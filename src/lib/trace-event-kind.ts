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

/**
 * The tool-input object under either the snake (`tool_input`) or camel
 * (`toolInput`) spelling. ZCode reports both twins on the same payload, while
 * the canonical recorder keeps only the snake one; reading the object through
 * both names lets a camel-only payload still expose its nested tool name. The
 * nullish guard allocates nothing per call, keeping this predicate inside the
 * same per-event budget the rest of the classifier is held to. Returns the
 * plain record, or `undefined` when neither spelling is an object.
 */
function toolInputRecord(
  payload: TraceEvent["payload"],
): Record<string, unknown> | undefined {
  const toolInput = payload.tool_input ?? payload.toolInput;
  return toolInput && typeof toolInput === "object" && !Array.isArray(toolInput)
    ? (toolInput as Record<string, unknown>)
    : undefined;
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
  // full normalized list for these candidate fields (and the two arrays around
  // it) dominated tool-heavy histories. The camelCase twins mirror what
  // `user-question-content.ts` and the ZCode adapter already accept, so a
  // question-shaped tool event whose name sits only in `payload.toolName` /
  // `payload.toolInput.*` still lands on the `user.question` atom instead of
  // being read as a generic tool call.
  const payload = event.payload;
  const toolInput = toolInputRecord(payload);
  const candidates = [
    event.toolName,
    payload.llm_tool_name,
    payload.tool_name,
    payload.toolName,
    payload.name,
    payload.type,
    toolInput?.name,
    toolInput?.tool_name,
    toolInput?.toolName,
    payload.payload?.type,
    payload.payload?.tool_name,
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
