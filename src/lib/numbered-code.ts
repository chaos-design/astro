/**
 * Recognise the line-numbered dump a `Read` tool returns (`   1→content`)
 * and turn it into two parallel columns the renderer can align: the original
 * line numbers and the source lines with their prefixes removed.
 *
 * This is presentation only — the captured text is never rewritten in the
 * event. Keeping the parser separate from both the Markdown projection and
 * the renderer means one definition decides when a dump is a numbered file
 * and when an ordinary multi-line string just happens to contain an arrow.
 */

export type NumberedCode = {
  /** The captured numbers, verbatim (they may start at an offset). */
  readonly numbers: readonly string[];
  /** The source lines with their `N→` prefixes removed. */
  readonly lines: readonly string[];
};

const NUMBERED_LINE = /^\s*(\d{1,7})→(.*)$/;

/**
 * A text is a numbered dump when the overwhelming majority of its lines carry
 * the `N→` prefix. Requiring both two lines and an 80% majority keeps a prose
 * paragraph with one `1→step` note from turning into a code gutter, while a
 * file read that ends with a blank `  9→` line still parses.
 */
export function parseNumberedCode(text: string): NumberedCode | null {
  if (typeof text !== "string") {
    return null;
  }
  const raw = text.replace(/\r\n/g, "\n").split("\n");
  while (raw.length && raw[raw.length - 1] === "") {
    raw.pop();
  }
  if (raw.length < 2) {
    return null;
  }
  const numbers: string[] = [];
  const lines: string[] = [];
  let numbered = 0;
  for (const line of raw) {
    const match = NUMBERED_LINE.exec(line);
    if (match) {
      numbers.push(match[1]);
      lines.push(match[2]);
      numbered += 1;
    } else {
      numbers.push("");
      lines.push(line);
    }
  }
  return numbered >= Math.max(2, Math.ceil(raw.length * 0.8))
    ? { numbers, lines }
    : null;
}

/** Language identifiers registered by the console's Markdown renderer. */
const LANGUAGE_BY_EXTENSION: Readonly<Record<string, string>> = {
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  jsonc: "json",
  py: "python",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  md: "markdown",
  markdown: "markdown",
  html: "xml",
  xml: "xml",
  svg: "xml",
  yaml: "yaml",
  yml: "yaml",
  diff: "diff",
  patch: "diff",
  c: "c",
  h: "c",
  cc: "cpp",
  cpp: "cpp",
  cxx: "cpp",
  "h++": "cpp",
  cs: "csharp",
  go: "go",
  rs: "rust",
  java: "java",
  rb: "ruby",
  kt: "kotlin",
  kts: "kotlin",
  scala: "scala",
  swift: "swift",
  lua: "lua",
  php: "php",
  sql: "sql",
  gql: "graphql",
  graphql: "graphql",
  proto: "protobuf",
  css: "css",
  less: "css",
  scss: "css",
  ini: "ini",
  conf: "ini",
  cfg: "ini",
  properties: "properties",
};

/**
 * Infer the highlight language from a captured `file_path`. Source content is
 * a fallback, not the first choice: a short `.ts` file with no keyword still
 * deserves TypeScript highlighting, and the path is the host's own statement
 * of what the bytes are.
 */
export function languageFromFilePath(filePath: string | null | undefined): string | null {
  if (typeof filePath !== "string" || !filePath.trim()) {
    return null;
  }
  const name = filePath.replace(/\\/g, "/").split("/").pop() ?? "";
  const extension = name.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  return extension ? LANGUAGE_BY_EXTENSION[extension] ?? null : null;
}

const FILE_PATH_KEYS = new Set(["file_path", "filepath", "fileName", "filename"]);

/**
 * Find the file a tool call addressed, anywhere in a captured payload. Used
 * by the Preview pane, which only has the payload — not the Agent view's
 * already-structured call inputs — to choose the same language as the Agent.
 */
export function findPayloadFilePath(
  value: unknown,
  depth = 0,
  seen = new WeakSet<object>(),
): string | null {
  if (depth > 6 || value === null || typeof value !== "object" || seen.has(value)) {
    return null;
  }
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findPayloadFilePath(item, depth + 1, seen);
      if (found) {
        return found;
      }
    }
    return null;
  }
  const record = value as Record<string, unknown>;
  for (const [key, item] of Object.entries(record)) {
    if (
      FILE_PATH_KEYS.has(key) &&
      typeof item === "string" &&
      item.trim() &&
      !/^https?:\/\//i.test(item.trim())
    ) {
      return item.trim();
    }
  }
  for (const item of Object.values(record)) {
    const found = findPayloadFilePath(item, depth + 1, seen);
    if (found) {
      return found;
    }
  }
  return null;
}
