/**
 * How long the console keeps consuming the event stream.
 *
 * A console left open keeps appending every captured event and re-deriving
 * sessions, runs and flows from the growing list. The cap exists so an
 * unattended tab cannot do that forever: once the budget is spent the stream is
 * closed (no network work, no re-derivation) and the header offers to resume.
 *
 * The budget is **wall-clock from the moment syncing (re)started**, not
 * accumulated CPU time: it is a limit on how stale a view may become before the
 * user has to acknowledge it, and an extra accumulator would have to be
 * persisted, paused and resumed to buy nothing.
 */

const HOUR_MS = 3_600_000;

/**
 * Milliseconds left before syncing must stop, `0` when it is already due, or
 * `null` when the console is configured never to stop (`maxHours <= 0`).
 *
 * Returning the remaining time instead of a boolean keeps the caller on a
 * single `setTimeout`: no polling, no per-second render, and no timer at all
 * while the budget is disabled.
 */
export function getSyncStopDelay(
  startedAt: number,
  maxHours: number,
  now: number,
): number | null {
  if (!Number.isFinite(maxHours) || maxHours <= 0) {
    return null;
  }
  const budget = maxHours * HOUR_MS;
  if (!Number.isFinite(startedAt) || startedAt <= 0) {
    return budget;
  }
  const remaining = startedAt + budget - now;
  return remaining > 0 ? remaining : 0;
}
