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
  // Disarmed reads light: a quiet surface, hairline border, muted text. The
  // armed state is the dark one, so "off" must not borrow the running accent.
  assert.match(chip, /border:\s*1px solid var\(--line-bright\)/);
  assert.match(chip, /color:\s*var\(--muted-soft\)/);
  // The glyph stays in every state — it is what makes the control legible as
  // "live" — and takes its colour from the chip instead of a hard-coded hue.
  assert.match(
    cssRule(".run-history__live-jump > svg"),
    /color:\s*currentColor/,
  );
  assert.doesNotMatch(
    styles,
    /\.run-history__live-jump[^{]*>\s*svg\s*\{[^}]*display:\s*none/,
  );
});

test("darkens the armed chip into a mode badge", () => {
  const filtering = cssRule(".run-history__live-jump.is-filtering");

  // Armed and disarmed must be distinguishable at a glance, with the polarity
  // a toggle reads as on a dark surface: off is light, on is dark and
  // saturated. The armed fill blends the running accent into the page colour,
  // which keeps it darker than the panel instead of glowing above it.
  assert.match(
    filtering,
    /background:\s*color-mix\(in srgb, var\(--status-running\) 26%, var\(--bg\)\)/,
  );
  assert.match(filtering, /border-color:\s*color-mix\(in srgb, var\(--status-running\)/);
  // Light text on the dark fill, not the panel colour knocked out of a solid
  // accent.
  assert.match(filtering, /color:\s*var\(--highlight-observed\)/);
  assert.match(filtering, /box-shadow:[\s\S]*var\(--status-running\)/);

  // The glyph is retained: the fill carries on/off, the icon carries "live".
  assert.doesNotMatch(
    styles,
    /\.run-history__live-jump[^{]*>\s*svg\s*\{[^}]*display:\s*none/,
  );
});

test("keeps the chip and the reload on one compact control height", () => {
  // Both header controls are 20px pills with the same radius: the LIVE chip
  // used to be a 24px glowing capsule that dominated the header.
  assert.match(cssRule(".run-history__live-jump"), /height:\s*20px/);
  assert.match(cssRule(".run-history__live-jump"), /border-radius:\s*999px/);
  assert.match(cssRule(".run-history__reload"), /height:\s*20px/);
  assert.match(cssRule(".run-history__reload"), /border-radius:\s*999px/);
});

test("keeps the chip in the header at zero live without pretending to run", () => {
  // `0 LIVE` uses the same control so the arm stays visible and operable;
  // it only goes a shade quieter than a disarmed chip with runs.
  const idle = cssRule(".run-history__live-jump.is-idle:not(.is-filtering)");

  assert.match(idle, /border-color:\s*var\(--line-bright\)/);
  assert.match(idle, /color:\s*var\(--muted\)/);
  // Same ghost surface as the reload button: one quiet pair of controls.
  assert.match(idle, /background:\s*transparent/);
  assert.match(
    cssRule(".run-history__live-jump.is-idle:not(.is-filtering) > svg"),
    /color:\s*currentColor/,
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

/**
 * The header gained two 28px controls (repository link, settings). They sit
 * next to the theme switcher, so the contract is that they look like it rather
 * than introducing a second button style in the same row.
 */
test("matches the header icon controls to the theme switcher", () => {
  const shared = cssRule(".repo-link,\n.settings-trigger");

  assert.match(shared, /border-color:\s*transparent/);
  assert.match(shared, /border-radius:\s*6px/);
  assert.match(shared, /background:\s*var\(--panel-raised\)/);

  const link = cssRule(".repo-link");
  assert.match(link, /width:\s*28px/);
  assert.match(link, /height:\s*28px/);

  // Both glyphs are sized together: a 14px mark next to a 16px mark read as a
  // misaligned pair at this scale.
  const glyph = cssRule(".repo-link > svg,\n.settings-trigger > svg");
  assert.match(glyph, /width:\s*15px/);
  assert.match(glyph, /height:\s*15px/);
});

test("lays the range choices out four per row", () => {
  const grid = cssRule(".settings-options");
  assert.match(
    grid,
    /grid-template-columns:\s*repeat\(var\(--settings-columns, 4\), minmax\(0, 1fr\)\)/,
  );

  // The tick reserves its slot instead of being added on selection: a layout
  // that grows on select makes the whole grid jump.
  assert.match(cssRule(".settings-option__check"), /position:\s*absolute/);
  assert.match(cssRule(".settings-option__check"), /opacity:\s*0/);
  assert.match(
    cssRule(".settings-option.is-selected .settings-option__check"),
    /opacity:\s*1/,
  );
  assert.match(
    cssRule(".settings-option.is-selected"),
    /var\(--selection-border\)/,
  );
});

test("lays settings out as a section rail beside the active pane", () => {
  // Two panes, not one stacked column: the rail names the sections and the
  // pane shows only the active one's fields.
  assert.match(
    cssRule(".settings-dialog__layout"),
    /grid-template-columns:\s*208px minmax\(0, 1fr\)/,
  );
  assert.match(cssRule(".settings-nav"), /flex-direction:\s*column/);
  assert.match(cssRule(".settings-dialog__layout"), /min-height:\s*0/);

  // The dialog is a real card, not a form strip: fixed height on a wide
  // viewport, with the pane scrolling between fixed header and footer so the
  // reset button never falls below the fold.
  assert.match(cssRule(".settings-dialog"), /height:\s*min\(672px/);
  assert.match(cssRule(".settings-dialog"), /overflow:\s*hidden/);
  assert.match(cssRule(".settings-pane"), /overflow-y:\s*auto/);
  assert.match(cssRule(".settings-pane"), /min-height:\s*0/);
  assert.match(cssRule(".settings-footer"), /flex:\s*none/);
});

test("keeps the log scroll controls out of the list", () => {
  // The chevrons used to float over the log: the top one covered the first
  // visible atom. They now sit in the header row, so no row is ever covered.
  const controls = cssRule(".atomic-log__scroll-controls");
  assert.match(controls, /display:\s*flex/);
  assert.doesNotMatch(controls, /position:\s*absolute/);

  const button = cssRule(".atomic-log__scroll-button");
  assert.doesNotMatch(button, /position:\s*absolute/);
  assert.doesNotMatch(button, /backdrop-filter/);
  assert.match(button, /width:\s*22px/);
});

test("dims the console behind the Flow Guide", () => {
  // A drawer without a scrim read as a fourth column. The scrim is a flat
  // fill, not a backdrop blur: the canvas repaints continuously.
  const overlay = cssRule(".atom-guide__overlay");
  assert.match(overlay, /background:\s*rgb\(4 6 10 \/ 58%\)/);
  assert.doesNotMatch(overlay, /backdrop-filter/);
  assert.match(
    styles,
    /:root\[data-theme="light"\] \.atom-guide__overlay/,
    "light theme needs its own scrim strength",
  );
});

/**
 * The Live filter is a persisted preference, so Settings owns a switch for it.
 * Its on-state borrows the running accent — the same colour as the chip the
 * setting arms — rather than introducing a fourth accent into the console.
 */
test("switches the Live filter on with the running accent", () => {
  const track = cssRule(".settings-switch");
  assert.match(track, /border-radius:\s*999px/);
  assert.match(track, /cursor:\s*pointer/);

  const on = cssRule(".settings-switch.is-on");
  assert.match(on, /var\(--status-running\)/);

  const thumb = cssRule(".settings-switch.is-on .settings-switch__thumb");
  assert.match(thumb, /transform:\s*translateX\(18px\)/);
  assert.match(thumb, /background:\s*var\(--status-running\)/);

  // Keyboard reachable: the switch is a real control, not a styled div.
  assert.match(cssRule(".settings-switch:focus-visible"), /outline:/);
});

test("gives the armed Live filter's empty state a title and a way out", () => {
  // `0 LIVE` with the filter armed is a legitimate result, and the panel must
  // say so instead of looking like a failed load.
  assert.match(
    cssRule(".run-history__empty > strong,\n.run-history__empty > span"),
    /display:\s*block/,
  );
  assert.match(cssRule(".run-history__empty > strong"), /var\(--text\)/);
});
