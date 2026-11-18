/**
 * Pure state behind the question surfaces. The floating card and the atom
 * inspector share one layout preference and one batch-answer rule so the same
 * question cannot render as two different widgets with two different submits.
 */

import type { QuestionPanelMode } from "../config/app-config.ts";
import type { QuestionDescriptor } from "./interaction-contract.ts";

export { type QuestionPanelMode };

export const questionPanelModes: readonly QuestionPanelMode[] = [
  "half",
  "bottom",
  "side",
];

export function normalizeQuestionPanelMode(
  value: string | null | undefined,
): QuestionPanelMode {
  return questionPanelModes.find((mode) => mode === value) ?? "half";
}

/**
 * Answer drafts are keyed by the verbatim question text, like the host's answer
 * map. A free-text draft wins over clicked option labels; multi-select labels
 * are emitted in the descriptor's declared order, never in click order.
 */
export function buildQuestionAnswer(
  question: QuestionDescriptor,
  selected: readonly string[] | undefined,
  draft: string | undefined,
): string {
  const typed = (draft ?? "").trim();
  if (typed) {
    return typed;
  }
  const chosen = new Set(selected ?? []);
  return question.options
    .map((option) => (typeof option === "string" ? option : option.label))
    .filter((label) => chosen.has(label))
    .join(", ");
}

export function buildQuestionAnswers(input: {
  questions: readonly QuestionDescriptor[];
  selections?: Readonly<Record<string, readonly string[]>>;
  drafts?: Readonly<Record<string, string>>;
}): Record<string, string> {
  const answers: Record<string, string> = {};
  for (const question of input.questions) {
    const answer = buildQuestionAnswer(
      question,
      input.selections?.[question.question],
      input.drafts?.[question.question],
    );
    if (answer) {
      answers[question.question] = answer;
    }
  }
  return answers;
}

export function questionPanelSubmittable(
  questions: readonly QuestionDescriptor[],
  answers: Readonly<Record<string, string>>,
): boolean {
  return questions
    .filter((question) => question.required !== false)
    .every((question) => Boolean(answers[question.question]?.trim()));
}
