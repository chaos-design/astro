import type { TracePayload } from "../types/trace";

/**
 * What the user.question preview shows.
 *
 * A user.question start event carries the question in whatever shape the
 * capture client produced: structured AskUserQuestion payloads (a `questions`
 * list with per-question headers and options), the free-form
 * `message` / `prompt` / `content` fields the simpler clients fill, and the
 * Markdown `plan` that approval tools such as ExitPlanMode put in
 * `tool_input`. ZCode reports plan approval as a `PermissionRequest` whose
 * `toolName` is `ExitPlanMode` and whose only readable text is
 * `tool_input.plan`, so the plan shape must be understood here as well.
 *
 * The extractor walks those shapes in one place so the preview component stays
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
  /** Markdown plan for approval tools (plan approval / ExitPlanMode). */
  plan: string;
  /** True when anything displayable was found in the payload. */
  hasContent: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function optionLabel(option: unknown): string {
  if (typeof option === "string") {
    return option.trim();
  }
  const record = asRecord(option);
  if (!record) {
    return "";
  }
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
    const record = asRecord(item);
    if (!record) {
      continue;
    }
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

function planText(record: Record<string, unknown>): string {
  for (const key of ["plan", "planText", "plan_text"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return "";
}

/**
 * True when the payload is a plan-shaped approval. The inspector uses this to
 * widen the preview to the tool lifecycle rows of ExitPlanMode without
 * changing event classification: projection, waiting state and topology stay
 * driven by `trace-event-kind.ts` alone.
 */
export function hasPlanContent(
  payload: TracePayload | null | undefined,
): boolean {
  return Boolean(parseUserQuestionContent(payload).plan);
}

export function parseUserQuestionContent(
  payload: TracePayload | null | undefined,
): UserQuestionContent {
  const record = asRecord(payload) ?? {};
  // Some clients nest the native payload one level down; ZCode delivers both
  // `tool_input` and its camelCase twin on the top level.
  const nested = asRecord(record.payload);
  const toolInput =
    asRecord(record.tool_input) ??
    asRecord(record.toolInput) ??
    asRecord(nested?.tool_input) ??
    asRecord(nested?.toolInput);
  const toolResponse =
    asRecord(record.tool_response) ?? asRecord(record.toolResponse);
  // Structured questions may sit directly on the payload (the input tab
  // resolves to `tool_input` for question tools) or one level down (the full
  // start payload). The direct shape wins so a client that fills both is not
  // rendered twice.
  const direct = extractQuestions(record.questions);
  const fromToolInput = extractQuestions(toolInput?.questions);
  const prompts = direct.length
    ? direct
    : fromToolInput.length
      ? fromToolInput
      : extractQuestions(nested?.questions);
  const message = prompts.length
    ? ""
    : freeFormText(record) ||
      (toolInput ? freeFormText(toolInput) : "") ||
      (nested ? freeFormText(nested) : "");
  // A plan is the question text for approval tools: it is Markdown, so the
  // existing validated preview renders headings, lists and code blocks. It is
  // only used when no structured question or free-form text was captured.
  const plan = prompts.length || message
    ? ""
    : planText(record) ||
      (toolInput ? planText(toolInput) : "") ||
      (toolResponse ? planText(toolResponse) : "") ||
      (nested ? planText(nested) : "");
  return {
    prompts,
    message,
    plan,
    hasContent:
      prompts.length > 0 || Boolean(message.trim()) || Boolean(plan.trim()),
  };
}
