import assert from "node:assert/strict";
import test from "node:test";

import {
  isTerminalEventName,
  mapOpenCodeEvent,
} from "../opencode-plugin/mapping.ts";

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

test("tool name comes from the caller when the event omits it", () => {
  const [payload] = mapOpenCodeEvent(
    {
      type: "session.tool.called",
      data: { sessionID: session, id: "functions.shell:0", input: { command: "ls" } },
    },
    { toolName: "shell" },
  );
  assert.equal(payload?.toolName, "shell");
  assert.equal(payload?.toolUseId, "functions.shell:0");

  // session.tool.input.started only carries the name, so it is not traceable.
  assert.deepEqual(
    mapOpenCodeEvent({
      type: "session.tool.input.started",
      data: { sessionID: session, id: "functions.shell:0", name: "shell" },
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

test("a failed tool call is recorded with its error payload", () => {
  const payloads = mapOpenCodeEvent({
    type: "session.tool.failed",
    data: {
      sessionID: session,
      id: "call_2",
      name: "write",
      error: { type: "aborted", message: "The user declined this tool call" },
    },
  });
  assert.equal(payloads[0]?.eventName, "PostToolUseFailure");
  assert.equal(payloads[0]?.status, "failed");
  assert.equal(payloads[0]?.toolUseId, "call_2");
  assert.deepEqual(payloads[0]?.tool_response, {
    type: "aborted",
    message: "The user declined this tool call",
  });
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

test("a tool result with a non-zero exit code is marked failed", () => {
  const failed = mapOpenCodeEvent({
    type: "session.tool.success",
    data: {
      sessionID: session,
      id: "call_3",
      name: "shell",
      metadata: { exit: 1 },
      content: [{ type: "text", text: "boom" }],
    },
  });
  assert.equal(failed[0]?.eventName, "PostToolUse");
  assert.equal(failed[0]?.status, "failed");

  const ok = mapOpenCodeEvent({
    type: "session.tool.success",
    data: { sessionID: session, id: "call_4", metadata: { exit: 0 } },
  });
  assert.equal(ok[0]?.status, undefined);
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

test("permission requests and rejections map to canonical names", () => {
  const asked = mapOpenCodeEvent({
    type: "permission.asked",
    data: {
      sessionID: session,
      id: "per_1",
      action: "external_directory",
      resources: ["/etc/*"],
      source: { type: "tool", id: "functions.write:2" },
    },
  });
  assert.equal(asked[0]?.eventName, "PermissionRequest");
  assert.equal(asked[0]?.toolUseId, "functions.write:2");

  const denied = mapOpenCodeEvent({
    type: "permission.replied",
    data: { sessionID: session, requestID: "per_1", reply: "reject" },
  });
  assert.equal(denied[0]?.eventName, "PermissionDenied");

  assert.deepEqual(
    mapOpenCodeEvent({
      type: "permission.replied",
      data: { sessionID: session, requestID: "per_1", reply: "once" },
    }),
    [],
  );
});

test("a failed step distinguishes interruption from failure", () => {
  assert.deepEqual(
    mapOpenCodeEvent({
      type: "session.step.failed",
      data: { sessionID: session, error: { type: "aborted", message: "Step interrupted" } },
    }),
    [{ eventName: "Interrupt", status: "failed" }],
  );
  const failure = mapOpenCodeEvent({
    type: "session.step.failed",
    data: { sessionID: session, error: { type: "provider", message: "500" } },
  });
  assert.equal(failure[0]?.eventName, "StopFailure");
  assert.equal(failure[0]?.status, "failed");
});

test("terminal event names are recognizable for deduplication", () => {
  assert.equal(isTerminalEventName("Stop"), true);
  assert.equal(isTerminalEventName("StopFailure"), true);
  assert.equal(isTerminalEventName("Interrupt"), true);
  assert.equal(isTerminalEventName("PreToolUse"), false);
});

test("compaction maps to the canonical compact events", () => {
  assert.deepEqual(
    mapOpenCodeEvent({
      type: "session.compaction.started",
      data: { sessionID: session, reason: "manual", inputID: "msg_1" },
    }),
    [{ eventName: "PreCompact", reason: "manual" }],
  );
  const ended = mapOpenCodeEvent({
    type: "session.compaction.ended",
    data: { sessionID: session, reason: "manual", text: "## Objective" },
  });
  assert.equal(ended[0]?.eventName, "PostCompact");
  assert.equal(ended[0]?.message, "## Objective");

  const failed = mapOpenCodeEvent({
    type: "session.compaction.failed",
    data: { sessionID: session, error: { type: "provider", message: "500" } },
  });
  assert.equal(failed[0]?.eventName, "PostCompact");
  assert.equal(failed[0]?.status, "failed");

  // Streaming deltas carry no trajectory meaning.
  assert.deepEqual(
    mapOpenCodeEvent({
      type: "session.compaction.delta",
      data: { sessionID: session, text: "##" },
    }),
    [],
  );
});

test("events with unverified payloads stay unmapped", () => {
  for (const type of [
    "session.idle",
    "session.instructions.updated",
    "session.inbox.delivered",
    "session.message.content.updated",
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
    mapOpenCodeEvent({
      type: "session.execution.interrupted",
      data: { sessionID: session, reason: "user" },
    }),
    [{ eventName: "Interrupt", reason: "user" }],
  );
  assert.deepEqual(
    mapOpenCodeEvent({ type: "session.deleted", data: { sessionID: session } }),
    [{ eventName: "SessionEnd" }],
  );
});