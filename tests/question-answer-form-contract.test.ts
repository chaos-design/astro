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

test("every option only fills the draft; one Submit sends the whole batch", () => {
  assert.doesNotMatch(form, /const onlyOne/);
  assert.match(form, /onClick=\{\(\) => toggleOption\(label\)\}/);
  assert.match(form, /const answers: Record<string, string> = \{\}/);
  assert.match(form, /onSend\(answers\)/);
  assert.match(form, /const value = drafts\[question\.question\]\?\.trim\(\) \|\| existing/);
});

test("both single and multi-select options stay highlighted from the draft", () => {
  assert.match(form, /const multi = question\.multiSelect === true/);
  assert.match(form, /aria-pressed=\{selectedTokens\.includes\(label\)\}/);
  assert.match(form, /const next = multi/);
  assert.match(form, /options\.filter\(\(option\) => next\.includes\(option\)\)\.join\(", "\)/);
});

test("the answer region folds and shares the three mode preference", () => {
  assert.match(form, /const \[collapsed, setCollapsed\] = useState\(false\)/);
  assert.match(form, /question-answer__collapse/);
  assert.match(form, /QuestionPanelModeControl/);
  assert.match(styles, /\.question-answer\.is-collapsed \{/);
  assert.match(styles, /\.inspector-question-stack\[data-mode="bottom"\]/);
  assert.match(styles, /\.inspector-question-stack\[data-mode="side"\]/);
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
  assert.match(
    styles,
    /\.question-answer__option\[aria-pressed="true"\] \{/,
  );
});

test("inspector width is bounded and long questions wrap inside a scrolling answer box", () => {
  const rule = (selector: string) => {
    const match = styles.match(new RegExp(`^\\${selector} \\{([^}]*)\\}`, "m"));
    assert.ok(match, `missing ${selector} rule`);
    return match![1];
  };
  assert.match(rule(".message-inspector"), /min-width:\s*0/);
  assert.match(rule(".question-answer"), /max-height:/);
  assert.match(rule(".question-answer"), /overflow-y:\s*auto/);
  const prompt = rule(".question-answer__prompt");
  assert.match(prompt, /white-space:\s*normal/);
  assert.match(prompt, /overflow-wrap:\s*anywhere/);
});
