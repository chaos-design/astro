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

/**
 * Whether a permission-prompt Notification names a question tool.
 *
 * WorkBuddy (CodeBuddy Code) has no PermissionRequest hook: while the host is
 * blocked on an AskUserQuestion its only signal is
 * `Notification { notification_type: "permission_prompt", message: "needs your
 * permission to use AskUserQuestion" }`. The tool's own PreToolUse lands only
 * after the user has answered, so without this shape the run turns `waiting`
 * but the newest event still projects onto `trace-append` — the Flow never
 * lights or locates the `user.question` atom while the question is on screen.
 *
 * The type must be an explicit permission prompt and the payload must name a
 * question tool. Generic idle/auth notifications and permission prompts for
 * ordinary tools (Bash, DeferExecuteTool) stay runtime signals.
 */
function isPendingQuestionNotification(event: TraceEvent) {
  if (event.eventName !== "Notification") {
    return false;
  }
  const payload = event.payload;
  const notificationType = normalizeIdentifier(
    payload.notification_type ?? payload.notificationType,
  );
  if (notificationType !== "permissionprompt") {
    return false;
  }
  return (
    mentionsUserQuestionTool(event.toolName) ||
    mentionsUserQuestionTool(payload.tool_name) ||
    mentionsUserQuestionTool(payload.toolName) ||
    mentionsUserQuestionTool(payload.llm_tool_name) ||
    mentionsUserQuestionTool(payload.message) ||
    mentionsUserQuestionTool(payload.payload?.message) ||
    mentionsUserQuestionTool(payload.payload?.tool_name)
  );
}

/**
 * Whether any spelling of a question tool name appears in a prose field. The
 * host writes the name inside a sentence ("… to use AskUserQuestion"), so the
 * normalized text is searched for the tool names instead of compared to them.
 */
function mentionsUserQuestionTool(value: unknown) {
  if (typeof value !== "string" || !value) {
    return false;
  }
  const normalized = normalizeIdentifier(value);
  if (!normalized) {
    return false;
  }
  for (const toolName of userQuestionToolNames) {
    if (normalized.includes(toolName)) {
      return true;
    }
  }
  return false;
}

export function isUserQuestionEvent(event: TraceEvent) {
  return (
    userQuestionEventNames.has(event.eventName) ||
    isUserQuestionToolEvent(event) ||
    isPendingQuestionNotification(event)
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
