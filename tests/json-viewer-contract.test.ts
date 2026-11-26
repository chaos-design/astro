import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const jsonViewer = read("src/components/json-viewer.tsx");
const styles = read("src/styles.css");

/**
 * Every JSON tree row reserves the collapse toggle's gutter. Without the
 * spacer a leaf line sits 22px left of its own container, so nesting visibly
 * loses an indent level (the "缩进错位" a long payload read as). The spacer
 * must stay a *rendered* node, not a CSS-only margin, or the gutter collapses
 * whenever a row has no toggle.
 */
test("rows without a toggle keep the toggle gutter via a hidden spacer", () => {
  assert.match(
    jsonViewer,
    /className="json-line__toggle json-line__toggle--spacer"/,
    "non-container rows render the spacer",
  );
  assert.doesNotMatch(
    jsonViewer,
    /: null\}\s*<div className="json-line__tokens"/,
    "the no-toggle branch must not fall back to an empty gutter",
  );
  assert.match(
    styles,
    /\.json-line__toggle--spacer\s*\{\s*visibility:\s*hidden;?/,
    "the spacer keeps the 16px + gap footprint but stays inert",
  );
});

/**
 * The inspector's Raw / Input / Output tab gives the JSON tree a definite
 * height (the detail grid row), so the tree owns its own scrollbar there.
 * The global overlay deliberately does not: its window scroll region stays in
 * charge, and the prompt / question drawers keep their per-drawer scroll.
 */
test("the inspector json tab scrolls on its own rows", () => {
  const block = styles.match(
    /\.inspector-tabs__content--json \.json-viewer__rows\s*\{[^}]*\}/,
  );
  assert.ok(block, "the inspector rows rule exists");
  assert.match(block[0], /height:\s*100%/);
  assert.match(block[0], /overflow:\s*auto/);
  assert.match(
    styles,
    /\.inspector-tabs__content--json \.json-viewer\s*\{\s*height:\s*100%;?\s*\}/,
  );
});

test("the drawer scroll regions keep their own rules", () => {
  assert.match(styles, /\.prompt-input__code \.json-viewer__rows/);
  assert.match(styles, /\.question-surface \.json-viewer__rows/);
});
