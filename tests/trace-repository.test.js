import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
