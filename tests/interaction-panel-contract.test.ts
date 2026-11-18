import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const panel = readFileSync(
  new URL("../src/components/interaction-panel.tsx", import.meta.url),
  "utf8",
);
const resultList = readFileSync(
  new URL("../src/components/question-result.tsx", import.meta.url),
  "utf8",
);
const styles = readFileSync(
  new URL("../src/styles.css", import.meta.url),
  "utf8",
);

/**
 * The panel collects every answer locally and sends one batch. These source
 * checks keep the rendered card from drifting back to per-click events or a
 * free-text Set button, which would make a multi-question AskUserQuestion look
 * like several independent submissions.
 */
test("option cards announce their selected state and toggle local drafts", () => {
  assert.match(panel, /aria-pressed=\{pressed\}/);
  assert.match(panel, /disabled=\{readOnly \|\| pending\}/);
  assert.match(panel, /resolveOptionClick\(\{/);
  assert.match(panel, /setDraftSelections\(\(previous\) =>/);
  assert.match(panel, /optionLabels\(question\)\.map/);
});

test("typed answers are part of the one Submit with no Set step", () => {
  assert.match(panel, /buildQuestionAnswers\(\{/);
  assert.match(panel, /onSend\?\.\(answerMap\)/);
  assert.match(panel, /Answer for \$\{question\.question\}/);
  assert.doesNotMatch(panel, /resolveTextAction/);
  assert.doesNotMatch(panel, />Set</);
  assert.match(panel, /onCancel\?\.\(\)/);
});

test("submit is blocked while a POST is in flight and while required answers are missing", () => {
  assert.match(panel, /questionPanelSubmittable\(request\.questions, answerMap\)/);
  assert.match(panel, /disabled=\{readOnly \|\| pending \|\| !submittable\}/);
  assert.match(panel, /interaction-panel__pending/);
  assert.match(panel, /role="status"/);
});

test("a closed panel renders only the result and marks the device that answered", () => {
  assert.match(panel, /status === "open" \?/);
  assert.match(panel, /interactionPanelStatus\(result\)/);
  assert.match(panel, /isInteractionPanelReadOnly\(status, lockedBy, deviceId\)/);
  assert.match(panel, /data-status=\{status\}/);
  assert.match(panel, /answered on \{lockedBy\}/);
  // The result block is shared with the docked surface.
  assert.match(resultList, /result\?\.answers \?\? \{\}/);
  assert.match(resultList, /Object\.entries\(answers\)\.map/);
});

test("the panel styles cover the pressed option and the pending state", () => {
  assert.match(styles, /\.interaction-panel \{/);
  assert.match(styles, /\.interaction-panel__option\[aria-pressed="true"\] \{/);
  assert.match(styles, /\.interaction-panel__option:hover:not\(:disabled\) \{/);
  assert.match(styles, /\.interaction-panel__pending \{/);
  assert.match(styles, /\.question-result li \{/);
  assert.match(
    styles,
    /\.interaction-panel\[data-status="timeout"\] \.interaction-panel__status/,
  );
});

test("the card collapses and both question and footer sections fold", () => {
  assert.match(panel, /interaction-panel__toggle/);
  assert.match(panel, /aria-expanded=\{!collapsed\}/);
  assert.match(panel, /interaction-panel__summary/);
  assert.match(panel, /interaction-panel__body/);
  assert.match(panel, /questionsFolded \? null :/);
  assert.match(panel, /keyboard && !footerFolded/);
  assert.match(styles, /\.interaction-panel\.is-collapsed \.interaction-panel__body \{/);
  assert.match(styles, /@keyframes interaction-panel-enter/);
  assert.match(styles, /\.interaction-panel--settling \{/);
  assert.match(
    styles,
    /\.interaction-panel--floating \.interaction-panel__questions \{/,
  );
});

test("the card is only the floating placement and caps its scroll range", () => {
  assert.match(panel, /QuestionPanelModeControl/);
  assert.match(panel, /data-mode=\{mode\}/);
  // The card renders only for `float`; the two dock layouts live in the
  // inspector, so no per-mode card geometry may come back.
  assert.doesNotMatch(styles, /\.interaction-panel--floating\[data-mode=/);
  assert.match(
    styles,
    /\.interaction-panel--floating \.interaction-panel__questions \{[\s\S]*?max-height: var\(--question-scroll-max/,
  );
  assert.match(styles, /\.question-mode-control__button\[aria-pressed="true"\] \{/);
});

test("keyboard flow stays on the card and cannot bypass the button guards", () => {
  assert.match(panel, /keyboard\?: boolean/);
  assert.match(panel, /onKeyDown=\{handleKeyDown\}/);
  assert.match(panel, /resolvePanelKey\(\{/);
  assert.match(panel, /readOnly,\s*\}/);
  assert.match(panel, /submittable && !pending/);
  assert.match(panel, /optionsRef\.current \|\| panelRef\.current/);
  assert.match(panel, /interaction-panel__keys/);
  assert.match(panel, /target\.isContentEditable/);
  assert.match(panel, /\["TEXTAREA", "SELECT"\]/);
});

test("the countdown is a CSS animation driven by the host's timestamps", () => {
  assert.match(panel, /interaction-panel__countdown/);
  assert.match(panel, /animationDuration: `\$\{request\.ttlMs\}ms`/);
  assert.match(panel, /Date\.now\(\) - created/);
  assert.match(styles, /@keyframes interaction-panel-countdown/);
  assert.match(
    styles,
    /prefers-reduced-motion: reduce[\s\S]*?interaction-panel__countdown/,
  );
});

test("chime previews reuse the settings option cards with status colours", () => {
  const settings = readFileSync(
    new URL("../src/components/settings-dialog.tsx", import.meta.url),
    "utf8",
  );
  assert.match(settings, /chimePreviewOptions\.map/);
  assert.match(settings, /settings-option settings-chime-option/);
  assert.match(settings, /playTaskCompletionChime\(option\.status, chimeStyle\)/);
  assert.match(styles, /\.settings-chime-preview \{[\s\S]*?grid-template-columns/);
  assert.match(styles, /\.settings-chime-option--complete > svg:first-child/);
  assert.match(styles, /\.settings-chime-option--failed > svg:first-child/);
  assert.match(styles, /\.settings-chime-option--terminated > svg:first-child/);
});
