import fsModule from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

type AnyRecord = Record<string, any>;

export type DelegationFs = Pick<
  typeof fsModule,
  "readdirSync" | "readFileSync"
>;

export type SubagentIdentity = {
  /** Number of nested Pi processes; > 0 means this process is a subagent. */
  depth: number;
  /** Ancestor agent names, outer first. */
  stack: string[];
  /** The Pi session this child was delegated from, when known. */
  parentSessionId: string;
  agent: string;
  handle: string;
  childSessionId: string;
};

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Resolve a Pi session id across CLI, Web and SDK hosts.
 *
 * The recorder used to read only `ctx.sessionManager.getSessionId()`, so a
 * host whose extension context omits `sessionManager` dropped every event —
 * the main Agent produced no session at all while the subagent child
 * processes (headless Pi, which do expose it) recorded normally. Walk every
 * spelling the hosts use, then fall back to a stable per-process id: an
 * imperfect session id beats losing the whole main-agent trace.
 */
export function resolvePiSessionId(
  event: AnyRecord | undefined,
  ctx: AnyRecord | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const candidates: Array<() => unknown> = [
    () => ctx?.sessionManager?.getSessionId?.(),
    () => ctx?.sessionId,
    () => ctx?.session?.id,
    () => event?.sessionId,
    () => event?.session?.id,
    () => event?.context?.sessionId,
    () => env?.PI_SESSION_ID,
    () => env?.PI_SESSION,
  ];
  for (const read of candidates) {
    let value = "";
    try {
      value = readString(read());
    } catch {
      // A throwing getter is not a session id; keep looking.
    }
    if (value) {
      return value;
    }
  }
  let cwd = "";
  try {
    cwd = readString(ctx?.cwd ?? ctx?.sessionManager?.getCwd?.() ?? event?.cwd);
  } catch {
    // cwd is only used to make the fallback readable.
  }
  const scope = cwd.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(-60);
  return `pi-process-${process.pid}${scope ? `-${scope}` : ""}`;
}

/**
 * Read the delegation origin of a Pi subagent.
 *
 * `PI_SUBAGENT_DELEGATION` is the launch-time transport for a *new named*
 * child session; it is cleared on continuations, so the persisted
 * `pi-subagent:delegation` custom entry in the child's session JSONL is the
 * durable contract. Accept only an entry whose `childSessionId` matches the
 * session we are recording — a parent-seeded fork can carry a copied entry
 * that does not describe it.
 */
export function readSubagentIdentity({
  sessionId,
  cwd = "",
  env = process.env,
  fs = fsModule,
  home = homedir(),
}: {
  sessionId: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  fs?: DelegationFs;
  home?: string;
}): SubagentIdentity | null {
  const depth = Number(env?.PI_SUBAGENT_DEPTH ?? 0);
  if (!Number.isFinite(depth) || depth <= 0) {
    return null;
  }
  let stack: string[] = [];
  try {
    const parsed = JSON.parse(env?.PI_SUBAGENT_STACK ?? "[]");
    if (Array.isArray(parsed)) {
      stack = parsed.filter((item): item is string => typeof item === "string");
    }
  } catch {
    // A malformed stack only costs the human-readable agent label.
  }
  const identity: SubagentIdentity = {
    depth,
    stack,
    parentSessionId: "",
    agent: stack.at(-1) ?? "",
    handle: "",
    childSessionId: sessionId,
  };

  try {
    const payload = JSON.parse(env?.PI_SUBAGENT_DELEGATION ?? "");
    const childId = readString(payload?.childSessionId);
    const parentSessionId = readString(payload?.parentSessionId);
    if (parentSessionId && (!childId || childId === sessionId)) {
      return {
        ...identity,
        parentSessionId,
        agent: readString(payload?.agent) || identity.agent,
        handle: readString(payload?.handle),
        childSessionId: childId || sessionId,
      };
    }
  } catch {
    // No launch payload (ephemeral call or continuation): use the JSONL.
  }

  const directory = readString(env?.PI_CODING_AGENT_SESSION_DIR) ||
    join(home, ".pi", "agent", "sessions");
  const persisted = findPersistedDelegation(directory, sessionId, fs);
  if (persisted) {
    return {
      ...identity,
      parentSessionId: persisted.parentSessionId,
      agent: persisted.agent || identity.agent,
      handle: persisted.handle,
    };
  }
  // `cwd` is accepted for callers that want to scope the lookup later; the
  // session id is already unique, so scanning by id stays unambiguous.
  void cwd;
  return identity;
}

function findPersistedDelegation(
  directory: string,
  sessionId: string,
  fs: DelegationFs,
): { parentSessionId: string; agent: string; handle: string } | null {
  const file = findSessionFile(directory, sessionId, fs, 0);
  if (!file) {
    return null;
  }
  try {
    const lines = fs.readFileSync(file, "utf8").split("\n");
    // The delegation entry is written when the named child session is first
    // created, so it lives near the top; bound the read for very long files.
    for (const line of lines.slice(0, 2000)) {
      try {
        const entry = JSON.parse(line);
        if (
          entry?.type !== "custom" ||
          entry?.customType !== "pi-subagent:delegation"
        ) {
          continue;
        }
        const data = entry?.data;
        if (readString(data?.childSessionId) !== sessionId) {
          continue;
        }
        const parentSessionId = readString(data?.parentSessionId);
        if (!parentSessionId) {
          continue;
        }
        return {
          parentSessionId,
          agent: readString(data?.agent),
          handle: readString(data?.handle),
        };
      } catch {
        // A partial trailing line is normal in a live session file.
      }
    }
  } catch {
    // Unreadable session file: fail open with the launch-time identity.
  }
  return null;
}

function findSessionFile(
  directory: string,
  sessionId: string,
  fs: DelegationFs,
  depth: number,
): string | null {
  let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }>;
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true }) as typeof entries;
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (entry.isDirectory() && depth < 1) {
      const found = findSessionFile(join(directory, entry.name), sessionId, fs, depth + 1);
      if (found) {
        return found;
      }
    } else if (entry.isFile() && entry.name.endsWith(`${sessionId}.jsonl`)) {
      return join(directory, entry.name);
    }
  }
  return null;
}
