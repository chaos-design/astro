import type { TraceSession } from "@/types/trace";

/**
 * The agent dropdown lists every configured coding agent plus a trailing
 * "Others" catch-all. Selecting an agent filters RUN HISTORY to that agent's
 * runs; "Others" covers every source that is not a configured agent.
 */
export const OTHERS_AGENT_ID = "others";

/**
 * RUN HISTORY loads on demand: the most recent {@link DEFAULT_RUN_HISTORY_DAYS}
 * day(s) are visible first, and scrolling further reveals one additional day
 * at a time instead of loading every historical run up front.
 */
export const DEFAULT_RUN_HISTORY_DAYS = 1;

const DAY_MS = 86_400_000;

/** Start-of-day (local midnight) for a timestamp. */
export function getCalendarDayStart(timestamp: number): number {
  const day = new Date(timestamp);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

/**
 * The day the visible window is anchored to: the most recent day that
 * actually has data for the filtered agent, falling back to today while
 * nothing has been recorded yet.
 */
export function getRunHistoryAnchorDayStart(
  sessions: readonly TraceSession[],
  now: number,
): number {
  let latest = 0;
  for (const session of sessions) {
    if (session.start > latest) {
      latest = session.start;
    }
  }
  return latest > 0 ? getCalendarDayStart(latest) : getCalendarDayStart(now);
}

/**
 * Lower bound of the visible window: `visibleDays` calendar days ending at
 * the anchor day (the most recent day with data). With one day this shows
 * only the anchor day; scrolling back reveals one earlier day at a time.
 */
export function getRunHistoryWindowStart(
  sessions: readonly TraceSession[],
  now: number,
  visibleDays: number,
): number {
  return (
    getRunHistoryAnchorDayStart(sessions, now) -
    Math.max(0, visibleDays - 1) * DAY_MS
  );
}

/**
 * The runs to render: sessions that started within the window, newest first
 * (input is already sorted that way).
 */
export function selectVisibleRunHistory(
  sessions: readonly TraceSession[],
  now: number,
  visibleDays: number,
): TraceSession[] {
  const from = getRunHistoryWindowStart(sessions, now, visibleDays);
  return sessions.filter((session) => session.start >= from);
}

/**
 * Whether loading one more day would reveal additional runs. True when at
 * least one session started before the current window.
 */
export function canLoadMoreRunHistoryDays(
  sessions: readonly TraceSession[],
  now: number,
  visibleDays: number,
): boolean {
  const from = getRunHistoryWindowStart(sessions, now, visibleDays);
  return sessions.some((session) => session.start < from);
}

/**
 * Advance the window by exactly one day, but only while older runs remain.
 * Keeps `current` unchanged once every run is already within the window.
 */
export function nextRunHistoryVisibleDays(
  sessions: readonly TraceSession[],
  now: number,
  current: number,
): number {
  return canLoadMoreRunHistoryDays(sessions, now, current)
    ? current + 1
    : current;
}

/**
 * Filter sessions down to a single agent. A configured agent value equals its
 * source string; {@link OTHERS_AGENT_ID} keeps only sessions whose source is
 * not a configured agent.
 */
export function filterSessionsByAgent(
  sessions: readonly TraceSession[],
  agentId: string,
  configuredSources: ReadonlySet<string>,
): TraceSession[] {
  if (agentId === OTHERS_AGENT_ID) {
    return sessions.filter((session) => !configuredSources.has(session.source));
  }
  return sessions.filter((session) => session.source === agentId);
}
