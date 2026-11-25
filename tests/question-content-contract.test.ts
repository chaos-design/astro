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
const settings = readFileSync(
  new URL("../src/components/settings-dialog.tsx", import.meta.url),
  "utf8",
);

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

test("settings edits the stored preference, not the state-resolved placement", () => {
  // Passing the resolved mode would hide the "follow state" option behind a
  // concrete placement and make the restore-default state unreachable.
  assert.match(app, /parseQuestionPanelMode\(\s*questionPanelPreference/);
  assert.match(app, /questionPanelMode=\{questionPanelPreferenceMode\}/);
  assert.match(settings, /questionPanelMode: QuestionPanelMode \| null;/);
  assert.match(settings, /questionPanelMode === null/);
  assert.match(settings, /value=\{questionPanelMode \?\? "auto"\}/);
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
  // The batch hint legitimately says "N 个问题 · 一次提交"; only the old
  // misleading "one-shot send" wording is gone.
  assert.doesNotMatch(surface, /一次性提交|提交发送/);
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
  // Static chips keep the same look but are spans, and a captured answer now
  // highlights its selected options via `is-selected` instead of losing them.
  assert.match(surface, /"is-static"/);
  assert.match(surface, /chosen && "is-selected"/);
  assert.match(surface, /matchAnswerOptions\(answer \?\? "", prompt\.options\)/);
  assert.match(surface, /disabled=\{disabled\}/);
  assert.match(styles, /\.question-options__option\.is-static \{/);
  assert.match(styles, /\.question-options__option:disabled \{/);
});

test("the batch hint sits above the list and the footer is a Submit / Cancel pair", () => {
  assert.ok(
    surface.indexOf("question-surface__summary") <
      surface.indexOf('<div className="question-surface">'),
    "the summary row must precede the scrolling question list",
  );
  assert.ok(
    surface.indexOf('className="question-surface__summary"') <
      surface.indexOf("question-surface__body"),
  );
  assert.doesNotMatch(surface, /question-surface__meta/);
  assert.doesNotMatch(surface, /一次性提交|提交发送/);
  const footer = surface.slice(surface.indexOf("<footer"), surface.indexOf("</footer>"));
  assert.ok(footer.indexOf("Submit") < footer.indexOf("Cancel"));
  assert.match(footer, /disabled=\{disabled \|\| !submittable\}/);
});

test("the shared question preview is exported for the global overlay", () => {
  assert.match(surface, /export function QuestionPreview\(/);
  assert.match(surface, /<QuestionPreview payload=\{payload\} \/>/);
});

test("the read-only preview leads with a count and numbers each question", () => {
  assert.match(surface, /question-preview__head/);
  assert.match(surface, /question-preview__count/);
  assert.match(surface, /question-preview__list/);
  assert.match(surface, /question-preview__heading/);
  assert.match(surface, /question-preview__index/);
  assert.match(surface, /question-preview__state/);
  assert.match(surface, /question-preview__answers/);
  assert.match(surface, /selected\.length && "is-answered"/);
  assert.match(styles, /\.question-preview__head \{/);
  assert.match(styles, /\.question-preview__answers \{/);
  assert.match(styles, /\.question-surface__item\.is-answered \{/);
});

test("floating and docked question headings group title and badges on the left", () => {
  const floating = styles.match(
    /\.interaction-panel__question-heading \{([^}]*)\}/,
  )?.[1] ?? "";
  const docked = styles.match(/\.question-surface__heading \{([^}]*)\}/)?.[1] ?? "";
  assert.match(floating, /justify-content:\s*flex-start/);
  assert.doesNotMatch(floating, /space-between/);
  // Both placements state it explicitly so they cannot drift apart again.
  assert.match(docked, /justify-content:\s*flex-start/);
  assert.doesNotMatch(docked, /space-between/);
});

test("a captured answer gets a stronger selected chip in the preview", () => {
  assert.match(styles, /\.question-options__option\.is-static\.is-selected \{/);
  const matches = [
    ...styles.matchAll(
      /\.question-options__option\.is-static\.is-selected \{([^}]*)\}/g,
    ),
  ];
  const selected = matches.at(-1)?.[1] ?? "";
  assert.match(selected, /border-style:\s*solid/);
  assert.match(selected, /box-shadow:/);
  assert.match(selected, /var\(--teal\) 24%/);
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

/**
 * The floating card is a live answer affordance, not a history preview. Both
 * the floating render paths and the inspector binding must go through the
 * single `questionActionable` gate, so a finished or replayed run never floats
 * a card and its answer controls stay read-only.
 */
test("floating card and inspector answers are gated by the executing task", () => {
  assert.match(app, /questionActionable && activeInteraction && !questionDocked/);
  assert.match(app, /questionActionable &&\s+settlingInteraction &&\s+settlingMatchesView/);
  const binding = app.slice(
    app.indexOf("const questionBinding"),
    app.indexOf("const dockedQuestion"),
  );
  assert.match(binding, /readOnly:\s*!questionActionable \|\|/);
  // The gate must delegate to the one live-state definition rather than grow
  // a second list of executing statuses.
  const interaction = readFileSync(
    new URL("../src/lib/question-interaction.ts", import.meta.url),
    "utf8",
  );
  assert.match(interaction, /isQuestionActionable/);
  assert.match(interaction, /isPromptExecuting\(input\.status, input\.isDemo\)/);
});
