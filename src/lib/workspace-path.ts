/**
 * RUN HISTORY path presentation.
 *
 * Every run reports the working directory it executed in. Absolute paths are
 * far too long for a narrow list row, so the UI shows a short label and keeps
 * the full path for the row tooltip:
 *
 * - the home directory itself renders as `~`;
 * - anything below it renders as its last segment (`~/a/b/c` -> `c`);
 * - a path outside the home directory keeps its absolute form in the tooltip
 *   and still renders only its last segment as the label.
 *
 * The kind drives the icon next to the label: a directory, a file, or an
 * unresolved path (recorded as a failure).
 */

export type WorkspacePathKind = "directory" | "file" | "error";

export type WorkspacePathPresentation = {
  /** Full path in `~` notation when the path lives under the home directory. */
  full: string;
  /** Short label rendered in the row: `~` at the home root, else the last segment. */
  name: string;
  kind: WorkspacePathKind;
};

/**
 * Home directory prefixes as they appear in captured `cwd` values: macOS
 * (`/Users/<name>`), Linux (`/home/<name>`, `/root`) and Windows
 * (`C:\Users\<name>`). The studio runs in the browser, so the prefix is derived
 * from the path itself instead of `os.homedir()`.
 */
const HOME_PREFIX = /^(?:[A-Za-z]:[\\/]Users[\\/][^\\/]+|\/Users\/[^/]+|\/home\/[^/]+|\/root)(?=$|[\\/])/;

/** A last segment that looks like a file name rather than a directory. */
const FILE_NAME = /\.[A-Za-z0-9][A-Za-z0-9._-]*$/;

const TRAILING_SEPARATORS = /[\\/]+$/;

const UNKNOWN_PATH: WorkspacePathPresentation = {
  full: "",
  kind: "error",
  name: "unknown",
};

/** Last path segment, ignoring trailing separators. */
export function workspacePathLeaf(value: string): string {
  const trimmed = value.replace(TRAILING_SEPARATORS, "");
  const segments = (trimmed || value).split(/[\\/]+/).filter(Boolean);
  return segments.at(-1) ?? value;
}

function isFileName(segment: string): boolean {
  return !segment.startsWith(".") && FILE_NAME.test(segment);
}

/**
 * Describe a run's working directory for the list row. An empty value (clients
 * that never reported a workspace) resolves to the `error` kind so the row can
 * show that the path is unknown instead of rendering a blank chip.
 */
export function describeWorkspacePath(
  cwd: string | null | undefined,
): WorkspacePathPresentation {
  const raw = typeof cwd === "string" ? cwd.trim() : "";
  if (!raw) {
    return UNKNOWN_PATH;
  }
  const path = raw.replace(TRAILING_SEPARATORS, "") || raw;
  const home = HOME_PREFIX.exec(path);
  const rest = home ? path.slice(home[0].length) : "";
  if (home && rest === "") {
    return { full: "~", kind: "directory", name: "~" };
  }
  const leaf = workspacePathLeaf(path);
  return {
    full: home ? `~${rest}` : path,
    kind: isFileName(leaf) ? "file" : "directory",
    name: leaf,
  };
}
