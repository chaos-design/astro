const assert = require("node:assert/strict");
const test = require("node:test");
const {
  adaptZcodePayload,
} = require("../plugin/zcode-adapter.cjs");
const { createTraceEvent } = require("../plugin/trace-recorder.cjs");

function zcodePayload(overrides = {}) {
  return {
    agentName: "main",
    cwd: "/tmp/astro-zcode",
    hookEventName: "PostToolUse",
    mode: "yolo",
    sessionId: "zcode-session",
    timestamp: "2026-10-06T12:00:00.000Z",
    toolCallId: "call_001",
    toolInput: { command: "echo hi" },
    toolName: "Bash",
    toolResponse: "hi\n",
    traceId: "trace-1",
    turnId: "turn_1",
    ...overrides,
  };
}

test("normalizes ZCode camelCase fields onto canonical names", () => {
  const [adapted] = adaptZcodePayload(zcodePayload());

  assert.equal(adapted.toolUseId, "call_001");
  assert.deepEqual(adapted.tool_input, { command: "echo hi" });
  assert.equal(adapted.tool_response, "hi\n");
  // The native payload stays on the event for inspection.
  assert.equal(adapted.toolCallId, "call_001");
  assert.equal(adapted.hookEventName, "PostToolUse");
});

test("maps a Stop payload with response text to AgentMessage then Stop", () => {
  const payloads = adaptZcodePayload(
    zcodePayload({
      hookEventName: "Stop",
      responseText: "All checks passed.",
      responsePreview: "All checks passed.",
      stopHookActive: false,
      toolCallCount: 3,
    }),
  );

  assert.equal(payloads.length, 2);
  assert.equal(payloads[0].eventName, "AgentMessage");
  assert.equal(payloads[0].message, "All checks passed.");
  assert.equal(payloads[1].eventName, "Stop");
});

test("keeps a Stop without response text as a single Stop", () => {
  const payloads = adaptZcodePayload(
    zcodePayload({ hookEventName: "Stop", responseText: "" }),
  );

  assert.deepEqual(payloads.map((payload) => payload.eventName), ["Stop"]);
});

test("drops payloads that are not one of the seven ZCode events", () => {
  // ZCode has no Notification, SubagentStop, or PreCompact hooks; if one
  // ever reaches the adapter it is not a traceable lifecycle moment.
  assert.deepEqual(
    adaptZcodePayload(zcodePayload({ hookEventName: "Notification" })),
    [],
  );
  assert.deepEqual(adaptZcodePayload({}), []);
  assert.deepEqual(adaptZcodePayload(null), []);
});

test("records an adapted payload as a canonical zcode trace event", () => {
  const [adapted] = adaptZcodePayload(
    zcodePayload({ hookEventName: "PostToolUseFailure", isInterrupt: true }),
  );
  const event = createTraceEvent(adapted, { source: "zcode" });

  assert.equal(event.eventName, "PostToolUseFailure");
  assert.equal(event.nativeEventName, "PostToolUseFailure");
  assert.equal(event.source, "zcode");
  assert.equal(event.sessionId, "zcode-session");
  assert.equal(event.cwd, "/tmp/astro-zcode");
  assert.equal(event.toolName, "Bash");
  assert.equal(event.toolUseId, "call_001");
  assert.equal(event.status, "failed");
});

test("UserPromptSubmit payloads keep their prompt text", () => {
  const [adapted] = adaptZcodePayload(
    zcodePayload({
      hookEventName: "UserPromptSubmit",
      prompt: "Run the test suite",
      toolCallId: undefined,
      toolInput: undefined,
      toolResponse: undefined,
    }),
  );
  const event = createTraceEvent(adapted, { source: "zcode" });

  assert.equal(event.eventName, "UserPromptSubmit");
  assert.equal(adapted.prompt, "Run the test suite");
});
