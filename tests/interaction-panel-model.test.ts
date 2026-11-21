import assert from "node:assert/strict";
import test from "node:test";

import {
  buildInteractionRequest,
  buildInteractionResult,
  type QuestionDescriptor,
} from "../src/lib/interaction-contract.ts";
import {
  interactionPanelStatus,
  interactionTimeLeft,
  isInteractionPanelReadOnly,
  isInteractionPanelSubmittable,
  optionDescription,
  optionLabels,
  resolveOptionClick,
  resolvePanelKey,
  resolveTextAction,
  resultAnswerRows,
} from "../src/lib/interaction-panel-model.ts";
import { parseUserQuestionContent } from "../src/lib/user-question-content.ts";

const NOW = Date.UTC(2026, 10, 15, 10, 0, 0);

const question: QuestionDescriptor = {
  question: "Which framework?",
  header: "Framework",
  options: [
    { label: "React", description: "Component model" },
    { label: "Vue" },
  ],
};

function request(questions: QuestionDescriptor[] = [question]) {
  return buildInteractionRequest(
    {
      hookEventName: "PermissionRequest",
      toolName: "AskUserQuestion",
      toolUseId: "call-1",
      sessionId: "sess-1",
      source: "claude",
      questions,
    },
    { now: NOW, timeoutMs: 5000 },
  );
}

test("option labels flatten strings and objects without losing descriptions", () => {
  assert.deepEqual(optionLabels(question), ["React", "Vue"]);
  assert.equal(optionDescription(question, "React"), "Component model");
  assert.equal(
    optionDescription(question, "Vue"),
    "",
    "a label without a description renders nothing extra",
  );
  assert.equal(optionDescription(question, "Svelte"), "");
  assert.deepEqual(
    optionLabels({ ...question, options: ["Alpha", { label: "Beta" }] }),
    ["Alpha", "Beta"],
  );
});

test("status defaults to open and follows the result", () => {
  const req = request();
  assert.equal(interactionPanelStatus(null), "open");
  assert.equal(
    interactionPanelStatus(
      buildInteractionResult(req, "timeout", {}, { now: NOW + 500 }),
    ),
    "timeout",
  );
  assert.equal(
    interactionPanelStatus(
      buildInteractionResult(req, "expired", {}, { now: NOW + 500 }),
    ),
    "expired",
  );
});

test("a closed result or another device makes the panel read-only", () => {
  assert.equal(isInteractionPanelReadOnly("open", null), false);
  assert.equal(isInteractionPanelReadOnly("open", "console"), false);
  assert.equal(
    isInteractionPanelReadOnly("open", "laptop"),
    true,
    "a second device must not rewrite the first answer",
  );
  for (const status of ["answered", "cancelled", "timeout", "expired"] as const) {
    assert.equal(isInteractionPanelReadOnly(status, null), true);
  }
});

test("a chosen option de-selects only in a multi-select question", () => {
  assert.equal(
    resolveOptionClick({ active: true, multiSelect: true, readOnly: false }),
    "deselect",
  );
  assert.equal(
    resolveOptionClick({ active: true, multiSelect: false, readOnly: false }),
    "select",
    "a single-select card never clears itself",
  );
  assert.equal(
    resolveOptionClick({ active: false, multiSelect: true, readOnly: false }),
    "select",
  );
  assert.equal(
    resolveOptionClick({ active: false, multiSelect: false, readOnly: true }),
    "none",
  );
});

test("free text becomes text once and edit when it replaces an answer", () => {
  assert.deepEqual(resolveTextAction(undefined, "   "), { action: "none" });
  assert.deepEqual(resolveTextAction(undefined, " Svelte "), {
    action: "text",
    text: "Svelte",
  });
  assert.deepEqual(resolveTextAction("Svelte", "Svelte"), { action: "none" });
  assert.deepEqual(resolveTextAction("Svelte", "Solid"), {
    action: "edit",
    previous: "Svelte",
    next: "Solid",
  });
});

test("submit needs every required question and ignores optional ones", () => {
  const questions = [
    question,
    { ...question, question: "Deploy target?", required: false },
  ];
  assert.equal(isInteractionPanelSubmittable(questions, {}), false);
  assert.equal(
    isInteractionPanelSubmittable(questions, { "Which framework?": ["React"] }),
    true,
  );
  assert.equal(
    isInteractionPanelSubmittable(
      [{ ...question, required: false }],
      {},
    ),
    true,
  );
});

test("number keys pick an option, Enter submits, Escape cancels", () => {
  const questions = [
    question,
    { ...question, question: "Deploy target?", options: ["Edge", "Lambda"] },
  ];
  assert.deepEqual(resolvePanelKey({ key: "1", questions, readOnly: false }), {
    action: "option",
    question: 0,
    option: 0,
  });
  assert.deepEqual(resolvePanelKey({ key: "2", questions, readOnly: false }), {
    action: "option",
    question: 0,
    option: 1,
  });
  assert.deepEqual(resolvePanelKey({ key: "Enter", questions, readOnly: false }), {
    action: "submit",
  });
  assert.deepEqual(resolvePanelKey({ key: "Escape", questions, readOnly: false }), {
    action: "cancel",
  });
});

test("read-only and out-of-range keys never answer a question", () => {
  for (const key of ["1", "Enter", "Escape"]) {
    assert.deepEqual(resolvePanelKey({ key, questions: [question], readOnly: true }), {
      action: "none",
    });
  }
  assert.deepEqual(resolvePanelKey({ key: "9", questions: [question], readOnly: false }), {
    action: "none",
  });
  assert.deepEqual(resolvePanelKey({ key: "a", questions: [question], readOnly: false }), {
    action: "none",
  });
});

test("the countdown drains to zero without wrapping past the deadline", () => {
  const req = request();
  assert.equal(interactionTimeLeft(req, NOW), 1);
  assert.equal(interactionTimeLeft(req, NOW + 2250), 0.5);
  assert.equal(interactionTimeLeft(req, NOW + 5000), 0);
  assert.equal(interactionTimeLeft(req, NOW + 9000), 0);
  assert.equal(
    interactionTimeLeft({ ...req, expiresAt: "not-a-date" }, NOW),
    1,
  );
});

test("closed answer rows follow the request order and drop empty answers", () => {
  const questions = [
    question,
    { ...question, question: "Deploy target?", header: "Target" },
  ];
  const req = request(questions);
  const result = buildInteractionResult(
    req,
    "answered",
    { "Deploy target?": "Edge", "Which framework?": "React, Vue" },
    { now: NOW + 500 },
  );
  const rows = resultAnswerRows(req, result);
  assert.deepEqual(rows, [
    { question: "Which framework?", answer: "React, Vue" },
    { question: "Deploy target?", answer: "Edge" },
  ]);
  assert.deepEqual(resultAnswerRows(req, null), []);
});

test("the closed panel reads the same answers the run log previews", () => {
  // The panel's result rows and the inspector's Answers section are two views
  // of one map; the host injects the same keys into tool_input.answers.
  const req = request();
  const result = buildInteractionResult(
    req,
    "answered",
    { "Which framework?": "React, Vue" },
    { now: NOW + 500 },
  );
  const content = parseUserQuestionContent({
    tool_input: {
      questions: req.questions,
      answers: result.answers,
    },
  } as never);
  assert.deepEqual(content.answers, resultAnswerRows(req, result));
});
