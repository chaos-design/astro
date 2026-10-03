import assert from "node:assert/strict";
import test from "node:test";

import { mapOpenCodeEvent } from "../opencode-plugin/mapping.ts";

const session = "ses_test";

test("session.created starts a trace session", () => {
  assert.deepEqual(mapOpenCodeEvent({ type: "session.created", data: { sessionID: session } }), [
    { eventName: "SessionStart" },
  ]);
});

test("events without a session id are ignored", () => {
  assert.deepEqual(mapOpenCodeEvent({ type: "session.tool.called", data: {} }), []);
});

test("user inbox items become prompt submissions", () => {
  assert.deepEqual(
    mapOpenCodeEvent({
      type: "session.inbox.enqueued",
      data: { sessionID: session, item: { type: "user", payload: { text: "hi" } } },
    }),
    [{ eventName: "UserPromptSubmit", prompt: "hi" }],
  );
  assert.deepEqual(
    mapOpenCodeEvent({
      type: "session.inbox.enqueued",
      data: { sessionID: session, item: { type: "synthetic", payload: { text: "x" } } },
    }),
    [],
  );
});

test("tool calls carry tool identity and payload", () => {
  assert.deepEqual(
    mapOpenCodeEvent({
      type: "session.tool.called",
      data: { sessionID: session, id: "call_1", name: "shell", input: { command: "ls" } },
    }),
    [
      {
        eventName: "PreToolUse",
        toolUseId: "call_1",
        toolName: "shell",
        tool_input: { command: "ls" },
      },
    ],
  );
});

test("unknown tool outcomes with an error are recorded as failures", () => {
  const payloads = mapOpenCodeEvent({
    type: "session.tool.somethingnew",
    data: { sessionID: session, id: "call_2", error: "boom" },
  });
  assert.equal(payloads[0]?.eventName, "PostToolUseFailure");
  assert.equal(payloads[0]?.status, "failed");
  assert.equal(payloads[0]?.toolUseId, "call_2");
});

test("tool progress and unknown tool events without errors are dropped", () => {
  assert.deepEqual(
    mapOpenCodeEvent({ type: "session.tool.progress", data: { sessionID: session } }),
    [],
  );
  assert.deepEqual(
    mapOpenCodeEvent({ type: "session.tool.input.started", data: { sessionID: session } }),
    [],
  );
});

test("a finished step ends the run, a tool-call step does not", () => {
  assert.deepEqual(
    mapOpenCodeEvent({
      type: "session.step.ended",
      data: { sessionID: session, finish: "stop" },
    }),
    [{ eventName: "Stop" }],
  );
  assert.deepEqual(
    mapOpenCodeEvent({
      type: "session.step.ended",
      data: { sessionID: session, finish: "tool-calls" },
    }),
    [],
  );
  assert.deepEqual(
    mapOpenCodeEvent({
      type: "session.step.ended",
      data: { sessionID: session, finish: "length" },
    }),
    [{ eventName: "StopFailure", status: "failed" }],
  );
});

test("stream deltas and usage updates are not traceable events", () => {
  for (const type of [
    "session.text.delta",
    "session.reasoning.delta",
    "session.usage.updated",
    "session.step.streamed",
    "server.connected",
  ]) {
    assert.deepEqual(mapOpenCodeEvent({ type, data: { sessionID: session } }), [], type);
  }
});

test("terminal lifecycle events map to canonical names", () => {
  assert.deepEqual(
    mapOpenCodeEvent({ type: "session.reasoning.ended", data: { sessionID: session, text: "why" } }),
    [{ eventName: "Reasoning", message: "why" }],
  );
  assert.deepEqual(
    mapOpenCodeEvent({ type: "session.text.ended", data: { sessionID: session, text: "done" } }),
    [{ eventName: "AgentMessage", message: "done" }],
  );
  assert.deepEqual(
    mapOpenCodeEvent({ type: "session.execution.interrupted", data: { sessionID: session } }),
    [{ eventName: "Interrupt" }],
  );
  assert.deepEqual(
    mapOpenCodeEvent({ type: "session.deleted", data: { sessionID: session } }),
    [{ eventName: "SessionEnd" }],
  );
});