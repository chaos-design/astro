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
  // The chip's Radio icon "breathes" via a dedicated keyframe that keeps the
  // running colour solid (and adds a glow), so the affordance stays clearly
  // visible — unlike the shared active-status-icon-breathe, which blends the
  // hue back to muted at the trough and nearly hides the icon.
  assert.match(
    cssRule(".run-history__live-jump > svg"),
    /animation:\s*run-history-live-breathe/,
  );
  assert.match(styles, /@keyframes run-history-live-breathe \{/);
});

test("marks the armed live filter on the same chip", () => {
  const filtering = cssRule(".run-history__live-jump.is-filtering");

  // The armed toggle must read clearly different from the resting chip:
  // a solid status fill (not translucent) plus a glowing ring, so the
  // on/off state is obvious at a glance on a dark panel.
  assert.match(filtering, /background:\s*var\(--status-running\)/);
  assert.match(
    filtering,
    /box-shadow:[\s\S]*color-mix\(in srgb, var\(--status-running\)/,
  );
});

test("keeps the chip in the header at zero live without pretending to run", () => {
  // `0 LIVE` uses the same control so the arm stays visible and operable;
  // only the running colour and the pulse drop away.
  const idle = cssRule(".run-history__live-jump.is-idle:not(.is-filtering)");

  assert.match(idle, /border-color:\s*var\(--line-bright\)/);
  assert.match(idle, /color:\s*var\(--muted\)/);
  // Same raised surface as the reload button: the two header controls read
  // as one cluster instead of a bare glyph next to a label.
  assert.match(idle, /background:[\s\S]*var\(--panel-raised\)/);
  assert.match(
    cssRule(".run-history__live-jump.is-idle:not(.is-filtering) > svg"),
    /animation:\s*none/,
  );
  // The armed fill must survive the idle variant: the filter is on, there is
  // simply nothing executing.
  assert.match(
    styles,
    /\.run-history__live-jump\.is-idle:not\(\.is-filtering\)/,
    "idle styling must defer to the armed chip",
  );
});

test("offers a manual reload control for stale loaded history", () => {
  const reload = cssRule(".run-history__reload");

  // The control is a compact header button, never a text label: the header
  // row is 48px and shares its edge with the `N LIVE` chip.
  assert.match(reload, /cursor:\s*pointer/);
  assert.match(reload, /border-radius:\s*999px/);
  assert.doesNotMatch(reload, /display:\s*none/);

  // While the fresh snapshot is in flight the control says so by spinning,
  // and it must not leave the pointer claiming clickability.
  assert.match(
    cssRule(".run-history__reload.is-reloading > svg"),
    /animation:\s*run-history-reload-spin/,
  );
  assert.match(cssRule(".run-history__reload.is-reloading"), /cursor:\s*progress/);
  assert.match(styles, /@keyframes run-history-reload-spin \{/);

  // The chip and the reload share one header row: a column layout would let
  // a second control push the live chip out of the 48px header.
  assert.match(cssRule(".run-history__header-meta"), /flex-direction:\s*row/);
});
