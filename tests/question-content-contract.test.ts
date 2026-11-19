import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const surface = readFileSync(
  new URL("../src/components/question-content.tsx", import.meta.url),
  "utf8",
);
const styles = readFileSync(
  new URL("../src/styles.css", import.meta.url),
  "utf8",
);
const app = readFileSync(new URL("../src/app.tsx", import.meta.url), "utf8");

/**
 * The preview / code pair is one surface with one toolbar. These checks keep
 * the merged layout from drifting back into a preview plus a second answer box
 * with its own header, mode switch and fold button.
 */
test("one toolbar drives view and placement, with no fold button", () => {
  assert.equal(
    surface.match(/<QuestionPanelModeControl/g)?.length,
    1,
    "the surface must mount the placement control once",
  );
  assert.match(surface, /aria-label="User question view"/);
  // The question itself must never be foldable, so the surface carries no
  // collapse button — the toolbar is only the view switch plus placement.
  assert.doesNotMatch(surface, /prompt-input__collapse/);
  assert.doesNotMatch(surface, /展开问题内容/);
  // The old answer box carried its own header; the surface owns both halves now.
  assert.doesNotMatch(surface, /QUESTION · 作答/);
  assert.doesNotMatch(app, /QuestionAnswerForm/);
});

test("code shows the payload only — no options, no answer bar", () => {
  const codeBranch = surface.slice(
    surface.indexOf('viewMode === "code"'),
    surface.indexOf('<div className="question-surface">'),
  );
  assert.match(codeBranch, /JsonViewer/);
  assert.doesNotMatch(codeBranch, /question-options/);
  assert.doesNotMatch(codeBranch, /question-surface__footer/);
});

test("options and the pinned submit bar belong to the preview only", () => {
  assert.match(surface, /question-surface__footer/);
  assert.match(surface, /disabled=\{disabled \|\| !submittable\}/);
  assert.match(surface, /onClick=\{answer\.onCancel\}/);
  assert.match(surface, /onClick=\{\(\) => answer\.onSend\(answers\)\}/);
  assert.match(surface, /\{live && answer \? \(/);
});

test("Preview / Code is controlled so the dock and Input tab cannot drift", () => {
  // The dock and Input tab stay mounted together; a local useState per
  // instance would show different views after a placement switch.
  assert.doesNotMatch(surface, /useState<QuestionViewMode>/);
  assert.match(surface, /viewMode: QuestionViewMode;/);
  assert.match(surface, /onViewModeChange: \(mode: QuestionViewMode\) => void;/);
  assert.match(surface, /onViewModeChange\(value as QuestionViewMode\)/);
  assert.match(app, /type QuestionViewMode/);
  assert.match(app, /viewMode=\{questionViewMode\}/);
  assert.match(app, /onViewModeChange=\{handleQuestionViewModeChange\}/);
});

test("both surfaces use the same Submit / Cancel wording and order", () => {
  assert.match(
    surface,
    /<Send aria-hidden="true" data-icon="inline-start" \/>\s*Submit/,
  );
  assert.match(
    surface,
    /<X aria-hidden="true" data-icon="inline-start" \/>\s*Cancel/,
  );
  assert.doesNotMatch(surface, /一次性提交|提交发送|一次提交/);
  const footer = surface.slice(
    surface.indexOf('<footer className="question-surface__footer">'),
  );
  assert.ok(
    footer.indexOf("Submit") < footer.indexOf("Cancel"),
    "Submit precedes Cancel on both surfaces",
  );
});

test("the dock adds no border and the two slots stay mounted across a mode switch", () => {
  const dock = styles.match(/\.inspector-question-dock \{([^}]*)\}/)?.[1] ?? "";
  // The tab list already carries a constant border-bottom in both placements;
  // a dock-only border shifted the whole surface by a pixel on every toggle.
  assert.doesNotMatch(dock, /border-top/);
  assert.match(
    styles,
    /\.inspector-question-dock\[hidden\],\s*\.inspector-question-stack\[hidden\] \{[\s\S]*?display: none/,
  );
  assert.match(
    app,
    /inspector-question-stack[\s\S]*?hidden=\{dockedQuestion \? true : undefined\}/,
  );
  assert.match(
    app,
    /inspector-question-dock[\s\S]*?hidden=\{dockedQuestion \? undefined : true\}/,
  );
});

test("the pinned answer bar stays reachable on a narrow viewport", () => {
  const narrow = styles
    .split("@media (max-width: 620px)")
    .filter((chunk) => chunk.includes(".question-surface__footer {"))
    .at(-1);
  assert.ok(narrow, "the narrow-viewport rule exists");
  assert.match(narrow, /\.question-surface__footer \{[\s\S]*?flex-wrap:\s*wrap/);
  assert.match(narrow, /\.question-surface__meta \{[\s\S]*?flex:\s*1 1 100%/);
  assert.match(narrow, /\.question-surface__actions \{[\s\S]*?margin-left:\s*0/);
});

test("a closed question keeps the same chips without controls", () => {
  assert.match(surface, /question-options__option is-static/);
  assert.match(surface, /disabled=\{disabled\}/);
  assert.match(styles, /\.question-options__option\.is-static \{/);
  assert.match(styles, /\.question-options__option:disabled \{/);
});

test("the submit bar is a sibling of the scroll area, not part of it", () => {
  const body = styles.match(/\.question-surface__body \{([^}]*)\}/)?.[1] ?? "";
  const footer = styles.match(/\.question-surface__footer \{([^}]*)\}/)?.[1] ?? "";
  assert.match(body, /overflow-y:\s*auto/);
  assert.match(footer, /flex:\s*0 0 auto/);
  assert.match(footer, /border-top:/);
});

test("the dock hands its whole height to the merged surface", () => {
  const dock = styles.match(/\.inspector-question-dock > \.prompt-input \{([^}]*)\}/)?.[1] ?? "";
  assert.match(dock, /flex:\s*1 1 auto/);
  assert.doesNotMatch(dock, /max-height:\s*45%/);
  assert.doesNotMatch(styles, /\.question-answer \{/);
});
