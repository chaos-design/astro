/**
 * Pure state behind the question surfaces. The docked panel in the EVENTS
 * inspector and the floating card over the canvas share one layout preference
 * and one batch-answer rule so the same question cannot render as two
 * different widgets with two different submits.
 */

import type { QuestionPanelMode } from "../config/app-config.ts";
import type { QuestionDescriptor } from "./interaction-contract.ts";

export { type QuestionPanelMode };

/**
 * Three places the same question surface can live, in the order the control
 * lists them:
 *  - `dock-half` 区域半屏: docked under the inspector tabs, lower half of the
 *    detail area, so the selected event stays readable above it.
 *  - `dock-full` 区域全屏: docked and filling the whole detail area below the
 *    tabs — the long-batch layout.
 *  - `float` 悬浮: the card that floats over the canvas, shown only while the
 *    highlighted atom is the question itself.
 */
export const questionPanelModes: readonly QuestionPanelMode[] = [
  "dock-half",
  "dock-full",
  "float",
];

export const questionPanelModeLabels: Record<QuestionPanelMode, string> = {
  "dock-half": "区域半屏",
  "dock-full": "区域全屏",
  float: "悬浮",
};

/**
 * A stored preference from before the dock existed: `half` was the floating
 * card, `bottom` the full-width card at the canvas bottom and `side` the
 * side-expanded card. Mapping them once here keeps a reader's layout after the
 * upgrade instead of silently resetting it.
 */
const legacyQuestionPanelModes: Record<string, QuestionPanelMode> = {
  half: "float",
  bottom: "dock-half",
  side: "dock-full",
};

export function isQuestionPanelMode(value: unknown): value is QuestionPanelMode {
  return (
    typeof value === "string" &&
    (questionPanelModes as readonly string[]).includes(value)
  );
}

export function normalizeQuestionPanelMode(
  value: string | null | undefined,
): QuestionPanelMode {
  if (isQuestionPanelMode(value)) {
    return value;
  }
  if (typeof value === "string" && legacyQuestionPanelModes[value]) {
    return legacyQuestionPanelModes[value];
  }
  return "dock-half";
}

/** Whether the mode renders the question inside the inspector instead of the canvas. */
export function isDockedQuestionPanelMode(mode: QuestionPanelMode): boolean {
  return mode !== "float";
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
