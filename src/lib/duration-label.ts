/**
 * The single stepped-duration ladder for the console. Both the LOG row badge
 * and the global overlay's rail badge use it, so the same measured pair span
 * reads with the same unit in every surface: under 10s it is a `ms` span,
 * 10–60s a `s` span, then `m`, `h` and `d` as it grows. Each value resolves to
 * its dominant unit instead of compounding (`1m 4s`): one number per tier
 * keeps a long history scannable, and colour (not a second unit) carries the
 * "is this slow" signal.
 */
export function formatDurationMs(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) {
    return "--";
  }
  const seconds = milliseconds / 1000;
  if (seconds < 10) {
    return `${Math.round(milliseconds)}ms`;
  }
  const minutes = seconds / 60;
  if (minutes < 1) {
    return `${Math.round(seconds)}s`;
  }
  const hours = minutes / 60;
  if (hours < 1) {
    return `${Math.round(minutes)}m`;
  }
  const days = hours / 24;
  if (days < 1) {
    return `${Math.round(hours)}h`;
  }
  return `${Math.round(days)}d`;
}

/**
 * The Agent view header's execution clock: a finer reading than the unit
 * ladder, because the reader is timing *this one* message, not scanning a
 * history. Under a minute it keeps a tenth of a second (`0:00.4`), then the
 * wall-clock `H:MM:SS` / `HH:MM:SS` form for longer runs. It is a display
 * reading only — never the pair-span value that feeds colour heat — so it
 * lives beside, not inside, {@link formatDurationMs}.
 */
export function formatDurationClock(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) {
    return "--";
  }
  const total = Math.floor(milliseconds / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  // Under a full minute the whole run is still sub-minute to the reader:
  // show `M:SS.s` with one decimal so 0.4s and 0.9s are not both `0:00`.
  if (total < 60) {
    const tenths = Math.round((milliseconds % 1000) / 100);
    return `0:${String(total).padStart(2, "0")}.${tenths}`;
  }
  const clock =
    hours > 0
      ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
      : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return clock;
}
