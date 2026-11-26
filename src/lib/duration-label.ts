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
 * The performance panel's clock. Unlike {@link formatDurationMs} — one
 * dominant unit per tier, built for scanning a history column — the panel
 * measures *how long something took* and needs the same string to stay
 * comparable across four orders of magnitude without inventing a decimal:
 *
 * - under 10s: `ms` (`742ms`) — frame work, list renders, boot;
 * - 10–60s: `s` (`42s`) — a slow paint, a stalled fetch;
 * - 1–60min: `MMmSSs` compound with two digits (`01M01s`) — a long task or a
 *   whole load, where dropping the seconds would hide the difference between
 *   `01M01s` and `01M59s`;
 * - 60min and up: `HHhMMm` (`02H05M`) — the seconds stop mattering.
 *
 * Two digits per unit and no spaces, so the exact shape `01M01s` the panel
 * documents is what every row prints.
 */
export function formatPerfDuration(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) {
    return "--";
  }
  const pad = (value: number) => String(value).padStart(2, "0");
  if (milliseconds < 10_000) {
    return `${Math.round(milliseconds)}ms`;
  }
  const totalSeconds = Math.floor(milliseconds / 1000);
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) {
    return `${pad(totalMinutes)}M${pad(totalSeconds % 60)}s`;
  }
  const hours = Math.floor(totalMinutes / 60);
  return `${pad(hours)}H${pad(totalMinutes % 60)}M`;
}
