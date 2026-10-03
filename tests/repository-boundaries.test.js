import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { TraceRepository } from "../server/trace-repository.mjs";

test("deduplicates snapshots when migrated and legacy files coexist", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "astro-repository-boundary-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const event = {
    id: "same", source: "codex", sessionId: "session",
    capturedAt: "2026-09-10T00:00:00Z", eventName: "SessionStart", payload: {},
  };
  for (const directory of ["codex", "codex/2026/09-10/08:00:00-session"]) {
    mkdirSync(join(root, directory), { recursive: true });
    writeFileSync(join(root, directory, "events.jsonl"), `${JSON.stringify(event)}\n`);
  }
  const repository = new TraceRepository({ ASTRO_HOME: root });
  t.after(() => repository.stop());
  await repository.initialize();
  assert.deepEqual(repository.getEvents(), [event]);
  assert.equal((await repository.append([event])).length, 0);
  assert.equal(repository.getTraceFiles().length, 2);
});
