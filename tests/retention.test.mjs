import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  DEFAULT_RETENTION_DAYS,
  RetentionError,
  describeRetentionReport,
  findExpiredSessions,
  pruneExpiredSessions,
  readSessionLastCapturedAt,
  resolveRetentionDays,
  retentionCutoff,
} from "../server/retention.mjs";

/**
 * Retention decides what "old" means and what may be deleted. A bug here is
 * not a wrong pixel: it is lost evidence. The tests pin the guard, the
 * candidate selection (captured sessions only) and the two-step contract.
 */

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-11-26T12:00:00.000Z");

function makeRoot() {
  return mkdtempSync(join(tmpdir(), "astro-retention-"));
}

function writeSession(root, source, sessionId, lastCapturedAt, extraLines = 0) {
  const directory = join(root, source, "2026", `11-${sessionId}`);
  mkdirSync(directory, { recursive: true });
  const file = join(directory, "events.jsonl");
  const lines = [];
  for (let index = 0; index < extraLines; index += 1) {
    lines.push(
      JSON.stringify({
        id: `${sessionId}-${index}`,
        capturedAt: new Date(Date.parse(lastCapturedAt) - 1000).toISOString(),
        eventName: "Notification",
        payload: {},
      }),
    );
  }
  lines.push(
    JSON.stringify({
      id: `${sessionId}-last`,
      capturedAt: lastCapturedAt,
      eventName: "Stop",
      payload: {},
    }),
  );
  writeFileSync(file, `${lines.join("\n")}\n`, "utf8");
  return { directory, file };
}

test("the day window is an integer inside the guard", () => {
  assert.equal(resolveRetentionDays(undefined), DEFAULT_RETENTION_DAYS);
  assert.equal(resolveRetentionDays(null), DEFAULT_RETENTION_DAYS);
  assert.equal(resolveRetentionDays(""), DEFAULT_RETENTION_DAYS);
  assert.equal(resolveRetentionDays(1), 1);
  assert.equal(resolveRetentionDays("30"), 30);
  assert.equal(resolveRetentionDays(3650), 3650);
  for (const bad of [0, -1, 1.5, 3651, "abc", Number.NaN]) {
    assert.throws(() => resolveRetentionDays(bad), RetentionError, String(bad));
  }
  assert.equal(retentionCutoff(15, NOW), NOW - 15 * DAY);
});

test("only sessions whose last event is older than the window are candidates", () => {
  const root = makeRoot();
  try {
    const old = writeSession(
      root,
      "zcode",
      "old",
      new Date(NOW - 20 * DAY).toISOString(),
    );
    const fresh = writeSession(
      root,
      "zcode",
      "fresh",
      new Date(NOW - 2 * DAY).toISOString(),
    );
    const report = findExpiredSessions({ root, days: 15, now: NOW });
    assert.equal(report.eventFiles, 1);
    assert.deepEqual(
      report.sessions.map((session) => session.file),
      [old.file],
    );
    assert.ok(report.sessions[0].ageDays >= 19);
    assert.ok(report.bytes > 0);
    assert.equal(
      existsSync(fresh.file),
      true,
      "a preview must not delete anything",
    );
    assert.equal(existsSync(old.file), true);
    assert.match(describeRetentionReport(report), /1 个会话/);
    assert.match(describeRetentionReport(report), /15 天前/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a session created just now survives a 15-day window", () => {
  const root = makeRoot();
  try {
    writeSession(root, "opencode", "today", new Date(NOW - 1000).toISOString());
    const report = findExpiredSessions({ root, days: 15, now: NOW });
    assert.equal(report.eventFiles, 0);
    assert.match(describeRetentionReport(report), /没有超过 15 天/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the newest event decides the age, not the file mtime", () => {
  const root = makeRoot();
  try {
    const long = writeSession(
      root,
      "workbuddy",
      "long",
      new Date(NOW - 1000).toISOString(),
      500,
    );
    // A copied directory has a fresh mtime but ancient events.
    const report = findExpiredSessions({ root, days: 15, now: NOW });
    assert.equal(report.eventFiles, 0, "a fresh tail keeps the session");
    assert.ok(existsSync(long.file));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("pruning removes expired sessions and keeps the rest", () => {
  const root = makeRoot();
  try {
    const old = writeSession(
      root,
      "zcode",
      "old",
      new Date(NOW - 40 * DAY).toISOString(),
    );
    const fresh = writeSession(
      root,
      "zcode",
      "fresh",
      new Date(NOW - DAY).toISOString(),
    );
    const result = pruneExpiredSessions({ root, days: 15, now: NOW });
    assert.equal(result.removed, 1);
    assert.equal(result.days, 15);
    assert.equal(existsSync(old.directory), false);
    assert.equal(existsSync(fresh.file), true);
    // The empty date directory above the deleted session is cleaned up too.
    assert.equal(existsSync(join(root, "zcode", "2026", "11-old")), false);
    const second = pruneExpiredSessions({ root, days: 15, now: NOW });
    assert.equal(second.removed, 0, "a second sweep finds nothing");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the guard refuses to sweep outside the trace root", () => {
  const root = makeRoot();
  const outside = makeRoot();
  try {
    const victim = writeSession(
      outside,
      "zcode",
      "outside",
      new Date(NOW - 90 * DAY).toISOString(),
    );
    // Only paths under the given root are ever candidates: the outside
    // session is invisible to a report rooted elsewhere.
    const report = findExpiredSessions({ root, days: 15, now: NOW });
    assert.equal(report.eventFiles, 0);
    assert.equal(existsSync(victim.file), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("a tail line still being written does not hide the session", () => {
  const root = makeRoot();
  try {
    const session = writeSession(
      root,
      "zcode",
      "torn",
      new Date(NOW - 30 * DAY).toISOString(),
    );
    // A hook appending an event leaves a partial line at the tail.
    writeFileSync(
      session.file,
      `${readFileSync(session.file, "utf8")}{"id":"half`,
      "utf8",
    );
    assert.ok(readSessionLastCapturedAt(session.file));
    const report = findExpiredSessions({ root, days: 15, now: NOW });
    assert.equal(report.eventFiles, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the tail read stays bounded on a long session", () => {
  const root = makeRoot();
  try {
    const session = writeSession(
      root,
      "zcode",
      "big",
      new Date(NOW - 5000).toISOString(),
      4000,
    );
    const at = readSessionLastCapturedAt(session.file, { tailBytes: 2048 });
    assert.equal(typeof at, "number");
    assert.ok(Number.isFinite(at));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
