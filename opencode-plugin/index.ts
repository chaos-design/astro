import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { claimSession } from "./claim";
import {
  isTerminalEventName,
  mapOpenCodeEvent,
  type AstroPayload,
} from "./mapping";

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

// The plugin ships next to the canonical recorder in the ASTRO repository, so
// the recorder is loaded in-process when present and the CLI is the fallback for
// installed copies that keep it one level deeper.
const recorderCandidates = [
  join(dirname(fileURLToPath(import.meta.url)), "..", "plugin", "trace-recorder.cjs"),
  join(dirname(fileURLToPath(import.meta.url)), "plugin", "trace-recorder.cjs"),
];

const source = "opencode";
const flushIntervalMs = 150;

/**
 * A session is recorded by exactly one plugin instance. OpenCode can keep an
 * event subscription alive per location across configuration reloads, so the
 * same session can reach several instances; the first instance to create the
 * claim file owns recording for that session.
 */
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

export default {
  id: "astro-capture",
  async setup(ctx: any) {
    const location = ctx?.location?.directory || process.cwd();
    const ownedSessions = new Set<string>();
    const foreignSessions = new Set<string>();
    const startedSessions = new Set<string>();
    const sessionDirs = new Map<string, string>();
    // A declined tool reports both session.step.failed and
    // session.execution.interrupted; only the first terminal event is kept.
    const lastTerminal = new Map<string, string>();
    // session.tool.input.started is the only event carrying the tool name.
    const toolNames = new Map<string, string>();
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

    const emit = (event: any) => {
      const sessionId = event?.data?.sessionID;
      if (!sessionId) {
        return;
      }
      const eventDirectory =
        event?.location?.directory ||
        event?.data?.location?.directory ||
        sessionDirs.get(sessionId) ||
        "";
      if (eventDirectory) {
        sessionDirs.set(sessionId, eventDirectory);
      }
      // The event stream is global and every location runs a plugin instance,
      // so only the instance that owns this session may record it.
      if (!eventDirectory || eventDirectory !== location) {
        return;
      }
      if (foreignSessions.has(sessionId)) {
        return;
      }
      if (!ownedSessions.has(sessionId)) {
        if (claimSession(sessionId, { home: resolveAstroHome(), source })) {
          ownedSessions.add(sessionId);
        } else {
          // Another live instance owns this session.
          foreignSessions.add(sessionId);
          return;
        }
      }

      const callId = event?.data?.id;
      const toolKey = callId ? `${sessionId}:${callId}` : "";
      if (event?.type === "session.tool.input.started" && callId) {
        toolNames.set(toolKey, String(event?.data?.name || ""));
      }
      const payloads = mapOpenCodeEvent(event, {
        toolName: toolKey ? toolNames.get(toolKey) : undefined,
      });
      if (!payloads.length) {
        return;
      }
      if (!startedSessions.has(sessionId)) {
        startedSessions.add(sessionId);
        enqueue({
          eventName: "SessionStart",
          sessionId,
          cwd: eventDirectory,
        });
      }
      for (const payload of payloads) {
        if (payload.eventName === "SessionStart") {
          continue;
        }
        if (isTerminalEventName(payload.eventName)) {
          if (lastTerminal.get(sessionId) === payload.eventName) {
            continue;
          }
          lastTerminal.set(sessionId, payload.eventName);
        } else if (payload.eventName === "Notification") {
          // A new model step means the previous terminal no longer dedupes.
          lastTerminal.delete(sessionId);
        }
        enqueue({ sessionId, cwd: eventDirectory, ...payload });
        if (
          toolKey &&
          (payload.eventName === "PostToolUse" ||
            payload.eventName === "PostToolUseFailure")
        ) {
          toolNames.delete(toolKey);
        }
      }
    };

    const controller = new AbortController();
    void (async () => {
      try {
        for await (const event of ctx.event.subscribe({
          signal: controller.signal,
        }) as AsyncIterable<any>) {
          emit(event);
        }
      } catch {
        // Stream closed or plugin unloaded.
      }
    })();

    return () => {
      controller.abort();
      if (timer) {
        clearTimeout(timer);
      }
      flush();
    };
  },
};