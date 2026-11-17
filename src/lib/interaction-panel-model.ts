/**
 * Pure decisions behind the interaction panel, kept out of the JSX so they
 * can be tested without a DOM. The component renders these results; it does
 * not re-derive them.
 */

import type {
  InteractionRequest,
  InteractionResult,
  QuestionDescriptor,
} from "./interaction-contract";

export type InteractionPanelStatus =
  | "open"
  | "answered"
  | "cancelled"
  | "timeout"
  | "expired";

export function optionLabels(question: QuestionDescriptor): string[] {
  return question.options.map((option) =>
    typeof option === "string" ? option : option.label,
  );
}

export function optionDescription(
  question: QuestionDescriptor,
  label: string,
): string {
  const option = question.options.find(
    (candidate) => typeof candidate === "object" && candidate.label === label,
  );
  return option && typeof option === "object" ? option.description || "" : "";
}

export function interactionPanelStatus(
  result?: InteractionResult | null,
): InteractionPanelStatus {
  return result?.status ?? "open";
}

/** Another device answered first; this one only reads the result. */
export function isInteractionPanelReadOnly(
  status: InteractionPanelStatus,
  lockedBy: string | null | undefined,
  deviceId = "console",
): boolean {
  return status !== "open" || Boolean(lockedBy && lockedBy !== deviceId);
}

export type OptionClick = "select" | "deselect" | "none";

/**
 * Clicking a chosen option de-selects it only in a multi-select question; a
 * single-select card would otherwise clear itself into an invalid answer.
 */
export function resolveOptionClick(input: {
  active: boolean;
  multiSelect: boolean;
  readOnly: boolean;
}): OptionClick {
  if (input.readOnly) {
    return "none";
  }
  return input.active && input.multiSelect ? "deselect" : "select";
}

export type TextAction =
  | { action: "text"; text: string }
  | { action: "edit"; previous: string; next: string }
  | { action: "none" };

/** Replacing an existing free-text answer is an `edit` event, not a new one. */
export function resolveTextAction(
  previous: string | undefined,
  draft: string,
): TextAction {
  const next = draft.trim();
  if (!next) {
    return { action: "none" };
  }
  const current = (previous || "").trim();
  if (current && current !== next) {
    return { action: "edit", previous: current, next };
  }
  return current ? { action: "none" } : { action: "text", text: next };
}

export function isInteractionPanelSubmittable(
  questions: QuestionDescriptor[],
  selections: Record<string, string[]>,
): boolean {
  return questions
    .filter((question) => question.required !== false)
    .every((question) => (selections[question.question] || []).length > 0);
}

/**
 * Keyboard answer flow for the floating card. Number keys pick the matching
 * option of the first question, Enter submits once every required question has
 * an answer, Escape cancels. All three are refused while the card is read-only
 * (closed or answered on another device) — keyboard must never bypass the
 * device lock the buttons respect.
 *
 * Only digit keys are bound: free text stays the input's job, so typing a
 * number into "Other…" is never mistaken for picking an option.
 */
export type PanelKeyboardAction =
  | { action: "option"; question: number; option: number }
  | { action: "submit" }
  | { action: "cancel" }
  | { action: "none" };

export function resolvePanelKey(input: {
  key: string;
  questions: readonly QuestionDescriptor[];
  readOnly: boolean;
}): PanelKeyboardAction {
  if (input.readOnly) {
    return { action: "none" };
  }
  if (/^[1-9]$/.test(input.key)) {
    // One digit cannot identify both a question and an option. Bind it to the
    // first question — the one the card's hint counts — so a key always means
    // the same thing instead of jumping between questions as options vary.
    const option = Number(input.key) - 1;
    const first = input.questions[0];
    return first && option < optionLabels(first).length
      ? { action: "option", question: 0, option }
      : { action: "none" };
  }
  if (input.key === "Enter") {
    return { action: "submit" };
  }
  if (input.key === "Escape") {
    return { action: "cancel" };
  }
  return { action: "none" };
}

/**
 * How much of the interaction window is left, as a 0..1 ratio. A request past
 * its deadline is fully drained but still rendered as `open` until the host's
 * timeout frame arrives; the bar must not wrap back to full.
 */
export function interactionTimeLeft(
  request: InteractionRequest,
  now: number,
): number {
  const expires = Date.parse(request.expiresAt);
  const created = Date.parse(request.createdAt);
  if (!Number.isFinite(expires) || !Number.isFinite(created)) {
    return 1;
  }
  const span = expires - created;
  return span > 0
    ? Math.min(1, Math.max(0, (expires - now) / span))
    : 0;
}

/** Closed-state answer rows, one per question, in the request's order. */
export function resultAnswerRows(
  request: InteractionRequest,
  result: InteractionResult | null,
): Array<{ question: string; answer: string }> {
  if (!result) {
    return [];
  }
  return request.questions
    .map((question) => ({
      question: question.question,
      answer: result.answers[question.question] || "",
    }))
    .filter((row) => row.answer);
}
