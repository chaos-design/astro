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

export function getPromptAtomSelection(
  status: string | undefined,
  mappedAtomId: string,
): string | null | undefined {
  if (status === "active") {
    return undefined;
  }
  return mappedAtomId || null;
}
