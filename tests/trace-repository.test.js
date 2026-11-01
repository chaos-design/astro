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
      id: "codex-event",
      source: "codex",
      sessionId: "codex-session",
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
    ["codex-event", "trae-event"],
  );
  assert.deepEqual(repository.getTraceFiles(), [
    join(
      root,
      "codex",
      ...formatSessionPath(new Date(events[0].capturedAt), "codex-session"),
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
    source: "codex",
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
