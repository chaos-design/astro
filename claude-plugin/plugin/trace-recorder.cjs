const crypto = require("node:crypto");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const {
  resolveAgentTraceFile,
  resolveAstroHome,
} = require("./storage-paths.cjs");
const {
  formatRuntimeConfigDiagnostic,
  loadRuntimeConfig,
} = require("./runtime-config.cjs");

const sensitiveKeyPattern =
  /authorization|cookie|password|passwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|credential|private[_-]?key/i;

const inlineSecretPatterns = [
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, "Bearer [redacted]"],
  [/\bsk-[A-Za-z0-9_-]{12,}/g, "sk-[redacted]"],
  [
    /\b(api[_-]?key|access[_-]?token|password|secret)\s*[:=]\s*["']?[^,\s"']{6,}/gi,
    "$1=[redacted]",
  ],
  [
    /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    "[redacted-jwt]",
  ],
];

const canonicalEventNames = new Map(
  [
    "SessionStart",
    "SessionEnd",
    "UserPromptSubmit",
    "PreToolUse",
    "PostToolUse",
    "PostToolUseFailure",
    "PermissionRequest",
    "PermissionDenied",
    "Notification",
    "SubagentStart",
    "SubagentStop",
    "TaskCreated",
    "TaskCompleted",
    "InstructionsLoaded",
    "ConfigChange",
    "CwdChanged",
    "WorktreeCreate",
    "WorktreeRemove",
    "PreCompact",
    "PostCompact",
    "Elicitation",
    "ElicitationResult",
    "AgentMessage",
    "Reasoning",
    "Stop",
    "StopFailure",
    "Interrupt",
  ].flatMap((name) => [
    [name.toLowerCase(), name],
    [name.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase(), name],
  ]),
);

const codexToolTypes = new Set([
  "command_execution",
  "file_change",
  "mcp_tool_call",
  "web_search",
  "function_call",
  "custom_tool_call",
]);

function redactString(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.stringify(redactValue(JSON.parse(value)));
    } catch {
      // Non-JSON prose still receives inline credential redaction.
    }
  }
  return inlineSecretPatterns.reduce(
    (result, [pattern, replacement]) => result.replace(pattern, replacement),
    value,
  );
}

function redactValue(value, key = "") {
  if (sensitiveKeyPattern.test(key)) {
    return "[redacted]";
  }

  if (typeof value === "string") {
    return redactString(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [
        childKey,
        redactValue(childValue, childKey),
      ]),
    );
  }

  return value;
}

function normalizeSource(value) {
  const source = String(value || "generic").trim().toLowerCase();
  if (source.includes("claude")) {
    return "claude";
  }
  if (source.includes("codex") || source.includes("openai")) {
    return "codex";
  }
  if (source.includes("deepseek") || source === "dsh") {
    return "deepseek";
  }
  if (source.includes("workbuddy") || source.includes("codebuddy")) {
    return "workbuddy";
  }
  if (source.includes("trae")) {
    return "trae";
  }
  if (
    source.includes("browser") ||
    source.includes("chrome") ||
    source.includes("extension")
  ) {
    return "browser";
  }
  return source.replace(/[^a-z0-9._-]+/g, "-") || "generic";
}

function canonicalizeEventName(name) {
  const value = String(name || "Unknown");
  return canonicalEventNames.get(value.toLowerCase()) || value;
}

function getCodexItem(payload) {
  return payload.item || payload.payload?.item || payload.payload || {};
}

function isCodexToolItem(item) {
  return codexToolTypes.has(item?.type || item?.item_type);
}

function inferCodexEventName(payload) {
  const outerType = payload.type;
  const innerType = payload.payload?.type;

  if (outerType === "session_meta" || outerType === "thread.started") {
    return "SessionStart";
  }
  if (outerType === "turn.started") {
    return "Notification";
  }
  if (outerType === "turn.completed" || innerType === "task_complete") {
    return "Stop";
  }
  if (
    outerType === "turn.aborted" ||
    outerType === "turn.cancelled" ||
    innerType === "turn_aborted"
  ) {
    return "Interrupt";
  }
  if (outerType === "turn.failed") {
    return "Stop";
  }
  if (outerType === "error") {
    return "Notification";
  }
  if (outerType === "item.started") {
    return isCodexToolItem(getCodexItem(payload))
      ? "PreToolUse"
      : "Notification";
  }
  if (outerType === "item.completed") {
    const item = getCodexItem(payload);
    if (isCodexToolItem(item)) {
      return "PostToolUse";
    }
    if (["agent_message", "assistant_message"].includes(item.type)) {
      return "AgentMessage";
    }
    if (item.type === "reasoning") {
      return "Reasoning";
    }
    return "Notification";
  }
  if (outerType === "event_msg") {
    if (innerType === "user_message") {
      return "UserPromptSubmit";
    }
    if (innerType === "agent_message") {
      return "AgentMessage";
    }
    if (innerType === "task_complete") {
      return "Stop";
    }
    if (innerType === "turn_aborted") {
      return "Interrupt";
    }
    if (innerType === "task_started") {
      return "Notification";
    }
  }
  if (outerType === "response_item") {
    if (["function_call", "custom_tool_call"].includes(innerType)) {
      return "PreToolUse";
    }
    if (["function_call_output", "custom_tool_call_output"].includes(innerType)) {
      return "PostToolUse";
    }
    if (innerType === "reasoning") {
      return "Reasoning";
    }
    if (innerType === "message") {
      return payload.payload?.role === "user"
        ? "UserPromptSubmit"
        : "AgentMessage";
    }
  }
  return "Notification";
}

function inferEventName(payload, source) {
  const hookName =
    payload.eventName ||
    payload.event_name ||
    payload.hook_event_name ||
    payload.hookEventName;
  if (hookName) {
    return canonicalizeEventName(hookName);
  }
  if (source === "codex") {
    return inferCodexEventName(payload);
  }
  return canonicalizeEventName(payload.type);
}

function extractText(value) {
  if (typeof value === "string") {
    return value;
  }
  if (!Array.isArray(value)) {
    return "";
  }
  return value
    .map((part) =>
      typeof part === "string"
        ? part
        : part?.text || part?.input_text || part?.output_text || "",
    )
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

function enrichPayload(payload, eventName) {
  const item = getCodexItem(payload);
  const safePayload = { ...payload };

  if (eventName === "UserPromptSubmit" && !safePayload.prompt) {
    safePayload.prompt =
      safePayload.message ||
      safePayload.payload?.message ||
      extractText(safePayload.content || safePayload.payload?.content);
  }

  if (eventName === "AgentMessage" && !safePayload.message) {
    safePayload.message =
      safePayload.payload?.message ||
      item.text ||
      extractText(item.content || safePayload.content);
  }

  if (eventName === "PreToolUse" && !safePayload.tool_input) {
    safePayload.tool_input =
      item.arguments !== undefined
        ? parseArguments(item.arguments)
        : item.command !== undefined
          ? { command: item.command }
          : item;
  }

  if (
    ["PostToolUse", "PostToolUseFailure"].includes(eventName) &&
    !safePayload.tool_response
  ) {
    safePayload.tool_response =
      item.output !== undefined
        ? item.output
        : item.result !== undefined
          ? item.result
          : item;
  }

  return safePayload;
}

function createWorkspaceId(cwd) {
  if (!cwd) {
    return "unknown";
  }
  return crypto
    .createHash("sha256")
    .update(path.resolve(String(cwd)))
    .digest("hex")
    .slice(0, 12);
}

function createTraceLocator(event) {
  return `trace://${encodeURIComponent(event.source)}/${encodeURIComponent(
    event.sessionId,
  )}/${encodeURIComponent(event.id)}`;
}

function createTraceEvent(payload, optionsOrCapturedAt = {}, legacyCapturedAt, environment) {
  const options =
    typeof optionsOrCapturedAt === "string"
      ? { capturedAt: optionsOrCapturedAt }
      : optionsOrCapturedAt || {};
  if (legacyCapturedAt) {
    options.capturedAt = legacyCapturedAt;
  }

  // WorkBuddy runs command hooks without piping the event payload into
  // stdin; it only carries session and workspace context through the hook
  // environment. Fall back to those variables when the payload omits them.
  const hookEnvironment = environment || {};
  const envSessionId =
    hookEnvironment.CODEBUDDY_SESSION_ID ||
    hookEnvironment.CLAUDE_SESSION_ID ||
    "";
  const envCwd =
    hookEnvironment.CODEBUDDY_PROJECT_DIR ||
    hookEnvironment.CLAUDE_PROJECT_DIR ||
    "";

  const source = normalizeSource(
    options.source ||
      payload.sourceClient ||
      payload.source_client ||
      payload.agent ||
      payload.client ||
      payload.source ||
      "generic",
  );
  const isEventEnvelope =
    payload.payload &&
    (payload.schemaVersion ||
      payload.eventName ||
      payload.event_name ||
      payload.sessionId);
  const rawPayload = isEventEnvelope ? payload.payload : payload;
  const eventName =
    options.eventName || payload.eventName || inferEventName(payload, source);
  const item = getCodexItem(payload);
  const cwd = String(
    options.cwd ||
      payload.cwd ||
      payload.payload?.cwd ||
      payload.payload?.session_meta?.cwd ||
      envCwd ||
      "",
  ) || null;
  const sessionId = String(
    options.sessionId ||
      payload.sessionId ||
      payload.session_id ||
      payload.threadId ||
      payload.thread_id ||
      (payload.type === "session_meta" ? payload.payload?.id : "") ||
      envSessionId ||
      "unknown-session",
  );
  const capturedAt =
    options.capturedAt ||
    payload.capturedAt ||
    payload.timestamp ||
    payload.payload?.timestamp ||
    new Date().toISOString();
  const toolUseId =
    payload.toolUseId ||
    payload.tool_use_id ||
    item.call_id ||
    item.id ||
    null;
  const toolName =
    payload.toolName ||
    payload.tool_name ||
    item.name ||
    item.type ||
    item.item_type ||
    null;
  const id = String(payload.id || options.id || crypto.randomUUID());
  const normalized = {
    schemaVersion: 2,
    id,
    capturedAt: new Date(capturedAt).toISOString(),
    source,
    sourceVersion:
      payload.sourceVersion ||
      payload.source_version ||
      payload.payload?.cli_version ||
      null,
    workspaceId:
      payload.workspaceId || payload.workspace_id || createWorkspaceId(cwd),
    sessionId,
    turnId:
      payload.turnId ||
      payload.turn_id ||
      payload.payload?.turn_id ||
      options.turnId ||
      null,
    parentId:
      payload.parentId ||
      payload.parent_id ||
      payload.agent_id ||
      payload.payload?.agent_id ||
      null,
    eventName: canonicalizeEventName(eventName),
    nativeEventName: String(
      payload.nativeEventName ||
        payload.hook_event_name ||
        payload.event_name ||
        payload.type ||
        eventName,
    ),
    toolUseId: toolUseId ? String(toolUseId) : null,
    toolName: toolName ? String(toolName) : null,
    cwd: cwd ? redactString(cwd) : null,
    status:
      payload.status ||
      item.status ||
      (eventName === "PostToolUseFailure" ||
      payload.type === "turn.failed" ||
      ["StopFailure", "stop_failure"].includes(
        payload.hook_event_name || payload.event_name,
      )
        ? "failed"
        : null),
    sequence: Number.isFinite(payload.sequence) ? payload.sequence : null,
    payload: redactValue(enrichPayload(rawPayload, eventName)),
  };

  normalized.locator = createTraceLocator(normalized);
  return normalized;
}

function resolveTraceFile(
  payload = {},
  environment = process.env,
  options = {},
) {
  const source = normalizeSource(
    options.source ||
      payload.sourceClient ||
      payload.source_client ||
      payload.agent ||
      payload.client ||
      payload.source ||
      "generic",
  );
  return resolveAgentTraceFile(source, payload, environment);
}

function appendTraceEvents(payloads, environment = process.env, options = {}) {
  const values = Array.isArray(payloads) ? payloads : [payloads];
  const events = values.map((payload) =>
    createTraceEvent(payload, options, undefined, environment),
  );
  if (!events.length) {
    return [];
  }

  const eventsByFile = new Map();
  const traceFileBySession = new Map();
  for (const event of events) {
    const sessionKey = `${event.source}::${event.sessionId}`;
    let traceFile = traceFileBySession.get(sessionKey);
    if (!traceFile) {
      traceFile = resolveTraceFile(event, environment, {
        source: event.source,
      });
      traceFileBySession.set(sessionKey, traceFile);
    }
    const group = eventsByFile.get(traceFile) || [];
    group.push(event);
    eventsByFile.set(traceFile, group);
  }

  for (const [traceFile, fileEvents] of eventsByFile) {
    fs.mkdirSync(path.dirname(traceFile), { recursive: true });
    fs.appendFileSync(
      traceFile,
      `${fileEvents.map((event) => JSON.stringify(event)).join("\n")}\n`,
      { encoding: "utf8", flag: "a" },
    );
  }
  return events;
}

function appendTraceEvent(payload, environment = process.env, options = {}) {
  return appendTraceEvents([payload], environment, options)[0];
}

function isEnabled(value) {
  return !["0", "false", "no", "off"].includes(
    String(value || "").trim().toLowerCase(),
  );
}

function isProcessRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function resolveComparablePath(value) {
  try {
    return fs.realpathSync(value);
  } catch {
    return path.resolve(value);
  }
}

function isAstroDashboardFile(value) {
  if (!value) {
    return false;
  }
  const serverFile = resolveComparablePath(value);
  const runtimeRoot = path.resolve(path.dirname(serverFile), "..");
  return (
    path.basename(serverFile) === "server.mjs" &&
    fs.existsSync(path.join(runtimeRoot, "dist", "index.html")) &&
    fs.existsSync(
      path.join(runtimeRoot, "plugin", "trace-recorder.cjs"),
    )
  );
}

function isCompatibleDashboard(existingFile, requestedFile) {
  return (
    !existingFile ||
    resolveComparablePath(existingFile) ===
      resolveComparablePath(requestedFile) ||
    (isAstroDashboardFile(existingFile) &&
      isAstroDashboardFile(requestedFile))
  );
}

const dashboardProbeScript = `
const http = require("node:http");
const port = Number(process.argv[1]);
const host = process.argv[2] || "127.0.0.1";
const request = http.get(
  { host, port, path: "/api/health", timeout: 750 },
  (response) => {
    let body = "";
    response.setEncoding("utf8");
    response.on("data", (chunk) => {
      body += chunk;
    });
    response.on("end", () => {
      let pid = 0;
      let url = "";
      try {
        const health = JSON.parse(body);
        if (health && health.status === "ok") {
          pid = Number(health.pid) || 0;
          url = typeof health.url === "string" ? health.url : "";
        }
      } catch {
        // A non-ASTRO response still means the port is occupied.
      }
      process.stdout.write(
        JSON.stringify(
          pid ? { state: "astro", pid, url } : { state: "occupied" },
        ),
      );
    });
  },
);
request.on("timeout", () => request.destroy(new Error("probe timeout")));
request.on("error", (error) => {
  process.stdout.write(
    JSON.stringify({
      state: error && error.code === "ECONNREFUSED" ? "free" : "occupied",
    }),
  );
});
`;

function probeDashboardPort(port, options = {}) {
  const host = options.host || "127.0.0.1";
  try {
    const result = childProcess.spawnSync(
      process.execPath,
      ["-e", dashboardProbeScript, String(port), host],
      { encoding: "utf8", timeout: 2_000 },
    );
    const probe = JSON.parse(result.stdout || "{}");
    return ["astro", "occupied", "free"].includes(probe?.state)
      ? probe
      : { state: "free" };
  } catch {
    // Probe failures fall back to the previous launch behavior; the spawned
    // server still handles EADDRINUSE by walking to the next port.
    return { state: "free" };
  }
}

function readDashboardPid(pidFile) {
  try {
    const value = JSON.parse(fs.readFileSync(pidFile, "utf8"));
    return {
      pid: Number(value.pid),
      server: typeof value.server === "string" ? value.server : "",
      url: typeof value.url === "string" ? value.url : "",
    };
  } catch {
    return { pid: 0, server: "", url: "" };
  }
}

function createDashboardUrl(baseUrl, event = {}) {
  try {
    const url = new URL(baseUrl);
    if (event.source && event.source !== "generic") {
      url.searchParams.set("source", event.source);
    }
    if (event.sessionId && event.sessionId !== "unknown-session") {
      url.searchParams.set("session", event.sessionId);
    }
    return url.toString();
  } catch {
    return baseUrl;
  }
}

function openDashboard(url, dependencies = {}) {
  const platform = dependencies.platform || process.platform;
  const command =
    platform === "darwin"
      ? ["open", [url]]
      : platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  try {
    const opener = (dependencies.spawn || childProcess.spawn)(
      command[0],
      command[1],
      {
        detached: true,
        stdio: "ignore",
      },
    );
    opener.on?.("error", () => {});
    opener.unref();
    return true;
  } catch {
    return false;
  }
}

function resolveDashboardFile() {
  const file = path.resolve(__dirname, "..", "server", "server.mjs");
  const indexFile = path.resolve(__dirname, "..", "dist", "index.html");
  return fs.existsSync(file) && fs.existsSync(indexFile) ? file : "";
}

function launchDashboardForEvents(
  events,
  environment = process.env,
  dependencies = {},
) {
  const triggerEvent = events.find(
    (event) =>
      event.eventName === "SessionStart" ||
      event.eventName === "UserPromptSubmit",
  );
  if (
    !triggerEvent ||
    !isEnabled(environment.ASTRO_AUTO_OPEN ?? "1")
  ) {
    return false;
  }

  const dashboardFile =
    dependencies.dashboardFile === undefined
      ? resolveDashboardFile()
      : dependencies.dashboardFile;
  if (!dashboardFile) {
    return false;
  }

  const astroHome = resolveAstroHome(environment);
  const requestedPort = Number(environment.ASTRO_PORT || 4318);
  const pidFile = path.join(astroHome, `dashboard-${requestedPort}.pid`);
  const processRunning = dependencies.isProcessRunning || isProcessRunning;
  const existing = readDashboardPid(pidFile);
  if (
    processRunning(existing.pid) &&
    isCompatibleDashboard(existing.server, dashboardFile)
  ) {
    if (dependencies.reopenExisting && existing.url) {
      const open = dependencies.openDashboard || openDashboard;
      return open(createDashboardUrl(existing.url, triggerEvent));
    }
    const message = existing.url
      ? `ASTRO is already running at ${createDashboardUrl(existing.url, triggerEvent)}. Switch to the existing dashboard tab or refresh it; no new tab was opened.`
      : "ASTRO is already starting. Switch to the existing dashboard tab or refresh it when ready; no new tab was opened.";
    if (dependencies.onAlreadyRunning) {
      dependencies.onAlreadyRunning(message);
    } else {
      process.stderr.write(`${message}\n`);
    }
    return false;
  }

  // A stale or foreign pid file does not prove the port is free. Probe the
  // requested port before spawning so an already-running instance is reused
  // instead of silently drifting to the next port.
  const probePort = dependencies.probeDashboardPort || probeDashboardPort;
  const probeHost =
    environment.ASTRO_HOST ||
    environment.AGENT_TRACE_HOST ||
    environment.TRAE_TRACE_HOST ||
    "127.0.0.1";
  const probe = probePort(requestedPort, { host: probeHost });
  if (probe.state !== "free") {
    const runningUrl = createDashboardUrl(
      probe.url || `http://${probeHost}:${requestedPort}`,
      triggerEvent,
    );
    if (probe.state === "astro") {
      if (!processRunning(existing.pid) && Number(probe.pid) > 0) {
        // Refresh the stale pid record so later triggers skip the probe.
        try {
          fs.mkdirSync(astroHome, { recursive: true });
          fs.writeFileSync(
            pidFile,
            `${JSON.stringify({
              pid: Number(probe.pid),
              server: existing.server || "",
              url: probe.url || `http://${probeHost}:${requestedPort}`,
            })}\n`,
            "utf8",
          );
        } catch {
          // A read-only ASTRO home only costs a repeated probe later.
        }
      }
      if (dependencies.reopenExisting && probe.url) {
        const open = dependencies.openDashboard || openDashboard;
        return open(runningUrl);
      }
    }
    const message =
      probe.state === "astro"
        ? `ASTRO is already running at ${runningUrl}. Switch to the existing dashboard tab or refresh it; no new tab was opened.`
        : `Port ${requestedPort} is already in use by another process; no new ASTRO dashboard was started.`;
    if (dependencies.onAlreadyRunning) {
      dependencies.onAlreadyRunning(message);
    } else {
      process.stderr.write(`${message}\n`);
    }
    return false;
  }

  fs.mkdirSync(astroHome, { recursive: true });
  fs.rmSync(pidFile, { force: true });
  const spawnProcess = dependencies.spawn || childProcess.spawn;
  const child = spawnProcess(process.execPath, [dashboardFile], {
    detached: true,
    env: {
      ...environment,
      ASTRO_HOME: astroHome,
      ASTRO_OPEN_BROWSER: "1",
      ASTRO_PID_FILE: pidFile,
      ASTRO_OPEN_SOURCE: triggerEvent.source || "",
      ASTRO_OPEN_SESSION:
        triggerEvent.sessionId === "unknown-session"
          ? ""
          : triggerEvent.sessionId || "",
    },
    stdio: "ignore",
  });
  fs.writeFileSync(
    pidFile,
    `${JSON.stringify({
      pid: child.pid,
      server: dashboardFile,
    })}\n`,
    "utf8",
  );
  child.on?.("error", () => {
    fs.rmSync(pidFile, { force: true });
  });
  child.unref();
  return true;
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      input += chunk;
    });
    process.stdin.on("end", () => resolve(input));
    process.stdin.on("error", reject);
  });
}

function getCliOption(name) {
  const inline = process.argv.find((argument) =>
    argument.startsWith(`--${name}=`),
  );
  if (inline) {
    return inline.slice(name.length + 3);
  }
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : null;
}

async function run() {
  let dashboardMessage = "";
  let failureReported = false;
  let recorded = false;
  try {
    const runtimeConfig = loadRuntimeConfig({
      environment: process.env,
      initialize: true,
    });
    const input = await readStdin();
    const payload = JSON.parse(input || "{}");
    const event = appendTraceEvent(payload, runtimeConfig.environment, {
      source: getCliOption("source") || undefined,
      // WorkBuddy never writes its hook payload to stdin, so its hook
      // commands carry the event name as an explicit flag instead.
      eventName: getCliOption("event") || undefined,
    });
    recorded = true;
    for (const diagnostic of runtimeConfig.diagnostics) {
      process.stderr.write(`${formatRuntimeConfigDiagnostic(diagnostic)}\n`);
    }
    launchDashboardForEvents([event], runtimeConfig.environment, {
      onAlreadyRunning: (message) => {
        dashboardMessage = message;
      },
    });
  } catch (error) {
    // Observability must never interrupt the Agent execution path.
    failureReported = true;
    const code = String(error?.code || error?.name || "UNKNOWN_ERROR")
      .replace(/[^a-zA-Z0-9_-]/g, "");
    dashboardMessage = recorded
      ? `ASTRO recorded the event, but the dashboard could not start (${code}).`
      : `ASTRO event was not recorded (${code}). Check that ASTRO_HOME is writable and matches the dashboard data root.`;
    process.stderr.write(`${dashboardMessage}\n`);
  }

  if (!process.argv.includes("--quiet")) {
    process.stdout.write(`${JSON.stringify({
      continue: true,
      ...(dashboardMessage ? { systemMessage: dashboardMessage } : {}),
    })}\n`);
  } else if (dashboardMessage && !failureReported) {
    process.stderr.write(`${dashboardMessage}\n`);
  }
}

if (require.main === module) {
  run();
}

module.exports = {
  appendTraceEvent,
  appendTraceEvents,
  canonicalizeEventName,
  createDashboardUrl,
  createTraceEvent,
  createTraceLocator,
  createWorkspaceId,
  inferCodexEventName,
  launchDashboardForEvents,
  normalizeSource,
  openDashboard,
  redactString,
  redactValue,
  resolveAstroHome,
  resolveTraceFile,
  run,
};
