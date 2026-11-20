import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const overlay = readFileSync(
  new URL("../src/components/payload-overlay.tsx", import.meta.url),
  "utf8",
);
const app = readFileSync(new URL("../src/app.tsx", import.meta.url), "utf8");

/**
 * The global layer follows the atom's type: a user.question Input tab shows
 * the question / option / answer list the reader saw, while every other tab
 * reads as Markdown. Both must keep using one preview definition each.
 */
test("the overlay switches preview by atom type", () => {
  assert.match(overlay, /variant === "question"/);
  assert.match(overlay, /<QuestionPreview payload=\{payload as TracePayload\} \/>/);
  assert.match(overlay, /USER QUESTION/);
  assert.match(overlay, /dangerouslySetInnerHTML=\{\{ __html: preview\.html \}\}/);
});

test("the global overlay keeps both Preview and the raw JSON Code view", () => {
  assert.match(overlay, /<JsonViewer value=\{payload\} \/>/);
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
  assert.match(overlay, /atoms\.map\(/);
  assert.match(overlay, /payload-overlay__rail/);
  assert.match(overlay, /onClick=\{\(\) => onSelectAtom\(atom\.id\)\}/);
  assert.match(overlay, /aria-current=\{selected \? "true" : undefined\}/);
  assert.match(overlay, /const selected = atom\.id === selectedAtomId/);
  assert.match(overlay, /atoms\.length > 0 \?/);
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
