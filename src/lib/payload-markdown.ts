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
  contentToMarkdown,
  fenceCode,
  isPayloadContainerKey,
  isPayloadEnvelopeKey,
  isPayloadIdentityKey,
  isPayloadMetaKey,
} from "./payload-preview.ts";
import { findPayloadFilePath } from "./numbered-code.ts";

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
 * Every extracted result text takes the one code-fence decision in
 * `contentToMarkdown`: JSON / diff / XML self-identify, a shell command or a
 * source snippet is fenced with its inferred language, and a Markdown document
 * stays a document. Repeating the JSON-only check here used to leave a tool
 * command or a captured shell output as a paragraph, with its flags uncoloured
 * and its URLs auto-linked into prose.
 */
function resultToMarkdown(text: string, filePath?: string | null): string {
  return contentToMarkdown(text, filePath);
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
 * An Edit-style tool input carries its change as an old/new string pair
 * (`old_string` / `new_string` in Claude's snake spelling, `oldString` /
 * `newString` in ZCode's camel spelling): synthesise the unified diff the
 * reader came to see, so the two blocks render as the highlighted
 * deletion / addition they are instead of two JSON walls.
 */
function editStringsToDiff(record: UnknownRecord): string {
  const firstString = (...names: string[]): string | undefined => {
    for (const name of names) {
      const value = record[name];
      if (typeof value === "string") {
        return value;
      }
    }
    return undefined;
  };
  const oldText = firstString("old_string", "oldString");
  const newText = firstString("new_string", "newString");
  if ((oldText === undefined || !oldText) && (newText === undefined || !newText)) {
    return "";
  }
  if (oldText === newText) {
    return "";
  }
  const file = firstString("file_path", "filePath") ?? "";
  // A trailing newline is a line terminator, not an empty line: `split("\n")`
  // would leave a trailing "" and render a ghost deletion/addition plus an
  // inflated hunk count. Normalize CRLF first, then drop exactly one trailing
  // empty element (an intentionally blank last line keeps its own "\n\n").
  const splitLines = (text: string): string[] => {
    if (!text) {
      return [];
    }
    const normalized = text.replace(/\r\n/g, "\n").replace(/\n$/, "");
    return normalized ? normalized.split("\n") : [];
  };
  const oldLines = splitLines(oldText ?? "");
  const newLines = splitLines(newText ?? "");
  const lines = [
    `--- ${file ? `a/${file}` : "a/"}`,
    `+++ ${file ? `b/${file}` : "b/"}`,
    `@@ -1,${oldLines.length} +1,${newLines.length} @@`,
    ...oldLines.map((line) => `-${line}`),
    ...newLines.map((line) => `+${line}`),
  ];
  return fenceCode(lines.join("\n"), "diff");
}

/**
 * Find a change (a structured patch array, a plain `patch` string, or an
 * Edit-style old/new input pair) anywhere in a captured payload, so an
 * Edit-style result previews as the diff it is.
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
  const editDiff = editStringsToDiff(record);
  if (editDiff) {
    return editDiff;
  }
  for (const child of Object.values(record)) {
    const found = findPatchMarkdown(child, depth + 1, seen);
    if (found) {
      return found;
    }
  }
  return "";
}

/**
 * An array whose items are compact records — scalars only, single-line
 * strings — reads as a checklist, not a JSON dump: a `todos` field renders
 * as GFM task rows (`- [x] content · priority=high`), the status driving the
 * checkbox, so the list is scannable instead of one fenced blob. Anything
 * longer or nested falls back to the per-item blocks.
 */
const LIST_PRIMARY_KEYS = [
  "content",
  "label",
  "title",
  "message",
  "question",
  "name",
  "text",
  "summary",
  "description",
];
const LIST_STATUS_KEYS = new Set([
  "status",
  "state",
  "done",
  "checked",
  "completed",
  "finished",
  "active",
]);
const LIST_DONE_VALUES = new Set([
  "completed",
  "complete",
  "done",
  "closed",
  "finished",
  "passed",
  "pass",
  "true",
  "yes",
]);

function isCompactRecord(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  return Object.values(value).every((item) => {
    if (item === null || item === undefined) {
      return true;
    }
    if (typeof item === "string") {
      // A multi-line body is a document, not a checklist row.
      return !item.includes("\n");
    }
    return typeof item !== "object";
  });
}

function compactRecordStatus(record: UnknownRecord): string | undefined {
  for (const [key, value] of Object.entries(record)) {
    // Status is commonly a boolean (`done: true`) or a number, not just a
    // string. Normalize scalars so the checklist checkbox works for those
    // shapes too (`true` is already in LIST_DONE_VALUES); objects/arrays are
    // not a status and are left for the rest of the renderer.
    if (
      LIST_STATUS_KEYS.has(key.toLowerCase()) &&
      value !== null &&
      value !== undefined &&
      typeof value !== "object"
    ) {
      return String(value);
    }
  }
  return undefined;
}

/**
 * One GFM row for a compact record. Returns "" when the item is not compact,
 * so the caller keeps the richer per-item rendering. A `status` (or similar)
 * field present on ANY item turns the whole list into a task list, so a
 * pending row next to a finished one still reads as one checklist.
 */
/** A list of uniform records with no headline field is a table, not a run of
 *  `key=value · key=value` strings: the keys become columns and a long path
 *  stays in its own cell instead of being swallowed by a paragraph. */
function recordsToTable(records: readonly UnknownRecord[]): string {
  const keys: string[] = [];
  for (const record of records) {
    for (const key of Object.keys(record)) {
      if (!keys.includes(key)) {
        keys.push(key);
      }
    }
  }
  if (!keys.length) {
    return "";
  }
  const cell = (value: unknown): string => {
    const text =
      value === null || value === undefined || value === ""
        ? "—"
        : escapeInline(String(value));
    return text.replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ");
  };
  return [
    `| ${keys.map((key) => cell(key)).join(" | ")} |`,
    `| ${keys.map(() => "---").join(" | ")} |`,
    ...records.map(
      (record) => `| ${keys.map((key) => cell(record[key])).join(" | ")} |`,
    ),
  ].join("\n");
}

function compactListMarkdown(items: readonly unknown[]): string {
  const records = items.map((item) => (isCompactRecord(item) ? item : null));
  if (records.some((record) => record === null) || !items.length) {
    return "";
  }
  const hasStatus = records.some((record) => {
    const status = compactRecordStatus(record as UnknownRecord);
    return status !== undefined;
  });
  const hasPrimary = records.some((record) =>
    LIST_PRIMARY_KEYS.some((key) => {
      const value = (record as UnknownRecord)[key];
      return typeof value === "string" && Boolean(value.trim());
    }),
  );
  if (!hasStatus && !hasPrimary) {
    return recordsToTable(records as UnknownRecord[]);
  }
  return (records as UnknownRecord[])
    .map((record) => {
      let primary = "";
      let primaryKey = "";
      for (const key of LIST_PRIMARY_KEYS) {
        const value = record[key];
        if (typeof value === "string" && value.trim()) {
          primary = value;
          primaryKey = key;
          break;
        }
      }
      const status = compactRecordStatus(record) ?? "";
      const done = LIST_DONE_VALUES.has(status.toLowerCase());
      const checkbox = hasStatus ? (done ? "[x] " : "[ ] ") : "";
      const suffix = Object.entries(record)
        .filter(([key, value]) => {
          if (key === primaryKey || LIST_STATUS_KEYS.has(key.toLowerCase())) {
            return false;
          }
          return (
            value !== null &&
            value !== undefined &&
            value !== "" &&
            typeof value !== "object"
          );
        })
        .map(([key, value]) => `${escapeInline(key)}=${escapeInline(String(value))}`)
        .join(" · ");
      // No primary key, no dump: the suffix already names every scalar, and
      // repeating the whole record as JSON made one entry read twice.
      const body = primary ? escapeInline(primary) : "";
      // Block lines, not bullets: each record is its own quiet row, the
      // status checkbox keeping its checklist reading.
      return `${checkbox}${body}${suffix ? ` — ${suffix}` : ""}`;
    })
    .join("\n\n");
}

function arrayToMarkdown(value: unknown[], depth: number, seen: WeakSet<object>): string {
  const list = compactListMarkdown(value);
  if (list) {
    return list;
  }
  const items = value
    .map((item) => payloadToMarkdown(item, depth + 1, seen))
    .filter(Boolean);
  if (!items.length) {
    return "";
  }
  // One block per item, rendered as a quoted block: the blockquote gives each
  // entry a distinct bordered record in the preview (no bullet list, no JSON
  // wall), and an item that is code keeps its fence inside the quote.
  // A single entry renders bare — no quote frame around one record; the
  // important content stands on its own.
  if (items.length === 1) {
    return items[0];
  }
  const asBlock = (item: string) =>
    item
      .split("\n")
      .map((line) => (line ? `> ${line}` : ">"))
      .join("\n");
  return items.map(asBlock).join("\n>\n");
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
    // The recorder's identity stamp (client name + version) belongs in the
    // dialog header, never in the preview body. Drop it at the top level of
    // the payload only: a deeper `version` field is genuine captured data.
    if (isPayloadEnvelopeKey(key) || (depth === 0 && isPayloadIdentityKey(key))) {
      continue;
    }
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
      // One fence decision with the content extractor: a code string fences
      // with its inferred language, a Markdown document renders as itself.
      blocks.push(contentToMarkdown(item));
    } else if (Array.isArray(item)) {
      // An array field is content: a checklist of compact records (a `todos`
      // payload) reads as a GFM list, nested items as their own blocks —
      // never as one fenced JSON blob of the whole array.
      const list = arrayToMarkdown(item, depth + 1, seen);
      blocks.push(list || fenceCode(safeJson(item), "json"));
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
    if (isPayloadEnvelopeKey(key) || (depth === 0 && isPayloadIdentityKey(key))) {
      continue;
    }
    const container = item !== null && typeof item === "object" && isPayloadContainerKey(key);
    if (!container && isPayloadMetaKey(key)) {
      continue;
    }
    if (item === null || item === undefined) {
      continue;
    }
    if (Array.isArray(item)) {
      // A checklist of compact records (a `todos` payload) keeps its list
      // shape here too, indented under its field like the plain bullets.
      const list = compactListMarkdown(item);
      const children = list
        ? list.split("\n").map((line) => `  ${line}`).join("\n")
        : item
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
function capturedResultToMarkdown(
  value: unknown,
  depth: number,
  seen: WeakSet<object>,
  filePath?: string | null,
): string {
  const structured = findStructured(value, depth, new WeakSet());
  if (structured) {
    return structured;
  }
  // The generic path detects an Edit / patch result before walking the rest of
  // the payload. The inspector always goes through this `{ contract, captured }`
  // wrapper, so it must use the same detector — otherwise a captured change
  // degrades into two JSON walls here while the global overlay shows a diff.
  const patch = findPatchMarkdown(value, depth, new WeakSet());
  if (patch) {
    return patch;
  }
  // `value` is the captured result itself, so read its display text directly:
  // unwrapText understands prompt / message / stdout / plan and the nested
  // `content` arrays a tool response hides its text in.
  const text = unwrapText(value, depth, new WeakSet());
  if (text.trim()) {
    return resultToMarkdown(text, filePath ?? findPayloadFilePath(value));
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
    return contentToMarkdown(value);
  }
  if (typeof value !== "object") {
    return contentToMarkdown(String(value));
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
    return capturedResultToMarkdown(record.captured, depth, seen, findPayloadFilePath(value));
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
    // The same payload carries the file path a Read result came from. Pass it
    // so a TypeScript file with an `export` line is not mislabelled as bash.
    return resultToMarkdown(result, findPayloadFilePath(value));
  }

  // Without a known result container, a lone text field is still the document.
  // With several unrelated fields the generic view is the honest one — it keeps
  // every field visible instead of silently discarding metadata. A lone
  // ARRAY is not a document: a `todos` field is a list to read, and
  // unwrapping it would join its rows into prose.
  if (Object.keys(record).length === 1) {
    const [singleKey, singleValue] = Object.entries(record)[0];
    if (!Array.isArray(singleValue)) {
      // A fresh guard: `unwrapText` walks this same object and would
      // otherwise see itself as already visited.
      const unwrapped = unwrapText(value, depth, new WeakSet());
      if (unwrapped.trim()) {
        return contentToMarkdown(unwrapped, findPayloadFilePath(value));
      }
    }
  }
  seen.add(value);
  return objectToMarkdown(record, depth, seen);
}
