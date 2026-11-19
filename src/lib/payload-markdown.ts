/**
 * Turn an inspector payload into the Markdown document the Preview surface
 * renders. A captured result is usually a string (agent text, a command's
 * output, a plan) wrapped in a small object; unwrapping the one interesting
 * field keeps a Preview from repeating a heading over a single line of text.
 *
 * Known structured payloads get a shape that reads like their meaning:
 * answers become question → Markdown-answer rows, questions become a list with
 * their options, and tool content arrays are flattened to their text. Anything
 * else keeps the generic key/value + fenced JSON form.
 *
 * This is presentation only — the Code surface shows the untouched payload,
 * and nothing here is written back to a captured event.
 */

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
      .map((item) => unwrapText(item, depth + 1, seen))
      .filter(Boolean)
      .join("\n\n");
  }
  const record = value as UnknownRecord;
  for (const key of TEXT_KEYS) {
    const child = record[key];
    if (typeof child === "string" && child.trim()) {
      return child;
    }
  }
  // A single meaningful field is the result itself, whatever its name.
  const entries = Object.entries(record);
  if (entries.length === 1 && typeof entries[0][1] === "object") {
    return unwrapText(entries[0][1], depth + 1, seen);
  }
  return "";
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

function objectToMarkdown(value: UnknownRecord, depth: number, seen: WeakSet<object>): string {
  const blocks: string[] = [];
  for (const [key, item] of Object.entries(value)) {
    const label = escapeInline(key);
    if (typeof item === "string") {
      if (!item.trim()) {
        continue;
      }
      blocks.push(`### ${label}\n\n${item}`);
    } else if (item === null || item === undefined || typeof item !== "object") {
      blocks.push(`- **${label}**: \`${safeJson(item)}\``);
    } else {
      blocks.push(`### ${label}\n\n\`\`\`json\n${safeJson(item)}\n\`\`\``);
    }
  }
  return blocks.join("\n\n");
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

  const structured = findStructured(value, depth, new WeakSet());
  if (structured) {
    return structured;
  }

  // Unwrap only a lone result field. With several fields the generic view is
  // the honest one — it keeps every field visible instead of silently
  // discarding metadata next to the text.
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
