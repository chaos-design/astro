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
  recordPageFpsSample,
  recordScrollSample,
  resolveHudPosition,
  summarizePageFps,
} from "../src/lib/perf-metrics.ts";
import { formatPerfDuration } from "../src/lib/duration-label.ts";

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

test("formatHudHeadline reads the page's own frame rate, not a scroll average", () => {
  recordScrollSample({ durationMs: 1_000, fps: 58.4, frames: 58 });
  recordPageFpsSample(59.5, 16.8);
  const headline = formatHudHeadline(getPerfSnapshot());
  // The snapshot aggregates module-level samples from every test in this
  // process, so the exact values are shared state; the pill's contract is
  // "current page fps · frame interval" in the panel's duration ladder.
  assert.match(
    headline,
    /^\d+(\.\d+)?fps · (\d+ms|\d+s|\d{2}M\d{2}s|\d{2}H\d{2}M)$/,
  );
  assert.ok(headline.startsWith("59.5fps"), headline);
});

test("formatPerfDuration follows the documented ladder", () => {
  // Under 10s: milliseconds, so frame work stays readable.
  assert.equal(formatPerfDuration(0), "0ms");
  assert.equal(formatPerfDuration(742.4), "742ms");
  assert.equal(formatPerfDuration(9_999), "9999ms");
  // 10–60s: whole seconds.
  assert.equal(formatPerfDuration(10_000), "10s");
  assert.equal(formatPerfDuration(59_999), "59s");
  // 1–60min: two-digit compound MMmSSs — the seconds still distinguish runs.
  assert.equal(formatPerfDuration(60_000), "01M00s");
  assert.equal(formatPerfDuration(61_000), "01M01s");
  assert.equal(formatPerfDuration(3_599_000), "59M59s");
  // 60min and up: hours + minutes, two digits each.
  assert.equal(formatPerfDuration(3_600_000), "01H00M");
  assert.equal(formatPerfDuration(7_500_000), "02H05M");
  // Degenerate input prints the same placeholder as the other ladder.
  assert.equal(formatPerfDuration(Number.NaN), "--");
  assert.equal(formatPerfDuration(-1), "--");
});

test("recordPageFpsSample keeps a bounded ring and summarizes it", () => {
  recordPageFpsSample(60, 16.7);
  recordPageFpsSample(30, 33.3);
  recordPageFpsSample(Number.NaN, 0);
  const stats = getPerfSnapshot().pageFps;
  assert.equal(stats.current, 30);
  assert.equal(stats.frameMs, 33.3);
  assert.ok(stats.samples >= 2);
  assert.ok(stats.min <= 30);
  // The summarizer is pure, so its shape is pinned directly.
  assert.deepEqual(summarizePageFps([60, 30], 30, 33.3), {
    current: 30,
    average: 45,
    min: 30,
    samples: 2,
    frameMs: 33.3,
  });
  assert.deepEqual(summarizePageFps([], 0, 0), {
    current: 0,
    average: 0,
    min: 0,
    samples: 0,
    frameMs: 0,
  });
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
    pageFps: { current: 58, average: 58, min: 55, samples: 3, frameMs: 17.2 },
    listRender: { count: 4, lastMs: 1, averageMs: 2, maxMs: 4, lastRows: 20 },
    longTasks: { count: 0, maxMs: 0, totalMs: 0 },
  });
  assert.deepEqual(
    tiles.map((tile) => [tile.label, tile.tone]),
    [
      ["页面帧率", "ok"],
      ["列表渲染", "ok"],
      ["长任务", "ok"],
    ],
  );
  // Thresholds flip the tone instead of hiding the number: the tool reports
  // the bad state, it does not go quiet.
  const degraded = getHudTiles({
    ...getPerfSnapshot(),
    scrollFps: { average: 22, last: 22, samples: 2, worst: 18 },
    pageFps: { current: 22, average: 24, min: 18, samples: 2, frameMs: 45.5 },
    listRender: { count: 4, lastMs: 30, averageMs: 25, maxMs: 40, lastRows: 20 },
    longTasks: { count: 2, maxMs: 180, totalMs: 240 },
  });
  assert.deepEqual(
    degraded.map((tile) => tile.tone),
    ["bad", "bad", "bad"],
  );
});
