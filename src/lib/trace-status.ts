import type { TraceEvent } from "../types/trace";
import { isUserQuestionStartEvent } from "./trace-event-kind.ts";

const explicitWaitingEvents = new Set([
  "Elicitation",
  "PermissionRequest",
]);

const waitingSignalPattern =
  /waiting|awaiting|permission[_ -]?prompt|idle[_ -]?prompt|elicitation|rate[_ -]?limit|too many requests|overload|retry[_ -]?after|backoff|throttl|capacity/;

export function isWaitingTraceEvent(event: TraceEvent) {
  if (
    explicitWaitingEvents.has(event.eventName) ||
    isUserQuestionStartEvent(event)
  ) {
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
