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
