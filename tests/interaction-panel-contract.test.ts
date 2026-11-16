import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const panel = readFileSync(
  new URL("../src/components/interaction-panel.tsx", import.meta.url),
  "utf8",
);
const styles = readFileSync(
  new URL("../src/styles.css", import.meta.url),
  "utf8",
);

/**
 * The panel is presentational: every decision (which click means select or
 * deselect, whether a draft is an edit, whether submit is allowed) comes from
 * `interaction-panel-model.ts`, which the unit tests cover. Pinning the JSX
 * wiring keeps the rendering from drifting away from those tests — a panel
 * that ignores `readOnly` or renders a free-text answer without an edit path
 * would pass the model tests and still be wrong on screen.
 */
test("option cards announce their selected state and route both clicks", () => {
  assert.match(panel, /aria-pressed=\{active\}/);
  assert.match(panel, /disabled=\{readOnly\}/);
  assert.match(panel, /resolveOptionClick\(\{/);
  assert.match(panel, /onSelect\?\.\(question\.question, label\)/);
  assert.match(panel, /onDeselect\?\.\(question\.question, label\)/);
  assert.match(panel, /optionLabels\(question\)\.map/);
});

test("free text, edit, skip and cancel are all reachable", () => {
  assert.match(panel, /resolveTextAction\(freeText, draft\)/);
  assert.match(panel, /dispatchTextAction\(/);
  assert.match(panel, /onText\?\.\(question, action\.text\)/);
  assert.match(panel, /onEdit\?\.\(question, action\.previous, action\.next\)/);
  assert.match(panel, /editing === question\.question \|\| !freeText/);
  assert.match(panel, /question\.required === false/);
  assert.match(panel, /onSkip\?\.\(question\.question\)/);
  assert.match(panel, /onClick=\{onCancel\}/);
});

test("submit is blocked while a POST is in flight and while required answers are missing", () => {
  assert.match(panel, /disabled=\{readOnly \|\| pending \|\| !submittable\}/);
  assert.match(panel, /interaction-panel__pending/);
  assert.match(panel, /role="status"/);
  assert.match(panel, /disabled=\{readOnly \|\| pending\}/);
});

test("a closed panel renders only the result and marks the device that answered", () => {
  assert.match(panel, /status === "open" \?/);
  assert.match(panel, /interactionPanelStatus\(result\)/);
  assert.match(panel, /isInteractionPanelReadOnly\(status, lockedBy, deviceId\)/);
  assert.match(panel, /data-status=\{status\}/);
  assert.match(panel, /answered on \{lockedBy\}/);
  assert.match(panel, /result\?\.answers \?\? \{\}/);
  assert.match(panel, /Object\.entries\(answers\)\.map/);
});

test("the panel styles cover the pressed option and the pending state", () => {
  assert.match(styles, /\.interaction-panel \{/);
  assert.match(styles, /\.interaction-panel__option\[aria-pressed="true"\] \{/);
  assert.match(styles, /\.interaction-panel__option:hover:not\(:disabled\) \{/);
  assert.match(styles, /\.interaction-panel__pending \{/);
  assert.match(styles, /\.interaction-panel__result li \{/);
  assert.match(
    styles,
    /\.interaction-panel\[data-status="timeout"\] \.interaction-panel__status/,
  );
});
