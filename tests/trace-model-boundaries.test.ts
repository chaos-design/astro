import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFlow, buildSessionPromptRuns, buildSessions, getEventSummary,
  getFlowNodeIdForEvent, normalizeTraceEvent, parseImportedTrace,
} from "../src/lib/trace-model.ts";

function makeEvent(eventName: string, index: number, extra = {}) {
  return normalizeTraceEvent({
    id: `event-${index}`, source: "codex", workspaceId: "workspace",
    sessionId: "session", eventName, capturedAt: new Date(1_000 + index * 100).toISOString(),
    payload: {}, ...extra,
  });
}

test("a new prompt reactivates every terminal session state", () => {
  const terminalCases = [
    { stop: {}, expected: "complete" },
    { stop: { status: "failed" }, expected: "failed" },
    { stop: { status: "cancelled" }, expected: "terminated" },
  ] as const;

  for (const { stop, expected } of terminalCases) {
    const events = [
      makeEvent("UserPromptSubmit", 0),
      makeEvent("Stop", 1, stop),
    ];
    const session = buildSessions(events)[0];
    assert.equal(session.status, expected);
    assert.equal(buildSessionPromptRuns(session)[0].status, expected);

    const resumed = buildSessions([
      ...events,
      makeEvent("UserPromptSubmit", 2),
    ])[0];
    assert.equal(resumed.status, "active");
    assert.deepEqual(
      buildSessionPromptRuns(resumed).map((run) => run.status),
      [expected, "active"],
    );
  }
});

test("a new prompt ignores stale terminal status metadata", () => {
  for (const status of ["failed", "cancelled"]) {
    const session = buildSessions([
      makeEvent("UserPromptSubmit", 0),
      makeEvent("Stop", 1, { status }),
      makeEvent("UserPromptSubmit", 2, { status }),
    ])[0];

    assert.equal(session.status, "active");
    assert.equal(buildSessionPromptRuns(session).at(-1)?.status, "active");
  }
});

test("legacy StopFailure imports retain failure semantics", () => {
  const [event] = parseImportedTrace('{"hook_event_name":"StopFailure","session_id":"s"}');
  assert.equal(event.eventName, "StopFailure");
  assert.equal(buildSessions([event])[0].status, "failed");
});

test("merges duplicate event IDs without deduplicating repeated prompt text", () => {
  const prompt = makeEvent("UserPromptSubmit", 0, { payload: { prompt: "same" } });
  const stop = makeEvent("Stop", 1);
  const repeat = makeEvent("UserPromptSubmit", 2, { payload: { prompt: "same" } });
  const session = buildSessions([prompt, stop, prompt, stop, repeat, repeat])[0];
  assert.deepEqual(session.events.map((event) => event.id), [prompt.id, stop.id, repeat.id]);
  const runs = buildSessionPromptRuns(session);
  assert.equal(runs.length, 2);
  assert.equal(new Set(runs.map((run) => run.key)).size, 2);
});

test("structured imported prompts remain inspectable and produce text summaries", () => {
  const [event] = parseImportedTrace(JSON.stringify([{
    id: "structured", eventName: "UserPromptSubmit",
    payload: { prompt: { text: "hello" }, custom: { keep: true } },
  }]));
  assert.equal(typeof getEventSummary(event), "string");
  assert.equal(buildSessionPromptRuns(buildSessions([event])[0])[0].title, "hello");
  assert.deepEqual(event.payload.custom, { keep: true });
});

test("rejects nonobject import rows and accepts blank JSONL separators", () => {
  for (const text of ["[null]", "[1]", "[[]]", '[{"payload":"bad"}]']) {
    assert.throws(() => parseImportedTrace(text), /object/i);
  }
  assert.equal(parseImportedTrace('{"id":"a"}\n  \n{"id":"b"}').length, 2);
  assert.deepEqual(parseImportedTrace(" \n "), []);
});

test("reused tool IDs keep separate selectable occurrences and consume results", () => {
  const events = ["PreToolUse", "PostToolUse", "PreToolUse", "PostToolUse", "PostToolUse"]
    .map((name, index) => makeEvent(name, index, { toolUseId: "same-tool" }));
  const flow = buildFlow(events);
  assert.equal(flow.nodes.length, 3);
  assert.equal(new Set(flow.nodes.map((node) => node.id)).size, 3);
  assert.equal(flow.nodes[0].data.endEvent?.id, events[1].id);
  assert.equal(flow.nodes[1].data.endEvent?.id, events[3].id);
  const id = getFlowNodeIdForEvent(events[3], flow.nodes);
  assert.equal(flow.nodes.find((node) => node.id === id)?.data.startEvent.id, events[2].id);
  assert.ok(flow.edges.every((edge) => edge.source !== edge.target));
});

test("tool pairing does not cross parent execution contexts", () => {
  const events = [
    makeEvent("PreToolUse", 0, { toolUseId: "call", parentId: "a" }),
    makeEvent("PreToolUse", 1, { toolUseId: "call", parentId: "b" }),
    makeEvent("PostToolUse", 2, { toolUseId: "call", parentId: "a" }),
    makeEvent("PostToolUse", 3, { toolUseId: "call", parentId: "b" }),
  ];
  const nodes = buildFlow(events).nodes;
  assert.equal(nodes[0].data.endEvent?.id, events[2].id);
  assert.equal(nodes[1].data.endEvent?.id, events[3].id);
});

test("a replay prefix does not contain future tool output", () => {
  const start = makeEvent("PreToolUse", 0, { toolUseId: "call" });
  const node = buildFlow([start]).nodes[0];
  assert.equal(node.data.status, "running");
  assert.equal(node.data.endEvent, null);
});
