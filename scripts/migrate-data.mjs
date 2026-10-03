import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  rmdirSync,
  statSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import recorder from "../plugin/trace-recorder.cjs";

const { createTraceEvent, resolveTraceFile } = recorder;
const legacySessionDirectoryPattern =
  /^(\d{2}):(\d{2}):(\d{2})-(.+)$/;

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

function getKnownIds(traceFile) {
  if (!existsSync(traceFile)) {
    return new Set();
  }
  return new Set(
    parseJsonLines(readFileSync(traceFile, "utf8"))
      .map((event) => event.id)
      .filter(Boolean),
  );
}

function getJsonlRows(text) {
  return text.split(/\r?\n/).filter((line) => line.trim());
}

function getJsonlRowKey(line) {
  try {
    const value = JSON.parse(line);
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      value.id !== undefined &&
      value.id !== null &&
      String(value.id)
    ) {
      return `id:${String(value.id)}`;
    }
  } catch {
    // Invalid rows remain source data and are compared by their raw content.
  }
  return `raw:${line}`;
}

function mergeJsonlFiles(sourceFile, targetFile) {
  if (!existsSync(targetFile)) {
    renameSync(sourceFile, targetFile);
    return {
      appendedRows: getJsonlRows(readFileSync(targetFile, "utf8")).length,
      skippedRows: 0,
    };
  }

  const targetText = readFileSync(targetFile, "utf8");
  const sourceRows = getJsonlRows(readFileSync(sourceFile, "utf8"));
  const knownRows = new Set(getJsonlRows(targetText).map(getJsonlRowKey));
  const appendedRows = sourceRows.filter((line) => {
    const key = getJsonlRowKey(line);
    if (knownRows.has(key)) {
      return false;
    }
    knownRows.add(key);
    return true;
  });

  if (appendedRows.length) {
    const separator = targetText && !targetText.endsWith("\n") ? "\n" : "";
    appendFileSync(
      targetFile,
      `${separator}${appendedRows.join("\n")}\n`,
      "utf8",
    );
  }
  rmSync(sourceFile);
  return {
    appendedRows: appendedRows.length,
    skippedRows: sourceRows.length - appendedRows.length,
  };
}

function mergeSessionDirectories(sourceDirectory, targetDirectory) {
  let appendedRows = 0;
  let skippedRows = 0;
  mkdirSync(targetDirectory, { recursive: true });

  for (const entry of readdirSync(sourceDirectory, { withFileTypes: true })) {
    const sourcePath = join(sourceDirectory, entry.name);
    const targetPath = join(targetDirectory, entry.name);
    if (!existsSync(targetPath)) {
      renameSync(sourcePath, targetPath);
      continue;
    }
    if (
      entry.isFile() &&
      entry.name === "events.jsonl" &&
      statSync(targetPath).isFile()
    ) {
      const result = mergeJsonlFiles(sourcePath, targetPath);
      appendedRows += result.appendedRows;
      skippedRows += result.skippedRows;
      continue;
    }
    if (entry.isDirectory() && statSync(targetPath).isDirectory()) {
      const result = mergeSessionDirectories(sourcePath, targetPath);
      appendedRows += result.appendedRows;
      skippedRows += result.skippedRows;
      continue;
    }
    if (
      entry.isFile() &&
      statSync(targetPath).isFile() &&
      readFileSync(sourcePath).equals(readFileSync(targetPath))
    ) {
      rmSync(sourcePath);
      continue;
    }
    throw new Error(
      `Cannot migrate conflicting session path ${sourcePath} to ${targetPath}.`,
    );
  }

  rmdirSync(sourceDirectory);
  return { appendedRows, skippedRows };
}

function collectLegacySessionDirectories(root, output = []) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === "plugins") {
      continue;
    }
    const entryPath = join(root, entry.name);
    if (
      legacySessionDirectoryPattern.test(entry.name) &&
      existsSync(join(entryPath, "events.jsonl"))
    ) {
      output.push(entryPath);
      continue;
    }
    collectLegacySessionDirectories(entryPath, output);
  }
  return output;
}

export function migrateSessionPathLayout(inputRoot) {
  const root = resolve(inputRoot);
  const emptyResult = {
    root,
    migratedDirectories: 0,
    renamedDirectories: 0,
    mergedDirectories: 0,
    appendedRows: 0,
    skippedRows: 0,
    outputs: [],
  };
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    return emptyResult;
  }

  const result = { ...emptyResult, outputs: [] };
  const legacyDirectories = collectLegacySessionDirectories(root).sort();
  for (const sourceDirectory of legacyDirectories) {
    const match = basename(sourceDirectory).match(
      legacySessionDirectoryPattern,
    );
    if (!match) {
      continue;
    }
    const targetDirectory = join(
      dirname(sourceDirectory),
      `${match[1]}_${match[2]}_${match[3]}-${match[4]}`,
    );
    if (existsSync(targetDirectory)) {
      const mergeResult = mergeSessionDirectories(
        sourceDirectory,
        targetDirectory,
      );
      result.mergedDirectories += 1;
      result.appendedRows += mergeResult.appendedRows;
      result.skippedRows += mergeResult.skippedRows;
    } else {
      renameSync(sourceDirectory, targetDirectory);
      result.renamedDirectories += 1;
    }
    result.migratedDirectories += 1;
    result.outputs.push(targetDirectory);
  }
  return result;
}

export function resolveLegacyTraceFile(inputPath) {
  const absolutePath = resolve(inputPath);
  return existsSync(absolutePath) && statSync(absolutePath).isDirectory()
    ? join(absolutePath, "events.jsonl")
    : absolutePath;
}

export function migrateTraceData(inputPath, environment = process.env) {
  const inputFile = resolveLegacyTraceFile(inputPath);
  if (!existsSync(inputFile)) {
    return { inputFile, migrated: 0, outputs: [], skipped: 0 };
  }

  const targetEnvironment = {
    ...environment,
    ASTRO_TRACE_DIR: undefined,
    AGENT_TRACE_DIR: undefined,
    TRAE_TRACE_DIR: undefined,
  };
  const rows = parseJsonLines(readFileSync(inputFile, "utf8"));
  const events = rows.map((row) =>
    createTraceEvent(row, { source: row.source || "generic" }),
  );
  const outputGroups = new Map();
  const traceFileBySession = new Map();
  let skipped = 0;

  for (const event of events) {
    const sessionKey = `${event.source}::${event.sessionId}`;
    let traceFile = traceFileBySession.get(sessionKey);
    if (!traceFile) {
      traceFile = resolveTraceFile(event, targetEnvironment, {
        source: event.source,
      });
      traceFileBySession.set(sessionKey, traceFile);
    }
    let group = outputGroups.get(traceFile);
    if (!group) {
      group = {
        events: [],
        knownIds: getKnownIds(traceFile),
      };
      outputGroups.set(traceFile, group);
    }
    if (group.knownIds.has(event.id)) {
      skipped += 1;
      continue;
    }
    group.knownIds.add(event.id);
    group.events.push(event);
  }

  for (const [traceFile, group] of outputGroups) {
    if (!group.events.length) {
      continue;
    }
    mkdirSync(dirname(traceFile), { recursive: true });
    appendFileSync(
      traceFile,
      `${group.events.map((event) => JSON.stringify(event)).join("\n")}\n`,
      "utf8",
    );
  }

  const outputs = [...outputGroups.entries()]
    .filter(([, group]) => group.events.length)
    .map(([traceFile]) => traceFile);
  return {
    inputFile,
    migrated: events.length - skipped,
    outputs,
    skipped,
  };
}

function collectTraceFiles(root, output = []) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.name === "plugins") {
      continue;
    }
    const entryPath = join(root, entry.name);
    if (entry.isDirectory()) {
      collectTraceFiles(entryPath, output);
    } else if (entry.isFile() && entry.name === "events.jsonl") {
      output.push(entryPath);
    }
  }
  return output;
}

export function migrateLegacyAotHome(inputRoot, environment = process.env) {
  const absoluteRoot = resolve(inputRoot);
  if (!existsSync(absoluteRoot) || !statSync(absoluteRoot).isDirectory()) {
    return { migrated: 0, outputs: [], skipped: 0, sources: [] };
  }

  const sources = collectTraceFiles(absoluteRoot).sort();
  const results = sources.map((traceFile) =>
    migrateTraceData(traceFile, environment),
  );

  return {
    migrated: results.reduce((total, result) => total + result.migrated, 0),
    outputs: [...new Set(results.flatMap((result) => result.outputs))],
    skipped: results.reduce((total, result) => total + result.skipped, 0),
    sources,
  };
}
