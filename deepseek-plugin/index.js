import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import recorder from "./plugin/trace-recorder.cjs";
import runtimeConfigLoader from "./plugin/runtime-config.cjs";

export const name = "astro-deepseek";

// Capture subscribes to session/* events on the root context; it never reads
// the `sessions` service. Declaring `inject = ["sessions"]` made activation
// depend on that service being ready: dsh leaves a third-party entry whose
// required services never resolve PENDING and prints only a stderr warning,
// so apply() never runs and not a single listener is registered. Subscribe
// unconditionally instead — event registration does not need the service.

const pluginRoot = dirname(fileURLToPath(import.meta.url));

function textFromContent(content, acceptedTypes = new Set(["text"])) {
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .flatMap((block) => {
      if (!block || typeof block !== "object") {
        return [];
      }
      if (acceptedTypes.has(block.type) && typeof block.text === "string") {
        return [block.text];
      }
      if (block.type === "tool-result") {
        return [textFromContent(block.content, acceptedTypes)];
      }
      return [];
    })
    .filter(Boolean)
    .join("\n");
}

function parseArguments(value) {
  if (typeof value !== "string") {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function turnStatus(reason) {
  if (reason?.kind === "error" || reason?.kind === "blocked") {
    return "failed";
  }
  if (reason?.kind === "aborted" || reason?.kind === "interrupted") {
    return "interrupted";
  }
  return "completed";
}

function turnIdFrom(event) {
  return Number.isFinite(event.data?.turn) ? String(event.data.turn) : null;
}

/**
 * Map one Harness event onto canonical ASTRO semantics.
 *
 * `carriedTurnId` is the turn the session is currently executing. Harness only
 * stamps `data.turn` on the events it emits for that turn (`turn/start`,
 * `step/*`, tool calls, the message, `turn/end`); the prompt and the inbox
 * notifications that belong to the same turn carry no number at all. Without
 * the carry-forward one logical turn reached the trace file with a mix of
 * `turnId: "6"` and `turnId: null`, and every consumer had to guess which turn
 * the null events belonged to.
 */
export function adaptDeepseekEvent(session, event, carriedTurnId = null) {
  const base = {
    id: `deepseek:${session.id}:${event.seq}`,
    capturedAt: new Date(event.time).toISOString(),
    source: "deepseek",
    sessionId: String(session.id),
    turnId: turnIdFrom(event) ?? carriedTurnId ?? null,
    parentId: session.header?.parentSession
      ? String(session.header.parentSession)
      : null,
    nativeEventName: event.type,
    sequence: event.seq,
    cwd: session.header?.cwd || null,
  };

  if (
    event.type === "user/message" &&
    event.data?.source?.kind === "user"
  ) {
    return {
      ...base,
      eventName: "UserPromptSubmit",
      payload: {
        prompt: textFromContent(event.data.content),
        content: event.data.content,
        source: event.data.source,
      },
    };
  }
  if (event.type === "assistant/message") {
    return {
      ...base,
      eventName: "AgentMessage",
      payload: {
        message: textFromContent(event.data?.message?.content),
        reasoning: textFromContent(
          event.data?.message?.content,
          new Set(["reasoning"]),
        ),
        content: event.data?.message?.content,
        interrupted: event.data?.interrupted === true,
        usage: event.data?.usage,
        model: event.data?.message?.source,
      },
    };
  }
  if (event.type === "assistant/attempt") {
    return {
      ...base,
      eventName: "Reasoning",
      payload: event.data,
    };
  }
  if (event.type === "tool/call") {
    return {
      ...base,
      eventName: "PreToolUse",
      toolUseId: String(event.data.callId),
      toolName: event.data.name,
      payload: {
        tool_name: event.data.name,
        tool_input: parseArguments(event.data.arguments),
        tool_use_id: String(event.data.callId),
        ...event.data,
      },
    };
  }
  if (event.type === "tool/result") {
    const result = event.data?.message?.content?.[0];
    const failed = result?.isError === true;
    return {
      ...base,
      eventName: failed ? "PostToolUseFailure" : "PostToolUse",
      toolUseId: result?.toolCallId ? String(result.toolCallId) : null,
      status: failed ? "failed" : "completed",
      payload: {
        tool_response: {
          content: result?.content || [],
          error: event.data?.error,
          meta: event.data?.meta,
        },
        tool_use_id: result?.toolCallId
          ? String(result.toolCallId)
          : null,
        ...event.data,
      },
    };
  }
  if (event.type === "turn/end") {
    const status = turnStatus(event.data?.reason);
    return {
      ...base,
      eventName: status === "interrupted" ? "Interrupt" : "Stop",
      status,
      payload: event.data,
    };
  }
  return {
    ...base,
    eventName: "Notification",
    payload: {
      type: event.type,
      ...event.data,
    },
  };
}

function lifecycleEvent(session, eventName) {
  const suffix =
    eventName === "SessionStart"
      ? `start:${session.header?.createdAt || Date.now()}`
      : `end:${Date.now()}`;
  return {
    id: `deepseek:${session.id}:${suffix}`,
    capturedAt:
      eventName === "SessionStart" && session.header?.createdAt
        ? new Date(session.header.createdAt).toISOString()
        : new Date().toISOString(),
    source: "deepseek",
    sessionId: String(session.id),
    parentId: session.header?.parentSession
      ? String(session.header.parentSession)
      : null,
    eventName,
    nativeEventName:
      eventName === "SessionStart" ? "session/created" : "session/disposed",
    cwd: session.header?.cwd || null,
    payload: {
      runtime: "DeepSeek Harness",
      ...(session.header || {}),
    },
  };
}

export function apply(ctx, config = {}) {
  const overrides = {
    ...(config.astroHome ? { ASTRO_HOME: config.astroHome } : {}),
    ...(config.autoOpen === undefined
      ? {}
      : { ASTRO_AUTO_OPEN: config.autoOpen ? "1" : "0" }),
  };
  // A bad config.yaml / .env must not take the whole bundle down: Cordis marks
  // a plugin whose apply() throws as FAILED, which again looks like "installed
  // but nothing is recorded". Fall back to the process environment and keep
  // the listeners alive so capture still has a chance to work.
  let environment = process.env;
  try {
    const runtimeConfig = runtimeConfigLoader.loadRuntimeConfig({
      astroHome: config.astroHome,
      environment: process.env,
      initialize: true,
      overrides,
      templateDir: pluginRoot,
    });
    for (const diagnostic of runtimeConfig.diagnostics) {
      ctx.logger?.warn?.(
        runtimeConfigLoader.formatRuntimeConfigDiagnostic(diagnostic),
      );
    }
    environment = runtimeConfig.environment;
  } catch (error) {
    ctx.logger?.warn?.(
      `ASTRO DeepSeek runtime config could not be loaded; using the process environment: ${String(error?.message || error)}`,
    );
  }
  const dashboardFile = join(pluginRoot, "server", "server.mjs");
  const record = (event) => {
    try {
      const recorded = recorder.appendTraceEvent(event, environment, {
        source: "deepseek",
        eventName: event.eventName,
      });
      recorder.launchDashboardForEvents([recorded], environment, {
        dashboardFile: existsSync(dashboardFile) ? dashboardFile : "",
      });
    } catch (error) {
      ctx.logger?.warn?.(
        `ASTRO DeepSeek capture failed: ${String(error?.message || error)}`,
      );
    }
  };

  ctx.on("session/created", (session) => {
    record(lifecycleEvent(session, "SessionStart"));
  });
  // One turn identity per session, carried from `turn/start` through the last
  // event before `turn/end`: every event inside a turn then records the same
  // `turnId`, and the LOG groups by the source's own number instead of
  // inferring a boundary from a neighbour that happens to carry one.
  const turnBySession = new Map();
  ctx.on("session/event", (session, event) => {
    const key = String(session.id);
    const nativeTurnId = turnIdFrom(event);
    const turnId = nativeTurnId ?? turnBySession.get(key) ?? null;
    if (nativeTurnId !== null) {
      turnBySession.set(key, nativeTurnId);
    }
    if (event.type === "turn/end") {
      turnBySession.delete(key);
    }
    record(adaptDeepseekEvent(session, event, turnId));
  });
  ctx.on("session/disposed", (session) => {
    turnBySession.delete(String(session.id));
    record(lifecycleEvent(session, "SessionEnd"));
  });
}
