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

/**
 * Does a change of the cap reopen a stream the spent budget had closed?
 *
 * The cap is the only reason that kind of pause exists, so a cap that no
 * longer holds — still has time left, or is `off` — must not leave the
 * console stopped: the pause lifts at once, the clock starts over, and the
 * missed tail arrives as a fresh snapshot (the resume path), never as a
 * replay that would regrow the capped array. A cap whose time is already
 * spent (`delay <= 0`) keeps the stream stopped.
 */
export function capChangeResumesSync(stopped: boolean, delay: number | null): boolean {
  return stopped && (delay === null || delay > 0);
}

/**
 * How the service card's uptime clock follows a sync pause.
 *
 * The clock measures the service process, but the pause is deliberate: while
 * the budget holds the stream stopped the clock stops counting too, and the
 * uptime the service accrues during the pause is never displayed again —
 * resuming continues from the frozen value instead of replaying the pause.
 * A new service process owns a fresh clock (`resetUptimePause`), which is
 * also the documented way out of a spent budget.
 */
export interface UptimePause {
  /** Displayed value captured when the current pause began; null while running. */
  frozenMs: number | null;
  /** Service uptime accrued during past pauses; never displayed again. */
  ignoredMs: number;
}

export function resetUptimePause(): UptimePause {
  return { frozenMs: null, ignoredMs: 0 };
}

/**
 * Move the pause state to match `paused`, observed at `rawUptimeMs` (the
 * service uptime the clock would show unpause-aware). Pure: the component
 * calls it from an effect and renders the result unchanged for repeat calls.
 */
export function applyUptimePause(
  state: UptimePause,
  rawUptimeMs: number,
  paused: boolean,
): UptimePause {
  const raw = Math.max(0, rawUptimeMs);
  if (paused) {
    if (state.frozenMs !== null) {
      return state;
    }
    return {
      frozenMs: Math.max(0, raw - state.ignoredMs),
      ignoredMs: state.ignoredMs,
    };
  }
  if (state.frozenMs === null) {
    return state;
  }
  return {
    frozenMs: null,
    ignoredMs: Math.max(0, raw - state.frozenMs),
  };
}

/** What the clock shows under a pause state: the frozen value, or the raw uptime minus every ignored pause. */
export function resolveDisplayedUptime(
  state: UptimePause,
  rawUptimeMs: number,
): number {
  if (state.frozenMs !== null) {
    return state.frozenMs;
  }
  return Math.max(0, Math.max(0, rawUptimeMs) - state.ignoredMs);
}
