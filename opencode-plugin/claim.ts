import fsModule from "node:fs";
import { join } from "node:path";

export const claimDirectoryName = ".claims";

export type ClaimFs = Pick<typeof fsModule, "mkdirSync" | "openSync" | "closeSync">;

/**
 * Claims exclusive ownership of a session for recording.
 *
 * OpenCode keeps one event subscription per location, and configuration
 * reloads can leave several live instances watching the same global stream. The
 * first instance to create `<home>/<source>/.claims/<sessionId>.claim` owns the
 * session; every later instance is told to stay silent so a session is never
 * recorded twice. Any failure other than an existing claim fails open, because
 * losing a trace is worse than duplicating one.
 */
export function claimSession(
  sessionId: string,
  { home, source, fs = fsModule }: { home: string; source: string; fs?: ClaimFs },
): boolean {
  if (!sessionId) {
    return false;
  }
  try {
    const directory = join(home, source, claimDirectoryName);
    fs.mkdirSync(directory, { recursive: true });
    const handle = fs.openSync(join(directory, `${sessionId}.claim`), "wx");
    fs.closeSync(handle);
    return true;
  } catch (error) {
    return (error as { code?: string })?.code !== "EEXIST";
  }
}