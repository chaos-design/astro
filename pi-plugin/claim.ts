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
 * Pi sessions are resumable: `/resume` reopens the same session file and id,
 * so a claim that only checked for existence would silence every later pi
 * process forever after the first owner exited. The claim file therefore
 * stores the owning pid; a later instance takes over when the recorded
 * process is no longer running. Any failure other than a live claim fails
 * open, because losing a trace is worse than duplicating one.
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
      if (Number.isInteger(previousPid) && previousPid > 0) {
        try {
          process.kill(previousPid, 0);
          // The previous owner is still running; it keeps the session.
          return false;
        } catch (killError) {
          if ((killError as { code?: string })?.code === "EPERM") {
            // EPERM also means the process exists, just without signal
            // rights, so the claim stays with the previous owner.
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
