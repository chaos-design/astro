/**
 * Snapshot identity.
 *
 * A restart, a manual reload and a reconnect all end with the server sending
 * the console a full snapshot. In the common case — the service was restarted
 * but no event was written or removed — that snapshot describes exactly the
 * events already on screen.
 *
 * Replacing the array anyway is not free: every event is re-normalized, every
 * session is rebuilt (sort, state machine, Prompt runs), every flow is
 * re-derived and the whole console re-renders, for a result identical to what
 * it already shows. Comparing ids first lets the caller skip all of it.
 *
 * The comparison is on ids and order only. That is the identity the recorder
 * guarantees: an id is written once and never rewritten, so an equal id
 * sequence means an equal snapshot. Events are compared in place, without
 * allocating a normalized copy.
 */
export function isSameEventSequence(
  next: readonly { id?: string | null }[],
  current: readonly { id?: string | null }[],
): boolean {
  if (next === current) {
    return true;
  }
  if (next.length !== current.length) {
    return false;
  }
  for (let index = 0; index < next.length; index += 1) {
    if (next[index]?.id !== current[index]?.id) {
      return false;
    }
  }
  return true;
}
