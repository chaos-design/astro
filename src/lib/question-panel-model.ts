/**
 * Pure state behind the question surfaces. The docked panel in the EVENTS
 * inspector and the floating card over the canvas share one layout preference
 * and one batch-answer rule so the same question cannot render as two
 * different widgets with two different submits.
 */

import {
  questionPanelModeByState,
  type QuestionPanelMode,
  type QuestionPanelState,
} from "../config/app-config.ts";
import type {
  QuestionDescriptor,
  QuestionOption,
} from "./interaction-contract.ts";

export { type QuestionPanelMode, type QuestionPanelState };

/**
 * Two places the same question surface can live, in the order the control
 * lists them:
 *  - `dock-full` 区域全屏: fills the inspector's detail area below the tabs —
 *    the long-batch layout that keeps every question readable.
 *  - `float` 悬浮: the card over the canvas, shown only while the highlighted
 *    atom is the question itself.
 */
export const questionPanelModes: readonly QuestionPanelMode[] = [
  "dock-full",
  "float",
];

export const questionPanelModeLabels: Record<QuestionPanelMode, string> = {
  "dock-full": "区域全屏",
  float: "悬浮",
};

/**
 * Stored preferences from before the two-placement switch: `dock-half` was the
 * half-height dock, `half` the floating card, `bottom` the full-width card and
 * `side` the side-expanded card. The dock has one size now, so every dock value
 * maps onto it and the card keeps its own.
 */
const legacyQuestionPanelModes: Record<string, QuestionPanelMode> = {
  "dock-half": "dock-full",
  half: "float",
  bottom: "dock-full",
  side: "dock-full",
};

export function isQuestionPanelMode(value: unknown): value is QuestionPanelMode {
  return (
    typeof value === "string" &&
    (questionPanelModes as readonly string[]).includes(value)
  );
}

/**
 * Parses a stored placement without inventing one for an absent or corrupt
 * value. `null` is the signal that the state-aware default still applies.
 */
export function parseQuestionPanelMode(
  value: string | null | undefined,
): QuestionPanelMode | null {
  if (isQuestionPanelMode(value)) {
    return value;
  }
  if (typeof value === "string" && legacyQuestionPanelModes[value]) {
    return legacyQuestionPanelModes[value];
  }
  return null;
}

export function normalizeQuestionPanelMode(
  value: string | null | undefined,
): QuestionPanelMode {
  return parseQuestionPanelMode(value) ?? "dock-full";
}

/**
 * The one placement decision: an explicit (or migrated legacy) choice wins,
 * otherwise the question's lifecycle picks it — a live request floats, a
 * settled or captured question docks.
 */
export function resolveQuestionPanelMode(
  stored: string | null | undefined,
  state: QuestionPanelState,
): QuestionPanelMode {
  return parseQuestionPanelMode(stored) ?? questionPanelModeByState[state];
}

/** Whether the mode renders the question inside the inspector instead of the canvas. */
export function isDockedQuestionPanelMode(mode: QuestionPanelMode): boolean {
  return mode === "dock-full";
}

/**
 * The default placement while the reader has not picked one: a question that
 * can be answered right now floats over the canvas so it stays visible next to
 * the executing run; a finished or captured question docks full in the
 * inspector so its whole text and every option fit on screen. The stored mode
 * still wins once the reader switches layouts by hand.
 */
export function autoQuestionPanelMode(actionable: boolean): QuestionPanelMode {
  return actionable ? "float" : "dock-full";
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

/**
 * Split a captured answer back into the option labels it selected and any
 * free text. Only whole comma tokens that exactly match a declared label count
 * as a selection, so a free-text answer like "Paris, France" never lights up a
 * "France" option, and a selected chip never reappears as prose.
 */
export function matchAnswerOptions(
  answer: string,
  options: readonly (QuestionOption | string)[] | undefined,
): { labels: string[]; text: string } {
  const labels = (options ?? []).map((option) =>
    typeof option === "string" ? option : option.label,
  );
  const tokens = (answer ?? "")
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean);
  const matched = labels.filter((label) => tokens.includes(label));
  const text = tokens.filter((token) => !labels.includes(token)).join(", ");
  return { labels: matched, text };
}

export function questionPanelSubmittable(
  questions: readonly QuestionDescriptor[],
  answers: Readonly<Record<string, string>>,
): boolean {
  return questions
    .filter((question) => question.required !== false)
    .every((question) => Boolean(answers[question.question]?.trim()));
}
