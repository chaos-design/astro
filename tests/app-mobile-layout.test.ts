import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const styles = readFileSync(
  path.resolve(import.meta.dirname, "../src/styles.css"),
  "utf8",
);

function mediaBlock(maxWidth: number): string {
  const block = new RegExp(
    `@media \\(max-width: ${maxWidth}px\\) \\{([\\s\\S]*?)\\n\\}`,
  ).exec(styles);
  assert.ok(block, `src/styles.css must declare @media (max-width: ${maxWidth}px)`);
  return block[1];
}

/**
 * The phone layout reuses one header-height variable for every overlay. When
 * the sheets and the overlay panels disagree about where the header ends, the
 * panels slide underneath it, so the contract keeps them from drifting apart.
 */
test("anchors overlays to the shared mobile header height", () => {
  const tablet = mediaBlock(900);

  assert.match(tablet, /--mobile-header-h: 94px/);
  assert.match(tablet, /min-height: var\(--mobile-header-h\)/);
  assert.match(
    tablet,
    /top: var\(--mobile-header-h\)/,
    "overlay panels must use the header-height variable",
  );
  assert.doesNotMatch(
    tablet,
    /top: 94px/,
    "a literal header height drifts when the header grows",
  );

  // The narrowest breakpoint shrinks the header and re-points the variable
  // instead of repeating the panels' `top` with a second literal.
  assert.match(mediaBlock(390), /--mobile-header-h: 88px/);
});

test("turns the phone nav and both panels into full-width sheets", () => {
  const phone = mediaBlock(620);

  assert.match(phone, /\.studio-header__actions \{[\s\S]*?position: fixed/);
  assert.match(phone, /\.studio-header__actions \{[\s\S]*?justify-self: stretch/);
  assert.match(phone, /max-width: none/);
  assert.match(
    phone,
    /\.studio-workspace:not\(\.is-left-collapsed\) \.history-column[\s\S]*?width: auto/,
  );
  assert.match(phone, /\.panel-rail-label \{\s*display: none/);
  assert.match(
    phone,
    /env\(safe-area-inset-bottom\)/,
    "sheets must clear the home indicator",
  );
});
