import assert from "node:assert/strict";
import test from "node:test";

import {
  buildQuestionAnswer,
  buildQuestionAnswers,
  normalizeQuestionPanelMode,
  questionPanelSubmittable,
  questionPanelModes,
} from "../src/lib/question-panel-model.ts";
import type { QuestionDescriptor } from "../src/lib/interaction-contract.ts";

const questions: QuestionDescriptor[] = [
  {
    question: "Which one?",
    options: [{ label: "A" }, { label: "B" }],
  },
  {
    question: "Pick several?",
    multiSelect: true,
    options: [{ label: "X" }, { label: "Y" }, { label: "Z" }],
  },
];

test("the three question panel modes normalize to a known value", () => {
  assert.deepEqual(questionPanelModes, ["half", "bottom", "side"]);
  assert.equal(normalizeQuestionPanelMode("bottom"), "bottom");
  assert.equal(normalizeQuestionPanelMode("side"), "side");
  assert.equal(normalizeQuestionPanelMode(""), "half");
});

test("free text wins over clicked labels at submit time", () => {
  assert.equal(
    buildQuestionAnswer(questions[0], ["A"], "  typed answer  "),
    "typed answer",
  );
  assert.equal(buildQuestionAnswer(questions[0], ["B"], ""), "B");
});

test("multi-select answers keep declaration order regardless of click order", () => {
  const answer = buildQuestionAnswer(questions[1], ["Z", "X"], "");
  assert.equal(answer, "X, Z");
});

test("every question is collected into one answer map", () => {
  const answers = buildQuestionAnswers({
    questions,
    selections: { "Which one?": ["A"], "Pick several?": ["Z", "X"] },
    drafts: { "Pick several?": "custom value" },
  });
  assert.deepEqual(answers, {
    "Which one?": "A",
    "Pick several?": "custom value",
  });
  assert.equal(questionPanelSubmittable(questions, answers), true);
});

test("a missing required answer blocks the one submit", () => {
  assert.equal(questionPanelSubmittable(questions, { "Which one?": "A" }), false);
  assert.equal(
    questionPanelSubmittable(
      [{ ...questions[0], required: false }],
      {},
    ),
    true,
  );
});
