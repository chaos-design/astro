import assert from "node:assert/strict";
import test from "node:test";
import {
  attachScrollFpsTracker,
  computeFps,
  getPerfSnapshot,
  installPerfMetrics,
  isApiRequest,
  markAppReady,
  recordListRender,
  recordScrollSample,
  resolvePerfHudEnabled,
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

test("resolvePerfHudEnabled prefers the query parameter over storage", () => {
  assert.equal(resolvePerfHudEnabled("?perf=1", null), true);
  assert.equal(resolvePerfHudEnabled("?perf=1", "0"), true);
  assert.equal(resolvePerfHudEnabled("?perf=0", "1"), false);
  assert.equal(resolvePerfHudEnabled("?perf=0", null), false);
  assert.equal(resolvePerfHudEnabled("?", "1"), true);
  assert.equal(resolvePerfHudEnabled("?", null), false);
  assert.equal(resolvePerfHudEnabled("", null), false);
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
