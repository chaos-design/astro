/**
 * Turn an inspector payload into the markdown document the Preview surface
 * renders. A captured result is usually a string (agent text, a command's
 * output, a plan) wrapped in a small object; unwrapping the one interesting
 * field keeps a Preview from repeating a heading over a single line of text.
 * Structured values stay visible as fenced JSON, which the markdown pipeline
 * highlights just like any other code block.
 *
 * This is presentation only — the Code surface shows the untouched payload,
 * and nothing here is written back to a captured event.
 */
export function payloadToMarkdown(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => payloadToMarkdown(item))
      .filter(Boolean)
      .join("\n\n---\n\n");
  }
  if (typeof value !== "object") {
    return String(value);
  }

  const entries = Object.entries(value as Record<string, unknown>);
  const textEntries = entries.filter(
    ([, item]) => typeof item === "string" && Boolean((item as string).trim()),
  );

  // `{ message: "..." }` / `{ prompt: "..." }` / `{ output: "..." }` is the
  // common shape: the single text field *is* the result, so return it verbatim
  // rather than wrapping one paragraph in a redundant heading.
  if (entries.length === 1 && textEntries.length === 1) {
    return textEntries[0][1] as string;
  }

  const blocks: string[] = [];
  for (const [key, item] of entries) {
    if (typeof item === "string") {
      if (!item.trim()) {
        continue;
      }
      blocks.push(`### ${key}\n\n${item}`);
    } else if (item === null || item === undefined || typeof item !== "object") {
      blocks.push(`- **${key}**: \`${JSON.stringify(item)}\``);
    } else {
      blocks.push(
        `### ${key}\n\n\`\`\`json\n${JSON.stringify(item, null, 2)}\n\`\`\``,
      );
    }
  }
  return blocks.join("\n\n");
}
