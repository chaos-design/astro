/**
 * Capture-side session state.
 *
 * The studio frontend derives the *display* status from the same raw events
 * (see `src/lib/trace-model.ts`). The server keeps its own running summary so
 * the API can answer "did this run end, and how?" without the browser being
 * open, and so `/api/sessions` reports an explicit terminal reason instead of
 * leaving a silent run indistinguishable from an executing one.
 *
 * Rules intentionally mirror the frontend's state machine:
 * - `SessionStart` / `UserPromptSubmit` open a run.
 * - `Stop` completes it, `StopFailure` fails it, `Interrupt` / `SessionEnd`
 *   terminate it.
 * - Waiting signals (permission prompts, elicitation, rate limits) mark it
 *   `waiting`; further execution progress returns it to `active`.
 */

const WAITING_EVENTS = ["Elicitation", "PermissionRequest"];
const WAITING_PATTERN =
  /waiting|awaiting|permission[_ -]?prompt|idle[_ -]?prompt|elicitation|rate[_ -]?limit|too many requests|overload|retry[_ -]?after|backoff|throttl|capacity/;
const PROGRESS_EVENTS = [
  "AgentMessage",
  "ElicitationResult",
  "PostToolUse",
  "PreToolUse",
  "Reasoning",
  "SubagentStart",
  "SubagentStop",
];

export const SESSION_STATES = [
  "active",
  "waiting",
  "complete",
  "failed",
  "terminated",
];

function readStatus(event) {
  return String(event.status || event.payload?.status || "").toLowerCase();
}

function readReason(event) {
  return String(event.payload?.reason || event.payload?.error || "").trim();
}

/** Whether an event is an explicit wait (permission, elicitation, retry). */
export function isWaitingEvent(event) {
  if (WAITING_EVENTS.includes(event.eventName)) {
    return true;
  }
  if (
    !["Notification", "StopFailure"].includes(event.eventName) &&
    !["waiting", "rate_limited", "rate-limit"].includes(readStatus(event))
  ) {
    return false;
  }
  return WAITING_PATTERN.test(
    [
      readStatus(event),
      event.nativeEventName,
      event.payload?.status,
      event.payload?.reason,
      event.payload?.message,
      event.payload?.notification_type,
      event.payload?.type,
      event.payload?.error,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase(),
  );
}

/** Create the summary record for a newly observed session. */
export function createSessionRecord(key, event) {
  return {
    key,
    source: event.source || "generic",
    sessionId: event.sessionId || "unknown-session",
    workspaceId: event.workspaceId || "unknown",
    cwd: typeof event.cwd === "string" ? event.cwd : null,
    state: "active",
    reason: null,
    ended: false,
    eventCount: 0,
    firstEventAt: event.capturedAt || null,
    lastEventAt: event.capturedAt || null,
    lastEventName: event.eventName || "Unknown",
    lastSequence: Number.isFinite(event.sequence) ? event.sequence : null,
  };
}

/**
 * Fold one event into a session record. Returns whether the visible state
 * changed, so callers can keep counts cheap.
 */
export function applySessionEvent(record, event) {
  const previousState = record.state;
  record.eventCount += 1;
  record.lastEventAt = event.capturedAt || record.lastEventAt;
  record.lastEventName = event.eventName || record.lastEventName;
  if (Number.isFinite(event.sequence)) {
    record.lastSequence = event.sequence;
  }
  if (typeof event.cwd === "string" && event.cwd && !record.cwd) {
    record.cwd = event.cwd;
  }

  if (
    event.eventName === "SessionStart" ||
    event.eventName === "UserPromptSubmit"
  ) {
    record.state = "active";
    record.reason = null;
    record.ended = false;
  } else if (
    event.eventName === "SessionEnd" ||
    event.eventName === "Interrupt" ||
    ["aborted", "cancelled", "canceled", "interrupted", "terminated"].includes(
      readStatus(event),
    )
  ) {
    record.state = "terminated";
    record.reason =
      event.eventName === "SessionEnd" ? "session-end" : "interrupted";
    record.ended = true;
  } else if (event.eventName === "StopFailure" || readStatus(event) === "failed") {
    record.state = "failed";
    record.reason = readReason(event) || "error";
    record.ended = true;
  } else if (isWaitingEvent(event)) {
    record.state = "waiting";
    record.reason = readReason(event) || null;
  } else if (event.eventName === "Stop") {
    record.state = "complete";
    record.reason = "completed";
    record.ended = true;
  } else if (
    !record.ended &&
    (record.state === "waiting" || record.state === "failed") &&
    PROGRESS_EVENTS.includes(event.eventName)
  ) {
    record.state = "active";
    record.reason = null;
  }
  return record.state !== previousState;
}

/** Public projection of one session record, without the internal flags. */
export function serializeSessionRecord(record) {
  return {
    key: record.key,
    source: record.source,
    sessionId: record.sessionId,
    workspaceId: record.workspaceId,
    cwd: record.cwd,
    state: record.state,
    reason: record.reason,
    eventCount: record.eventCount,
    firstEventAt: record.firstEventAt,
    lastEventAt: record.lastEventAt,
    lastEventName: record.lastEventName,
  };
}

/** `{ active: n, waiting: n, ... }` counts across every known session. */
export function countSessionStates(records) {
  const counts = Object.fromEntries(
    SESSION_STATES.map((state) => [state, 0]),
  );
  for (const record of records) {
    counts[record.state] = (counts[record.state] || 0) + 1;
  }
  return counts;
}
