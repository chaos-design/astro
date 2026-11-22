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
