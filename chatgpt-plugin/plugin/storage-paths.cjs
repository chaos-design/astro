const { createHash } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function normalizeAgentName(value) {
  const name = String(value || "generic").trim().toLowerCase();
  const normalized = name.replace(/[^a-z0-9._-]+/g, "-") || "generic";
  if ([".", "..", "plugins"].includes(normalized)) {
    throw new TypeError("Trace source must not be a reserved path component.");
  }
  return normalized;
}

function expandHome(value, home = os.homedir()) {
  if (value === "~") {
    return home;
  }
  if (value.startsWith("~/")) {
    return path.join(home, value.slice(2));
  }
  return value;
}

function resolveAstroHome(environment = process.env) {
  const configuredHome = environment.ASTRO_HOME || environment.AOT_HOME;
  if (configuredHome) {
    return path.resolve(expandHome(configuredHome));
  }

  const defaultHome = path.join(os.homedir(), ".astrox");
  return path.resolve(defaultHome);
}

function resolveTraceDirectory(
  source,
  payload = {},
  environment = process.env,
) {
  const configuredDir =
    environment.ASTRO_TRACE_DIR ||
    environment.AGENT_TRACE_DIR ||
    environment.TRAE_TRACE_DIR;
  if (configuredDir) {
    const projectDir =
      environment.ASTRO_PROJECT_DIR ||
      environment.AGENT_TRACE_PROJECT_DIR ||
      environment.TRAE_PROJECT_DIR ||
      environment.CLAUDE_PROJECT_DIR ||
      payload.cwd ||
      process.cwd();
    const expandedDir = expandHome(configuredDir);
    return path.isAbsolute(expandedDir)
      ? expandedDir
      : path.resolve(projectDir, expandedDir);
  }

  return path.join(
    resolveAstroHome(environment),
    normalizeAgentName(source),
  );
}

function sanitizeSessionId(value) {
  const sessionId = String(value || "unknown-session").trim();
  const sanitized = sessionId.replace(/[^a-zA-Z0-9._-]+/g, "-");
  if (sanitized === sessionId && sessionId.length <= 96) {
    return sessionId || "unknown-session";
  }
  const hash = createHash("sha256").update(sessionId).digest("hex").slice(0, 16);
  return `${sanitized.slice(0, 79) || "session"}-${hash}`;
}

function resolveSessionId(payload = {}) {
  return sanitizeSessionId(
    payload.sessionId ||
      payload.session_id ||
      payload.threadId ||
      payload.thread_id ||
      payload.payload?.session_id ||
      payload.payload?.thread_id,
  );
}

function resolveSessionTimestamp(payload = {}) {
  const candidate =
    payload.capturedAt ||
    payload.timestamp ||
    payload.payload?.timestamp;
  const date = candidate ? new Date(candidate) : new Date();
  return Number.isFinite(date.getTime()) ? date : new Date();
}

function formatSessionPath(timestamp, sessionId) {
  const pad = (value) => String(value).padStart(2, "0");
  return [
    String(timestamp.getFullYear()).padStart(4, "0"),
    `${pad(timestamp.getMonth() + 1)}-${pad(timestamp.getDate())}`,
    `${pad(timestamp.getHours())}_${pad(timestamp.getMinutes())}_${pad(
      timestamp.getSeconds(),
    )}-${sanitizeSessionId(sessionId)}`,
  ];
}

function findSessionTraceFile(root, sessionId) {
  if (!fs.existsSync(root)) {
    return "";
  }

  const expectedId = sanitizeSessionId(sessionId);
  const directories = [root];
  const matches = [];
  while (directories.length) {
    const directory = directories.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === "plugins") {
        continue;
      }
      const entryPath = path.join(directory, entry.name);
      if (
        /^\d{2}(?::\d{2}:\d{2}|_\d{2}_\d{2})-/.test(entry.name) &&
        entry.name.slice(9) === expectedId
      ) {
        const traceFile = path.join(entryPath, "events.jsonl");
        if (fs.existsSync(traceFile)) {
          matches.push(traceFile);
          continue;
        }
      }
      directories.push(entryPath);
    }
  }
  return (
    matches
      .sort((left, right) => {
        const leftCanonical = /[/\\]\d{2}_\d{2}_\d{2}-/.test(left);
        const rightCanonical = /[/\\]\d{2}_\d{2}_\d{2}-/.test(right);
        return (
          Number(leftCanonical) - Number(rightCanonical) ||
          left.localeCompare(right)
        );
      })
      .at(-1) || ""
  );
}

function resolveAgentTraceFile(
  source,
  payload = {},
  environment = process.env,
) {
  const traceDirectory = resolveTraceDirectory(source, payload, environment);
  const sessionId = resolveSessionId(payload);
  const existingFile = findSessionTraceFile(traceDirectory, sessionId);
  if (existingFile) {
    return existingFile;
  }
  return path.join(
    traceDirectory,
    ...formatSessionPath(resolveSessionTimestamp(payload), sessionId),
    "events.jsonl",
  );
}

module.exports = {
  expandHome,
  findSessionTraceFile,
  formatSessionPath,
  normalizeAgentName,
  resolveAgentTraceFile,
  resolveAstroHome,
  resolveTraceDirectory,
  sanitizeSessionId,
};
