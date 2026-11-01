import type { TraceEvent } from "../types/trace.ts";

const userQuestionEventNames = new Set([
  "AskUserQuestion",
  "Elicitation",
  "ElicitationResult",
  "PermissionDenied",
  "PermissionRequest",
  "RequestUserInput",
  "UserQuestion",
]);

const userQuestionToolNames = new Set([
  "askquestion",
  "askuser",
  "askuserquestion",
  "elicitation",
  "requestinput",
  "requestuserinput",
  "userquestion",
]);

const traceEventKeys: Readonly<Record<string, string>> = {
  SessionStart: "run.start",
  SessionEnd: "run.finish",
  Interrupt: "run.interrupt",
  UserPromptSubmit: "prompt.input",
  AgentMessage: "agent.message",
  Reasoning: "model.reasoning",
  PreToolUse: "tool.call",
  PostToolUse: "tool.result",
  PostToolUseFailure: "tool.failure",
  PermissionRequest: "user.question",
  Notification: "user.question",
  SubagentStart: "subagent.start",
  SubagentStop: "subagent.finish",
  Stop: "reply.final",
  StopFailure: "reply.failure",
};

function normalizeIdentifier(value: unknown) {
  return typeof value === "string"
    ? value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "")
    : "";
}

const toolEventNames = new Set([
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
]);

/** Events that report a user question answer rather than a question. */
const userQuestionAnswerEvents = new Set([
  "ElicitationResult",
  "PermissionDenied",
  "PostToolUse",
  "PostToolUseFailure",
]);

export function isUserQuestionToolEvent(event: TraceEvent) {
  if (!toolEventNames.has(event.eventName)) {
    return false;
  }
  // Every tool event runs through this on the state-machine path, so the
  // identifiers are visited in place and the first match returns: building the
  // full normalized list for all eight candidate fields (and the two arrays
  // around it) dominated tool-heavy histories.
  const payload = event.payload;
  const candidates = [
    event.toolName,
    payload.llm_tool_name,
    payload.tool_name,
    payload.name,
    payload.type,
    payload.tool_input?.name,
    payload.tool_input?.tool_name,
    payload.payload?.type,
  ];
  for (const candidate of candidates) {
    if (
      typeof candidate === "string" &&
      candidate &&
      userQuestionToolNames.has(normalizeIdentifier(candidate))
    ) {
      return true;
    }
  }
  return false;
}

export function isUserQuestionEvent(event: TraceEvent) {
  return (
    userQuestionEventNames.has(event.eventName) ||
    isUserQuestionToolEvent(event)
  );
}

export function isUserQuestionStartEvent(event: TraceEvent) {
  if (!isUserQuestionEvent(event)) {
    return false;
  }
  return !userQuestionAnswerEvents.has(event.eventName);
}

export function getTraceEventKey(event?: TraceEvent | null) {
  if (event && isUserQuestionEvent(event)) {
    return isUserQuestionStartEvent(event)
      ? "user.question"
      : "user.answer";
  }
  const eventName = event?.eventName || "event";
  return traceEventKeys[eventName] || eventName.toLowerCase();
}
