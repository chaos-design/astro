import type { TracePayload } from "../types/trace";

/**
 * What the user.question preview shows.
 *
 * A user.question start event carries the question in whatever shape the
 * capture client produced: structured AskUserQuestion payloads (a `questions`
 * list with per-question headers and options), and the free-form
 * `message` / `prompt` / `content` fields the simpler clients fill. The
 * extractor walks those shapes in one place so the preview component stays
 * presentation only, and the inspector can hand it either the full payload or
 * the `tool_input` object the input tab resolves to.
 */

export interface UserQuestionPrompt {
  /** Section title: the client's header, or "Question N" when none is given. */
  title: string;
  /** The question text itself, a markdown source. */
  question: string;
  /** Choice labels, when the client captured options for the question. */
  options: string[];
}

export interface UserQuestionContent {
  prompts: UserQuestionPrompt[];
  /** Free-form question text for clients without structured questions. */
  message: string;
  /** True when anything displayable was found in the payload. */
  hasContent: boolean;
}

function optionLabel(option: unknown): string {
  if (typeof option === "string") {
    return option.trim();
  }
  if (!option || typeof option !== "object" || Array.isArray(option)) {
    return "";
  }
  const record = option as Record<string, unknown>;
  for (const key of ["label", "name", "value", "title", "header"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function questionText(record: Record<string, unknown>): string {
  for (const key of ["question", "prompt", "message", "text", "content"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return "";
}

function extractQuestions(source: unknown): UserQuestionPrompt[] {
  if (!Array.isArray(source)) {
    return [];
  }
  const prompts: UserQuestionPrompt[] = [];
  for (const item of source) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }
    const record = item as Record<string, unknown>;
    const question = questionText(record);
    if (!question) {
      continue;
    }
    const rawOptions = Array.isArray(record.options)
      ? record.options
      : Array.isArray(record.choices)
        ? record.choices
        : [];
    const header = record.header;
    prompts.push({
      title:
        typeof header === "string" && header.trim() ? header.trim() : "",
      question,
      options: rawOptions.map(optionLabel).filter(Boolean),
    });
  }
  return prompts;
}

function freeFormText(record: Record<string, unknown>): string {
  for (const key of ["message", "prompt", "question", "text", "content"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return "";
}

export function parseUserQuestionContent(
  payload: TracePayload | null | undefined,
): UserQuestionContent {
  const record = (payload ?? {}) as Record<string, unknown>;
  const toolInput =
    record.tool_input && typeof record.tool_input === "object"
      ? (record.tool_input as Record<string, unknown>)
      : null;
  // Structured questions may sit directly on the payload (the input tab
  // resolves to `tool_input` for question tools) or one level down (the full
  // start payload). The direct shape wins so a client that fills both is not
  // rendered twice.
  const direct = extractQuestions(record.questions);
  const prompts = direct.length
    ? direct
    : extractQuestions(toolInput?.questions);
  const message = prompts.length
    ? ""
    : freeFormText(record) || (toolInput ? freeFormText(toolInput) : "");
  return {
    prompts,
    message,
    hasContent: prompts.length > 0 || Boolean(message.trim()),
  };
}
