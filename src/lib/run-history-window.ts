import type { TraceSession } from "@/types/trace";

/**
 * The agent dropdown lists every configured coding agent plus a trailing
 * "Others" catch-all. Selecting an agent filters RUN HISTORY to that agent's
 * runs; "Others" covers every source that is not a configured agent.
 */
export const OTHERS_AGENT_ID = "others";

/**
 * RUN HISTORY shows a rolling time window instead of a calendar page: the most
 * recent {@link DEFAULT_RUN_HISTORY_HOURS} hours are visible first and the
 * window widens only when the user asks for more.
 *
 * The default lives in Settings (`appDefaults.historyRange`); this constant is
 * the fallback the window helpers use when a caller has no preference at hand.
 * Hours — not days — because "最近 3 小时" is a span, not a date: the previous
 * day-based window silently changed length at midnight and could show nothing
 * at all on the first login of a new day.
 */
export const DEFAULT_RUN_HISTORY_HOURS = 3;

const HOUR_MS = 3_600_000;

/**
 * The moment the visible window ends: the newest message in the pool, falling
 * back to `now` while nothing has been recorded.
 *
 * Anchoring to the newest message rather than to the wall clock is what keeps
 * the panel useful after an idle night — "the last 3 hours" of a machine whose
 * last message arrived 14 hours ago are the three hours leading up to it, not
 * an empty list. A live run is newer than every finished one, so the anchor
 * follows the message that is executing right now.
 */
export function getRunHistoryAnchorTime(
  sessions: readonly Pick<TraceSession, "start">[],
  now: number,
): number {
  let latest = 0;
  for (const session of sessions) {
    if (session.start > latest) {
      latest = session.start;
    }
  }
  return latest > 0 ? latest : now;
}

/**
 * Lower bound of the visible window: `visibleHours` back from the anchor.
 * Widening the window (the panel's "load earlier" control) moves this bound
 * further into the past without moving the anchor.
 */
export function getRunHistoryWindowStart(
  sessions: readonly Pick<TraceSession, "start">[],
  now: number,
  visibleHours: number = DEFAULT_RUN_HISTORY_HOURS,
): number {
  return (
    getRunHistoryAnchorTime(sessions, now) -
    Math.max(0, visibleHours) * HOUR_MS
  );
}

const NO_LIVE_RUNS: ReadonlySet<string> = new Set();

/**
 * The runs to render: sessions that started within the window, newest first
 * (input is already sorted that way).
 *
 * A run that is still executing is always visible, window or not. A resumed
 * session keeps the `start` of its first prompt, so a message sent into a
 * two-day-old thread would otherwise be filtered out mid-execution — exactly
 * when the user is watching it.
 */
export function selectVisibleRunHistory(
  sessions: readonly TraceSession[],
  now: number,
  visibleHours: number = DEFAULT_RUN_HISTORY_HOURS,
  liveKeys: ReadonlySet<string> = NO_LIVE_RUNS,
): TraceSession[] {
  const from = getRunHistoryWindowStart(sessions, now, visibleHours);
  return sessions.filter(
    (session) => session.start >= from || liveKeys.has(session.key),
  );
}

/**
 * Pin the executing messages to the top of RUN HISTORY. Ordering strictly by
 * `start` buries a resumed run: the session began hours or days ago, so the
 * prompt that is executing *right now* would sort below every session that
 * merely started later. Pinned rows are ordered by their latest activity
 * (`end` — the moment the new prompt arrived), so the run that just received
 * a message is the first row; finished rows keep their newest-first order
 * underneath.
 */
export function pinLiveRunHistory<
  T extends { key: string; start: number; end: number },
>(sessions: readonly T[], liveKeys: ReadonlySet<string>): T[] {
  if (liveKeys.size === 0) {
    return [...sessions];
  }
  const live: T[] = [];
  const finished: T[] = [];
  for (const session of sessions) {
    (liveKeys.has(session.key) ? live : finished).push(session);
  }
  live.sort(
    (left, right) => right.end - left.end || right.start - left.start,
  );
  return [...live, ...finished];
}

/**
 * The Live filter's rows: exactly the messages whose run is executing right now.
 *
 * The pool is the agent's *whole* history, not the time window — a session
 * resumed a minute ago still carries the `start` of its first prompt, so a
 * windowed pool would drop precisely the message the user is waiting on.
 *
 * Zero live runs is a legitimate result and the caller must render it as
 * such ("nothing is executing"): falling back to the full list would turn a
 * filter the user armed into "show everything", which is the opposite of what
 * the `N LIVE` chip promises.
 */
export function selectLiveRunHistory<
  T extends { key: string; start: number; end: number },
>(sessions: readonly T[], liveKeys: ReadonlySet<string>): T[] {
  if (liveKeys.size === 0) {
    return [];
  }
  return pinLiveRunHistory(
    sessions.filter((session) => liveKeys.has(session.key)),
    liveKeys,
  );
}

/**
 * Whether widening the window would reveal additional runs. True when at
 * least one session started before the current window.
 */
export function canLoadMoreRunHistory(
  sessions: readonly Pick<TraceSession, "start">[],
  now: number,
  visibleHours: number = DEFAULT_RUN_HISTORY_HOURS,
): boolean {
  const from = getRunHistoryWindowStart(sessions, now, visibleHours);
  return sessions.some((session) => session.start < from);
}

/**
 * Widen the window by doubling it, but only while older runs remain.
 *
 * Doubling rather than adding one more base range keeps the gesture
 * logarithmic: reaching a week of history from the 3-hour default takes four
 * "load earlier" steps instead of fifty-six. Keeps `current` unchanged once
 * every run is already inside the window.
 */
export function nextRunHistoryVisibleHours(
  sessions: readonly Pick<TraceSession, "start">[],
  now: number,
  current: number,
): number {
  return canLoadMoreRunHistory(sessions, now, current) ? current * 2 : current;
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
