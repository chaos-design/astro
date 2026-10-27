import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const styles = readFileSync(
  new URL("../src/styles.css", import.meta.url),
  "utf8",
);

function cssRule(selector: string): string {
  const marker = `${selector} {`;
  const selectorStart = styles.indexOf(marker);
  assert.notEqual(selectorStart, -1, `Missing CSS selector: ${selector}`);
  const bodyStart = styles.indexOf("{", selectorStart);
  const bodyEnd = styles.indexOf("}", bodyStart);
  return styles.slice(bodyStart + 1, bodyEnd);
}

/**
 * RUN HISTORY has to make the executing message identifiable without
 * scrolling, so the live affordances are pinned by contract rather than by
 * eyeballing the panel.
 */
test("marks a live run row with an accent edge and no selection override", () => {
  const live = cssRule(".run-history__row.is-live:not(.is-selected)");

  assert.match(live, /box-shadow:\s*inset 2px 0 var\(--status-running\)/);
  assert.match(live, /border-color:\s*color-mix\(in srgb, var\(--status-running\)/);
  // A live row never hides underneath an explicit selection.
  assert.match(
    styles,
    /\.run-history__row\.is-live:not\(\.is-selected\)/,
    "live styling must defer to the selected row",
  );
});

test("keeps a waiting run visually distinct from an executing one", () => {
  const waiting = cssRule(
    '.run-history__row.is-live[data-live-status="waiting"]:not(.is-selected)',
  );

  assert.match(waiting, /var\(--status-waiting\)/);
  assert.doesNotMatch(waiting, /--status-running/);
});

test("labels live rows with a pulsing RUNNING / WAITING capsule", () => {
  const tag = cssRule(".run-history__tags > .run-history__live-tag");

  assert.match(tag, /var\(--status-running\)/);
  assert.match(tag, /font-weight:\s*700/);
  assert.match(
    cssRule(".run-history__live-pulse"),
    /animation:\s*run-history-live-pulse/,
  );
  assert.match(styles, /@keyframes run-history-live-pulse \{/);
});

test("offers a header chip that jumps to the executing run", () => {
  const chip = cssRule(".run-history__live-jump");

  assert.match(chip, /display:\s*inline-flex/);
  assert.match(chip, /cursor:\s*pointer/);
  assert.match(
    cssRule(".run-history__live-jump > svg"),
    /animation:\s*active-status-icon-breathe/,
  );
});

test("marks the armed live filter on the same chip", () => {
  const filtering = cssRule(".run-history__live-jump.is-filtering");

  // The armed toggle must read clearly different from the resting chip:
  // a solid status border instead of the translucent one.
  assert.match(
    filtering,
    /border-color:\s*var\(--status-running\)/,
  );
});
