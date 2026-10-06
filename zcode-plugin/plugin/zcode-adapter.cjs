const recorder = require("./trace-recorder.cjs");
const {
  formatRuntimeConfigDiagnostic,
  loadRuntimeConfig,
} = require("./runtime-config.cjs");

// ZCode fires exactly seven hook events; anything else on stdin is not a
// traceable ZCode lifecycle moment.
const zcodeEventNames = new Set([
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PermissionRequest",
  "PostToolUse",
  "PostToolUseFailure",
  "Stop",
]);

/**
 * ZCode reports tool identity as toolCallId and tool data in camelCase, while
 * the canonical recorder expects toolUseId and snake_case tool fields. Stop
 * carries the final assistant text as responseText, which becomes the
 * AgentMessage event the trajectory projection renders before Stop.
 */
function adaptZcodePayload(payload) {
  const eventName = String(
    payload?.hook_event_name || payload?.hookEventName || "",
  ).trim();
  if (!zcodeEventNames.has(eventName)) {
    return [];
  }

  const normalized = { ...payload, eventName };
  if (normalized.toolUseId === undefined && payload.toolCallId !== undefined) {
    normalized.toolUseId = payload.toolCallId;
  }
  if (normalized.tool_input === undefined && payload.toolInput !== undefined) {
    normalized.tool_input = payload.toolInput;
  }
  if (
    normalized.tool_response === undefined &&
    payload.toolResponse !== undefined
  ) {
    normalized.tool_response = payload.toolResponse;
  }

  if (eventName === "Stop") {
    const message = String(
      payload.responseText ?? payload.response_text ?? "",
    );
    if (message.trim()) {
      return [
        { ...normalized, eventName: "AgentMessage", message },
        { ...normalized, eventName: "Stop" },
      ];
    }
  }

  return [normalized];
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
    // A malformed payload must surface through the shared failure report
    // below instead of being silently dropped.
    const payload = JSON.parse(input || "{}");
    const payloads = adaptZcodePayload(payload);
    const events = payloads.length
      ? recorder.appendTraceEvents(payloads, runtimeConfig.environment, {
          source: getCliOption("source") || "zcode",
        })
      : [];
    recorded = events.length > 0;
    for (const diagnostic of runtimeConfig.diagnostics) {
      process.stderr.write(`${formatRuntimeConfigDiagnostic(diagnostic)}\n`);
    }
    recorder.launchDashboardForEvents(events, runtimeConfig.environment, {
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
    process.stdout.write(
      `${JSON.stringify({
        continue: true,
        ...(dashboardMessage ? { systemMessage: dashboardMessage } : {}),
      })}\n`,
    );
  } else if (dashboardMessage && !failureReported) {
    process.stderr.write(`${dashboardMessage}\n`);
  }
}

if (require.main === module) {
  run();
}

module.exports = {
  adaptZcodePayload,
  run,
};
