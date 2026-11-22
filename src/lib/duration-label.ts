/**
 * The global overlay rail's duration label — the badge on a closed tool pair.
 * The layer exists to inspect ONE step's latency, so it keeps more precision
 * than the list surfaces' stepped badges (`formatDurationMs`: <10s ms, <1m s,
 * then m / h / d), but a long tool call must still stay scannable: the ladder
 * resolves each span to its smallest honest unit and compounds only when one
 * number is no longer enough.
 *
 * - < 10s          exact milliseconds (`9500ms`) — the digits being inspected
 * - 10s – 60s      seconds, one decimal when it carries information (`12.5s`)
 * - 60s – 60min    minutes + seconds (`2M30s`); capital `M` keeps minutes
 *                  distinguishable from the lowercase `ms` tier
 * - ≥ 60min        hours + minutes + seconds (`1H25M30s`)
 *
 * Zero components drop (`1H25M`, `2M`, `1H`), so a composite never prints a
 * unit that carries nothing.
 */
export function formatOverlayDuration(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) {
    return "--";
  }
  if (milliseconds < 10_000) {
    return `${Math.round(milliseconds)}ms`;
  }
  const totalSeconds = Math.round(milliseconds / 1000);
  if (totalSeconds < 60) {
    const seconds = Math.round((milliseconds / 1000) * 10) / 10;
    return `${Number.isInteger(seconds) ? String(seconds) : seconds.toFixed(1)}s`;
  }
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];
  if (hours > 0) {
    parts.push(`${hours}H`);
  }
  if (minutes > 0) {
    parts.push(`${minutes}M`);
  }
  if (seconds > 0) {
    parts.push(`${seconds}s`);
  }
  return parts.join("");
}
