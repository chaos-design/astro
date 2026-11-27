import fsModule from "node:fs";
import { join } from "node:path";

export const claimDirectoryName = ".claims";

export type ClaimFs = Pick<
  typeof fsModule,
  | "mkdirSync"
  | "openSync"
  | "closeSync"
  | "readFileSync"
  | "writeFileSync"
>;

export type ClaimRecord = {
  pid: number;
  claimedAt: string;
};

/**
 * Claims exclusive ownership of a session for recording.
 *
 * OpenCode keeps one event subscription per location, and configuration
 * reloads leave several live instances watching the same global stream. The
 * first instance to create `<home>/<source>/.claims/<sessionId>.claim` owns the
 * session; later instances stay silent so a session is never recorded twice.
 *
 * The file stores the owning pid, though: `opencode service restart` and a
 * config reload kill the previous instance but leave its claim behind. A
 * later instance takes over when that process is gone, and a reload inside
 * the same process takes over its own claim. Any failure other than a live,
 * foreign claim fails open, because losing a trace is worse than duplicating
 * one.
 */
export function claimSession(
  sessionId: string,
  {
    home,
    source,
    pid = process.pid,
    fs = fsModule,
  }: {
    home: string;
    source: string;
    pid?: number;
    fs?: ClaimFs;
  },
): boolean {
  if (!sessionId) {
    return false;
  }
  const directory = join(home, source, claimDirectoryName);
  const claimFile = join(directory, `${sessionId}.claim`);
  const record: ClaimRecord = {
    pid,
    claimedAt: new Date().toISOString(),
  };
  try {
    fs.mkdirSync(directory, { recursive: true });
    const handle = fs.openSync(claimFile, "wx");
    fs.closeSync(handle);
    fs.writeFileSync(claimFile, `${JSON.stringify(record)}\n`, "utf8");
    return true;
  } catch (error) {
    if ((error as { code?: string })?.code !== "EEXIST") {
      return true;
    }
    try {
      const previous = JSON.parse(
        fs.readFileSync(claimFile, "utf8"),
      ) as Partial<ClaimRecord>;
      const previousPid = Number(previous.pid);
      if (
        Number.isInteger(previousPid) &&
        previousPid > 0 &&
        // A reload re-runs the plugin in this process: a liveness probe would
        // see our own pid and silence every event after the reload. The same
        // process always owns its own claim.
        previousPid !== pid
      ) {
        try {
          process.kill(previousPid, 0);
          // The previous owner is still running; it keeps the session.
          return false;
        } catch (killError) {
          if ((killError as { code?: string })?.code === "EPERM") {
            // EPERM also means the process exists, just without signal rights.
            return false;
          }
          // ESRCH (or anything else): the owner is gone, take over below.
        }
      }
    } catch {
      // A missing or unreadable claim from a dead owner fails open.
    }
    try {
      fs.writeFileSync(claimFile, `${JSON.stringify(record)}\n`, "utf8");
      return true;
    } catch {
      return true;
    }
  }
}
