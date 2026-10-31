import type {
  RunTerminalReason,
  TracePromptRun,
  TraceRunStatus,
} from "../types/trace";
import { getSessionDisplayState } from "./trace-model.ts";

type RunDurationSource = {
  duration: number;
  start: number;
  status: TraceRunStatus;
};

/**
 * Clock granularity for rows whose run already finished: their status and
 * duration never depend on `now` (the 24h timeout boundary excepted), so a
 * coarse bucket keeps the 1s duration tick from re-rendering history rows
 * that cannot change.
 */
export const RUN_HISTORY_COARSE_REFRESH_MS = 30_000;

/**
 * A run marked `active` that has not produced a single event for this long is
 * very likely dead (the agent crashed, was killed, or the recorder stopped).
 * The status alone cannot tell, so the row keeps the live status but adds an
 * explicit STALE marker with the silence duration instead of pretending the
 * run is still executing. `waiting` is deliberately exempt: a permission
 * prompt can legitimately sit unanswered for minutes.
 */
export const RUN_HISTORY_STALE_AFTER_MS = 120_000;

/**
 * A `waiting` run gets a much longer rope — a permission prompt can sit
 * unanswered for minutes — but a quarter of an hour without a single event
 * means nobody is coming back, and the row should say so instead of showing a
 * WAITING capsule forever.
 */
export const RUN_HISTORY_WAITING_STALE_AFTER_MS = 15 * 60_000;

/** Human labels for the recorded terminal reason, shown next to the status. */
export const runTerminalReasonLabels: Readonly<
  Record<RunTerminalReason, string>
> = {
  aborted: "aborted",
  completed: "completed",
  error: "error",
  interrupted: "interrupted",
  "session-end": "session end",
  timeout: "timeout",
};

export type RunFreshness = {
  /** True when an executing run has gone silent past the stale threshold. */
  stale: boolean;
  /** Milliseconds since the run's last event. */
  idleFor: number;
};

/**
 * How long a live run has been silent. Returns `stale: false` for terminal
 * statuses (their silence is expected); a `waiting` run is judged against the
 * much longer waiting threshold.
 */
export function getRunFreshness(
  status: string | undefined,
  lastEventAt: number | null | undefined,
  now: number,
  staleAfterMs?: number,
): RunFreshness {
  if (
    (status !== "active" && status !== "waiting") ||
    !lastEventAt
  ) {
    return { idleFor: 0, stale: false };
  }
  const threshold =
    staleAfterMs ??
    (status === "waiting"
      ? RUN_HISTORY_WAITING_STALE_AFTER_MS
      : RUN_HISTORY_STALE_AFTER_MS);
  const idleFor = Math.max(0, now - lastEventAt);
  return { idleFor, stale: idleFor >= threshold };
}

/** Snap a timestamp down to the start of its {@link bucketMs} bucket. */
export function quantizeTimestamp(now: number, bucketMs: number): number {
  return Math.floor(now / bucketMs) * bucketMs;
}

export function getRunHistoryDisplayStatus(
  sessionStatus: TraceRunStatus,
  promptRuns: readonly Pick<TracePromptRun, "status">[],
): TraceRunStatus {
  return promptRuns.at(-1)?.status ?? sessionStatus;
}

export function getRunHistoryDuration(
  session: RunDurationSource,
  promptRuns: readonly RunDurationSource[],
  now: number,
  activeRunTimeoutMs = Number.POSITIVE_INFINITY,
): number {
  return getRunHistoryDisplayState(
    session,
    promptRuns,
    now,
    activeRunTimeoutMs,
  ).duration;
}

export function getRunHistoryDisplayState(
  session: RunDurationSource & { end?: number },
  promptRuns: readonly (RunDurationSource & { end?: number })[],
  now: number,
  activeRunTimeoutMs = Number.POSITIVE_INFINITY,
): {
  duration: number;
  status: TraceRunStatus;
} {
  const activePrompt = promptRuns.at(-1);
  const status = getRunHistoryDisplayStatus(
    session.status,
    promptRuns,
  );
  // Terminal states (complete/failed/terminated) keep their recorded
  // duration.
  if (!isLiveRunStatus(status)) {
    return {
      duration: session.duration,
      status,
    };
  }
  // "active" and "waiting" are both live states: the duration keeps advancing
  // and the run terminates once it has been running past the active-run
  // timeout. The *executing message* owns that clock, not the session: a
  // session resumed two days after its first prompt would otherwise present
  // itself as a 48-hour run, and the timeout turned it into `terminated` (kept
  // out of the `N LIVE` filter, off the top of the list) the instant the new
  // prompt arrived. Only a session with no Prompt runs falls back to its own
  // start.
  const clockRun = { ...(activePrompt ?? session), status };
  const display = getSessionDisplayState(clockRun, now, activeRunTimeoutMs);
  // The freshness gate judges the executing message's last event: once the
  // recorder has demonstrably stopped producing (a dead run kept its status
  // forever otherwise), the display terminates on the session's recorded
  // duration — the same definition the live index applies, so the row, the
  // footer Live button, and the `N LIVE` chip cannot disagree.
  if (
    isLiveRunStatus(display.status) &&
    !isFreshLiveRun(display.status, clockRun.end, now)
  ) {
    return { duration: session.duration, status: "terminated" };
  }
  return display;
}

/**
 * Display state of one run with the live-freshness gate folded in.
 *
 * {@link getSessionDisplayState} only knows the recorded status: a run whose
 * recorder died without a terminal event stays `active` forever, and every
 * consumer that trusted the status — the RUNNING capsule, the footer Live
 * button — presented a long-dead message as executing for up to the whole
 * 24h timeout. The live index (`collectLiveRunKeys`) already refused to count
 * such corpses via {@link isFreshLiveRun}; this helper applies the same
 * definition to the *display*, so the row, the Live button, and the `N LIVE`
 * chip can no longer disagree about what is executing. A run that went silent
 * past its freshness window displays as `terminated` on its recorded
 * duration; runs without an activity timestamp keep trusting their status.
 */
export function getRunDisplayState(
  run: RunDurationSource & { end?: number },
  now: number,
  activeRunTimeoutMs = Number.POSITIVE_INFINITY,
): {
  duration: number;
  status: TraceRunStatus;
} {
  const display = getSessionDisplayState(run, now, activeRunTimeoutMs);
  if (
    isLiveRunStatus(display.status) &&
    !isFreshLiveRun(display.status, run.end, now)
  ) {
    return { duration: run.duration, status: "terminated" };
  }
  return display;
}

/**
 * Why the run ended, for display next to the status. Recorded reasons win;
 * a live run that only *looks* terminated because the display timeout kicked
 * in reports `timeout`, so "terminated" never appears without a cause.
 */
export function getRunHistoryTerminalInfo(
  session: RunDurationSource & {
    statusDetail?: string | null;
    terminalReason?: RunTerminalReason | null;
  },
  promptRuns: readonly (RunDurationSource &
    Pick<TracePromptRun, "statusDetail" | "terminalReason">)[],
  now: number,
  activeRunTimeoutMs = Number.POSITIVE_INFINITY,
): { detail: string | null; reason: RunTerminalReason | null } {
  const recordedStatus = getRunHistoryDisplayStatus(
    session.status,
    promptRuns,
  );
  const display = getRunHistoryDisplayState(
    session,
    promptRuns,
    now,
    activeRunTimeoutMs,
  );
  if (
    display.status === "terminated" &&
    isLiveRunStatus(recordedStatus)
  ) {
    return { detail: null, reason: "timeout" };
  }
  if (isLiveRunStatus(display.status)) {
    return { detail: null, reason: null };
  }
  const lastPrompt = promptRuns.at(-1);
  return {
    detail: lastPrompt?.statusDetail ?? session.statusDetail ?? null,
    reason: lastPrompt?.terminalReason ?? session.terminalReason ?? null,
  };
}

export function toggleExpandedRun(
  current: ReadonlySet<string>,
  key: string,
): Set<string> {
  const next = new Set(current);
  if (next.has(key)) {
    next.delete(key);
  } else {
    next.add(key);
  }
  return next;
}

export function ensureExpandedRun(
  current: ReadonlySet<string>,
  key: string,
  expandable: boolean,
): Set<string> {
  const next = new Set(current);
  if (expandable) {
    next.add(key);
  } else {
    next.delete(key);
  }
  return next;
}

/**
 * `active` and `waiting` are the two live states: the run is still the one the
 * user is watching, so the topology keeps following the executing atom.
 * A finished run (complete/failed/terminated) has no atom to follow: the last
 * atom is a historical position, not "where execution is", so selecting the
 * run must not auto-locate it. Only an explicit atom pick does that.
 */
export function getPromptAtomSelection(
  status: string | undefined,
): string | null | undefined {
  return isLiveRunStatus(status) ? undefined : null;
}

/** Whether a run status still counts as the currently executing message. */
export function isLiveRunStatus(status: string | undefined): boolean {
  return status === "active" || status === "waiting";
}

/**
 * How long an executing run may go without a single event before it stops
 * counting as "running now". Status alone is not enough: a crashed agent
 * leaves its last session `active` forever — the recorder never writes a
 * terminal event — so opening the dashboard hours later listed half a dozen
 * corpses as live while the message that was actually executing drowned among
 * them. This is deliberately much longer than the STALE display threshold (a
 * long build or test run is silent for minutes) and much shorter than the 24h
 * display timeout.
 */
export const RUN_HISTORY_LIVE_WINDOW_MS = 10 * 60_000;

/**
 * A run blocked on the user keeps its place far longer than a running one: an
 * unanswered permission prompt is still the thing the user has to deal with.
 */
export const RUN_HISTORY_WAITING_LIVE_WINDOW_MS = 60 * 60_000;

/**
 * Whether a run belongs to the live index right now: its status is live *and*
 * the recorder produced an event inside the freshness window. A `waiting` run
 * gets the longer window.
 */
export function isFreshLiveRun(
  status: string | undefined,
  lastActivityAt: number | null | undefined,
  now: number,
): boolean {
  if (!isLiveRunStatus(status)) {
    return false;
  }
  // Without activity information the status is all we have — trust it, as the
  // timeout in `getRunHistoryDisplayState` already caps the age.
  if (!lastActivityAt) {
    return true;
  }
  const window =
    status === "waiting"
      ? RUN_HISTORY_WAITING_LIVE_WINDOW_MS
      : RUN_HISTORY_LIVE_WINDOW_MS;
  return now - lastActivityAt <= window;
}

/**
 * Keys of the sessions whose displayed message is still executing. RUN
 * HISTORY uses this one set for three things that must agree: the `N LIVE`
 * count, the live-only filter, and pinning executing rows to the top of the
 * list. A session is live when its newest prompt is — the prompt inherits the
 * session status, so the row and the thread always agree on what is running.
 *
 * Liveness also requires recent activity (`isFreshLiveRun`): a session whose
 * recorder died hours ago still carries `active`, and counting it as running
 * made the live index point at rows that were not running and miss the one
 * that was.
 */
export function collectLiveRunKeys(
  sessions: readonly (RunDurationSource & {
    key: string;
    /** Timestamp of the session's newest event, when known. */
    end?: number;
  })[],
  promptRunsBySession: ReadonlyMap<string, readonly RunDurationSource[]>,
  now: number,
  activeRunTimeoutMs = Number.POSITIVE_INFINITY,
): Set<string> {
  const live = new Set<string>();
  for (const session of sessions) {
    const { status } = getRunHistoryDisplayState(
      session,
      promptRunsBySession.get(session.key) ?? [],
      now,
      activeRunTimeoutMs,
    );
    if (isFreshLiveRun(status, session.end ?? session.start, now)) {
      live.add(session.key);
    }
  }
  return live;
}
