import assert from "node:assert/strict";
import test from "node:test";

import { buildAgentView } from "../src/lib/agent-view.ts";
import type { TraceEvent } from "../src/types/trace.ts";

/**
 * Two numbers, one source. The header clock states the *message's* accumulated
 * execution time; every step card states *its own* span, and an abnormal step
 * states why it ended. These tests pin the projection, because the rendering
 * has no second rule for either.
 */

const NOW = Date.parse("2026-11-26T10:00:00.000Z");

function event(
  id: string,
  eventName: string,
  offsetMs: number,
  payload: Record<string, unknown> = {},
  extra: Partial<TraceEvent> = {},
): TraceEvent {
  return {
    schemaVersion: 2,
    id,
    capturedAt: new Date(NOW + offsetMs).toISOString(),
    source: "zcode",
    sourceVersion: null,
    workspaceId: "ws",
    sessionId: "session-1",
    turnId: "turn-1",
    parentId: null,
    eventName,
    nativeEventName: eventName,
    toolUseId: null,
    toolName: null,
    cwd: "/tmp/project",
    status: null,
    sequence: null,
    payload,
    ...extra,
  } as TraceEvent;
}

test("a tool pair reports the pair span as the step's own duration", () => {
  const events = [
    event("s", "SessionStart", 0),
    event(
      "pre-1",
      "PreToolUse",
      1000,
      { tool_input: { command: "pnpm test" } },
      { toolUseId: "tool-1", toolName: "Bash" },
    ),
    event(
      "post-1",
      "PostToolUse",
      4600,
      { tool_input: { command: "pnpm test" }, tool_response: { exitCode: 0 } },
      { toolUseId: "tool-1", toolName: "Bash" },
    ),
  ];
  const view = buildAgentView(events, "zcode");
  const call = view.steps.find((step) => step.eventId === "pre-1");
  const result = view.steps.find((step) => step.eventId === "post-1");
  assert.ok(call);
  assert.ok(result);
  assert.equal(call.durationMs, 3600);
  assert.equal(result.durationMs, 3600);
  assert.equal(result.status, null);
  assert.equal(call.status, null);
});

test("a failed tool result carries its reason and the host's detail", () => {
  const events = [
    event(
      "pre-2",
      "PreToolUse",
      0,
      { tool_input: { command: "pnpm build" } },
      { toolUseId: "tool-2", toolName: "Bash" },
    ),
    event(
      "post-2",
      "PostToolUseFailure",
      900,
      {
        tool_input: { command: "pnpm build" },
        tool_response: { exitCode: 1, stderr: "TS2304: Cannot find name 'X'." },
      },
      { toolUseId: "tool-2", toolName: "Bash" },
    ),
  ];
  const view = buildAgentView(events, "zcode");
  const failed = view.steps.find((step) => step.eventId === "post-2");
  assert.ok(failed?.status);
  assert.equal(failed.status.status, "failed");
  assert.equal(failed.status.kind, "tool-failure");
  assert.equal(failed.status.scope, "tool");
  assert.equal(failed.status.reason, "error");
  assert.match(failed.status.detail ?? "", /TS2304/);
  assert.equal(failed.durationMs, 900);
});

test("a streamed reply's own span is first snapshot to final message", () => {
  const events = [
    event("m1", "AgentMessage", 0, { message: "先说一句", messageId: "m", streamed: true }),
    event("m2", "AgentMessage", 1200, { message: "先说一句，再说第二句", messageId: "m", streamed: true }),
    event("m3", "AgentMessage", 3000, { message: "先说一句，再说第二句，收口。", messageId: "m" }),
  ];
  const view = buildAgentView(events, "opencode");
  const reply = view.steps.find((step) => step.kind === "reply");
  assert.ok(reply?.kind === "reply");
  assert.equal(reply.snapshotCount, 2);
  assert.equal(reply.durationMs, 3000);
  assert.equal(reply.status, null);
});

test("a terminated Stop states the interruption, not a generic failure", () => {
  const events = [
    event("stop", "Stop", 500, { status: "cancelled", reason: "user cancelled the turn" }),
  ];
  const view = buildAgentView(events, "claude");
  const step = view.steps.find((entry) => entry.eventId === "stop");
  assert.ok(step?.status);
  assert.equal(step.status.status, "terminated");
  assert.equal(step.status.reason, "aborted");
  assert.match(step.status.detail ?? "", /cancelled the turn/);
});

test("a normal Stop carries no status", () => {
  const events = [
    event("stop", "Stop", 500, { last_assistant_message: "done" }),
  ];
  const view = buildAgentView(events, "codebuddy");
  const step = view.steps.find((entry) => entry.eventId === "stop");
  assert.ok(step);
  assert.equal(step.status, null);
});

test("steps without a measurable span report null, never a fabricated zero", () => {
  const events = [
    event("r1", "Reasoning", 0, { text: "先想一下" }),
    event("n1", "Notification", 50, { message: "rate limited" }),
  ];
  const view = buildAgentView(events, "opencode");
  const thinking = view.steps.find((step) => step.kind === "thinking");
  const plain = view.steps.find((step) => step.kind === "event");
  assert.equal(thinking?.durationMs, null);
  assert.equal(plain?.durationMs, null);
});
