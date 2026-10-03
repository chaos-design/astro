import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mapOpenCodeEvent, type AstroPayload } from "./mapping";

type AstroRecorder = {
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
    const seenSessions = new Set<string>();
    const sessionDirs = new Map<string, string>();
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
      const payloads = mapOpenCodeEvent(event);
      if (!payloads.length) {
        return;
      }
      if (!seenSessions.has(sessionId)) {
        seenSessions.add(sessionId);
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
        enqueue({ sessionId, cwd: eventDirectory, ...payload });
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