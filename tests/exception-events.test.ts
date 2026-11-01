import assert from "node:assert/strict";
import test from "node:test";
import {
  getExceptionOutcome,
  isFailureEvent,
  isTerminationEvent,
} from "../src/lib/exception-events.ts";
import { getTraceEventKey } from "../src/lib/trace-event-kind.ts";
import {
  buildSessionPromptRuns,
  buildSessions,
  getEventSummary,
  normalizeTraceEvent,
} from "../src/lib/trace-model.ts";

function event(
  eventName: string,
  payload: Record<string, unknown> = {},
  overrides: Record<string, unknown> = {},
) {
  return normalizeTraceEvent({
    capturedAt: "2026-10-01T08:00:00.000Z",
    eventName,
    id: `${eventName}-${JSON.stringify(payload)}-${JSON.stringify(overrides)}`,
    payload,
    sessionId: "exception-session",
    source: "claude",
    workspaceId: "workspace",
    ...overrides,
  });
}

function session(events: ReturnType<typeof event>[]) {
  const [built] = buildSessions(events);
  if (!built) {
    throw new Error("Session was not built.");
  }
  return built;
}

function timestamps(count: number) {
  return Array.from({ length: count }, (_, index) =>
    `2026-10-01T08:00:0${index}.000Z`,
  );
}

test("classifies the four exception scopes and their terminality", () => {
  const toolFailure = getExceptionOutcome(event("PostToolUseFailure"));
  assert.equal(toolFailure?.kind, "tool-failure");
  assert.equal(toolFailure?.scope, "tool");
  assert.equal(toolFailure?.status, "failed");
  assert.equal(toolFailure?.terminal, false);

  const exitCodeFailure = getExceptionOutcome(
    event("PostToolUse", { tool_response: { exitCode: 1 } }),
  );
  assert.equal(exitCodeFailure?.kind, "tool-failure");
  assert.equal(exitCodeFailure?.scope, "tool");
  assert.equal(exitCodeFailure?.terminal, false);

  const rejection = getExceptionOutcome(event("PermissionDenied"));
  assert.equal(rejection?.kind, "rejection");
  assert.equal(rejection?.scope, "interaction");
  assert.equal(rejection?.status, "failed");
  assert.equal(rejection?.terminal, false);

  const retryableRejection = getExceptionOutcome(
    event("PermissionDenied", { retry: true }),
  );
  assert.equal(retryableRejection?.status, "waiting");

  const turnFailure = getExceptionOutcome(event("StopFailure"));
  assert.equal(turnFailure?.kind, "turn-failure");
  assert.equal(turnFailure?.scope, "turn");
  assert.equal(turnFailure?.status, "failed");
  assert.equal(turnFailure?.terminal, true);

  const foldedTurnFailure = getExceptionOutcome(
    event("Stop", {}, { status: "failed" }),
  );
  assert.equal(foldedTurnFailure?.kind, "turn-failure");
  assert.equal(foldedTurnFailure?.terminal, true);

  const interruption = getExceptionOutcome(event("Interrupt"));
  assert.equal(interruption?.kind, "interruption");
  assert.equal(interruption?.status, "terminated");
  assert.equal(interruption?.terminal, true);

  const sessionEnd = getExceptionOutcome(event("SessionEnd"));
  assert.equal(sessionEnd?.scope, "session");
  assert.equal(sessionEnd?.reason, "session-end");

  assert.equal(getExceptionOutcome(event("Stop")), null);
  assert.equal(getExceptionOutcome(event("PostToolUse")), null);
});

test("a throttled turn waits instead of failing", () => {
  const rateLimited = getExceptionOutcome(
    event("StopFailure", { reason: "rate_limit", retry_after: 30 }),
  );
  assert.equal(rateLimited?.status, "waiting");
  assert.equal(rateLimited?.terminal, false);
});

test("tool failures never become terminations", () => {
  // A tool error that merely mentions a terminated process is still a tool
  // failure, not a stopped run.
  const toolError = event("PostToolUseFailure", {
    reason: "process terminated",
    tool_response: { error: "terminated" },
  });
  assert.equal(isTerminationEvent(toolError), false);
  assert.equal(getExceptionOutcome(toolError)?.status, "failed");

  const cancelledNotification = event(
    "Notification",
    {},
    { nativeEventName: "session.cancelled" },
  );
  assert.equal(isTerminationEvent(cancelledNotification), true);
  assert.equal(
    getExceptionOutcome(cancelledNotification)?.status,
    "terminated",
  );

  // A custom producer that names its own lifecycle event is still believed.
  assert.equal(isTerminationEvent(event("session.cancelled")), true);
});

test("termination outranks failure and cannot be revived by progress", () => {
  const keys = timestamps(5);
  const built = session([
    event("UserPromptSubmit", { prompt: "Run it" }, { capturedAt: keys[0] }),
    event("PostToolUseFailure", { tool_response: { error: "boom" } }, {
      capturedAt: keys[1],
    }),
    event("Interrupt", {}, { capturedAt: keys[2] }),
    event("PostToolUse", {}, { capturedAt: keys[3] }),
    event("AgentMessage", { message: "late noise" }, { capturedAt: keys[4] }),
  ]);

  assert.equal(built.status, "terminated");
  assert.equal(built.terminalReason, "interrupted");
});

test("tool failures derail the run but a later Stop still completes it", () => {
  const keys = timestamps(4);
  const built = session([
    event("UserPromptSubmit", { prompt: "Run it" }, { capturedAt: keys[0] }),
    event("PostToolUse", { tool_response: { exitCode: 2 } }, {
      capturedAt: keys[1],
    }),
    event("AgentMessage", { message: "Retrying" }, { capturedAt: keys[2] }),
    event("Stop", {}, { capturedAt: keys[3] }),
  ]);

  assert.equal(built.status, "complete");
});

test("a folded turn failure stays failed after later progress", () => {
  const keys = timestamps(3);
  const built = session([
    event("UserPromptSubmit", { prompt: "Run it" }, { capturedAt: keys[0] }),
    event("Stop", { reason: "upstream_error" }, { capturedAt: keys[1], status: "failed" }),
    event("PostToolUse", {}, { capturedAt: keys[2] }),
  ]);

  assert.equal(built.status, "failed");
  assert.equal(built.terminalReason, "error");

  const [promptRun] = buildSessionPromptRuns(built);
  assert.equal(promptRun?.status, "failed");
});

test("prompt runs truncate at the first exception terminal", () => {
  const keys = timestamps(4);
  const built = session([
    event("UserPromptSubmit", { prompt: "First" }, { capturedAt: keys[0] }),
    event("StopFailure", { reason: "server_error" }, { capturedAt: keys[1] }),
    event("UserPromptSubmit", { prompt: "Second" }, { capturedAt: keys[2] }),
    event("Stop", {}, { capturedAt: keys[3] }),
  ]);
  const [first, second] = buildSessionPromptRuns(built);

  assert.equal(first?.status, "failed");
  assert.equal(first?.events.at(-1)?.eventName, "StopFailure");
  assert.equal(second?.status, "complete");
});

test("failure events keep a dedicated event-log key", () => {
  assert.equal(getTraceEventKey(event("StopFailure")), "reply.failure");
  assert.equal(getTraceEventKey(event("PostToolUseFailure")), "tool.failure");
  assert.equal(getTraceEventKey(event("Interrupt")), "run.interrupt");

  const toolFailure = event("PostToolUseFailure");
  assert.equal(isFailureEvent(toolFailure), true);
  assert.equal(isFailureEvent(event("PostToolUse")), false);
});

test("failure events keep failure wording while a Stop stays completed", () => {
  // A payload-less failure (WorkBuddy) must not read as a normal completion.
  assert.equal(getEventSummary(event("StopFailure")), "Response failed");
  assert.equal(getEventSummary(event("Stop")), "Response committed");
  assert.equal(
    getEventSummary(event("StopFailure", { error_message: "429 Too Many Requests" })),
    "429 Too Many Requests",
  );
});
