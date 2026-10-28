import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { TraceRepository } from "../server/trace-repository.mjs";
import {
  applySessionEvent,
  countSessionStates,
  createSessionRecord,
  serializeSessionRecord,
} from "../server/session-state.mjs";

const base = {
  source: "claude",
  sessionId: "session-1",
  workspaceId: "workspace",
  cwd: "/tmp/workspace",
  payload: {},
};

function event(id, eventName, extra = {}) {
  return {
    ...base,
    id,
    eventName,
    capturedAt: "2026-09-10T00:00:00.000Z",
    ...extra,
  };
}

function fold(events) {
  const record = createSessionRecord("claude::workspace::session-1", events[0]);
  for (const item of events) {
    applySessionEvent(record, item);
  }
  return record;
}

test("completes a session on Stop and keeps the reason", () => {
  const record = fold([
    event("p", "UserPromptSubmit"),
    event("c", "PreToolUse"),
    event("s", "Stop"),
  ]);

  assert.equal(record.state, "complete");
  assert.equal(record.reason, "completed");
  assert.equal(record.eventCount, 3);
});

test("reports an explicit termination cause instead of a bare terminated state", () => {
  assert.equal(fold([event("i", "Interrupt")]).reason, "interrupted");
  assert.equal(fold([event("e", "SessionEnd")]).reason, "session-end");
  assert.equal(
    fold([event("a", "Stop", { status: "aborted" })]).reason,
    "interrupted",
  );
});

test("keeps the failure reason from the recorded payload", () => {
  const record = fold([
    event("p", "UserPromptSubmit"),
    event("f", "StopFailure", { status: "failed", payload: { reason: "rate_limit" } }),
  ]);

  assert.equal(record.state, "failed");
  assert.equal(record.reason, "rate_limit");
});

test("marks permission prompts as waiting and resumes on progress", () => {
  const waiting = fold([
    event("p", "UserPromptSubmit"),
    event("r", "PermissionRequest"),
  ]);
  assert.equal(waiting.state, "waiting");

  applySessionEvent(waiting, event("c", "PreToolUse"));
  assert.equal(waiting.state, "active");
});

test("a later prompt reopens a finished session", () => {
  const record = fold([event("s", "Stop")]);
  assert.equal(record.state, "complete");

  applySessionEvent(record, event("p2", "UserPromptSubmit"));
  assert.equal(record.state, "active");
});

test("serializes without leaking internal flags and counts every state", () => {
  const record = fold([event("s", "Stop")]);
  const serialized = serializeSessionRecord(record);

  assert.equal(serialized.state, "complete");
  assert.equal("ended" in serialized, false);
  assert.deepEqual(countSessionStates([record]), {
    active: 0,
    waiting: 0,
    complete: 1,
    failed: 0,
    terminated: 0,
  });
});

test("serves per-session capture states from the repository index", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "astro-session-state-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const directory = join(root, "claude", "2026", "09-10", "08:00:00-session-1");
  mkdirSync(directory, { recursive: true });
  const events = [
    { ...event("p", "UserPromptSubmit"), sessionId: "live" },
    { ...event("i", "Interrupt"), sessionId: "stopped", id: "i2" },
  ];
  writeFileSync(
    join(directory, "events.jsonl"),
    `${events.map((item) => JSON.stringify(item)).join("\n")}\n`,
  );

  const repository = new TraceRepository({ ASTRO_HOME: root });
  t.after(() => repository.stop());
  await repository.initialize();

  const summaries = repository.getSessionSummaries();
  assert.equal(summaries.length, 2);
  assert.equal(repository.getEventCount(), 2);
  assert.deepEqual(repository.getSessionStateCounts(), {
    active: 1,
    waiting: 0,
    complete: 0,
    failed: 0,
    terminated: 1,
  });
  // The merged list is cached: repeated reads return the same instance.
  assert.equal(repository.getEvents(), repository.getEvents());
});
