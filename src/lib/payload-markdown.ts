/**
 * Turn an inspector payload into the Markdown document the Preview surface
 * renders. A captured result is usually a string (agent text, a command's
 * output, a plan) wrapped in a small object; unwrapping the one interesting
 * field keeps a Preview from repeating a heading over a single line of text.
 *
 * Known structured payloads get a shape that reads like their meaning:
 * answers become question → Markdown-answer rows, questions become a list with
 * their options, and tool content arrays are flattened to their text. Anything
 * else keeps a content-only generic view — metadata keys stay out (they are
 * labelled in the related-data pane) and the remaining values render with
 * inferred-language code fences, without field-name headings.
 *
 * This is presentation only — the Code surface shows the untouched payload,
 * and nothing here is written back to a captured event.
 */

import {
  fenceCode,
  inferCodeLanguage,
  isPayloadContainerKey,
  isPayloadMetaKey,
} from "./payload-preview.ts";

const TEXT_KEYS = [
  "message",
  "text",
  "content",
  "output",
  "result",
  "response",
  "plan",
  "prompt",
  "last_assistant_message",
  "stdout",
  "stderr",
  "reasoning",
];

/**
 * Fields that carry a *result* as opposed to metadata. They win over the
 * generic key/value view at any depth, so a tool response wrapped next to ids
 * and status still previews its Markdown body instead of a JSON blob. The
 * global overlay passes `{ contract, captured }` for an atom tab; `captured`
 * is the actual captured output and leads the list. Both the snake and the
 * camel spellings are listed because clients write either (the ZCode adapter
 * writes `toolResponse`, hook payloads write `tool_response`).
 */
const RESULT_KEYS = [
  "captured",
  "tool_response",
  "toolResponse",
  "toolResult",
  "tool_result",
  "result",
  "output",
  "stdout",
  "stderr",
];

/**
 * Containers that hold the real content one level down rather than being the
 * display text themselves. A captured tool call often nests the meaningful
 * text under `tool_input` or a translated `payload`; walking these keeps the
 * preview on the content even when metadata sits alongside it.
 */
const CONTAINER_KEYS = ["tool_input", "toolInput", "input", "payload", "arguments", "args"];

/** One module-level list so per-event unwrapping never allocates a new array. */
const UNWRAP_KEYS = [...new Set([...TEXT_KEYS, ...RESULT_KEYS, ...CONTAINER_KEYS])];

const MAX_DEPTH = 6;

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Keep a captured key from injecting headings, emphasis or line breaks. */
function escapeInline(value: string): string {
  return value
    .replace(/[\r\n]+/g, " ")
    .replace(/([\\`*_[\]#<>])/g, "\\$1");
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? "null";
  } catch {
    return "[unserializable value]";
  }
}

/**
 * Pull readable text out of nested result containers such as
 * `{ tool_response: { content: [{ type: "text", text: "..." }] } }`. Returns an
 * empty string when the value is genuinely structured, so the caller can fall
 * back to the generic view rather than guessing.
 */
function unwrapText(value: unknown, depth: number, seen: WeakSet<object>): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value === null || value === undefined || depth > MAX_DEPTH) {
    return "";
  }
  if (typeof value !== "object") {
    return "";
  }
  if (seen.has(value)) {
    return "";
  }
  seen.add(value);
  if (Array.isArray(value)) {
    return value
      .map((item) => unwrapText(item, depth + 1, new WeakSet()))
      .filter(Boolean)
      .join("\n\n");
  }
  const record = value as UnknownRecord;
  // Direct text fields are the content itself and win over any container.
  for (const key of UNWRAP_KEYS) {
    const child = record[key];
    if (typeof child === "string" && child.trim()) {
      return child;
    }
  }
  // A content field often holds a nested container — `content: [{ type:
  // "text", text: "..." }]` — or a result key wraps the text one level down.
  // Walk those too so a multi-field tool response previews its text instead
  // of its field names. MAX_DEPTH bounds recursion, which also stops cycles.
  for (const key of UNWRAP_KEYS) {
    const child = record[key];
    if (child && typeof child === "object") {
      const nested = unwrapText(child, depth + 1, new WeakSet());
      if (nested.trim()) {
        return nested;
      }
    }
  }
  // A single meaningful field is the result itself, whatever its name.
  const entries = Object.entries(record);
  if (entries.length === 1 && typeof entries[0][1] === "object") {
    return unwrapText(entries[0][1], depth + 1, new WeakSet());
  }
  return "";
}

/**
 * Find a readable result anywhere in a captured payload. `unwrapText` handles
 * one container; this walks the tree and tries it on every result-bearing
 * field, so `{ tool_use_id, tool_response: { content: [...] } }` previews the
 * text the tool returned rather than a wall of field labels and fenced JSON.
 */
function findResultText(value: unknown, depth: number, seen: WeakSet<object>): string {
  if (depth > MAX_DEPTH || value === null || typeof value !== "object" || seen.has(value)) {
    return "";
  }
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findResultText(item, depth + 1, seen);
      if (found.trim()) {
        return found;
      }
    }
    return "";
  }
  const record = value as UnknownRecord;
  for (const key of RESULT_KEYS) {
    if (!(key in record)) {
      continue;
    }
    const text = unwrapText(record[key], depth + 1, new WeakSet());
    if (text.trim()) {
      return text;
    }
  }
  for (const child of Object.values(record)) {
    const found = findResultText(child, depth + 1, seen);
    if (found.trim()) {
      return found;
    }
  }
  return "";
}

/**
 * A result that is itself a JSON document belongs in a fenced block so the
 * renderer's highlighter colours it; prose and Markdown stay as-is so headings,
 * lists and inline code render normally.
 */
function resultToMarkdown(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      JSON.parse(trimmed);
      return `\`\`\`json\n${trimmed}\n\`\`\``;
    } catch {
      // Not JSON after all: keep the original text.
    }
  }
  return text;
}

function answersToMarkdown(answers: UnknownRecord): string {
  const rows = Object.entries(answers).filter(
    ([, value]) => typeof value === "string" && value.trim(),
  );
  if (!rows.length) {
    return "";
  }
  return `### Answers\n\n${rows
    .map(([question, answer]) => `**${escapeInline(question)}**\n\n${answer}`)
    .join("\n\n")}`;
}

function questionsToMarkdown(questions: unknown[]): string {
  const rows = questions.map((item, index) => {
    const record = isRecord(item) ? item : null;
    const header = record && typeof record.header === "string" ? record.header : "";
    const question =
      typeof item === "string"
        ? item
        : record && typeof record.question === "string"
          ? record.question
          : "";
    const heading = header
      ? `**${escapeInline(header)}** — ${escapeInline(question)}`
      : escapeInline(question);
    const options = record && Array.isArray(record.options) ? record.options : [];
    const lines = [`1. ${heading || `Question ${index + 1}`}`];
    for (const option of options) {
      const optionRecord = isRecord(option) ? option : null;
      const label =
        typeof option === "string"
          ? option
          : optionRecord && typeof optionRecord.label === "string"
            ? optionRecord.label
            : "";
      if (!label) {
        continue;
      }
      const description =
        optionRecord && typeof optionRecord.description === "string"
          ? optionRecord.description
          : "";
      lines.push(
        `   - **${escapeInline(label)}**${description ? ` — ${description}` : ""}`,
      );
    }
    return lines.join("\n");
  });
  return `### Questions\n\n${rows.join("\n\n")}`;
}

/** Find a known structured shape at any depth of a captured payload. */
function findStructured(value: unknown, depth: number, seen: WeakSet<object>): string {
  if (depth > MAX_DEPTH || value === null || typeof value !== "object" || seen.has(value)) {
    return "";
  }
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findStructured(item, depth + 1, seen);
      if (found) {
        return found;
      }
    }
    return "";
  }
  const record = value as UnknownRecord;
  if (isRecord(record.answers)) {
    const markdown = answersToMarkdown(record.answers);
    if (markdown) {
      return markdown;
    }
  }
  if (Array.isArray(record.questions)) {
    const markdown = questionsToMarkdown(record.questions);
    if (markdown) {
      return markdown;
    }
  }
  for (const child of Object.values(record)) {
    const found = findStructured(child, depth + 1, seen);
    if (found) {
      return found;
    }
  }
  return "";
}

/**
 * An Edit-style tool result carries its change as a structured patch: an
 * array of `{ oldStart, oldLines, newStart, newLines, lines }` whose `lines`
 * are diff rows (`+` / `-` / context). Fenced as `diff` so the renderer's
 * highlighter colours the change — the patch is the *result* the reader came
 * to see, not metadata for the generic view.
 */
function structuredPatchToMarkdown(patch: unknown[]): string {
  const lines: string[] = [];
  for (const item of patch) {
    if (isRecord(item) && Array.isArray(item.lines)) {
      for (const line of item.lines) {
        if (typeof line === "string") {
          lines.push(line);
        }
      }
    }
  }
  if (!lines.length) {
    return "";
  }
  return `\`\`\`diff\n${lines.join("\n")}\n\`\`\``;
}

/**
 * Find a change (a structured patch array or a plain `patch` string) anywhere
 * in a captured payload, so an Edit-style result previews as the diff it is.
 */
function findPatchMarkdown(value: unknown, depth: number, seen: WeakSet<object>): string {
  if (depth > MAX_DEPTH || value === null || typeof value !== "object" || seen.has(value)) {
    return "";
  }
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findPatchMarkdown(item, depth + 1, seen);
      if (found) {
        return found;
      }
    }
    return "";
  }
  const record = value as UnknownRecord;
  if (Array.isArray(record.structuredPatch)) {
    const markdown = structuredPatchToMarkdown(record.structuredPatch);
    if (markdown) {
      return markdown;
    }
  }
  if (typeof record.patch === "string" && record.patch.trim()) {
    return `\`\`\`diff\n${record.patch.trimEnd()}\n\`\`\``;
  }
  for (const child of Object.values(record)) {
    const found = findPatchMarkdown(child, depth + 1, seen);
    if (found) {
      return found;
    }
  }
  return "";
}

function arrayToMarkdown(value: unknown[], depth: number, seen: WeakSet<object>): string {
  const items = value
    .map((item) => payloadToMarkdown(item, depth + 1, seen))
    .filter(Boolean);
  if (!items.length) {
    return "";
  }
  if (items.every((item) => !item.includes("\n"))) {
    return items.map((item) => `- ${item}`).join("\n");
  }
  return items.join("\n\n---\n\n");
}

/**
 * The generic view is content-only: a preview pane shows what the payload
 * carried, not a field-name index. Metadata keys stay out (the related-data
 * pane labels them), plain numbers/booleans are metadata values and drop, a
 * string is fenced with its inferred language so code arrives highlighted
 * (prose that infers nothing stays prose), and a nested object fences as
 * highlighted JSON.
 */
function objectToMarkdown(value: UnknownRecord, depth: number, seen: WeakSet<object>): string {
  const blocks: string[] = [];
  for (const [key, item] of Object.entries(value)) {
    // A container key (tool_input / payload / …) hides the content one level
    // down and is never metadata; other metadata keys stay beside the preview.
    const container = item !== null && typeof item === "object" && isPayloadContainerKey(key);
    if (!container && isPayloadMetaKey(key)) {
      continue;
    }
    if (typeof item === "string") {
      if (!item.trim()) {
        continue;
      }
      const language = inferCodeLanguage(item);
      blocks.push(language ? fenceCode(item, language) : item);
    } else if (item !== null && item !== undefined && typeof item === "object") {
      if (container) {
        blocks.push(payloadToMarkdown(item, depth + 1, seen));
      } else {
        blocks.push(fenceCode(safeJson(item), "json"));
      }
    }
  }
  return blocks.join("\n\n");
}

/**
 * A captured result with no single display text is still content, not
 * metadata: render its field VALUES as readable lines instead of a JSON dump.
 * Metadata keys stay out (they are labelled in the related-data pane) and the
 * remaining values keep their nesting — plain arrays become bullet lists, a
 * nested object indents under its value — so a small structured result reads
 * as its values rather than as field labels and fenced JSON.
 */
function readableFields(value: unknown, depth: number, seen: WeakSet<object>): string {
  if (!isRecord(value) || depth > MAX_DEPTH || seen.has(value)) {
    return payloadToMarkdown(value, depth + 1, new WeakSet());
  }
  seen.add(value);
  const lines: string[] = [];
  for (const [key, item] of Object.entries(value)) {
    const container = item !== null && typeof item === "object" && isPayloadContainerKey(key);
    if (!container && isPayloadMetaKey(key)) {
      continue;
    }
    if (item === null || item === undefined) {
      continue;
    }
    if (Array.isArray(item)) {
      const children = item
        .map((entry) =>
          typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean"
            ? `  - ${escapeInline(String(entry))}`
            : `  - \`${escapeInline(safeJson(entry))}\``,
        )
        .join("\n");
      if (children) {
        lines.push(children);
      }
    } else if (isRecord(item)) {
      // Without field-name labels there is no header to nest under: the
      // container's own values join the list directly.
      const nested = readableFields(item, depth + 1, new WeakSet());
      if (nested) {
        lines.push(nested);
      }
    } else {
      lines.push(`- ${escapeInline(String(item))}`);
    }
  }
  return lines.join("\n");
}

/**
 * Preview a captured result from the inspector's `{ contract, captured }`
 * wrapper. `contract` is topology metadata and would only add a fenced JSON
 * block of field names, so it is deliberately ignored here. Structured
 * questions/answers and a readable result text win first; otherwise the
 * result is shown as readable fields rather than a JSON structure.
 */
function capturedResultToMarkdown(value: unknown, depth: number, seen: WeakSet<object>): string {
  const structured = findStructured(value, depth, new WeakSet());
  if (structured) {
    return structured;
  }
  // `value` is the captured result itself, so read its display text directly:
  // unwrapText understands prompt / message / stdout / plan and the nested
  // `content` arrays a tool response hides its text in.
  const text = unwrapText(value, depth, new WeakSet());
  if (text.trim()) {
    return resultToMarkdown(text);
  }
  if (isRecord(value)) {
    return readableFields(value, depth, seen);
  }
  return payloadToMarkdown(value, depth, seen);
}

export function payloadToMarkdown(
  value: unknown,
  depth = 0,
  seen: WeakSet<object> = new WeakSet(),
): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value !== "object") {
    return String(value);
  }
  if (seen.has(value)) {
    return "[circular reference]";
  }
  if (Array.isArray(value)) {
    seen.add(value);
    return arrayToMarkdown(value, depth, seen);
  }
  const record = value as UnknownRecord;

  // The inspector and the global overlay wrap a tab's payload as
  // `{ contract, captured }`. `contract` is topology metadata; previewing it
  // only produces a fenced JSON block of field names. Follow `captured` so the
  // preview shows the prompt / output content the reader asked for, leaving
  // the untouched wrapper to the Code view.
  if ("captured" in record && "contract" in record) {
    return capturedResultToMarkdown(record.captured, depth, seen);
  }

  const structured = findStructured(value, depth, new WeakSet());
  if (structured) {
    return structured;
  }

  // An Edit-style change is its own result: the structured patch (or a plain
  // patch string) previews as a highlighted diff before the generic result
  // walk, so the reader sees the change instead of the envelope.
  const patch = findPatchMarkdown(value, depth, new WeakSet());
  if (patch) {
    return patch;
  }

  // A captured result wins over its metadata, wherever it sits in the payload.
  // This is the "read the result, not the field names" path the global preview
  // relies on: fenced code and Markdown are rendered, not shown as JSON text.
  const result = findResultText(value, depth, new WeakSet());
  if (result) {
    return resultToMarkdown(result);
  }

  // Without a known result container, a lone text field is still the document.
  // With several unrelated fields the generic view is the honest one — it keeps
  // every field visible instead of silently discarding metadata.
  if (Object.keys(record).length === 1) {
    // A fresh guard: `unwrapText` walks this same object and would otherwise
    // see itself as already visited.
    const unwrapped = unwrapText(value, depth, new WeakSet());
    if (unwrapped.trim()) {
      return unwrapped;
    }
  }
  seen.add(value);
  return objectToMarkdown(record, depth, seen);
}
