import type { TracePayload } from "../types/trace";
import { nonEmptyRecord } from "./payload-preview.ts";

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

export interface UserQuestionOption {
  /** The verbatim option label — also the answer token the host records. */
  label: string;
  /** The client's explanation, when it captured one. */
  description?: string;
}

export interface UserQuestionPrompt {
  /** Section title: the client's header, or "Question N" when none is given. */
  title: string;
  /** The question text itself, a markdown source. */
  question: string;
  /** Choices, when the client captured options for the question. */
  options: UserQuestionOption[];
}

export interface UserQuestionAnswer {
  /** The exact question text used as the answer key. */
  question: string;
  /** The chosen option label(s); multi-select answers are comma-joined. */
  answer: string;
}

export interface UserQuestionContent {
  prompts: UserQuestionPrompt[];
  /** Free-form question text for clients without structured questions. */
  message: string;
  /** Markdown plan for approval tools (plan approval / ExitPlanMode). */
  plan: string;
  /** Answers injected by a host decision hook, never produced by the agent. */
  answers: UserQuestionAnswer[];
  /** True when anything displayable was found in the payload. */
  hasContent: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function optionInfo(option: unknown): UserQuestionOption | null {
  if (typeof option === "string") {
    const label = option.trim();
    return label ? { label } : null;
  }
  const record = asRecord(option);
  if (!record) {
    return null;
  }
  let label = "";
  for (const key of ["label", "name", "value", "title", "header"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      label = value.trim();
      break;
    }
  }
  if (!label) {
    return null;
  }
  for (const key of ["description", "desc", "detail", "help"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return { label, description: value.trim() };
    }
  }
  return { label };
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
      options: rawOptions
        .map(optionInfo)
        .filter((option): option is UserQuestionOption => Boolean(option)),
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

/**
 * An auto-approve decision hook answers by injecting `answers` into the tool
 * input (question text -> option label). The same map may be echoed back in
 * `tool_response`. It is display-only evidence: the persisted event is not
 * rewritten and no run state is derived from it.
 */
function extractAnswers(sources: readonly unknown[]): UserQuestionAnswer[] {
  for (const source of sources) {
    const record = asRecord(source);
    if (!record) {
      continue;
    }
    const answers = Object.entries(record)
      .filter(
        ([question, answer]) =>
          question.trim() && typeof answer === "string" && answer.trim(),
      )
      .map(([question, answer]) => ({
        question: question.trim(),
        answer: String(answer).trim(),
      }));
    if (answers.length) {
      return answers;
    }
  }
  return [];
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

/**
 * The single line the console shows for a user.question: the question text(s)
 * themselves, not the tool name that carried them. Structured questions are
 * joined in capture order; free-form text is used as-is; a Markdown plan
 * contributes its first non-empty line so a plan approval stays readable in a
 * LOG row. Empty means the payload has no displayable question at all.
 */
export function userQuestionSummary(
  payload: TracePayload | null | undefined,
): string {
  const content = parseUserQuestionContent(payload);
  const prompts = content.prompts
    .map((prompt) => prompt.question.trim())
    .filter(Boolean);
  if (prompts.length) {
    return prompts.join(" · ");
  }
  if (content.message.trim()) {
    return content.message.trim();
  }
  return (
    content.plan
      .split("\n")
      .map((line) => line.trim())
      .find(Boolean) || ""
  );
}

/**
 * Per-payload parse cache: captured payloads are immutable and stable
 * object references, so the projection layers may hand the same payload to
 * the extractor on every streaming batch. Caching the result keeps a long
 * live run from re-walking every question shape once per batch.
 */
const parsedContentCache = new WeakMap<object, UserQuestionContent>();

export function parseUserQuestionContent(
  payload: TracePayload | null | undefined,
): UserQuestionContent {
  if (payload && typeof payload === "object") {
    const cached = parsedContentCache.get(payload);
    if (cached) {
      return cached;
    }
  }
  const record = asRecord(payload) ?? {};
  // Some clients nest the native payload one level down; ZCode delivers both
  // `tool_input` and its camelCase twin on the top level.
  const nested = asRecord(record.payload);
  // An empty `tool_input: {}` placeholder must not shadow the real camelCase
  // `toolInput` — the recorder writes that placeholder when only the camel
  // spelling carries the questions. The same shared rule the tool-call
  // extractor uses applies here.
  const toolInput =
    nonEmptyRecord(record.tool_input) ??
    nonEmptyRecord(record.toolInput) ??
    nonEmptyRecord(nested?.tool_input) ??
    nonEmptyRecord(nested?.toolInput);
  const toolResponse =
    nonEmptyRecord(record.tool_response) ?? nonEmptyRecord(record.toolResponse);
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
  // Answers are independent of the question text: a completed question tool
  // may carry only the auto-filled answers, which is still worth showing.
  const answers = extractAnswers([
    record.answers,
    toolInput?.answers,
    toolResponse?.answers,
    nested?.answers,
  ]);
  const content: UserQuestionContent = {
    prompts,
    message,
    plan,
    answers,
    hasContent:
      prompts.length > 0 ||
      Boolean(message.trim()) ||
      Boolean(plan.trim()) ||
      answers.length > 0,
  };
  if (payload && typeof payload === "object") {
    parsedContentCache.set(payload, content);
  }
  return content;
}

/**
 * One join rule for the captured answers of a question: the answers the
 * question event itself carried first (a host decision hook's injection),
 * then the recorded answers of its paired result event, deduped by the
 * verbatim question text so a host that wrote both never prints an answer
 * twice.
 */
export function mergeQuestionAnswers(
  own: readonly UserQuestionAnswer[],
  recorded: readonly UserQuestionAnswer[],
): UserQuestionAnswer[] {
  if (!recorded.length) {
    return [...own];
  }
  const seen = new Set(own.map((item) => item.question));
  return [...own, ...recorded.filter((item) => !seen.has(item.question))];
}
