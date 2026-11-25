import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { claimSession } from "./claim.ts";
import { readSubagentIdentity, resolvePiSessionId } from "./session.ts";
import {
  isTerminalEventName,
  mapPiEvent,
  readPiLiveText,
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

// The installed extension's own manifest is the single source of truth for
// which capture code wrote an event, so a stale process is observable in the
// console after a reinstall without a restart.
const extensionRequire = createRequire(import.meta.url);
const captureVersion = (() => {
  try {
    return String(extensionRequire("./package.json").version || "");
  } catch {
    return "";
  }
})();

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
  // Pi emits no start→delta stream to the console: only `message_end` used to
  // write the whole text, so the reader saw nothing until the step finished.
  // Accumulate the live text per message and enqueue throttled snapshots, the
  // same way opencode turns `session.text.delta` into AgentMessage snapshots.
  // Reading the accumulated text from each update (not blind delta append)
  // keeps every snapshot a prefix of the final message_end text.
  const liveText = new Map<string, { text: string; lastAt: number }>();
  const liveTextIntervalMs = 800;
  // Pi's assistant messages carry no stable id of their own, so synthesize one
  // per message and reuse it across its snapshots and final AgentMessage. The
  // origin session id scopes subagents; the counter keeps consecutive messages
  // of a resumed session distinct.
  const messageSeqBySession = new Map<string, number>();
  const liveMessageIdBySession = new Map<string, string>();
  // One token per extension instance. A resumed session loads a fresh instance
  // whose per-session counter starts at 1 again; without the token its new
  // replies would reuse the previous process's ids and fold into the same
  // reply in the Agent view (or raise a false prefix-break diagnostic).
  const replyIdToken = randomUUID().slice(0, 8);
  // Subagent identity is read once per child session: the launch payload is
  // cheap, the persisted delegation entry is read only on a continuation.
  const subagentIdentities = new Map<string, ReturnType<typeof readSubagentIdentity>>();
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
    queue.push(captureVersion ? { ...payload, captureVersion } : payload);
    timer ??= setTimeout(flush, flushIntervalMs);
  };

  const emit = (type: string, event: any, ctx: PiContext) => {
    try {
      // The claim and the live-text buffers key on the *origin* session: two
      // parallel children of the same parent must not fight over one claim or
      // share an assistant text accumulator.
      const sessionId = resolvePiSessionId(event, ctx);
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

      // A subagent child records into its *parent's* session so its messages
      // are associated with the main Agent instead of orphaned under a
      // `subagent.*` session. `agent` is deliberately not used as a field name
      // here: the recorder reads it as a source client override.
      if (!subagentIdentities.has(sessionId)) {
        subagentIdentities.set(
          sessionId,
          readSubagentIdentity({ sessionId, cwd, env: process.env }),
        );
      }
      const identity = subagentIdentities.get(sessionId);
      const displaySessionId = identity?.parentSessionId || sessionId;
      const attribution = identity
        ? {
            ...(identity.parentSessionId
              ? { parentSessionId: identity.parentSessionId }
              : {}),
            ...(identity.agent ? { subagentAgent: identity.agent } : {}),
            ...(identity.handle ? { subagentHandle: identity.handle } : {}),
            ...(identity.childSessionId && identity.childSessionId !== displaySessionId
              ? { subagentSessionId: identity.childSessionId }
              : {}),
          }
        : {};

      // Live assistant text. `message_start` opens a new buffer, each update
      // advances it and emits a throttled snapshot, and `message_end` clears
      // it before the final complete AgentMessage is written below. Snapshots
      // are non-terminal, so they never touch the terminal dedupe set. Pi
      // fires these for user / tool-result messages too; those must never
      // clear an assistant buffer that is still filling.
      if (
        type === "message_start" ||
        type === "message_update" ||
        type === "message_end"
      ) {
        const role = String(event?.message?.role ?? "");
        if (role && role !== "assistant") {
          return;
        }
        // Pi gives assistants no stable per-message id, so allocate one at
        // message_start and reuse it for the throttled snapshots and the final
        // message. The origin `sessionId` already separates subagents.
        if (type === "message_start") {
          const seq = (messageSeqBySession.get(sessionId) ?? 0) + 1;
          messageSeqBySession.set(sessionId, seq);
          const id = `pi-${replyIdToken}-${sessionId}-${seq}`;
          liveMessageIdBySession.set(sessionId, id);
          mappingContext.messageId = id;
          liveText.delete(`${sessionId}:${id}`);
          return;
        }
        const messageId = liveMessageIdBySession.get(sessionId) ?? null;
        // The final message is written through mapPiEvent below; hand it the
        // same id so the console folds every snapshot into that one reply.
        mappingContext.messageId = messageId ?? undefined;
        const live = readPiLiveText(event, messageId ?? undefined);
        const key = `${sessionId}:${messageId ?? "default"}`;
        if (type === "message_end") {
          liveText.delete(key);
          liveMessageIdBySession.delete(sessionId);
        } else {
          const state = liveText.get(key) ?? { text: "", lastAt: 0 };
          if (live.text !== null) {
            state.text = live.text;
          } else if (live.delta) {
            state.text += live.delta;
          } else {
            return;
          }
          const now = Date.now();
          if (now - state.lastAt >= liveTextIntervalMs) {
            state.lastAt = now;
            enqueue({
              eventName: "AgentMessage",
              sessionId: displaySessionId,
              cwd,
              message: state.text,
              streamed: true,
              // Same synthesized id as the final message: the accumulated
              // snapshots are merged by the console into a single reply.
              ...(messageId ? { messageId } : {}),
              ...attribution,
            });
          }
          liveText.set(key, state);
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
        enqueue({
          sessionId: displaySessionId,
          cwd,
          ...payload,
          ...attribution,
        });
      }
    } catch {
      // A broken trace path must never block the agent loop.
    }
  };

  const observedEvents = [
    "session_start",
    "input",
    "before_agent_start",
    "message_start",
    "message_update",
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
