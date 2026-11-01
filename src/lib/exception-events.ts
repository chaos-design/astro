import type { RunTerminalReason, TraceEvent } from "../types/trace.ts";
import { isWaitingTraceEvent } from "./trace-status.ts";

/**
 * Error and exception contract.
 *
 * Every non-normal outcome a client can report is classified here exactly
 * once, so the run state machine, the tool step state and the event log all
 * read the same definition. The boundaries are:
 *
 * - **tool** (`PostToolUseFailure`, `PostToolUse` with an errored or non-zero
 *   `tool_response`): one tool call failed. The run is marked `failed`, but
 *   the failure is recoverable: the next execution progress or a later
 *   `Stop` supersedes it.
 * - **turn** (`StopFailure`, `Stop` + `status=failed`, or any event carrying
 *   `status=failed`): the answer itself failed. Turn failures are terminal,
 *   later progress noise must not resurrect the run.
 * - **interaction** (`PermissionDenied`): the user rejected the request. It
 *   is a recoverable failure unless the payload asks for a retry, in which
 *   case the run waits.
 * - **session** (`Interrupt`, `SessionEnd`, or an explicit abort/cancel
 *   status): the run was stopped. Terminal, and it outranks failure.
 *
 * Waiting evidence (rate limit, backoff, permission prompt) is not an
 * exception by itself, but a failure event that carries waiting evidence is
 * reported as `waiting` rather than `failed`, so a throttled turn does not
 * look like a crashed one.
 */

export type ExceptionKind =
  | "tool-failure"
  | "turn-failure"
  | "rejection"
  | "interruption";

export type ExceptionScope = "tool" | "turn" | "interaction" | "session";

export type ExceptionOutcome = {
  kind: ExceptionKind;
  scope: ExceptionScope;
  /** Run status this event derives while it is the last evidence. */
  status: "failed" | "terminated" | "waiting";
  /** A terminal outcome cannot be revived by later progress events. */
  terminal: boolean;
  reason: RunTerminalReason | null;
};

type FailureDefinition = {
  kind: ExceptionKind;
  scope: ExceptionScope;
};

/**
 * Event names that report a failure by name. Payload status remains
 * authoritative, but these names also fail when a client cannot deliver a
 * payload at all (WorkBuddy hooks, for example).
 */
const failureEventDefinitions: Readonly<Record<string, FailureDefinition>> = {
  PostToolUseFailure: { kind: "tool-failure", scope: "tool" },
  PermissionDenied: { kind: "rejection", scope: "interaction" },
  StopFailure: { kind: "turn-failure", scope: "turn" },
};

/** Explicit statuses that mean "this run was stopped", not "it failed". */
const terminationStatuses: readonly string[] = [
  "aborted",
  "cancelled",
  "canceled",
  "interrupted",
  "terminated",
];

/**
 * Native names or payload reasons only end a run when the event can actually
 * carry a lifecycle outcome. Tool events are excluded: a tool failure whose
 * error text happens to contain "terminated" stays a tool failure. Custom
 * producers that name their own event (`session.cancelled`) are still
 * recognized, because that name is the only evidence they can supply.
 */
const toolLifecycleEvents: readonly string[] = [
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
];

const terminationTokens: readonly string[] = [
  "abort",
  "cancel",
  "interrupt",
  "terminate",
];

function readStatus(event: TraceEvent) {
  return String(event.status || event.payload?.status || "").toLowerCase();
}

function readReason(event: TraceEvent) {
  return String(event.payload?.reason || "").toLowerCase();
}

/** `tool_response` evidence that a tool call did not succeed. */
export function hasToolFailureResponse(event: TraceEvent) {
  const response = event.payload?.tool_response;
  return Boolean(response?.error) || Number(response?.exitCode) > 0;
}

/**
 * A tool step ends `failed` when the client says so, when the paired result
 * event is a failure event, or when the response carries an error/exit code.
 */
export function isToolFailureEvent(event: TraceEvent) {
  return (
    event.eventName === "PostToolUseFailure" ||
    readStatus(event) === "failed" ||
    hasToolFailureResponse(event)
  );
}

/**
 * Termination evidence: an explicit stop event, an explicit stop status, or
 * a stop token in the native name / reason of a lifecycle event.
 */
export function isTerminationEvent(event: TraceEvent) {
  if (event.eventName === "Interrupt" || event.eventName === "SessionEnd") {
    return true;
  }
  if (terminationStatuses.includes(readStatus(event))) {
    return true;
  }
  if (
    toolLifecycleEvents.includes(event.eventName) ||
    event.payload?.tool_response !== undefined
  ) {
    return false;
  }
  const nativeName = event.nativeEventName.toLowerCase();
  const reason = readReason(event);
  return terminationTokens.some(
    (token) => nativeName.includes(token) || reason.includes(token),
  );
}

/** Any event that reports a failure by name, status or tool response. */
export function isFailureEvent(event: TraceEvent) {
  return (
    Object.hasOwn(failureEventDefinitions, event.eventName) ||
    readStatus(event) === "failed" ||
    hasToolFailureResponse(event)
  );
}

function getTerminationReason(event: TraceEvent): RunTerminalReason {
  if (event.eventName === "SessionEnd") {
    return "session-end";
  }
  const status = readStatus(event);
  return ["aborted", "cancelled", "canceled"].includes(status)
    ? "aborted"
    : "interrupted";
}

/**
 * Classifies one event. Returns `null` for normal lifecycle events, which the
 * run state machine handles separately (`SessionStart`, `Stop`, progress).
 *
 * Precedence inside this contract mirrors the state machine: termination
 * outranks waiting, and waiting outranks failure.
 */
export function getExceptionOutcome(
  event: TraceEvent,
  waitingEvents?: readonly string[],
): ExceptionOutcome | null {
  if (isTerminationEvent(event)) {
    return {
      kind: "interruption",
      scope: event.eventName === "SessionEnd" ? "session" : "turn",
      status: "terminated",
      terminal: true,
      reason: getTerminationReason(event),
    };
  }

  const definition = failureEventDefinitions[event.eventName];
  const failedByToolResponse = hasToolFailureResponse(event);
  if (!definition && readStatus(event) !== "failed" && !failedByToolResponse) {
    return null;
  }

  const kind: ExceptionKind =
    definition?.kind ??
    (failedByToolResponse ? "tool-failure" : "turn-failure");
  const scope: ExceptionScope =
    definition?.scope ?? (failedByToolResponse ? "tool" : "turn");

  if (isWaitingTraceEvent(event, waitingEvents)) {
    return { kind, scope, status: "waiting", terminal: false, reason: null };
  }

  return {
    kind,
    scope,
    status: "failed",
    // A turn-level failure ends the run, whether the client reports it as
    // StopFailure (Claude, Trae, OpenCode, Pi) or as Stop + status=failed
    // (Codex, DeepSeek). Tool failures and rejections stay recoverable so a
    // later retry or a final Stop still describes the run.
    terminal:
      event.eventName === "StopFailure" || event.eventName === "Stop",
    reason: "error",
  };
}
