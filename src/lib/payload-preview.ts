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

/** Later duplicates (e.g. `transcript_path` after `transcriptPath`) win. */
function mergeRelated(fields: RelatedField[]): RelatedField[] {
  const byKey = new Map<string, RelatedField>();
  for (const field of fields) {
    byKey.set(normalized(field.key), field);
  }
  return [...byKey.values()];
}

/**
 * Fence a content that is itself code so the Markdown renderer highlights it.
 * Plain Markdown and prose pass through unchanged — the renderer already
 * handles inline and fenced code, headings and lists.
 */
export function contentToMarkdown(content: string): string {
  const text = content.trim();
  if (!text) {
    return "";
  }
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      JSON.parse(trimmed);
      return `\`\`\`json\n${trimmed}\n\`\`\``;
    } catch {
      // Not JSON — keep the original text.
    }
  }
  return text;
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
