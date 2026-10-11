import type { TraceEvent } from "@/types/trace";

/**
 * Lowercased search haystack per event.
 *
 * Serializing every event on each keystroke is the single most expensive part
 * of log filtering, so the text is built once per event and cached. A WeakMap
 * keeps the cache tied to the lifetime of the event objects.
 */
const haystacks = new WeakMap<TraceEvent, string>();

export function getEventSearchText(event: TraceEvent) {
  const cached = haystacks.get(event);
  if (cached !== undefined) {
    return cached;
  }
  const text = JSON.stringify(event).toLowerCase();
  haystacks.set(event, text);
  return text;
}

/** Whether an event contains every character sequence in `needle`. */
export function matchesEventQuery(event: TraceEvent, needle: string) {
  if (!needle) {
    return true;
  }
  return getEventSearchText(event).includes(needle);
}
