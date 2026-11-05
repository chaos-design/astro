import assert from "node:assert/strict";
import test from "node:test";
import {
  attachScrollFpsTracker,
  clampHudPosition,
  computeFps,
  formatHudHeadline,
  getHudTiles,
  getPerfSnapshot,
  installPerfMetrics,
  isApiRequest,
  markAppReady,
  recordListRender,
  recordScrollSample,
  resolveHudPosition,
} from "../src/lib/perf-metrics.ts";

test("computeFps derives clamped one-decimal frames per second", () => {
  assert.equal(computeFps(60, 1_000), 60);
  assert.equal(computeFps(119, 1_000), 119);
  // Sub-frame precision rounds to one decimal.
  assert.equal(computeFps(1, 250), 4);
  // Degenerate inputs read as zero instead of Infinity.
  assert.equal(computeFps(0, 1_000), 0);
  assert.equal(computeFps(10, 0), 0);
  // Absurd frame counts (broken rAF clocks) stay bounded.
  assert.equal(computeFps(10_000, 1_000), 240);
});

test("isApiRequest separates the trace API from static assets", () => {
  assert.equal(isApiRequest("http://127.0.0.1:4318/api/events"), true);
  assert.equal(isApiRequest("/api/stream"), true);
  assert.equal(isApiRequest("/assets/index-abc123.js"), false);
  assert.equal(isApiRequest("/"), false);
  // A path segment that merely contains "api" is not the API.
  assert.equal(isApiRequest("/assets/api-guide.js"), false);
});

test("recordListRender keeps a bounded, aggregated sample window", () => {
  const before = getPerfSnapshot().listRender.count;
  recordListRender(4, 30);
  recordListRender(6, 40);
  recordListRender(20, 50);
  // Non-finite and negative measurements are ignored, not recorded.
  recordListRender(Number.NaN, 10);
  recordListRender(-3, 10);
  const stats = getPerfSnapshot().listRender;
  assert.equal(stats.count, before + 3);
  assert.equal(stats.lastMs, 20);
  assert.equal(stats.maxMs, 20);
  assert.equal(stats.averageMs, 10);
  assert.equal(stats.lastRows, 50);
});

test("recordScrollSample feeds the snapshot's fps aggregate", () => {
  recordScrollSample({ durationMs: 1_000, fps: 60, frames: 60 });
  recordScrollSample({ durationMs: 1_000, fps: 30, frames: 30 });
  const fps = getPerfSnapshot().scrollFps;
  assert.equal(fps.last, 30);
  assert.equal(fps.average, 45);
  assert.equal(fps.worst, 30);
});

test("markAppReady records the first commit once", () => {
  markAppReady(1_234);
  assert.equal(getPerfSnapshot().appReadyMs, 1_234);
  // Later calls (re-renders, HMR) must not move the first-screen mark.
  markAppReady(9_999);
  assert.equal(getPerfSnapshot().appReadyMs, 1_234);
});

test("formatHudHeadline condenses the collapsed pill to two numbers", () => {
  recordScrollSample({ durationMs: 1_000, fps: 58.4, frames: 58 });
  recordListRender(0.8, 12);
  const headline = formatHudHeadline(getPerfSnapshot());
  // The snapshot aggregates module-level samples from every test in this
  // process, so the exact values are shared state; the pill's contract is the
  // two-number shape: a rounded fps average and a one-decimal render average.
  assert.match(headline, /^\d+(\.\d+)?fps · \d+\.\dms$/);
});

test("browser-only installers no-op outside the DOM", () => {
  // In Node there is no window/PerformanceObserver: the installers must
  // return a callable disconnect without throwing.
  assert.equal(typeof installPerfMetrics(), "function");
  assert.equal(
    typeof attachScrollFpsTracker({
      addEventListener() {},
      removeEventListener() {},
    } as unknown as HTMLElement),
    "function",
  );
});

test("clampHudPosition keeps the pill inside the viewport, bottom-pinned", () => {
  const viewport = { width: 1_000, height: 800 };
  // With a 240px pill and a 336px panel, the pill's minimum left leaves room
  // for the panel to open upward to its left: minLeft = 8 + (336 - 240) = 104.
  // In-range positions pass through rounded.
  assert.deepEqual(
    clampHudPosition({ left: 400.4, bottom: 300.6 }, 240, 32, viewport.width, viewport.height),
    { left: 400, bottom: 301 },
  );
  // Beyond the right/bottom edge is pulled back so the pill stays visible.
  assert.deepEqual(
    clampHudPosition({ left: 1_200, bottom: 900 }, 240, 32, viewport.width, viewport.height),
    { left: 752, bottom: 760 },
  );
  // The panel must never run past the left edge: a far-left pill is pulled
  // right until the panel's 336px width fits to its left.
  assert.deepEqual(
    clampHudPosition({ left: 0, bottom: 10 }, 240, 32, viewport.width, viewport.height),
    { left: 104, bottom: 10 },
  );
  // A viewport smaller than the HUD still keeps the pill on screen.
  assert.deepEqual(
    clampHudPosition({ left: -50, bottom: -50 }, 240, 32, 100, 50),
    { left: 104, bottom: 8 },
  );
});

test("resolveHudPosition restores a stored drag, rejects malformed values", () => {
  const viewport = { width: 1_000, height: 800 };
  // A stored position in the new bottom-pinned shape restores (clamped).
  assert.deepEqual(
    resolveHudPosition('{"left":400,"bottom":60}', 240, 32, viewport.width, viewport.height),
    { left: 400, bottom: 60 },
  );
  // Out-of-range stored positions (a smaller window since the drop) clamp.
  assert.deepEqual(
    resolveHudPosition('{"left":5000,"bottom":5000}', 240, 32, viewport.width, viewport.height),
    { left: 752, bottom: 760 },
  );
  // Absent, broken JSON, and non-numeric fields all fall back to the default.
  assert.equal(resolveHudPosition(null, 240, 32, viewport.width, viewport.height), null);
  assert.equal(resolveHudPosition("not-json", 240, 32, viewport.width, viewport.height), null);
  assert.equal(
    resolveHudPosition('{"left":"x","bottom":0}', 240, 32, viewport.width, viewport.height),
    null,
  );
  assert.equal(
    resolveHudPosition('{"left":null,"bottom":null}', 240, 32, viewport.width, viewport.height),
    null,
  );
  // A pre-upgrade position stored `{ left, top }` (the host grew downward, so
  // it could land off-screen) is treated as absent: the reader re-drops.
  assert.equal(
    resolveHudPosition('{"left":40,"top":60}', 240, 32, viewport.width, viewport.height),
    null,
  );
});

test("getHudTiles tone-codes the three headline numbers", () => {
  const tiles = getHudTiles({
    ...getPerfSnapshot(),
    scrollFps: { average: 58, last: 58, samples: 3, worst: 55 },
    listRender: { count: 4, lastMs: 1, averageMs: 2, maxMs: 4, lastRows: 20 },
    longTasks: { count: 0, maxMs: 0, totalMs: 0 },
  });
  assert.deepEqual(
    tiles.map((tile) => [tile.label, tile.tone]),
    [
      ["滚动帧率", "ok"],
      ["列表渲染", "ok"],
      ["长任务", "ok"],
    ],
  );
  // Thresholds flip the tone instead of hiding the number: the tool reports
  // the bad state, it does not go quiet.
  const degraded = getHudTiles({
    ...getPerfSnapshot(),
    scrollFps: { average: 22, last: 22, samples: 2, worst: 18 },
    listRender: { count: 4, lastMs: 30, averageMs: 25, maxMs: 40, lastRows: 20 },
    longTasks: { count: 2, maxMs: 180, totalMs: 240 },
  });
  assert.deepEqual(
    degraded.map((tile) => tile.tone),
    ["bad", "bad", "bad"],
  );
});
