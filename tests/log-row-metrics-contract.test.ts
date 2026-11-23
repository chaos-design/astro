import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../src/app.tsx", import.meta.url), "utf8");

/**
 * The virtualized log used to re-run its DOM measurement whenever `metrics`
 * changed. Reporting a measured height then mounted a different slice, whose
 * first row had a different height, so the layout effect looped until React
 * threw error #185 on the deployed console. These assertions pin the two
 * properties that break that cycle.
 */
test("the log row measurement never depends on the metrics it writes", () => {
  const measure = app.match(
    /\/\/ Measure real row and separator heights[\s\S]*?\n  }, \[([^\]]*)\]/,
  );
  assert.ok(measure, "the row measurement layout effect must exist");
  assert.equal(
    measure[1].replace(/\s/g, ""),
    "visibleEntries",
    "the effect may only follow entry changes, never its own state update",
  );
  assert.match(
    app,
    /const metricsRef = useRef\(metrics\);\s*metricsRef\.current = metrics;/,
  );
  assert.match(measure[0], /const current = metricsRef\.current/);
  assert.doesNotMatch(measure[0], /\bmetrics\.(row|turn)\b/);
});

test("the implicit LOG reveal is gated by Live, an explicit locate or a new selection", () => {
  const effect = app.match(
    /useEffect\(\(\) => \{\s*\n\s*const explicitLocate = locateRequestRef\.current[\s\S]*?\n  \}, \[[\s\S]*?\]\);/,
  );
  assert.ok(effect, "the LOG locate effect must exist");
  assert.match(effect[0], /const selectionChanged = locatedEventRef\.current !== selectedEventId/);
  assert.match(effect[0], /shouldScrollLogToSelection\(\{ explicitLocate, live, selectionChanged \}\)/);
  assert.match(effect[0], /\blive,\n    locateRequest,/);
});

test("row and turn estimates use the tallest mounted item, not the first", () => {
  // A uniform-height layout must not clip a wrapped row: measuring only the
  // first row made the estimate jump whenever the virtual window slid.
  const measure = app.match(
    /\/\/ Measure real row and separator heights[\s\S]*?\n  }, \[visibleEntries\]/,
  );
  assert.ok(measure);
  assert.match(measure[0], /const tallest = \(selector: string\)/);
  assert.match(measure[0], /querySelectorAll<HTMLElement>\(selector\)/);
  assert.match(measure[0], /tallest\("\.atomic-log__row"\)/);
  assert.match(measure[0], /tallest\("\.atomic-log__turn"\)/);
  assert.match(measure[0], /Math\.max\(max, element\.offsetHeight\)/);
});
