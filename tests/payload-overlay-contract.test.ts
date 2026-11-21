import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const overlay = readFileSync(
  new URL("../src/components/payload-overlay.tsx", import.meta.url),
  "utf8",
);
const app = readFileSync(new URL("../src/app.tsx", import.meta.url), "utf8");
const stylesForOverlay = readFileSync(
  new URL("../src/styles.css", import.meta.url),
  "utf8",
);
const bindingForOverlay = app.slice(
  app.indexOf("const overlayAtoms"),
  app.indexOf(");", app.indexOf("const overlayAtoms")),
);

/**
 * The global layer follows the atom's type: a user.question Input tab shows
 * the question / option / answer list the reader saw, while every other tab
 * reads as Markdown. Both must keep using one preview definition each.
 */
test("the overlay switches preview by atom type", () => {
  assert.match(overlay, /variant === "question"/);
  assert.match(overlay, /<QuestionPreview payload=\{activePayload as TracePayload\} \/>/);
  assert.match(overlay, /USER QUESTION/);
  assert.match(overlay, /dangerouslySetInnerHTML=\{\{ __html: preview\.contentHtml \}\}/);
});

test("the preview splits the atom's content from its related data", () => {
  assert.match(overlay, /splitPayloadPreview/);
  assert.match(overlay, /contentToMarkdown/);
  assert.match(overlay, /payload-overlay__pane--content/);
  assert.match(overlay, /payload-overlay__pane--related/);
  assert.match(overlay, /payload-overlay__fields/);
  assert.match(stylesForOverlay, /\.payload-overlay__preview-grid/);
  assert.match(stylesForOverlay, /\.payload-overlay__field\.is-annotation/);
});

test("prepared previews are cached per atom so rail switches are instant", () => {
  assert.match(overlay, /useRef<Map<string, PreparedPreview>>/);
  assert.match(overlay, /cache\.get\(atomId\)/);
  assert.match(overlay, /cache\.set\(atomId, prepared\)/);
  assert.match(overlay, /payloadForAtom/);
  assert.match(overlay, /variantForAtom/);
});

test("the global overlay keeps both Preview and the raw JSON Code view", () => {
  assert.match(overlay, /<JsonViewer value=\{activePayload\} \/>/);
  assert.match(overlay, /Code2/);
  assert.match(overlay, /ToggleGroup/);
  assert.match(overlay, /viewMode/);
  assert.match(overlay, /value="preview"/);
  assert.match(overlay, /value="code"/);
  // The rendered content leads; Code is the raw form one toggle away.
  assert.ok(overlay.indexOf("viewMode === \"preview\"") < overlay.indexOf("payload-overlay__body--code"));
  assert.match(overlay, /切到 Code 查看原始载荷/);
});

test("an answers-only question falls back to the markdown answer preview", () => {
  assert.match(overlay, /parseUserQuestionContent/);
  assert.match(overlay, /showQuestion \?/);
  assert.match(
    overlay,
    /question\.prompts\.length \|\| question\.message\.trim\(\) \|\| question\.plan\.trim\(\)/,
  );
});

test("the inspector passes the raw question payload for question atoms", () => {
  const binding = app.slice(
    app.indexOf("<PayloadOverlay"),
    app.indexOf("</section>", app.indexOf("<PayloadOverlay")),
  );
  assert.match(
    binding,
    /activeTab === "input" && questionEvent\s*\? questionEvent\.payload/,
  );
  assert.match(
    binding,
    /variant=\{activeTab === "input" && questionEvent \? "question" : "default"\}/,
  );
});

test("the inspector passes the raw prompt payload so the overlay previews its content", () => {
  const binding = app.slice(
    app.indexOf("<PayloadOverlay"),
    app.indexOf("</section>", app.indexOf("<PayloadOverlay")),
  );
  assert.match(
    binding,
    /activeTab === "input" && promptEvent\s*\? promptEvent\.payload/,
  );
});

/**
 * The left rail lists every atom of the current run and is a view of the single
 * console selection — picking a row calls `onSelectAtom` instead of growing a
 * second, overlay-local selection that could drift from the canvas / LOG.
 */
test("the overlay renders a run-atom rail that commits through onSelectAtom", () => {
  assert.match(overlay, /orderedAtoms\.map\(/);
  assert.match(overlay, /payload-overlay__rail/);
  assert.match(overlay, /onClick=\{\(\) => onSelectAtom\(atom\.id\)\}/);
  assert.match(overlay, /aria-current=\{selected \? "true" : undefined\}/);
  assert.match(overlay, /const selected = atom\.id === selectedAtomId/);
  assert.match(overlay, /atoms\.length > 0 \?/);
});

test("the overlay rail reads like the LOG row and lists atoms newest first", () => {
  // Reverse display order: the first-executed atom sits at the bottom while
  // its `index` badge still reports the pipeline position.
  assert.match(overlay, /\[\.\.\.atoms\]\.reverse\(\)/);
  assert.match(overlay, /atom\.sequence \?\? `#\$\{String\(atom\.index\)\.padStart\(3, "0"\)\}`/);
  assert.match(bindingForOverlay, /formatLogSequence\(node\.data\.index \+ 1\)/);
  // The rail is a LOG row, not a second row imitation: same grid, TYPE badge,
  // time and action/summary line, with only narrow-rail column overrides.
  assert.match(overlay, /"atomic-log__row payload-overlay__atom"/);
  assert.match(overlay, /className="log-sequence"/);
  assert.match(overlay, /className="atomic-log__name"/);
  assert.match(overlay, /className="atomic-log__key"/);
  assert.match(overlay, /<time dateTime=\{atom\.timestamp\}/);
  assert.match(overlay, /className="atomic-log__summary"/);
  assert.match(stylesForOverlay, /\.payload-overlay__rail \.atomic-log__row \{/);
  assert.match(overlay, /payload-overlay__atom-type/);
  assert.match(overlay, /`tone-\$\{atom\.tone \|\| "unknown"\}`/);
  assert.match(overlay, /payload-overlay__atom-count/);
  assert.match(overlay, /handleAtomKeyDown/);
  assert.match(stylesForOverlay, /\.payload-overlay__atom\.tone-tool \{[\s\S]*?--log-tone: var\(--amber\)/);
  assert.match(bindingForOverlay, /atomTypeLabel\(node\.data\.key, node\.data\.kind\)/);
  assert.match(bindingForOverlay, /tone: node\.data\.meta\.tone/);
});

test("the rail separates highlighted rows so adjacent highlights do not touch", () => {
  assert.match(
    stylesForOverlay,
    /\.payload-overlay__atom-list \{[\s\S]*?display: flex;[\s\S]*?flex-direction: column;[\s\S]*?gap: 10px;/,
  );
});

test("the inspector threads the atom list and selection handler into the overlay", () => {
  const binding = app.slice(
    app.indexOf("<PayloadOverlay"),
    app.indexOf("</section>", app.indexOf("<PayloadOverlay")),
  );
  assert.match(binding, /atoms=\{overlayAtoms\}/);
  assert.match(binding, /selectedAtomId=\{overlaySelectedAtomId\}/);
  assert.match(binding, /onSelectAtom=\{onOverlaySelectAtom\}/);
});

test("the overlay rail and the canvas share one atom-selection commit point", () => {
  assert.match(app, /const commitAtomSelection = useCallback\(/);
  assert.match(app, /handleCanvasSelectNode[\s\S]*commitAtomSelection\(node, selectedAtomId === node\.id\)/);
  assert.match(app, /handleOverlaySelectAtom[\s\S]*commitAtomSelection\(node, false\)/);
  // The rail data comes from the same harness topology the canvas projects.
  assert.match(app, /harnessFlow\.nodes\.map\(/);
});
