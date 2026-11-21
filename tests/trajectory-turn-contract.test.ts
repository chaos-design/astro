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

function themeBlock(theme: "dark" | "light"): string {
  const marker =
    theme === "dark"
      ? ':root,\n:root[data-theme="dark"] {'
      : ':root[data-theme="light"] {';
  const start = styles.indexOf(marker);
  assert.notEqual(start, -1, `Missing ${theme} theme block`);
  const bodyStart = styles.indexOf("{", start);
  let depth = 1;
  let cursor = bodyStart + 1;
  while (depth > 0 && cursor < styles.length) {
    if (styles[cursor] === "{") depth += 1;
    if (styles[cursor] === "}") depth -= 1;
    cursor += 1;
  }
  return styles.slice(bodyStart + 1, cursor - 1);
}

/**
 * RUN TRAJECTORY groups atoms under sticky `TURN n` headers. The boundaries
 * must read as blocks on both themes, so the header carries a theme-specific
 * accent pinned by contract instead of by eyeballing each theme.
 */
test("turn headers carry a theme-specific accent edge and bar", () => {
  const dark = themeBlock("dark");
  const light = themeBlock("light");

  assert.match(dark, /--trajectory-turn-accent:\s*var\(--violet\)/);
  assert.match(light, /--trajectory-turn-accent:\s*var\(--violet-deep\)/);

  const header = cssRule(".trajectory-turn > header");
  assert.match(header, /box-shadow:\s*inset 3px 0 var\(--trajectory-turn-accent\)/);
  // The sticky bar is tinted from the theme accent, not the bare panel, so a
  // scrolled-over turn boundary still reads as a section header.
  assert.match(header, /background:[\s\S]*var\(--accent\)/);
  assert.match(header, /position:\s*sticky/);
});

test("the turn number renders as an accent badge", () => {
  const badge = cssRule(".trajectory-turn > header strong");

  assert.match(badge, /background:[\s\S]*var\(--trajectory-turn-accent\)/);
  assert.match(badge, /border:[\s\S]*var\(--trajectory-turn-accent\)/);
  assert.match(badge, /border-radius:\s*4px/);
  assert.match(badge, /font-weight:\s*700/);
});

test("turn sections are tinted blocks distinct from the page ground", () => {
  const section = cssRule(".trajectory-turn");
  assert.match(section, /background:[\s\S]*var\(--accent\)/);
});

/**
 * A turn that is executing or blocked on a question must open by itself — the
 * reader should not have to expand the one turn that needs attention. The
 * default is derived from the model on every rebuild (so a fresh snapshot
 * after refresh reopens it) rather than persisted in a UI-only Set.
 */
test("running and waiting turns are expanded by default after every snapshot", () => {
  const app = readFileSync(new URL("../src/app.tsx", import.meta.url), "utf8");
  const start = app.indexOf("const liveTurnsKey");
  const end = app.indexOf("const [expandedTurns", start);
  const block = app.slice(start, end);
  assert.match(block, /turn\.status === "running"/);
  assert.match(block, /turn\.status === "waiting"/);

  const reset = app.slice(
    app.indexOf("useEffect(() => {\n    const latestTurn"),
    app.indexOf("const toggleTurn"),
  );
  assert.match(reset, /new Set<number>\(defaultExpandedTurns\)/);
  assert.match(reset, /latestTurn/);
});
