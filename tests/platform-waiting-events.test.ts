import test from "node:test";
import assert from "node:assert/strict";
import { buildSessions } from "../src/lib/trace-model.ts";
import { getWaitingEventsForSource } from "../src/config/atom-platforms.ts";

const base = { workspaceId: "w", cwd: "/tmp/w" };
const ev = (
  sessionId: string,
  eventName: string,
  payload: object,
  sec: number,
  source = "workbuddy",
) => ({
  ...base,
  source,
  id: `${sessionId}-${eventName}-${sec}`,
  sessionId,
  eventName,
  capturedAt: `2026-09-08T08:00:0${sec}.000Z`,
  payload,
});

test("WorkBuddy keeps default waiting signals (no override)", () => {
  assert.equal(getWaitingEventsForSource("workbuddy"), undefined);
  // ZCode cannot capture Elicitation, so it overrides.
  assert.deepEqual(getWaitingEventsForSource("zcode"), ["PermissionRequest"]);
});

test("WorkBuddy PermissionRequest run stays waiting", () => {
  const sessions = buildSessions([
    ev("wb-a", "UserPromptSubmit", { prompt: "hi" }, 0),
    ev("wb-a", "PermissionRequest", { tool_name: "Bash" }, 1),
    ev("wb-b", "UserPromptSubmit", { prompt: "later" }, 2),
    ev("wb-b", "Stop", { responseText: "done" }, 3),
  ]);
  assert.equal(sessions.length, 2);
  const a = sessions.find((s) => s.key.includes("wb-a"))!;
  assert.equal(a.status, "waiting");
  const b = sessions.find((s) => s.key.includes("wb-b"))!;
  assert.equal(b.status, "complete");
});

test("codebuddy source maps to the workbuddy platform", () => {
  const sessions = buildSessions([
    ev("cb-1", "UserPromptSubmit", { prompt: "x" }, 0, "codebuddy"),
  ]);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].source, "workbuddy");
});