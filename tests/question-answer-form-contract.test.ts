import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const form = readFileSync(
  new URL("../src/components/question-answer-form.tsx", import.meta.url),
  "utf8",
);
const styles = readFileSync(
  new URL("../src/styles.css", import.meta.url),
  "utf8",
);

/**
 * The inspector answer box is presentational: the batch send logic lives in
 * `interaction-client.ts`. These checks pin the JSX wiring so a regression
 * cannot leave an AskUserQuestion with several descriptors rendered as one
 * input, or submit a single question when the host is waiting for all of them.
 */
test("every descriptor of the matched request is rendered", () => {
  assert.match(form, /questions\.map\(\(question\) =>/);
  assert.match(form, /key=\{question\.question\}/);
  assert.match(form, /normalizeQuestionOptions\(question\.options\)/);
  assert.match(form, /value=\{drafts\[question\.question\] \?\? ""\}/);
});

test("one submit carries all answers keyed by verbatim question text", () => {
  assert.match(form, /const answers: Record<string, string> = \{\}/);
  assert.match(form, /for \(const question of questions\)/);
  assert.match(form, /answers\[question\.question\] = value/);
  assert.match(form, /onSend\(answers\)/);
  assert.match(form, /missingRequired/);
  assert.match(form, /question\.required !== false/);
});

test("a lone question keeps one-click quick answers, a batch fills the row", () => {
  assert.match(form, /const onlyOne = questions\.length === 1/);
  assert.match(form, /if \(onlyOne\) \{[\s\S]*onSend\(\{ \[question\.question\]: label \}\)/);
  assert.match(form, /onDraftChange\(question\.question, label\)/);
});

test("busy and closed states disable every control", () => {
  assert.match(form, /const disabled = readOnly \|\| pending \|\| missingRequired/);
  assert.match(form, /disabled=\{readOnly \|\| pending\}/);
  assert.match(form, /disabled=\{disabled\}/);
  assert.match(form, /此提问已关闭或已在其他设备作答/);
});

test("the styles separate multiple questions and reserve a footer for submit", () => {
  assert.match(styles, /\.question-answer__item \{/);
  assert.match(styles, /\.question-answer__item \+ \.question-answer__item \{/);
  assert.match(styles, /\.question-answer__meta \{/);
  assert.match(styles, /\.question-answer__footer \{/);
});
