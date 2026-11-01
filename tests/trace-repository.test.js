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
