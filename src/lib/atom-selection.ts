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
