import assert from "node:assert/strict";
import test from "node:test";
import { getAtomIdForEvent } from "../src/config/atom-platforms.ts";
import { projectTraceEvents } from "../src/lib/atomic-projection.ts";
import { buildExecutionTopology } from "../src/lib/execution-topology.ts";
import {
  getTraceEventKey,
  isUserQuestionEvent,
  isUserQuestionStartEvent,
} from "../src/lib/trace-event-kind.ts";
import {
  buildSessions,
  normalizeTraceEvent,
} from "../src/lib/trace-model.ts";
import { isWaitingTraceEvent } from "../src/lib/trace-status.ts";
import {
  hasPlanContent,
  parseUserQuestionContent,
} from "../src/lib/user-question-content.ts";

function questionToolEvent(eventName: "PreToolUse" | "PostToolUse") {
  return normalizeTraceEvent({
    capturedAt:
      eventName === "PreToolUse"
        ? "2026-09-10T10:00:00.000Z"
        : "2026-09-10T10:00:01.000Z",
    eventName,
    id: eventName,
    payload: {
      llm_tool_name: "request_user_input",
      tool_name: "AskUserQuestion",
      tool_use_id: "question-1",
    },
    sessionId: "session",
    source: "trae",
    toolName: "AskUserQuestion",
    toolUseId: "question-1",
    workspaceId: "workspace",
  });
}

test("recognizes explicit and tool-based user question events", () => {
  const toolStart = questionToolEvent("PreToolUse");
  const explicit = normalizeTraceEvent({
    eventName: "UserQuestion",
    id: "explicit",
    payload: {},
    sessionId: "session",
    source: "trae",
    workspaceId: "workspace",
  });

  assert.equal(isUserQuestionEvent(toolStart), true);
  assert.equal(isUserQuestionStartEvent(toolStart), true);
  assert.equal(isWaitingTraceEvent(toolStart), true);
  assert.equal(explicit.eventName, "PermissionRequest");
  assert.equal(getAtomIdForEvent(toolStart, "trae"), "harness-user-question");
});

test("labels Notification events as AskUserQuestion activity", () => {
  const notification = normalizeTraceEvent({
    eventName: "Notification",
    id: "notification",
    payload: {},
    sessionId: "session",
    source: "trae",
    workspaceId: "workspace",
  });

  assert.equal(getTraceEventKey(notification), "user.question");
});

test("projects a question tool lifecycle to one user question instance", () => {
  const start = questionToolEvent("PreToolUse");
  const end = questionToolEvent("PostToolUse");
  const projected = projectTraceEvents([start, end], "trae").events.filter(
    (event) => event.atom.key === "user.question",
  );

  assert.deepEqual(
    projected.map((event) => event.phase),
    ["waiting", "end"],
  );
  assert.equal(projected[0]?.instance.id, projected[1]?.instance.id);
});

test("shows question tools on the dedicated topology atom", () => {
  const topology = buildExecutionTopology(
    [questionToolEvent("PreToolUse")],
    "trae",
  );
  const question = topology.nodes.find(
    (node) => node.id === "harness-user-question",
  );
  const tool = topology.nodes.find((node) => node.id === "harness-tool-call");

  assert.equal(question?.data.count, 1);
  assert.equal(question?.data.status, "waiting");
  assert.equal(tool?.data.count, 0);
});

test("marks a completed question tool as complete", () => {
  const topology = buildExecutionTopology(
    [questionToolEvent("PreToolUse"), questionToolEvent("PostToolUse")],
    "trae",
  );
  const question = topology.nodes.find(
    (node) => node.id === "harness-user-question",
  );

  assert.equal(question?.data.count, 2);
  assert.equal(question?.data.status, "complete");
});

test("treats a denied question as failed unless it is retryable", () => {
  const denied = normalizeTraceEvent({
    eventName: "PermissionDenied",
    id: "denied",
    payload: {},
    sessionId: "denied-session",
    source: "trae",
    workspaceId: "workspace",
  });
  const retryable = normalizeTraceEvent({
    eventName: "PermissionDenied",
    id: "retryable",
    payload: { retry: true },
    sessionId: "retryable-session",
    source: "trae",
    workspaceId: "workspace",
  });

  assert.equal(buildSessions([denied])[0]?.status, "failed");
  assert.equal(buildSessions([retryable])[0]?.status, "waiting");
});

test("a ZCode ExitPlanMode approval is a user.question whose plan is displayable", () => {
  // The inspector picks the event by its display key and hands its full
  // payload to the question preview. Plan approval has no `questions` array:
  // the Markdown in tool_input.plan is the message content.
  const approval = normalizeTraceEvent({
    eventName: "PermissionRequest",
    id: "plan-approval",
    payload: {
      reason: "Tool ExitPlanMode requires user interaction",
      tool_name: "ExitPlanMode",
      tool_input: {
        plan: "# Plan\n\n## Step 1\n\nRun the test suite before merging.",
        allowedPrompts: [{ tool: "Bash", prompt: "run tests" }],
      },
    },
    sessionId: "zcode-plan-session",
    source: "zcode",
    toolName: "ExitPlanMode",
    workspaceId: "workspace",
  });

  assert.equal(getTraceEventKey(approval), "user.question");
  assert.equal(isWaitingTraceEvent(approval), true);
  const content = parseUserQuestionContent(approval.payload);
  assert.equal(content.hasContent, true);
  assert.match(content.plan, /^# Plan/);
  assert.deepEqual(content.prompts, []);
});

test("plan approval tool rows stay tool events but are previewable", () => {
  // The inspector's content fallback renders the plan on Pre/PostToolUse rows
  // without reclassifying them. Keeping the tool.* keys preserves projection,
  // waiting state and topology counts.
  const toolEvent = (eventName: "PreToolUse" | "PostToolUse") =>
    normalizeTraceEvent({
      eventName,
      id: `plan-${eventName}`,
      payload: {
        tool_name: "ExitPlanMode",
        tool_input: { plan: "# Plan\n\n## Step 1\n\nRun the tests." },
      },
      sessionId: "zcode-plan-session",
      source: "zcode",
      toolName: "ExitPlanMode",
      workspaceId: "workspace",
    });

  const start = toolEvent("PreToolUse");
  const end = toolEvent("PostToolUse");
  assert.equal(getTraceEventKey(start), "tool.call");
  assert.equal(getTraceEventKey(end), "tool.result");
  assert.equal(isUserQuestionEvent(start), false);
  assert.equal(isUserQuestionEvent(end), false);
  assert.equal(hasPlanContent(start.payload), true);
  assert.equal(hasPlanContent(end.payload), true);
});
