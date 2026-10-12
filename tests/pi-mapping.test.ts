import assert from "node:assert/strict";
import test from "node:test";
import {
  isTerminalEventName,
  mapPiEvent,
  type PiMappingContext,
} from "../pi-plugin/mapping.ts";

function assistantMessage(overrides: Record<string, unknown> = {}) {
  return {
    role: "assistant",
    content: [{ type: "text", text: "All done." }],
    provider: "anthropic",
    model: "claude-sonnet-4-5",
    usage: { totalTokens: 42 },
    stopReason: "stop",
    ...overrides,
  };
}

test("session_start opens a session", () => {
  assert.deepEqual(mapPiEvent("session_start", {}, {}), [
    { eventName: "SessionStart" },
  ]);
});

test("input caches the prompt and before_agent_start consumes it", () => {
  const context: PiMappingContext = {};
  assert.deepEqual(mapPiEvent("input", { text: "fix the bug" }, context), []);
  assert.equal(context.pendingPrompt, "fix the bug");

  assert.deepEqual(mapPiEvent("before_agent_start", {}, context), [
    { eventName: "UserPromptSubmit", prompt: "fix the bug" },
  ]);
  assert.equal(context.pendingPrompt, undefined);
});

test("before_agent_start without a pending prompt records nothing", () => {
  const context: PiMappingContext = {};
  assert.deepEqual(mapPiEvent("before_agent_start", {}, context), []);
});

test("assistant message_end with text stops the run", () => {
  const payloads = mapPiEvent(
    "message_end",
    { message: assistantMessage() },
    {},
  );
  assert.equal(payloads.length, 2);
  assert.equal(payloads[0].eventName, "AgentMessage");
  assert.equal(payloads[0].message, "All done.");
  assert.equal(payloads[0].model, "claude-sonnet-4-5");
  assert.equal(payloads[1].eventName, "Stop");
});

test("assistant thinking blocks map to Reasoning before AgentMessage", () => {
  const payloads = mapPiEvent(
    "message_end",
    {
      message: assistantMessage({
        content: [
          { type: "thinking", thinking: "Let me look." },
          { type: "text", text: "Looking now." },
        ],
      }),
    },
    {},
  );
  assert.deepEqual(
    payloads.map((payload) => payload.eventName),
    ["Reasoning", "AgentMessage", "Stop"],
  );
  assert.equal(payloads[0].message, "Let me look.");
});

test("a toolUse stop keeps the loop open and records no terminal", () => {
  const payloads = mapPiEvent(
    "message_end",
    { message: assistantMessage({ stopReason: "toolUse" }) },
    {},
  );
  assert.deepEqual(
    payloads.map((payload) => payload.eventName),
    ["AgentMessage"],
  );
});

test("error and aborted stops map to failure and interrupt", () => {
  const failure = mapPiEvent(
    "message_end",
    {
      message: assistantMessage({
        stopReason: "error",
        errorMessage: "rate limited",
        content: [],
      }),
    },
    {},
  );
  assert.equal(failure.length, 1);
  assert.equal(failure[0].eventName, "StopFailure");
  assert.equal(failure[0].status, "failed");
  assert.deepEqual(failure[0].error, { message: "rate limited" });

  const aborted = mapPiEvent(
    "message_end",
    {
      message: assistantMessage({
        stopReason: "aborted",
        errorMessage: "user aborted",
        content: [],
      }),
    },
    {},
  );
  assert.equal(aborted.length, 1);
  assert.equal(aborted[0].eventName, "Interrupt");
  assert.equal(aborted[0].reason, "user aborted");
});

test("non-assistant message_end events are dropped", () => {
  assert.deepEqual(
    mapPiEvent("message_end", { message: { role: "user", content: "hi" } }, {}),
    [],
  );
  assert.deepEqual(
    mapPiEvent(
      "message_end",
      { message: { role: "toolResult", content: [] } },
      {},
    ),
    [],
  );
});

test("tool_call maps to PreToolUse with the tool identity", () => {
  const payloads = mapPiEvent(
    "tool_call",
    { toolCallId: "call_1", toolName: "bash", input: { command: "ls" } },
    {},
  );
  assert.deepEqual(payloads, [
    {
      eventName: "PreToolUse",
      toolUseId: "call_1",
      toolName: "bash",
      tool_input: { command: "ls" },
    },
  ]);
});

test("tool_result maps by isError and strips image blocks", () => {
  const success = mapPiEvent(
    "tool_result",
    {
      toolCallId: "call_1",
      toolName: "bash",
      content: [
        { type: "text", text: "out" },
        { type: "image", data: "aGVsbG8=", mimeType: "image/png" },
      ],
      details: { exit: 0 },
      isError: false,
    },
    {},
  );
  assert.equal(success.length, 1);
  assert.equal(success[0].eventName, "PostToolUse");
  assert.deepEqual(success[0].tool_response, {
    content: [{ type: "text", text: "out" }],
    details: { exit: 0 },
  });
  assert.equal(success[0].status, undefined);

  const failed = mapPiEvent(
    "tool_result",
    {
      toolCallId: "call_2",
      toolName: "bash",
      content: [{ type: "text", text: "boom" }],
      isError: true,
    },
    {},
  );
  assert.equal(failed.length, 1);
  assert.equal(failed[0].eventName, "PostToolUseFailure");
  assert.equal(failed[0].status, "failed");
});

test("user_bash and model_select map to notifications", () => {
  const bash = mapPiEvent(
    "user_bash",
    { command: "pnpm test", exitCode: 0 },
    {},
  );
  assert.equal(bash.length, 1);
  assert.equal(bash[0].eventName, "Notification");
  assert.equal(bash[0].message, "! pnpm test");

  const select = mapPiEvent(
    "model_select",
    { model: { id: "gpt-5-mini", provider: "openai" } },
    {},
  );
  assert.equal(select.length, 1);
  assert.equal(select[0].eventName, "Notification");
  assert.equal(select[0].message, "model → openai/gpt-5-mini");

  assert.deepEqual(mapPiEvent("model_select", {}, {}), []);
});

test("compaction and shutdown map to the canonical lifecycle", () => {
  assert.deepEqual(mapPiEvent("session_before_compact", {}, {}), [
    { eventName: "PreCompact" },
  ]);
  const compact = mapPiEvent(
    "session_compact",
    { summary: "Earlier work", tokensBefore: 1200 },
    {},
  );
  assert.deepEqual(compact, [
    {
      eventName: "PostCompact",
      message: "Earlier work",
      tokensBefore: 1200,
    },
  ]);
  assert.deepEqual(mapPiEvent("session_shutdown", {}, {}), [
    { eventName: "SessionEnd" },
  ]);
});

test("unmapped events return empty payloads", () => {
  for (const type of [
    "message_start",
    "message_update",
    "turn_start",
    "turn_end",
    "agent_start",
    "agent_end",
    "tool_execution_start",
    "tool_execution_update",
    "tool_execution_end",
    "resources_discover",
    "something_new",
  ]) {
    assert.deepEqual(mapPiEvent(type, {}, {}), [], type);
  }
});

test("terminal event names cover the run-closing set", () => {
  for (const name of ["Stop", "StopFailure", "Interrupt"]) {
    assert.equal(isTerminalEventName(name), true);
  }
  for (const name of ["AgentMessage", "UserPromptSubmit", "SessionEnd"]) {
    assert.equal(isTerminalEventName(name), false);
  }
});
