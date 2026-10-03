const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const {
  appendTraceEvents,
  createTraceEvent,
} = require("./trace-recorder.cjs");
const { resolveTraceDirectory } = require("./storage-paths.cjs");

function parseJsonLines(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const value = JSON.parse(line);
        return value && typeof value === "object" ? [value] : [];
      } catch {
        return [];
      }
    });
}

function createStableEventId(fileKey, row, index) {
  return crypto
    .createHash("sha256")
    .update(
      [
        fileKey,
        index,
        row.timestamp || "",
        row.type || "",
        row.payload?.type || "",
        row.item?.id || row.payload?.call_id || "",
      ].join("\0"),
    )
    .digest("hex")
    .slice(0, 32);
}

function adaptCodexRows(rows, options = {}) {
  let sessionId = options.sessionId || "";
  let cwd = options.cwd || "";
  let turnId = null;
  const fileKey = options.fileKey || "codex-stream";

  return rows.map((row, index) => {
    if (row.type === "session_meta") {
      sessionId = row.payload?.id || sessionId;
      cwd = row.payload?.cwd || cwd;
    }
    if (row.type === "thread.started") {
      sessionId = row.thread_id || sessionId;
    }
    if (row.type === "turn_context") {
      turnId = row.payload?.turn_id || turnId;
      cwd = row.payload?.cwd || cwd;
    }
    if (row.payload?.turn_id) {
      turnId = row.payload.turn_id;
    }

    return createTraceEvent(row, {
      source: "codex",
      sessionId: sessionId || `codex-${path.basename(fileKey)}`,
      cwd,
      turnId,
      id: createStableEventId(fileKey, row, index),
    });
  });
}

function collectTraceFiles(root, output = []) {
  if (!fs.existsSync(root)) {
    return output;
  }
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      collectTraceFiles(entryPath, output);
    } else if (entry.isFile() && entry.name === "events.jsonl") {
      output.push(entryPath);
    }
  }
  return output;
}

function readKnownIds(traceRoot) {
  return new Set(
    collectTraceFiles(traceRoot)
      .flatMap((traceFile) =>
        parseJsonLines(fs.readFileSync(traceFile, "utf8")),
      )
      .map((event) => event.id)
      .filter(Boolean),
  );
}

function importCodexFiles(files, environment = process.env) {
  const traceRoot = resolveTraceDirectory("codex", {}, environment);
  const knownIds = readKnownIds(traceRoot);
  const events = [];

  for (const file of files) {
    const absoluteFile = path.resolve(file);
    const rows = parseJsonLines(fs.readFileSync(absoluteFile, "utf8"));
    const adapted = adaptCodexRows(rows, { fileKey: absoluteFile });
    for (const event of adapted) {
      if (!knownIds.has(event.id)) {
        events.push(event);
        knownIds.add(event.id);
      }
    }
  }

  if (events.length) {
    appendTraceEvents(events, environment, { source: "codex" });
  }
  return events;
}

module.exports = {
  adaptCodexRows,
  importCodexFiles,
  parseJsonLines,
};
