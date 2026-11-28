import {
  closeSync,
  existsSync,
  lstatSync,
  openSync,
  readdirSync,
  readSync,
  rmSync,
  statSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

import {
  resolveAstroHome,
  resolveTraceDirectory,
} from "../plugin/storage-paths.cjs";

/**
 * Retention for captured runs.
 *
 * The console's RUN HISTORY is a window over everything on disk, and nothing
 * ever removed an old session: a machine that runs an agent every day keeps
 * every byte forever. This module is the one place that decides what "old"
 * means and what may be deleted, so the preview a reader confirms and the
 * deletion the service performs can never disagree.
 *
 * Boundaries that are not negotiable:
 *
 * - **Only captured sessions**: the walk accepts `events.jsonl` under the
 *   trace root; `data/demo-events.json` and anything outside that root are
 *   never candidates, no matter how old.
 * - **Two-step**: {@link findExpiredSessions} only reports; nothing is removed
 *   until {@link pruneExpiredSessions} is called with the same cutoff.
 * - **Day-grained and bounded**: `days` must be an integer in
 *   [{@link MIN_RETENTION_DAYS}, {@link MAX_RETENTION_DAYS}], so a typo can
 *   neither disable the guard (0) nor delete a decade of history by accident.
 * - **Last event wins**: a session's age is the timestamp of its newest event,
 *   not the file's mtime — copying a trace directory must not make a fresh run
 *   look ancient.
 */

export const MIN_RETENTION_DAYS = 1;
export const MAX_RETENTION_DAYS = 3650;
export const DEFAULT_RETENTION_DAYS = 15;

/** Thrown for a `days` value the guard refuses to act on. */
export class RetentionError extends Error {
  constructor(message) {
    super(message);
    this.name = "RetentionError";
    this.status = 400;
  }
}

/**
 * Normalizes the requested retention window. Absent means the default
 * (15 days); anything outside the guard throws instead of being clamped, so
 * a caller cannot believe it asked for 0 days and get 1.
 */
export function resolveRetentionDays(value, fallback = DEFAULT_RETENTION_DAYS) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const days = Number(value);
  if (
    !Number.isFinite(days) ||
    !Number.isInteger(days) ||
    days < MIN_RETENTION_DAYS ||
    days > MAX_RETENTION_DAYS
  ) {
    throw new RetentionError(
      `retention days must be an integer between ${MIN_RETENTION_DAYS} and ${MAX_RETENTION_DAYS}`,
    );
  }
  return days;
}

/** Epoch ms at which a run becomes older than the window. */
export function retentionCutoff(days, now = Date.now()) {
  return now - resolveRetentionDays(days) * 24 * 60 * 60 * 1000;
}

/** The root the service reads captured sessions from — never the repo data/. */
export function resolveRetentionRoot(environment = process.env) {
  const configuredRoot =
    environment.ASTRO_TRACE_DIR ||
    environment.AGENT_TRACE_DIR ||
    environment.TRAE_TRACE_DIR;
  return configuredRoot
    ? resolveTraceDirectory("generic", {}, environment)
    : resolveAstroHome(environment);
}

/** Every `events.jsonl` under the root, skipping the plugin payload dir. */
function walkTraceFiles(root, output = []) {
  if (!existsSync(root)) {
    return output;
  }
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return output;
  }
  for (const entry of entries) {
    if (entry.name === "plugins") {
      continue;
    }
    const entryPath = join(root, entry.name);
    if (entry.isDirectory()) {
      walkTraceFiles(entryPath, output);
    } else if (entry.name === "events.jsonl") {
      output.push(entryPath);
    }
  }
  return output;
}

/**
 * The newest capturedAt in one session file, read from the tail only: a
 * session can hold tens of thousands of lines and the answer is always near
 * the end. Returns `null` when the file has no readable timestamp.
 */
export function readSessionLastCapturedAt(file, { tailBytes = 64 * 1024 } = {}) {
  let size = 0;
  try {
    size = statSync(file).size;
  } catch {
    return null;
  }
  if (size === 0) {
    return null;
  }
  let text = "";
  try {
    const fd = openSync(file, "r");
    try {
      const start = Math.max(0, size - tailBytes);
      const buffer = Buffer.alloc(size - start);
      readSync(fd, buffer, 0, buffer.length, start);
      text = buffer.toString("utf8");
    } finally {
      closeSync(fd);
    }
  } catch {
    return null;
  }
  const lines = text.split("\n").filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const entry = JSON.parse(lines[index]);
      const capturedAt = Date.parse(entry?.capturedAt || "");
      if (Number.isFinite(capturedAt)) {
        return capturedAt;
      }
    } catch {
      // A partially written tail line is normal; keep walking up.
    }
  }
  return null;
}

/**
 * Sessions whose newest event predates the cutoff. `sessions` is what the
 * reader sees before confirming; nothing is deleted here.
 */
export function findExpiredSessions({
  root = resolveRetentionRoot(),
  days = DEFAULT_RETENTION_DAYS,
  now = Date.now(),
} = {}) {
  const cutoff = retentionCutoff(days, now);
  const sessions = [];
  for (const file of walkTraceFiles(root)) {
    const lastCapturedAt = readSessionLastCapturedAt(file);
    if (lastCapturedAt === null || lastCapturedAt >= cutoff) {
      continue;
    }
    let bytes = 0;
    try {
      bytes = statSync(file).size;
    } catch {
      bytes = 0;
    }
    sessions.push({
      file,
      directory: dirname(file),
      lastCapturedAt: new Date(lastCapturedAt).toISOString(),
      ageDays: Math.floor((now - lastCapturedAt) / (24 * 60 * 60 * 1000)),
      bytes,
    });
  }
  sessions.sort((left, right) =>
    left.lastCapturedAt.localeCompare(right.lastCapturedAt),
  );
  return {
    days: resolveRetentionDays(days),
    cutoff: new Date(cutoff).toISOString(),
    now: new Date(now).toISOString(),
    sessions,
    eventFiles: sessions.length,
    bytes: sessions.reduce((total, session) => total + session.bytes, 0),
  };
}

/**
 * Deletes the sessions reported by {@link findExpiredSessions}. The report is
 * recomputed inside this call — a caller cannot hand in an arbitrary file
 * list — and only paths inside `root` are removed. Empty parent directories
 * are cleaned up to the `source` level so the tree does not fill with husks.
 * `interactions/`, `transcript-state/` and `plugins/` are never walked.
 */
export function pruneExpiredSessions({
  root = resolveRetentionRoot(),
  days = DEFAULT_RETENTION_DAYS,
  now = Date.now(),
} = {}) {
  const report = findExpiredSessions({ root, days, now });
  const rootPath = resolve(root);
  const removed = [];
  for (const session of report.sessions) {
    const target = resolve(session.directory);
    // Defence in depth, three checks before anything is removed:
    // 1. containment — the target must sit inside the trace root (a crafted
    //    root, `..` segments or a different mount must not move the delete
    //    outside it);
    // 2. no symlinks — a link inside the root that points elsewhere must not
    //    drag its target into the sweep;
    // 3. a captured session — the directory must actually hold an
    //    `events.jsonl`, so anything else under the root (plugins, exports,
    //    a user's stray folder) is never a candidate.
    const relativePath = relative(rootPath, target);
    if (
      (relativePath !== "" && relativePath.startsWith("..")) ||
      isAbsolute(relativePath)
    ) {
      continue;
    }
    try {
      if (lstatSync(target).isSymbolicLink()) {
        continue;
      }
    } catch {
      continue;
    }
    if (!existsSync(join(target, "events.jsonl"))) {
      continue;
    }
    try {
      rmSync(target, { force: true, recursive: true });
      removed.push(session);
    } catch {
      // A file locked by another process stays; it will be retried next run.
    }
  }
  // Remove now-empty date / session parent directories, one level above the
  // deleted session, stopping at the source directory.
  const prunedDirectories = new Set();
  for (const session of removed) {
    let directory = resolve(session.directory, "..");
    while (directory.startsWith(`${rootPath}/`) && directory !== rootPath) {
      try {
        const entries = readdirSync(directory);
        if (entries.length > 0) {
          break;
        }
        try {
          if (lstatSync(directory).isSymbolicLink()) {
            break;
          }
        } catch {
          break;
        }
        rmSync(directory, { force: true, recursive: true });
        prunedDirectories.add(directory);
        directory = resolve(directory, "..");
      } catch {
        break;
      }
    }
  }
  return {
    days: report.days,
    cutoff: report.cutoff,
    removed: removed.length,
    bytes: removed.reduce((total, session) => total + session.bytes, 0),
    directories: prunedDirectories.size,
    sessions: removed,
  };
}

/** A one-line summary for the service log and the settings panel. */
export function describeRetentionReport(report) {
  if (!report.eventFiles) {
    return `没有超过 ${report.days} 天的会话（截止 ${report.cutoff}）`;
  }
  const megabytes = (report.bytes / (1024 * 1024)).toFixed(1);
  return `${report.eventFiles} 个会话 · ${megabytes} MB 早于 ${report.days} 天前（截止 ${report.cutoff}）`;
}
