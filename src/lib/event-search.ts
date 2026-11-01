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

type IdleWindow = Window & {
  cancelIdleCallback?: (handle: number) => void;
  requestIdleCallback?: (
    callback: () => void,
    options?: { timeout: number },
  ) => number;
};

/**
 * Warm the haystack cache off the critical path.
 *
 * Serializing every event is what makes the *first* search keystroke fast, but
 * doing it synchronously right after a session is selected adds hundreds of
 * milliseconds to that selection for a long run. The work is therefore split
 * across idle slices — search stays instant (a missing haystack is built on
 * demand) and selecting a run no longer pays for the whole log at once.
 *
 * Returns a cancel function; calling it stops the remaining slices.
 */
export function warmEventSearchCache(
  events: readonly TraceEvent[],
  sliceMs = 4,
): () => void {
  if (!events.length || typeof window === "undefined") {
    return () => undefined;
  }
  const idleWindow = window as IdleWindow;
  let index = 0;
  let cancelled = false;
  let handle = 0;
  let usedIdle = false;

  const schedule = (callback: () => void) => {
    if (typeof idleWindow.requestIdleCallback === "function") {
      usedIdle = true;
      return idleWindow.requestIdleCallback(callback, { timeout: 500 });
    }
    usedIdle = false;
    return window.setTimeout(callback, 24);
  };

  const step = () => {
    if (cancelled) {
      return;
    }
    const startedAt = performance.now();
    while (
      index < events.length &&
      performance.now() - startedAt < sliceMs
    ) {
      getEventSearchText(events[index]);
      index += 1;
    }
    if (index < events.length) {
      handle = schedule(step);
    }
  };

  handle = schedule(step);
  return () => {
    cancelled = true;
    if (!handle) {
      return;
    }
    if (usedIdle && typeof idleWindow.cancelIdleCallback === "function") {
      idleWindow.cancelIdleCallback(handle);
    } else {
      window.clearTimeout(handle);
    }
  };
}
