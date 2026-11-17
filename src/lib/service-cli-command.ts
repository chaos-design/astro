/**
 * The out-of-band command for a local service that cannot answer HTTP.
 *
 * A static console cannot spawn a process on the reader's machine. When the
 * service is unreachable the restart control copies this command instead of
 * pretending the `/api/restart` call worked. The port comes from the same
 * resolved API base every other request uses, so the command always targets
 * the service this page was configured for.
 */
export function servicePortFromApiBase(apiBase: string) {
  try {
    const parsed = new URL(apiBase);
    const port = Number(parsed.port);
    if (port > 0) {
      return port;
    }
    return parsed.protocol === "https:" ? 443 : 80;
  } catch {
    return 5678;
  }
}

export function buildServiceCliCommand(apiBase: string) {
  return `pnpm service:up --port=${servicePortFromApiBase(apiBase)}`;
}
