import type { TracePromptRun, TraceRunStatus } from "../types/trace";
import { getSessionDisplayState } from "./trace-model.ts";

type RunDurationSource = {
  duration: number;
  start: number;
  status: TraceRunStatus;
};

export function getRunHistoryDisplayStatus(
  sessionStatus: TraceRunStatus,
  promptRuns: readonly Pick<TracePromptRun, "status">[],
): TraceRunStatus {
  return promptRuns.at(-1)?.status ?? sessionStatus;
}

export function getRunHistoryDuration(
  session: RunDurationSource,
  promptRuns: readonly Pick<TracePromptRun, "status">[],
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
  session: RunDurationSource,
  promptRuns: readonly Pick<TracePromptRun, "status">[],
  now: number,
  activeRunTimeoutMs = Number.POSITIVE_INFINITY,
): {
  duration: number;
  status: TraceRunStatus;
} {
  const status = getRunHistoryDisplayStatus(
    session.status,
    promptRuns,
  );
  // "active" and "waiting" are both live states: the duration keeps
  // advancing and the run terminates once the message stream goes silent
  // past the active-run timeout. Terminal states (complete/failed/
  // terminated) keep their recorded duration.
  if (status !== "active" && status !== "waiting") {
    return {
      duration: session.duration,
      status,
    };
  }
  return getSessionDisplayState(
    { ...session, status },
    now,
    activeRunTimeoutMs,
  );
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
 * Keep only the loaded sessions whose key appears at least once in the live
 * list, preserving the list's original order. The live list is derived from
 * the *currently loaded* sessions, so filtering can never reach for more
 * history than the panel already has.
 */
export function filterSessionsByLiveKeys<T extends { key: string }>(
  sessions: readonly T[],
  liveKeys: readonly string[],
): T[] {
  const live = new Set(liveKeys);
  return sessions.filter(({ key }) => live.has(key));
}
