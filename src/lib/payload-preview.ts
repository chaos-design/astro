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
  /** `annotation` fields are shown first and carry a distinct tone. */
  annotation: boolean;
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
      });
      return mergeRelated(fields);
    }
    // An array of scalars reads as one joined value; an array of objects is
    // walked by index so no nested field is lost.
    const hasObjects = value.some(
      (item) => item !== null && typeof item === "object",
    );
    if (!hasObjects) {
      fields.push({
        key: prefix,
        label: prefix,
        value: value.map(scalarFieldValue).filter(Boolean).join(", "),
        annotation: false,
      });
      return mergeRelated(fields);
    }
    value.forEach((item, index) => {
      fields.push(
        ...collectPayloadFields(item, `${prefix}[${index}]`, depth + 1, seen),
      );
    });
    return mergeRelated(fields);
  }
  for (const [key, item] of Object.entries(value as UnknownRecord)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (item !== null && typeof item === "object") {
      fields.push(...collectPayloadFields(item, path, depth + 1, seen));
    } else {
      fields.push({
        key: path,
        label: key,
        value: scalarFieldValue(item),
        annotation: isAnnotation(key),
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

/** Later duplicates (e.g. `transcript_path` after `transcriptPath`) win. */
function mergeRelated(fields: RelatedField[]): RelatedField[] {
  const byKey = new Map<string, RelatedField>();
  for (const field of fields) {
    byKey.set(normalized(field.key), field);
  }
  return [...byKey.values()];
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
  const looksLikeCode = /[{};=<>[\]]/.test(body) || body.includes("\n");
  return looksLikeCode ? candidate : null;
}

function inferStructuralLanguage(body: string): string | null {
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

function inferKeywordLanguage(body: string): string | null {
  if (
    /^\s*(?:import|export)\s[\w"'{*]/m.test(body) ||
    /^\s*(?:const|let|var|function|class|interface|type)\s+\w/m.test(body) ||
    /=>\s*\{/.test(body)
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
  if (
    /^\s*(?:ls|cat|wc|head|tail|grep|find|sed|awk|chmod|chown|mkdir|touch|rm|cp|mv|ln|curl|wget|git|npm|pnpm|yarn|npx|node|python3?|pip3?|docker|make|brew|sudo|ssh|scp|tar)\s+\S/m.test(body)
  ) {
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
export function contentToMarkdown(content: string): string {
  const text = content.trim();
  if (!text) {
    return "";
  }
  const language = inferCodeLanguage(text);
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
      if (isPayloadMetaKey(key)) {
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

/** Related fields sorted so annotations lead, then timestamps / paths / ids. */
export function orderRelated(fields: readonly RelatedField[]): RelatedField[] {
  return [...fields].sort((a, b) => {
    if (a.annotation !== b.annotation) {
      return a.annotation ? -1 : 1;
    }
    return 0;
  });
}
