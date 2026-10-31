import { isLiveRunStatus } from "./run-history-state.ts";

export type AtomSelection = string | null | undefined;

/**
 * Whether the run the studio is looking at is still in flight. Both live
 * states count: a run waiting for a permission answer is still the run the
 * user is watching, so the footer's Live button must not go dark on it. This
 * delegates to {@link isLiveRunStatus} on purpose — the RUN HISTORY capsule,
 * the `N LIVE` set, and the Live button have to agree on one definition.
 */
export function isPromptExecuting(
  status: string | undefined,
  isDemo: boolean,
): boolean {
  return !isDemo && isLiveRunStatus(status);
}

export function isFollowingLive(
  selection: AtomSelection,
  replayMode: boolean,
  isFollowable: boolean,
): boolean {
  return selection === undefined && !replayMode && isFollowable;
}

/**
 * Live stays active only while the selection actually tracks the newest
 * executed atom: an absent selection follows automatically, an explicit
 * selection keeps following only while it still is the newest atom, and a
 * cleared or older selection has left Live mode.
 */
export function isLiveFollowingLatest(
  selection: AtomSelection,
  latestAtomId: string,
): boolean {
  if (selection === undefined) {
    return true;
  }
  if (selection === null) {
    return false;
  }
  return selection.length > 0 && selection === latestAtomId;
}

export function resolveSelectedAtomId(
  selection: AtomSelection,
  mappedAtomId: string,
): string {
  if (selection === null) {
    return "";
  }
  if (selection !== undefined) {
    return selection;
  }
  return mappedAtomId;
}

export function resolveLocateAtomId(
  selection: AtomSelection,
  activeAtomId: string,
  mappedAtomId: string,
): string {
  if (typeof selection === "string" && selection) {
    return selection;
  }
  return activeAtomId || mappedAtomId;
}

export function toggleAtomSelection(
  selection: AtomSelection,
  atomId: string,
): AtomSelection {
  return selection === atomId ? null : atomId;
}
