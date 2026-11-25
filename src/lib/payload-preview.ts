/**
 * Split a captured atom payload into the two things a reader needs side by
 * side: the atom's *content* (a message, prompt, plan, tool result — the text
 * the atom actually carried) and the *related data* around it (timestamps,
 * paths, ids and the annotations / explanations an adapter attached).
 *
 * This is presentation only. It never rewrites a captured event, and the Code
 * view still shows the untouched payload. Keeping the split here means the
 * inspector and the global overlay share one definition — a second heuristic
 * in a component would drift the moment an adapter adds a field.
 *
 * The content is returned as a Markdown source. `renderMarkdownPreview`
 * already highlights fenced code with highlight.js and renders Markdown
 * prose, so a `content` that is JSON, a diff or ordinary Markdown all arrive
 * with the right highlighting without a second renderer.
 */

import {
  findPayloadFilePath,
  languageFromFilePath,
  parseNumberedCode,
} from "./numbered-code.ts";

const CONTENT_KEYS = [
  "content",
  "message",
  "text",
  "prompt",
  "plan",
  "planText",
  "plan_text",
  "output",
  "result",
  "response",
  "stdout",
  "stderr",
  "reasoning",
  "last_assistant_message",
];

/** Fields that describe *when* / *where* / *how* rather than what was said. */
const META_KEY_HINTS = [
  "time",
  "date",
  "timestamp",
  "path",
  "cwd",
  "dir",
  "url",
  "uri",
  "id",
  "session",
  "trace",
  "turn",
  "turnid",
  "meta",
  "model",
  "provider",
  "source",
  "agent",
  "hook",
  "event",
  "tool",
  "user",
  "permission",
  "mode",
  "revision",
  "sequence",
  "status",
  "type",
  "kind",
  "duration",
];

const ANNOTATION_KEYS = [
  "annotation",
  "annotations",
  "comment",
  "comments",
  "note",
  "notes",
  "explanation",
  "explain",
  "description",
  "detail",
  "details",
  "summary",
  "context",
];

const CONTAINER_KEYS = [
  "captured", "toolresponse", "toolresult", "toolinput",
  "payload", "input", "arguments", "args",
];

/**
 * The client's own identity, not per-event data: a tool result should not
 * re-print the agent name and the recorder's version beside the fields that
 * matter. These are top-level envelope keys the recorder stamps on every
 * event; dropping them here keeps the related-field inventory on the event
 * itself. Matched by exact normalized name so a real `version` field inside
 * a tool payload (a deeper path) is not caught.
 */
const IDENTITY_KEYS = new Set(["client", "version"]);

/**
 * Whether a key is the recorder's own identity stamp. Exported so the
 * Markdown projection strips the same root keys the related-field inventory
 * drops — the agent name and version belong in the dialog header, not in a
 * payload's preview body. Only the caller passes a *root* key here; a nested
 * `version` field remains genuine captured data.
 */
export function isPayloadIdentityKey(key: string): boolean {
  return IDENTITY_KEYS.has(normalized(key));
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalized(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isAnnotation(key: string): boolean {
  const name = normalized(key);
  return ANNOTATION_KEYS.some((hint) => name === hint || name.startsWith(hint));
}

function isMeta(key: string): boolean {
  const name = normalized(key);
  return (
    META_KEY_HINTS.some((hint) => name.includes(hint)) ||
    /^(?:[A-Za-z_]+_)?(?:at|on|from|to)$/.test(name)
  );
}

/**
 * Whether a field name describes *when* / *where* / *how* rather than what was
 * said. Shared with the core extractor (`payload-markdown.ts`), whose generic
 * view keeps only content fields — metadata stays beside the preview, in the
 * related-data pane. Container keys (a `tool_input` / `toolResponse` hiding
 * the content one level down) are never metadata.
 */
export function isPayloadMetaKey(key: string): boolean {
  return isMeta(key);
}

/**
 * Whether a field name is one of the containers that hide the real content
 * one level down. Always walked before the metadata check — `tool_response`
 * contains "tool", but it is a container, not metadata.
 */
export function isPayloadContainerKey(key: string): boolean {
  return CONTAINER_KEYS.includes(normalized(key));
}

/** Flatten a scalar / small array value into one readable line. */
function displayValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => displayValue(item))
      .filter(Boolean)
      .join(", ");
  }
  // A nested record here is metadata (a model source object, a permission
  // descriptor). Show its scalar leaves rather than a wall of brace text.
  if (isRecord(value)) {
    return Object.entries(value)
      .map(([key, item]) =>
        typeof item === "string" || typeof item === "number" || typeof item === "boolean"
          ? `${key}: ${String(item)}`
          : "",
      )
      .filter(Boolean)
      .join(" · ");
  }
  return "";
}

/**
 * Read the text a content field carries: a plain string, or the `text` leaves
 * of a tool response's `{ type: "text", text }` content blocks.
 */
function extractContentText(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => extractContentText(item))
      .filter(Boolean)
      .join("\n\n");
  }
  if (isRecord(value)) {
    // A block's `text` wins; otherwise a single nested content field does.
    if (typeof value.text === "string" && value.text.trim()) {
      return value.text.trim();
    }
    if (typeof value.content === "string" && value.content.trim()) {
      return value.content.trim();
    }
  }
  return "";
}

export type RelatedField = {
  key: string;
  label: string;
  value: string;
  /**
   * The items that made up a scalar-array value (`["a", "b"]`). Present only
   * for such fields; the renderer lists them one per line instead of a single
   * comma-joined string, so a list-shaped value reads as a list. `value`
   * keeps the joined form for copy / non-list surfaces.
   */
  items?: readonly string[];
  /** `annotation` fields are shown first and carry a distinct tone. */
  annotation: boolean;
  /**
   * Nesting depth of the array element this row belongs to: `0` for members
   * of a top-level array (`questions[0]`), `1` for members of one nested
   * inside it (`questions[0].options[1]`). Undefined for rows outside any
   * array element — the pane indents them by one step more than their header.
   */
  level?: number;
  /** The row introduces one array element; its members render beneath it. */
  groupHeader?: boolean;
};

/**
 * A related-data value longer than this is folded behind its own 展开 control.
 * Folding is per value, never per pane: a long path must not hide the short
 * timestamps beside it.
 */
export const RELATED_VALUE_MAX_CHARS = 200;

export function isFoldableRelatedValue(value: string): boolean {
  return value.length > RELATED_VALUE_MAX_CHARS;
}

export type PayloadPreview = {
  /** Markdown source for the atom's real content; empty when there is none. */
  content: string;
  /** Related data: timestamps, paths, ids, annotations and explanations. */
  related: RelatedField[];
};

/**
 * Split one payload into content and related fields. The search walks the
 * known container keys so `{ contract, captured }` and a tool response nested
 * under `tool_input` both resolve to the same content. Metadata is collected
 * along the way and de-duplicated by key, preserving first-seen order.
 */
export function splitPayloadPreview(value: unknown, depth = 0, seen = new WeakSet<object>()): PayloadPreview {
  if (depth > 6 || value === null || typeof value !== "object" || seen.has(value)) {
    return { content: "", related: [] };
  }
  seen.add(value);
  if (Array.isArray(value)) {
    const parts = value.map((item) => splitPayloadPreview(item, depth + 1, seen));
    return {
      content: parts.map((part) => part.content).filter(Boolean).join("\n\n"),
      related: mergeRelated(parts.flatMap((part) => part.related)),
    };
  }
  const record = value as UnknownRecord;
  const related: RelatedField[] = [];
  const contents: string[] = [];

  for (const [key, item] of Object.entries(record)) {
    const name = normalized(key);
    if (CONTENT_KEYS.includes(name)) {
      // A content field is usually a string, but tool responses nest text in
      // an array of `{ type: "text", text: "..." }` blocks. Both are content,
      // never metadata, so read either shape with one extraction.
      const text = extractContentText(item);
      if (text) {
        contents.push(text);
        continue;
      }
    }
    if (CONTAINER_KEYS.includes(name) && item && typeof item === "object") {
      const nested = splitPayloadPreview(item, depth + 1, seen);
      if (nested.content) {
        contents.push(nested.content);
      }
      related.push(...nested.related);
      continue;
    }
    if (typeof item === "object" && item !== null && !isAnnotation(key) && !isMeta(key)) {
      // An unclassified object may hide content (a model source object, a
      // translated payload). Walk it, but keep its own key out of metadata.
      const nested = splitPayloadPreview(item, depth + 1, seen);
      if (nested.content) {
        contents.push(nested.content);
      }
      related.push(...nested.related);
      continue;
    }
    const text = displayValue(item);
    if (text) {
      related.push({ key, label: key, value: text, annotation: isAnnotation(key) });
    }
  }

  return { content: contents.join("\n\n"), related: mergeRelated(related) };
}

/**
 * Every scalar leaf of a captured payload, with a dotted path so a nested
 * `tool_response.tool_use_id` stays distinguishable from a top-level one.
 *
 * Arrays of objects keep their shape: each element opens with a
 * `groupHeader` row named after its indexed path (`questions[0]`,
 * `questions[0].options[1]`) and its scalar members follow with that row's
 * `level`, so the pane can indent them beneath their element instead of
 * printing three identical bare keys (`label`, `label`, `label`).
 *
 * Unlike `splitPayloadPreview`'s curated `related` list (which keeps only
 * metadata and drops content fields and empty values), this is the complete
 * field inventory: content keys, empty strings, `null`, `false` and `0` are
 * all present. The related-data pane shows this list so a reader can inspect
 * every field the adapter captured; the content pane still renders the real
 * content via `splitPayloadPreview`. Cycles and deep trees are bounded.
 */
export function collectPayloadFields(
  value: unknown,
  prefix = "",
  depth = 0,
  seen = new WeakSet<object>(),
  level?: number,
): RelatedField[] {
  if (depth > 8 || value === null || typeof value !== "object" || seen.has(value)) {
    return [];
  }
  seen.add(value);
  const fields: RelatedField[] = [];
  if (Array.isArray(value)) {
    if (!value.length) {
      fields.push({
        key: prefix || "[]",
        label: prefix || "[]",
        value: "[]",
        annotation: false,
        ...(level === undefined ? {} : { level }),
      });
      return mergeRelated(fields);
    }
    // An array of scalars reads as one joined value; an array of objects is
    // walked by index so no nested field is lost.
    const hasObjects = value.some(
      (item) => item !== null && typeof item === "object",
    );
    if (!hasObjects) {
      const items = value.map((item) => scalarFieldValue(item));
      fields.push({
        key: prefix,
        label: prefix,
        value: items.filter(Boolean).join(", "),
        items,
        annotation: false,
        ...(level === undefined ? {} : { level }),
      });
      return mergeRelated(fields);
    }
    const childLevel = level === undefined ? 0 : level + 1;
    value.forEach((item, index) => {
      const childPrefix = `${prefix}[${index}]`;
      // One header row per element gives the pane its array shape: the reader
      // sees which index every bare `label` / `description` beneath belongs
      // to instead of three identical keys. The header carries no value; the
      // members follow in walk order, indented one step deeper.
      fields.push({
        key: childPrefix,
        label: childPrefix.slice(childPrefix.lastIndexOf(".") + 1),
        value: "",
        annotation: false,
        level: childLevel,
        groupHeader: true,
      });
      fields.push(
        ...collectPayloadFields(item, childPrefix, depth + 1, seen, childLevel),
      );
    });
    return mergeRelated(fields);
  }
  for (const [key, item] of Object.entries(value as UnknownRecord)) {
    // The top-level client identity (agent name + recorder version) is stamped
    // on every event by the source; a result's field inventory should stay on
    // the event, so only the root level drops it. A deeper payload that
    // genuinely records a version field keeps it.
    if (prefix === "" && isPayloadIdentityKey(key)) {
      continue;
    }
    const path = prefix ? `${prefix}.${key}` : key;
    if (item !== null && typeof item === "object") {
      fields.push(...collectPayloadFields(item, path, depth + 1, seen, level));
    } else {
      fields.push({
        key: path,
        label: key,
        value: scalarFieldValue(item),
        annotation: isAnnotation(key),
        ...(level === undefined ? {} : { level }),
      });
    }
  }
  return mergeRelated(fields);
}

/** Render a scalar leaf, keeping empty/falsy values visible as real fields. */
function scalarFieldValue(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (value === undefined) {
    return "undefined";
  }
  if (typeof value === "string") {
    return value === "" ? '""' : value.trim();
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

/**
 * Later duplicates (e.g. `transcript_path` after `transcriptPath`) win. A tool
 * also echoes its own inputs back in the result (`tool_input.description` and
 * `tool_response.task.description` both read as a bare `description` with the
 * same value), so rows that repeat the same label *and* value are collapsed
 * to one — the data is not printed twice. Only fields rooted in a tool's
 * input / result containers take part: two unrelated branches that happen to
 * share a label and value (`a.note`, `b.note`) keep their own rows and path,
 * as the field inventory promises. Group headers and array members carry
 * their own identity (a `level`) and are never merged.
 */
const ECHO_CONTAINERS = new Set([
  "toolinput", "toolresponse", "toolresult", "input", "output",
  "result", "captured", "arguments", "args",
]);
function inEchoContainer(key: string): boolean {
  return ECHO_CONTAINERS.has(normalized(key.split(".")[0] ?? ""));
}
function mergeRelated(fields: RelatedField[]): RelatedField[] {
  const byKey = new Map<string, RelatedField>();
  for (const field of fields) {
    byKey.set(normalized(field.key), field);
  }
  const byLabelValue = new Map<string, RelatedField>();
  const out: RelatedField[] = [];
  for (const field of byKey.values()) {
    if (field.groupHeader || field.level !== undefined || !inEchoContainer(field.key)) {
      out.push(field);
      continue;
    }
    const id = `${normalized(field.label)}\u0000${field.value}`;
    if (byLabelValue.has(id)) {
      continue;
    }
    byLabelValue.set(id, field);
    out.push(field);
  }
  return out;
}

/**
 * Conservative code-language inference for a captured text. Only strong
 * signals count — a wrong guess colours prose into noise, so everything here
 * requires a structural marker (a fence language the renderer has registered:
 * json / diff / xml / typescript / python / bash / yaml).
 */
export function inferCodeLanguage(text: string): string | null {
  const body = text.trim();
  if (!body || body.includes("\u0000")) {
    return null;
  }
  // Structural formats self-identify; everything else is a weak signal that
  // prose can trip ("git status shows changes" is a sentence), so a weak
  // candidate additionally requires code punctuation or a multi-line body.
  const structural = inferStructuralLanguage(body);
  if (structural) {
    return structural;
  }
  const candidate = inferKeywordLanguage(body);
  if (!candidate) {
    return null;
  }
  // A keyword is per-line evidence, so prose that merely starts with a
  // command name must still stay prose. A single-line shell command is code
  // when it carries a flag, a chain/pipe, a variable or a script task name —
  // none of which an ordinary sentence uses. Without this, a captured
  // `pnpm build` rendered as a paragraph with its URL auto-linked into prose.
  const shellEvidence =
    /\s--?[A-Za-z0-9]|&&|\s\|\s|\$[A-Za-z_{]|^[A-Za-z_][A-Za-z0-9_]*=|[A-Za-z0-9_]+:[A-Za-z0-9_-]+/.test(
      body,
    );
  const looksLikeCode =
    /[{};=<>[\]]/.test(body) || body.includes("\n") || (candidate === "bash" && shellEvidence);
  return looksLikeCode ? candidate : null;
}

function inferStructuralLanguage(body: string): string | null {
  // A shebang is unambiguous, even when the script body that follows has no
  // other code punctuation. Without it the whole script would render as prose
  // and `# comment` lines would turn into Markdown headings.
  if (/^#!.*\b(?:bash|zsh|sh)\b/.test(body)) {
    return "bash";
  }
  if (body.startsWith("{") || body.startsWith("[")) {
    try {
      JSON.parse(body);
      return "json";
    } catch {
      // Not JSON after all — keep looking.
    }
  }
  if (/^diff --git\b/m.test(body) || /^@@ -\d+(?:,\d+)? [+-]\d+/m.test(body)) {
    return "diff";
  }
  if (/^\s*<\?xml\b/i.test(body) || /^\s*<(?:!doctype|html|head|body|div|span|p|section|template|svg|table|ul|li)\b/i.test(body)) {
    return "xml";
  }
  return null;
}

/**
 * Whether a body is *structured* as a shell command, as opposed to a source
 * file that merely contains a shell keyword on a line. Command chaining
 * (`&&` / `||`), a substitution (`$( …)` or backticks) or an env-assignment
 * prefix are unambiguous: a `node -e "…script…"` line is bash that quotes a
 * script, not a TypeScript document, so it must label bash. A real source
 * file that happens to hold `&&` inside one expression has none of these, so
 * it keeps its own language.
 */
function hasShellStructure(body: string, commandBody: string): boolean {
  if (/\$\(/.test(body)) {
    return true;
  }
  if (/\`/.test(body)) {
    return true;
  }
  if (/\s(?:&&|\|\|)\s/.test(body)) {
    return true;
  }
  // An env-assignment prefix was stripped for the keyword match: that itself
  // is shell structure (`FOO=1 cmd …`), so the original and the stripped body
  // differ.
  return commandBody !== body;
}

/** One shared list of the shell verbs a captured command opens with. */
const SHELL_VERB_RE =
  /^\s*(?:ls|cat|wc|head|tail|grep|find|sed|awk|chmod|chown|mkdir|touch|rm|cp|mv|ln|cd|echo|export|source|printf|pwd|which|kill|env|time|sleep|curl|wget|git|npm|pnpm|yarn|npx|node|python3?|pip3?|docker|make|brew|sudo|ssh|scp|tar|sort|uniq|cut|tr|xargs|tee|du|df)\s+\S/m;

function inferKeywordLanguage(body: string): string | null {
  // A command may be prefixed by env assignments (`ASTRO_PORT=4401 pnpm …`).
  // Strip them only for the match: the original body keeps the `=` that makes
  // the shell evidence unambiguous, and the related-data pane still shows the
  // assignment verbatim.
  const commandBody = body.replace(
    /^(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|[^\s]*)\s+)+/gm,
    "",
  );
  // A shell *command* claims the label before an embedded-language keyword, so
  // `cd … && node -e "…JS…"` reads bash (the script is quoted data) instead of
  // the TypeScript that one embedded `=> {` would otherwise trip. Only a
  // structured command takes this path; a bare keyword on a source line still
  // falls through to its own language below and to the caller's code gate.
  if (SHELL_VERB_RE.test(commandBody) && hasShellStructure(body, commandBody)) {
    return "bash";
  }
  // `export FOO=bar` is a shell assignment, not a TypeScript export statement;
  // without this guard the TS matcher claims it before the bash list is seen.
  const shellExport = /^\s*export\s+[A-Za-z_]\w*=[^\n]*$/m.test(body);
  if (
    !shellExport &&
    (/^\s*(?:import|export)\s[\w"'{*]/m.test(body) ||
      /^\s*(?:const|let|var|function|class|interface|type)\s+\w/m.test(body) ||
      /=>\s*\{/.test(body))
  ) {
    return "typescript";
  }
  if (
    /^\s*(?:def|class)\s+\w+\s*\(?\s*[:a-zA-Z]/m.test(body) ||
    /^\s*print\(/m.test(body) ||
    /^\s*from\s+[\w.]+\s+import\b/m.test(body)
  ) {
    return "python";
  }
  // An unstructured shell verb on a line is only a weak signal: it still goes
  // through the caller's code gate so `git status shows changes` stays prose.
  if (SHELL_VERB_RE.test(commandBody)) {
    return "bash";
  }
  return null;
}

/**
 * Wrap a text in a fenced code block, optionally with a language, so the
 * Markdown renderer highlights it. A `null` language still fences — the
 * renderer falls back to an escaped, monospace block — which is how the
 * generic view keeps multi-line values intact without markdown mangling.
 */
export function fenceCode(text: string, language?: string | null): string {
  return `\`\`\`${language ?? ""}\n${text.trimEnd()}\n\`\`\``;
}

const HEADING_LINE = /^\s{0,3}#{1,6}\s+\S/m;

/**
 * Whether a text carries Markdown block structure. Such a text is a
 * *document*, not an unnamed code string: the keyword matchers below are
 * per-line evidence, and one code-like line inside a document — an agent's
 * plan sketching `export type …` signatures, a command quoted in prose — must
 * not fence the whole reading surface into a monospace wall. `#` lines are
 * comments in shell and Python sources, so a heading only counts as Markdown
 * evidence for languages where it cannot be one.
 */
function hasMarkdownBlockStructure(text: string, allowHashHeading: boolean): boolean {
  return (
    (allowHashHeading && HEADING_LINE.test(text)) ||
    /\*\*[^*\n]+\*\*/.test(text) || // strong emphasis
    /\[[^\]\n]+\]\([^)\n]+\)/.test(text) || // link
    /^\s{0,3}\d+[.)]\s+\S/m.test(text) || // ordered list
    /^\s{0,3}[-*+]\s+\S/m.test(text) || // bullet list
    text.includes("```") || // the document already fences its own code
    /^\s{0,3}\|.+\|\s*$/m.test(text) // table row
  );
}

/**
 * Fence a content that is itself code so the Markdown renderer highlights it.
 * Plain Markdown and prose pass through unchanged — the renderer already
 * handles inline and fenced code, headings and lists. A text that is code in
 * an unnamed field (an `import` line, a diff, a shell command) is fenced with
 * its inferred language instead of being rendered as mangled prose.
 *
 * The fence is for content that is *predominantly* code: a structural format
 * (JSON / diff / XML) self-identifies and fences unconditionally, while a
 * keyword match is per-line evidence — a long document that carries Markdown
 * block structure renders as the document it is, its own fenced code still
 * highlighted inside, instead of one horizontally scrolling code block.
 */
export function contentToMarkdown(content: string, filePath?: string | null): string {
  const text = content.trim();
  if (!text) {
    return "";
  }
  // A Read result's numbered dump is a file, not a prose paragraph. The path
  // is the host's own language statement; fall back to the stripped source
  // when no path was captured. The renderer reads the same prefix pattern to
  // split the numbers back out into a gutter.
  const numbered = parseNumberedCode(text);
  const language =
    (numbered ? languageFromFilePath(filePath) : null) ??
    inferCodeLanguage(numbered ? numbered.lines.join("\n") : text);
  if (numbered) {
    return fenceCode(text.trimEnd(), language);
  }
  if (language) {
    const structural = language === "json" || language === "diff" || language === "xml";
    // `#` heads a Markdown heading everywhere; in shell / Python it is a
    // comment, so there it must not count as document evidence.
    const allowHashHeading = language !== "bash" && language !== "python";
    if (structural || !hasMarkdownBlockStructure(text, allowHashHeading)) {
      return fenceCode(text, language);
    }
  }
  return text;
}

/**
 * Drop metadata fields from a JSON dump so the fallback shows the content
 * fields, not the envelope. A container that ends up empty after the strip is
 * omitted entirely.
 */
function stripMetaKeys(value: unknown, depth = 0): unknown {
  if (depth > 6) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => stripMetaKeys(item, depth + 1));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      // The recorder's own identity stamp is never preview content: the agent
      // name and client version are shown once, in the dialog header.
      if (isPayloadMetaKey(key) || (depth === 0 && isPayloadIdentityKey(key))) {
        continue;
      }
      const stripped = stripMetaKeys(item, depth + 1);
      if (
        stripped !== undefined &&
        !(typeof stripped === "object" && stripped !== null && !Array.isArray(stripped) && Object.keys(stripped).length === 0)
      ) {
        out[key] = stripped;
      }
    }
    return Object.keys(out).length ? out : undefined;
  }
  return value;
}

/**
 * The content pane's last resort: a payload whose split produced no prose
 * (arguments, contract envelopes, structured results) still has something to
 * say. Dump it as highlighted JSON — with metadata keys stripped, so the dump
 * carries the content fields and not the envelope — instead of an empty pane;
 * a reader switching rows must always see the row's own data change. A
 * `{ captured }` wrapper dumps only its captured half (the contract topology
 * metadata stays on the Raw tab). Returns "" only for a payload with nothing
 * left to show, so the caller's empty state stays truthful.
 */
export function fallbackPayloadMarkdown(payload: unknown): string {
  if (payload === null || payload === undefined) {
    return "";
  }
  if (typeof payload === "string") {
    return contentToMarkdown(payload);
  }
  if (typeof payload !== "object") {
    return contentToMarkdown(String(payload));
  }
  const record = payload as Record<string, unknown>;
  const inner =
    "captured" in record && record.captured !== null && record.captured !== undefined
      ? record.captured
      : payload;
  if (!Array.isArray(inner) && Object.keys(inner as object).length === 0) {
    return "";
  }
  const stripped = stripMetaKeys(inner);
  if (
    stripped === undefined ||
    (typeof stripped === "object" && stripped !== null && !Array.isArray(stripped) && Object.keys(stripped).length === 0)
  ) {
    return "";
  }
  return contentToMarkdown(JSON.stringify(stripped, null, 2));
}

/**
 * Related fields sorted so annotations lead, then timestamps / paths / ids.
 * Only rows outside any array element float: hoisting a note that lives
 * inside `questions[0]` would tear it out of its element, so grouped rows
 * keep the walk order their header rows established.
 */
export function orderRelated(fields: readonly RelatedField[]): RelatedField[] {
  return [...fields].sort((a, b) => {
    const aTop = a.annotation && a.level === undefined ? 0 : 1;
    const bTop = b.annotation && b.level === undefined ? 0 : 1;
    if (aTop !== bTop) {
      return aTop - bTop;
    }
    return 0;
  });
}
