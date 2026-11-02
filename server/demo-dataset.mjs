/**
 * The console's sample (Demo) dataset is a local resource file, not a bundle
 * constant: `data/demo-events.json` is the single source of truth, read here
 * and served as `GET /api/demo-events`.
 *
 * Two properties of that file shape this module:
 *
 * 1. Event times are offsets from "now", not timestamps. RUN HISTORY is a
 *    sliding hours-based window, so a dataset written with absolute times
 *    would silently fall out of the window a day after it was authored and
 *    the Demo would read as "no runs". The console applies the offsets when it
 *    builds the events.
 * 2. It is a file on disk, so it can be missing, half-written or hand-edited.
 *    Every failure is reported as a typed result instead of a thrown error, so
 *    the route answers 404/500 with a readable reason and the console can fall
 *    back to its truthful empty state instead of crashing.
 *
 * This module validates the envelope only (schema version, session identity,
 * events array). Per-event validation belongs to the console
 * (`src/lib/demo-events.ts`), which must also accept the same file served
 * statically, where no service has vetted it.
 */
import { readFileSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

export const DEMO_DATASET_SCHEMA_VERSION = 1;

/**
 * Lookup order. `data/` is the authoring location and wins whenever it exists;
 * `dist/data/` is the copy the build writes, which is what an installed
 * runtime (shipping `dist` and `server`, but not the repository root) reads.
 */
export const demoDatasetLocations = [
  join("data", "demo-events.json"),
  join("dist", "data", "demo-events.json"),
];

export class DemoDatasetError extends Error {
  constructor(message, { path = "", code = "invalid" } = {}) {
    super(message);
    this.name = "DemoDatasetError";
    this.path = path;
    this.code = code;
  }
}

/** How the dataset path is shown in API payloads: never a home directory. */
function displayPath(path, projectDir) {
  const relativePath = relative(projectDir, path);
  return relativePath && !relativePath.startsWith(`..${sep}`) && relativePath !== ".."
    ? relativePath.split(sep).join("/")
    : path;
}

/**
 * Resolve the dataset path for this process. `ASTRO_DEMO_EVENTS` wins (an
 * absolute path, or one relative to the project), which is how a deployment
 * can point the console at a dataset outside the build.
 *
 * The repository's `data/` directory is authoritative whenever it exists: a
 * deleted file must read as 404, not as "quietly serve the copy an older build
 * left in `dist/`". Only the installed runtime, which ships `dist/` and
 * `server/` but not `data/`, falls through to the built copy.
 */
export function resolveDemoDatasetPath({ projectDir, environment = {}, statFile = statSync } = {}) {
  const configured = String(environment.ASTRO_DEMO_EVENTS || "").trim();
  if (configured) {
    return isAbsolute(configured) ? configured : resolve(projectDir, configured);
  }
  const repositoryFile = join(projectDir, demoDatasetLocations[0]);
  const repositoryDataDir = join(projectDir, "data");
  try {
    if (statFile(repositoryDataDir).isDirectory()) {
      return repositoryFile;
    }
  } catch {
    // No repository data directory: this is an installed or static runtime.
  }
  for (const location of demoDatasetLocations) {
    const candidate = join(projectDir, location);
    try {
      if (statFile(candidate).isFile()) {
        return candidate;
      }
    } catch {
      // Missing candidate: keep looking.
    }
  }
  return repositoryFile;
}

function requireObject(value, message, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DemoDatasetError(message, { path, code: "shape" });
  }
  return value;
}

function requireText(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Validate the envelope of a dataset document. Returns the document unchanged
 * on success; throws `DemoDatasetError` with a message that names the file.
 */
export function parseDemoDataset(text, path = "") {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new DemoDatasetError(
      `is not valid JSON (${error instanceof Error ? error.message : String(error)})`,
      { path, code: "json" },
    );
  }
  const document = requireObject(parsed, "must contain a JSON object", path);
  if (document.schemaVersion !== DEMO_DATASET_SCHEMA_VERSION) {
    throw new DemoDatasetError(
      `must declare schemaVersion ${DEMO_DATASET_SCHEMA_VERSION}`,
      { path, code: "schema" },
    );
  }
  const session = requireObject(
    document.session,
    "must declare a session object",
    path,
  );
  if (!requireText(session.id)) {
    throw new DemoDatasetError(
      "must declare a non-empty session.id",
      { path, code: "session" },
    );
  }
  if (!requireText(session.source)) {
    throw new DemoDatasetError(
      "must declare a non-empty session.source",
      { path, code: "session" },
    );
  }
  if (!Array.isArray(document.events)) {
    throw new DemoDatasetError(
      "must declare an events array",
      { path, code: "events" },
    );
  }
  return document;
}

/**
 * Reads the dataset from disk, cached by mtime and size so repeated polls do
 * not re-parse an unchanged file — and a hand edit is picked up on the next
 * request without restarting the service.
 */
export function createDemoDatasetReader({
  projectDir,
  environment = {},
  readFile = readFileSync,
  statFile = statSync,
} = {}) {
  if (!projectDir) {
    throw new TypeError("createDemoDatasetReader requires a projectDir");
  }
  let cached = null;

  return {
    /** Current path without touching the file (useful for diagnostics). */
    resolvePath() {
      return resolveDemoDatasetPath({ projectDir, environment, statFile });
    },
    read() {
      const path = resolveDemoDatasetPath({ projectDir, environment, statFile });
      const shown = displayPath(path, projectDir);
      let stats;
      try {
        stats = statFile(path);
      } catch {
        return {
          ok: false,
          status: 404,
          error: "Demo dataset not found",
          path: shown,
        };
      }
      if (!stats.isFile()) {
        return {
          ok: false,
          status: 404,
          error: "Demo dataset is not a file",
          path: shown,
        };
      }
      if (
        cached &&
        cached.path === path &&
        cached.mtimeMs === stats.mtimeMs &&
        cached.size === stats.size
      ) {
        return { ok: true, dataset: cached.dataset, path: shown, cached: true };
      }
      let text;
      try {
        text = readFile(path, "utf8");
      } catch (error) {
        return {
          ok: false,
          status: 500,
          error: `Demo dataset could not be read (${
            error instanceof Error ? error.message : String(error)
          })`,
          path: shown,
        };
      }
      try {
        const dataset = parseDemoDataset(text, shown);
        cached = { path, mtimeMs: stats.mtimeMs, size: stats.size, dataset };
        return { ok: true, dataset, path: shown, cached: false };
      } catch (error) {
        // A broken file must not be served from a previous successful read:
        // the next request retries, so fixing the file is enough.
        cached = null;
        return {
          ok: false,
          status: 500,
          error: error instanceof DemoDatasetError
            ? `Demo dataset ${error.message}`
            : `Demo dataset is invalid (${
                error instanceof Error ? error.message : String(error)
              })`,
          path: shown,
        };
      }
    },
  };
}
