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

test("a system authorization does not block, but a question does", () => {
  const sessions = buildSessions([
    ev("wb-a", "UserPromptSubmit", { prompt: "hi" }, 0),
    ev("wb-a", "PermissionRequest", { tool_name: "Bash" }, 1),
    ev("wb-b", "UserPromptSubmit", { prompt: "later" }, 2),
    ev("wb-b", "Stop", { responseText: "done" }, 3),
    ev("wb-c", "UserPromptSubmit", { prompt: "pick one" }, 4),
    ev(
      "wb-c",
      "PermissionRequest",
      {
        tool_name: "AskUserQuestion",
        tool_input: { questions: [{ question: "A or B?" }] },
      },
      5,
    ),
  ]);
  assert.equal(sessions.length, 3);
  const a = sessions.find((s) => s.key.includes("wb-a"))!;
  assert.equal(a.status, "active");
  const b = sessions.find((s) => s.key.includes("wb-b"))!;
  assert.equal(b.status, "complete");
  const c = sessions.find((s) => s.key.includes("wb-c"))!;
  assert.equal(c.status, "waiting");
});

test("codebuddy source maps to the workbuddy platform", () => {
  const sessions = buildSessions([
    ev("cb-1", "UserPromptSubmit", { prompt: "x" }, 0, "codebuddy"),
  ]);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].source, "workbuddy");
});