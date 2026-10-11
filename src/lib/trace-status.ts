import type { TraceEvent } from "../types/trace";
import { isUserQuestionStartEvent } from "./trace-event-kind.ts";

const explicitWaitingEvents: readonly string[] = [
  "Elicitation",
  "PermissionRequest",
];

const waitingSignalPattern =
  /waiting|awaiting|permission[_ -]?prompt|idle[_ -]?prompt|elicitation|rate[_ -]?limit|too many requests|overload|retry[_ -]?after|backoff|throttl|capacity/;

/**
 * `waitingEvents` optionally overrides the canonical events that mark a run
 * as pending, per the agent's platform configuration. Unknown events stay
 * governed by the shared payload-signal heuristics.
 */
export function isWaitingTraceEvent(
  event: TraceEvent,
  waitingEvents?: readonly string[],
) {
  const explicitEvents = waitingEvents ?? explicitWaitingEvents;
  if (explicitEvents.includes(event.eventName)) {
    return true;
  }
  // An explicit per-agent configuration is authoritative: the shared
  // user-question classification only applies to the default signals.
  if (!waitingEvents && isUserQuestionStartEvent(event)) {
    return true;
  }
  if (event.eventName === "PermissionDenied" && event.payload.retry === true) {
    return true;
  }
  if (
    !["Notification", "StopFailure"].includes(event.eventName) &&
    !["waiting", "rate_limited", "rate-limit"].includes(
      String(event.status || "").toLowerCase(),
    )
  ) {
    return false;
  }

  const signal = [
    event.status,
    event.nativeEventName,
    event.payload.status,
    event.payload.reason,
    event.payload.message,
    event.payload.notification_type,
    event.payload.type,
    typeof event.payload.error === "string"
      ? event.payload.error
      : JSON.stringify(event.payload.error || ""),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return waitingSignalPattern.test(signal);
}
