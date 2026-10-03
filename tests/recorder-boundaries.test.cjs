const assert = require("node:assert/strict");
const test = require("node:test");
const { createTraceEvent, redactValue } = require("../plugin/trace-recorder.cjs");

test("redacts JSON-encoded native arguments as well as parsed tool input", () => {
  const secret = "plain_secret_123456";
  const event = createTraceEvent({
    type: "response_item",
    payload: {
      type: "function_call",
      name: "request",
      call_id: "call-1",
      arguments: JSON.stringify({ apiKey: secret, query: "retain this" }),
    },
  }, { source: "codex" });
  assert.ok(!JSON.stringify(event).includes(secret));
  assert.equal(event.payload.tool_input.apiKey, "[redacted]");
  assert.equal(JSON.parse(event.payload.payload.arguments).query, "retain this");
});

test("redacts nested serialized objects without damaging ordinary strings", () => {
  const value = JSON.stringify({
    nested: JSON.stringify([{ password: "short" }]),
    text: "ordinary text",
  });
  assert.ok(!redactValue(value).includes("short"));
  assert.equal(redactValue("{not json"), "{not json");
  assert.equal(redactValue("plain text"), "plain text");
});

test("redacts browser metadata while retaining stable workspace identity", () => {
  const input = {
    source: "browser",
    sessionId: "session",
    eventName: "AgentMessage",
    cwd: "https://example.test/?api_key=plain_secret_123456&view=trace",
    payload: { message: "hello" },
  };
  const event = createTraceEvent(input);
  assert.ok(!JSON.stringify(event).includes("plain_secret_123456"));
  assert.equal(event.sessionId, input.sessionId);
  assert.equal(event.workspaceId, createTraceEvent(input).workspaceId);
  assert.notEqual(event.workspaceId, createTraceEvent({
    ...input, cwd: "https://example.test/?api_key=another_secret_987654&view=trace",
  }).workspaceId);
});
