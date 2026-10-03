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
};

function normalizeIdentifier(value: unknown) {
  return typeof value === "string"
    ? value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "")
    : "";
}

function getToolIdentifiers(event: TraceEvent) {
  return [
    event.toolName,
    event.payload.llm_tool_name,
    event.payload.tool_name,
    event.payload.name,
    event.payload.type,
    event.payload.tool_input?.name,
    event.payload.tool_input?.tool_name,
    event.payload.payload?.type,
  ]
    .map(normalizeIdentifier)
    .filter(Boolean);
}

export function isUserQuestionToolEvent(event: TraceEvent) {
  return (
    ["PreToolUse", "PostToolUse", "PostToolUseFailure"].includes(
      event.eventName,
    ) &&
    getToolIdentifiers(event).some((identifier) =>
      userQuestionToolNames.has(identifier),
    )
  );
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
  return ![
    "ElicitationResult",
    "PermissionDenied",
    "PostToolUse",
    "PostToolUseFailure",
  ].includes(event.eventName);
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
