import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../src/app.tsx", import.meta.url), "utf8");
const styles = readFileSync(
  new URL("../src/styles.css", import.meta.url),
  "utf8",
);
const notices = readFileSync(
  new URL("../src/components/console-notices.tsx", import.meta.url),
  "utf8",
);

/**
 * First paint must not claim facts it does not have yet, and actions must
 * report their outcome in the console instead of a blocking native dialog.
 * These are pinned as contracts because both regressions are invisible in a
 * fast local run: the wrong copy is on screen for a few hundred milliseconds.
 */
test("RUN HISTORY paints a skeleton instead of a zero count while loading", () => {
  assert.match(
    app,
    /initialLoading\s*\?\s*"loading…"/,
    "the header count must not read 0 before the snapshot lands",
  );
  assert.match(app, /className="run-history__skeleton"/);
  assert.match(app, /src-?only|sr-only/);
  assert.match(
    styles,
    /\.run-history__skeleton-row \{/,
    "skeleton rows need their own geometry",
  );
  assert.match(styles, /@keyframes run-history-skeleton-pulse \{/);
  assert.match(
    styles,
    /@media \(prefers-reduced-motion: reduce\) \{\s*\.run-history__skeleton-row \{/,
    "the skeleton must respect reduced motion",
  );
});

test("the header separates the first connection from a dropped one", () => {
  assert.match(
    app,
    /const \[everConnected, setEverConnected\] = useState\(false\)/,
  );
  // "connecting" is only reachable before the first `ready`; "offline" needs a
  // connection that already existed.
  assert.match(app, /: "connecting"/);
  assert.match(app, /everConnected\s*\?\s*"offline"/);
});

test("the history search dialog is a lazily loaded, preloaded chunk", () => {
  assert.match(app, /const LazyHistorySearch = lazy\(/);
  assert.match(app, /import\("\.\/components\/history-search"\)/);
  assert.match(
    app,
    /requestIdleCallback\(preload, \{ timeout: 4000 \}\)/,
    "the chunk has to be pulled during the first idle window",
  );
  assert.match(app, /<Suspense[\s\S]{0,400}history-search--pending/);
  assert.match(
    styles,
    /\.history-search--pending \{/,
    "the fallback reuses the dialog frame instead of an unstyled box",
  );
});

test("action feedback uses console notices, never window.alert", () => {
  assert.doesNotMatch(app, /window\.alert\(/);
  assert.match(app, /<ConsoleNotices notices=\{notices\}/);
  assert.match(notices, /role=\{notice\.tone === "error" \? "alert" : "status"\}/);
  assert.match(notices, /aria-label="关闭提示"/);
  assert.match(
    notices,
    /notice\.tone === "error" \? NOTICE_LIFETIME_MS \* 2 : NOTICE_LIFETIME_MS/,
    "errors stay on screen longer than confirmations",
  );
  // The stack must never swallow clicks meant for the panels underneath.
  assert.match(styles, /\.console-notices \{[\s\S]*?pointer-events: none;/);
  assert.match(styles, /\.console-notice \{[\s\S]*?pointer-events: auto;/);
});
