export type AtomSelection = string | null | undefined;

export function isPromptExecuting(
  status: string | undefined,
  isDemo: boolean,
): boolean {
  return !isDemo && status === "active";
}

export function isFollowingLive(
  selection: AtomSelection,
  replayMode: boolean,
  isLatestSession: boolean,
): boolean {
  return selection === undefined && !replayMode && isLatestSession;
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
