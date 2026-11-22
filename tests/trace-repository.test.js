import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { TraceRepository } from "../server/trace-repository.mjs";
import storagePaths from "../plugin/storage-paths.cjs";

const { formatSessionPath } = storagePaths;

test("aggregates and persists events across agent data directories", async () => {
  const root = mkdtempSync(join(tmpdir(), "astro-repository-"));
  const repository = new TraceRepository(
    { ASTRO_HOME: root },
    { discoveryInterval: 20, pollInterval: 20 },
  );
  await repository.initialize();

  const events = [
    {
      id: "chatgpt-event",
      source: "chatgpt",
      sessionId: "chatgpt-session",
      eventName: "SessionStart",
      capturedAt: "2026-09-08T08:00:00.000Z",
      payload: {},
    },
    {
      id: "trae-event",
      source: "trae",
      sessionId: "trae-session",
      eventName: "AgentMessage",
      capturedAt: "2026-09-08T08:01:00.000Z",
      payload: { message: "Done" },
    },
  ];

  assert.equal((await repository.append(events)).length, 2);
  assert.deepEqual(
    repository.getEvents().map((event) => event.id),
    ["chatgpt-event", "trae-event"],
  );
  assert.deepEqual(repository.getTraceFiles(), [
    join(
      root,
      "chatgpt",
      ...formatSessionPath(new Date(events[0].capturedAt), "chatgpt-session"),
      "events.jsonl",
    ),
    join(
      root,
      "trae",
      ...formatSessionPath(new Date(events[1].capturedAt), "trae-session"),
      "events.jsonl",
    ),
  ]);

  repository.stop();
  rmSync(root, { recursive: true, force: true });
});

test("publishes a snapshot that includes newly discovered trace files", async () => {
  const root = mkdtempSync(join(tmpdir(), "astro-repository-discovery-"));
  const repository = new TraceRepository(
    { ASTRO_HOME: root },
    { discoveryInterval: 20, pollInterval: 20 },
  );
  await repository.initialize();
  // Prime the merged snapshot cache the way a connected dashboard does. The
  // bug this guards: discovery folded the new file into the derived counts
  // without invalidating that cache, so the broadcast `reset` shipped the
  // previous snapshot and a freshly written session stayed invisible until
  // one of its events arrived.
  repository.getEvents();

  const event = {
    id: "late-event",
    source: "claude",
    sessionId: "late-session",
    eventName: "UserPromptSubmit",
    capturedAt: "2026-09-08T09:00:00.000Z",
    payload: {},
  };
  const traceFile = join(
    root,
    "claude",
    ...formatSessionPath(new Date(event.capturedAt), event.sessionId),
    "events.jsonl",
  );
  mkdirSync(dirname(traceFile), { recursive: true });
  writeFileSync(traceFile, `${JSON.stringify(event)}\n`);

  const snapshot = await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("timeout waiting for the discovery reset")),
      3_000,
    );
    repository.once("reset", (events) => {
      clearTimeout(timer);
      resolve(events);
    });
    repository.start();
  });

  assert.deepEqual(snapshot.map((entry) => entry.id), ["late-event"]);
  assert.deepEqual(repository.getEvents().map((entry) => entry.id), [
    "late-event",
  ]);
  assert.equal(repository.getEventCount(), 1);

  repository.stop();
  rmSync(root, { recursive: true, force: true });
});

test("snapshot key identifies the history and changes with it", async () => {
  const root = mkdtempSync(join(tmpdir(), "astro-snapshot-key-"));
  const repository = new TraceRepository(
    { ASTRO_HOME: root },
    { discoveryInterval: 20, pollInterval: 20 },
  );
  await repository.initialize();

  // Empty history still has a key: a restart with nothing recorded must be
  // answered by `reset-same` instead of an empty snapshot.
  const empty = repository.getSnapshotKey();
  assert.match(empty, /^[0-9a-z]+-[0-9a-z]+$/);
  assert.equal(repository.getSnapshotKey(), empty, "the key is cached");

  const event = (id) => ({
    id,
    source: "chatgpt",
    sessionId: "session",
    eventName: "SessionStart",
    capturedAt: "2026-11-01T08:00:00.000Z",
    payload: {},
  });
  await repository.append([event("a"), event("b")]);
  const afterAppend = repository.getSnapshotKey();
  assert.notEqual(afterAppend, empty);
  assert.equal(repository.getSnapshotKey(), afterAppend);

  // Appending a new event on top must produce a new key, otherwise a restart
  // would be answered with a snapshot the client does not actually have.
  const beforeAppend = repository.getSnapshotKey();
  await repository.append([event("c")]);
  assert.notEqual(repository.getSnapshotKey(), beforeAppend);

  repository.stop();
  rmSync(root, { recursive: true, force: true });
});

test("tracks per-source capture versions and flags drift after a reinstall", async () => {
  const root = mkdtempSync(join(tmpdir(), "astro-repository-version-"));
  const repository = new TraceRepository(
    { ASTRO_HOME: root },
    { discoveryInterval: 20, pollInterval: 20 },
  );
  await repository.initialize();
  const event = (id, version, at) => ({
    id,
    source: "opencode",
    sessionId: "session",
    eventName: "SessionStart",
    capturedAt: at,
    payload: version ? { captureVersion: version } : {},
  });
  try {
    assert.deepEqual(repository.getCaptureVersions(), {});
    await repository.append([
      event("old", "0.0.3", "2026-11-01T08:00:00.000Z"),
      event("fresh", "0.0.6", "2026-11-02T08:00:00.000Z"),
    ]);
    const state = repository.getCaptureVersions().opencode;
    assert.deepEqual(
      state.versions.map((entry) => entry.version),
      ["0.0.6", "0.0.3"],
      "newest capture version first",
    );
    assert.equal(state.stale, true, "two stamped versions = stale process drift");
    assert.equal(state.unversionedAt, null);
  } finally {
    repository.stop();
    rmSync(root, { recursive: true, force: true });
  }
});

test("an unstamped event after a stamped one reveals a still-running old process", async () => {
  // This is the real bug: a process running pre-stamp code writes NO
  // captureVersion at all, so counting only stamped versions showed one value
  // and never warned. The unversioned bucket must make that drift visible.
  const root = mkdtempSync(join(tmpdir(), "astro-repository-unversioned-"));
  const repository = new TraceRepository(
    { ASTRO_HOME: root },
    { discoveryInterval: 20, pollInterval: 20 },
  );
  await repository.initialize();
  const event = (id, version, at) => ({
    id,
    source: "pi",
    sessionId: "session",
    eventName: "AgentMessage",
    capturedAt: at,
    payload: version ? { captureVersion: version } : {},
  });
  try {
    // A reinstalled, restarted process writes stamped events first.
    await repository.append([event("new", "0.0.6", "2026-11-02T08:00:00.000Z")]);
    let state = repository.getCaptureVersions().pi;
    assert.equal(state.stale, false, "one stamped version alone is not drift");

    // The old process was never killed and writes an unstamped event later.
    await repository.append([event("old-still-writing", null, "2026-11-02T08:01:00.000Z")]);
    state = repository.getCaptureVersions().pi;
    assert.equal(state.unversionedAt, Date.parse("2026-11-02T08:01:00.000Z"));
    assert.equal(state.stale, true, "unstamped event at/after newest stamp = drift");

    // Old history only, from before stamping existed, is not drift: no stamped
    // version to compare against.
    const root2 = mkdtempSync(join(tmpdir(), "astro-repository-legacy-"));
    const repository2 = new TraceRepository(
      { ASTRO_HOME: root2 },
      { discoveryInterval: 20, pollInterval: 20 },
    );
    await repository2.initialize();
    try {
      await repository2.append([event("legacy", null, "2026-10-01T08:00:00.000Z")]);
      const legacy = repository2.getCaptureVersions().pi;
      assert.equal(legacy.stale, false, "no stamped version, no drift to report");
      assert.equal(typeof legacy.unversionedAt, "number");
    } finally {
      repository2.stop();
      rmSync(root2, { recursive: true, force: true });
    }
  } finally {
    repository.stop();
    rmSync(root, { recursive: true, force: true });
  }
});
