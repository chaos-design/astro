import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { TraceStore } from "../server/trace-store.mjs";

test("appends atomic events once and supports exact lookup", async () => {
  const root = mkdtempSync(join(tmpdir(), "astro-store-"));
  const traceFile = join(root, "events.jsonl");
  const store = new TraceStore(traceFile);
  await store.initialize();
  const event = {
    schemaVersion: 2,
    id: "event-1",
    capturedAt: "2026-09-07T08:00:00.000Z",
    source: "browser",
    sessionId: "session-1",
    eventName: "AgentMessage",
    payload: { message: "Done" },
  };

  assert.equal(store.append([event]).length, 1);
  assert.equal(store.append([event]).length, 0);
  assert.deepEqual(store.getEvent("event-1"), event);
  assert.equal(readFileSync(traceFile, "utf8").trim().split("\n").length, 1);

  rmSync(root, { recursive: true, force: true });
});
