import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { claimSession } from "./claim.ts";
import {
  isTerminalEventName,
  mapPiEvent,
  type AstroPayload,
} from "./mapping.ts";

type AstroRecorder = {
  resolveAstroHome?: (environment?: NodeJS.ProcessEnv) => string;
  appendTraceEvents?: (
    payloads: unknown[],
    environment?: NodeJS.ProcessEnv,
    options?: { source?: string },
  ) => unknown[];
  launchDashboardForEvents?: (
    events: unknown[],
    environment?: NodeJS.ProcessEnv,
  ) => unknown;
};

/**
 * Minimal structural view of Pi's ExtensionAPI. Pi loads this extension with
 * jiti and provides the real API at runtime, so the plugin stays
 * zero-dependency and only names the one method it uses.
 */
type PiExtensionApi = {
  on: (
    event: string,
    handler: (event: any, ctx: PiContext) => void | Promise<void>,
  ) => unknown;
};

type PiContext = {
  cwd?: string;
  sessionManager?: {
    getSessionId?: () => string | undefined;
    getCwd?: () => string | undefined;
  };
};

// The extension ships next to the canonical recorder in the ASTRO repository,
// so the recorder is loaded in-process when present and the CLI is the
// fallback for installed copies that keep it one level deeper.
const extensionDir = dirname(fileURLToPath(import.meta.url));
const recorderCandidates = [
  join(extensionDir, "..", "plugin", "trace-recorder.cjs"),
  join(extensionDir, "plugin", "trace-recorder.cjs"),
];

const source = "pi";
const flushIntervalMs = 150;

function resolveAstroHome(): string {
  const fromRecorder = loaded?.module.resolveAstroHome?.(process.env);
  if (fromRecorder) {
    return fromRecorder;
  }
  // Mirrors plugin/storage-paths.cjs so claims still work when the recorder
  // module cannot be required in-process and recording falls back to the CLI.
  const configured = process.env.ASTRO_HOME || process.env.AOT_HOME;
  if (configured) {
    return configured.startsWith("~/")
      ? join(homedir(), configured.slice(2))
      : resolve(configured);
  }
  return join(homedir(), ".astrox");
}

function loadRecorder(): { module: AstroRecorder; file: string } | null {
  const requireModule = createRequire(import.meta.url);
  for (const file of recorderCandidates) {
    try {
      return { module: requireModule(file), file };
    } catch {
      // Try the next layout.
    }
  }
  return null;
}

const loaded = loadRecorder();

function spawnRecord(file: string, payloads: AstroPayload[]) {
  for (const payload of payloads) {
    try {
      const child = spawn("node", [file, `--source=${source}`, "--quiet"], {
        stdio: ["pipe", "ignore", "pipe"],
      });
      child.stdin.on("error", () => {});
      child.stderr.on("data", () => {});
      child.stdin.end(JSON.stringify(payload));
    } catch {
      // Observability must never interrupt the agent execution path.
    }
  }
}

export default function (pi: PiExtensionApi) {
  // One Pi process drives one session, so a single mapping context pairs the
  // session's `input` events with their `before_agent_start` runs.
  const ownedSessions = new Set<string>();
  const foreignSessions = new Set<string>();
  const sessionCwds = new Map<string, string>();
  // A closed turn reports one terminal event; an identical re-fire is noise.
  const lastTerminal = new Map<string, string>();
  const mappingContext: { pendingPrompt?: string } = {};
  let queue: AstroPayload[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;

  const flush = () => {
    timer = undefined;
    if (!queue.length) {
      return;
    }
    const batch = queue;
    queue = [];
    if (loaded?.module.appendTraceEvents) {
      try {
        const events = loaded.module.appendTraceEvents(batch, process.env, {
          source,
        });
        loaded.module.launchDashboardForEvents?.(events, process.env);
        return;
      } catch {
        // Fall through to the CLI path when in-process recording fails.
      }
    }
    if (loaded) {
      spawnRecord(loaded.file, batch);
    }
  };

  const enqueue = (payload: AstroPayload) => {
    queue.push(payload);
    timer ??= setTimeout(flush, flushIntervalMs);
  };

  const emit = (type: string, event: any, ctx: PiContext) => {
    try {
      const sessionId =
        ctx?.sessionManager?.getSessionId?.() ?? event?.sessionId ?? "";
      if (!sessionId) {
        return;
      }
      const cwd =
        ctx?.cwd ?? ctx?.sessionManager?.getCwd?.() ?? sessionCwds.get(sessionId) ?? "";
      if (cwd) {
        sessionCwds.set(sessionId, cwd);
      }
      if (foreignSessions.has(sessionId)) {
        return;
      }
      if (!ownedSessions.has(sessionId)) {
        // Pi sessions are resumable: the claim stores the owning pid, so a
        // later process takes the session over only after this one exits.
        if (claimSession(sessionId, { home: resolveAstroHome(), source })) {
          ownedSessions.add(sessionId);
        } else {
          // Another live Pi process owns this session.
          foreignSessions.add(sessionId);
          return;
        }
      }

      const payloads = mapPiEvent(type, event, mappingContext);
      for (const payload of payloads) {
        if (isTerminalEventName(payload.eventName)) {
          if (lastTerminal.get(sessionId) === payload.eventName) {
            continue;
          }
          lastTerminal.set(sessionId, payload.eventName);
        } else if (payload.eventName === "Notification") {
          // A new model step means the previous terminal no longer dedupes.
          lastTerminal.delete(sessionId);
        }
        enqueue({ sessionId, cwd, ...payload });
      }
    } catch {
      // A broken trace path must never block the agent loop.
    }
  };

  const observedEvents = [
    "session_start",
    "input",
    "before_agent_start",
    "message_end",
    "tool_call",
    "tool_result",
    "user_bash",
    "model_select",
    "session_before_compact",
    "session_compact",
  ];
  for (const type of observedEvents) {
    pi.on(type, (event, ctx) => {
      emit(type, event, ctx);
    });
  }

  // session_shutdown tears the runtime down; the SessionEnd event must reach
  // disk, so flush synchronously instead of leaving it on the batch timer.
  pi.on("session_shutdown", (event, ctx) => {
    emit("session_shutdown", event, ctx);
    if (timer) {
      clearTimeout(timer);
    }
    flush();
  });
}
