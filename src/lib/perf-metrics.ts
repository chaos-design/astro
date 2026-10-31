/**
 * Dependency-free performance instrumentation for the studio frontend.
 *
 * The metrics stay cheap enough to always run: two PerformanceObservers
 * (long tasks, resource timings) plus paint entries, a bounded list-render
 * ring, and a scroll FPS tracker that only samples while the list actually
 * scrolls. Every value is readable from one place — `window.__astroPerf` —
 * so a before/after comparison of an optimization reads a single consistent
 * snapshot instead of ad-hoc console timing.
 *
 * The visible HUD is strictly opt-in (`?perf=1`, persisted; `?perf=0`
 * clears it) so regular usage never pays for HUD DOM updates.
 */

const LIST_RENDER_SAMPLE_LIMIT = 200;
const SCROLL_FPS_SAMPLE_LIMIT = 100;
/** Frame gap after the last scroll event at which a scroll sample closes. */
const SCROLL_IDLE_MS = 400;
const HUD_UPDATE_MS = 500;
const HUD_STORAGE_KEY = "astro:perf-hud";

export type ListRenderStats = {
  count: number;
  lastMs: number;
  averageMs: number;
  maxMs: number;
  lastRows: number;
};

export type ScrollFpsSample = {
  /** Rounded frames per second over one continuous scroll gesture. */
  fps: number;
  durationMs: number;
  frames: number;
};

export type PerfSnapshot = {
  /** Navigation start → the app's first committed render, in ms. */
  appReadyMs: number | null;
  firstContentfulPaintMs: number | null;
  largestContentfulPaintMs: number | null;
  scrollFps: {
    average: number;
    last: number;
    samples: number;
    worst: number;
  };
  listRender: ListRenderStats;
  network: {
    apiRequests: number;
    assetRequests: number;
    totalRequests: number;
    transferBytes: number;
  };
  longTasks: { count: number; maxMs: number; totalMs: number };
};

type ResourceCategory = "api" | "asset";

const listRenderSamples: number[] = [];
let listRenderRows = 0;
const scrollFpsSamples: number[] = [];
let lastScrollFps = 0;
let appReadyMs: number | null = null;
let firstContentfulPaintMs: number | null = null;
let largestContentfulPaintMs: number | null = null;
const network = {
  apiRequests: 0,
  assetRequests: 0,
  totalRequests: 0,
  transferBytes: 0,
};
const longTasks = { count: 0, maxMs: 0, totalMs: 0 };

/** Whether a resource URL belongs to the trace API rather than a static asset. */
export function isApiRequest(url: string): boolean {
  try {
    return new URL(url, "http://localhost").pathname.startsWith("/api/");
  } catch {
    return false;
  }
}

function categorizeResource(url: string): ResourceCategory {
  return isApiRequest(url) ? "api" : "asset";
}

/** Frames-per-second over a gesture, rounded to one decimal and clamped. */
export function computeFps(frames: number, elapsedMs: number): number {
  if (frames <= 0 || elapsedMs <= 0) {
    return 0;
  }
  return Math.min(240, Math.round((frames / (elapsedMs / 1000)) * 10) / 10);
}

export function recordListRender(durationMs: number, rows: number) {
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    return;
  }
  listRenderSamples.push(durationMs);
  if (listRenderSamples.length > LIST_RENDER_SAMPLE_LIMIT) {
    listRenderSamples.shift();
  }
  listRenderRows = rows;
}

export function recordScrollSample(sample: ScrollFpsSample) {
  lastScrollFps = sample.fps;
  scrollFpsSamples.push(sample.fps);
  if (scrollFpsSamples.length > SCROLL_FPS_SAMPLE_LIMIT) {
    scrollFpsSamples.shift();
  }
}

export function markAppReady(now = typeof performance === "undefined" ? 0 : performance.now()) {
  if (appReadyMs === null && now > 0) {
    appReadyMs = Math.round(now);
  }
}

function readPaintEntries() {
  if (typeof performance === "undefined" || !performance.getEntriesByType) {
    return;
  }
  if (firstContentfulPaintMs === null) {
    const fcp = performance
      .getEntriesByType("paint")
      .find((entry) => entry.name === "first-contentful-paint");
    firstContentfulPaintMs = fcp ? Math.round(fcp.startTime) : null;
  }
}

export function getPerfSnapshot(): PerfSnapshot {
  readPaintEntries();
  const listCount = listRenderSamples.length;
  const listTotal = listRenderSamples.reduce((sum, ms) => sum + ms, 0);
  const fpsSamples = scrollFpsSamples.length;
  const fpsTotal = scrollFpsSamples.reduce((sum, fps) => sum + fps, 0);
  return {
    appReadyMs,
    firstContentfulPaintMs,
    largestContentfulPaintMs,
    scrollFps: {
      average: fpsSamples ? Math.round((fpsTotal / fpsSamples) * 10) / 10 : 0,
      last: lastScrollFps,
      samples: fpsSamples,
      worst: fpsSamples ? Math.min(...scrollFpsSamples) : 0,
    },
    listRender: {
      count: listCount,
      lastMs: listCount ? listRenderSamples[listCount - 1] : 0,
      averageMs: listCount ? Math.round((listTotal / listCount) * 100) / 100 : 0,
      maxMs: listCount ? Math.max(...listRenderSamples) : 0,
      lastRows: listRenderRows,
    },
    network: { ...network },
    longTasks: { ...longTasks },
  };
}

/**
 * Samples scroll frame rate with one requestAnimationFrame loop that only
 * runs while the element is actually scrolling: the first scroll event starts
 * a gesture, and {@link SCROLL_IDLE_MS} without scroll events closes the
 * sample and stops the loop. Returns a disconnect function.
 */
export function attachScrollFpsTracker(element: HTMLElement): () => void {
  if (typeof window === "undefined" || typeof requestAnimationFrame === "undefined") {
    return () => undefined;
  }
  let frame = 0;
  let frames = 0;
  let startedAt = 0;
  let lastScrollAt = 0;

  const closeSample = () => {
    frame = 0;
    const durationMs = performance.now() - startedAt;
    if (frames > 0 && durationMs > 0) {
      recordScrollSample({
        durationMs: Math.round(durationMs),
        fps: computeFps(frames, durationMs),
        frames,
      });
    }
    frames = 0;
  };

  const tick = () => {
    frames += 1;
    if (performance.now() - lastScrollAt > SCROLL_IDLE_MS) {
      closeSample();
      return;
    }
    frame = requestAnimationFrame(tick);
  };

  const handleScroll = () => {
    lastScrollAt = performance.now();
    if (!frame) {
      startedAt = lastScrollAt;
      frames = 0;
      frame = requestAnimationFrame(tick);
    }
  };

  element.addEventListener("scroll", handleScroll, { passive: true });
  return () => {
    element.removeEventListener("scroll", handleScroll);
    if (frame) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
  };
}

/**
 * Installs the always-on observers (paint, long tasks, resource timings) and
 * exposes `window.__astroPerf.snapshot()`. Returns the disconnect function so
 * callers with a teardown path (tests, HMR) can remove them again.
 */
export function installPerfMetrics(): () => void {
  if (typeof window === "undefined" || typeof PerformanceObserver === "undefined") {
    return () => undefined;
  }

  const observers: PerformanceObserver[] = [];
  try {
    const paint = new PerformanceObserver((entries) => {
      for (const entry of entries.getEntries()) {
        if (entry.name === "first-contentful-paint") {
          firstContentfulPaintMs = Math.round(entry.startTime);
        }
      }
    });
    paint.observe({ buffered: true, type: "paint" } as PerformanceObserverInit);
    observers.push(paint);
  } catch {
    // Paint timing is unavailable (older engines): the snapshot just omits it.
  }
  try {
    const lcp = new PerformanceObserver((entries) => {
      const last = entries.getEntries().at(-1);
      if (last) {
        largestContentfulPaintMs = Math.round(last.startTime);
      }
    });
    lcp.observe({ buffered: true, type: "largest-contentful-paint" } as PerformanceObserverInit);
    observers.push(lcp);
  } catch {
    // LCP is unavailable: the snapshot just omits it.
  }
  try {
    const longtask = new PerformanceObserver((entries) => {
      for (const entry of entries.getEntries()) {
        longTasks.count += 1;
        longTasks.totalMs += entry.duration;
        longTasks.maxMs = Math.max(longTasks.maxMs, Math.round(entry.duration));
      }
    });
    longtask.observe({ buffered: true, type: "longtask" } as PerformanceObserverInit);
    observers.push(longtask);
  } catch {
    // Long-task timing is unavailable (Firefox): the snapshot just omits it.
  }
  try {
    const resource = new PerformanceObserver((entries) => {
      for (const entry of entries.getEntries()) {
        const resource = entry as PerformanceResourceTiming;
        const category = categorizeResource(resource.name);
        network.totalRequests += 1;
        if (category === "api") {
          network.apiRequests += 1;
        } else {
          network.assetRequests += 1;
        }
        network.transferBytes += resource.transferSize || 0;
      }
    });
    resource.observe({ buffered: true, type: "resource" } as PerformanceObserverInit);
    observers.push(resource);
  } catch {
    // Resource timing is unavailable: the snapshot just omits it.
  }

  (window as typeof window & { __astroPerf?: unknown }).__astroPerf = {
    snapshot: getPerfSnapshot,
  };

  return () => {
    for (const observer of observers) {
      observer.disconnect();
    }
    delete (window as typeof window & { __astroPerf?: unknown }).__astroPerf;
  };
}

/**
 * HUD visibility: the `perf` query parameter wins (`1` enables, `0` disables
 * and clears the stored preference), otherwise the stored preference decides.
 */
export function resolvePerfHudEnabled(
  query: string,
  storedValue: string | null,
): boolean {
  const params = new URLSearchParams(query);
  const requested = params.get("perf");
  if (requested === "1") {
    return true;
  }
  if (requested === "0") {
    return false;
  }
  return storedValue === "1";
}

function formatHudLine(snapshot: PerfSnapshot): string {
  const list = snapshot.listRender;
  return [
    `ready ${snapshot.appReadyMs ?? "--"}ms · fcp ${snapshot.firstContentfulPaintMs ?? "--"}ms · lcp ${snapshot.largestContentfulPaintMs ?? "--"}ms`,
    `fps last ${snapshot.scrollFps.last} · avg ${snapshot.scrollFps.average} · worst ${snapshot.scrollFps.worst} (${snapshot.scrollFps.samples} gestures)`,
    `log render last ${list.lastMs.toFixed(1)}ms · avg ${list.averageMs.toFixed(1)}ms · max ${list.maxMs.toFixed(1)}ms · ${list.count} renders · ${list.lastRows} rows`,
    `net ${snapshot.network.totalRequests} req (api ${snapshot.network.apiRequests} · assets ${snapshot.network.assetRequests}) · ${(snapshot.network.transferBytes / 1024).toFixed(0)}KB`,
    `long tasks ${snapshot.longTasks.count} · total ${snapshot.longTasks.totalMs.toFixed(0)}ms · max ${snapshot.longTasks.maxMs}ms`,
  ].join("\n");
}

/**
 * Mounts the opt-in HUD: a fixed, pointer-transparent overlay refreshed from
 * {@link getPerfSnapshot} every {@link HUD_UPDATE_MS}. Pure DOM on purpose —
 * React renders must not be influenced by the tool that measures them.
 */
export function mountPerfHud(
  getSnapshot: () => PerfSnapshot,
  doc: Document = document,
): HTMLElement | null {
  if (typeof doc === "undefined") {
    return null;
  }
  const host = doc.createElement("div");
  host.id = "astro-perf-hud";
  host.setAttribute("aria-hidden", "true");
  Object.assign(host.style, {
    background: "rgba(7, 10, 16, 0.85)",
    border: "1px solid rgba(255, 255, 255, 0.18)",
    borderRadius: "6px",
    color: "#e8f0ff",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: "11px",
    lineHeight: "1.5",
    padding: "6px 10px",
    pointerEvents: "none",
    position: "fixed",
    right: "8px",
    top: "8px",
    whiteSpace: "pre",
    zIndex: "2147483647",
  } satisfies Partial<CSSStyleDeclaration>);
  host.textContent = formatHudLine(getSnapshot());
  doc.body.appendChild(host);

  const timer = window.setInterval(() => {
    host.textContent = formatHudLine(getSnapshot());
  }, HUD_UPDATE_MS);
  window.addEventListener("pagehide", () => window.clearInterval(timer), {
    once: true,
  });
  return host;
}

/**
 * Resolves the HUD preference (`?perf=1|0` over `localStorage`) and mounts the
 * HUD when enabled. Split from {@link mountPerfHud} so the storage write only
 * happens on an explicit query-param decision.
 */
export function setupPerfHud(query: string = window.location.search): void {
  const stored = readHudStorage();
  const enabled = resolvePerfHudEnabled(query, stored);
  const requested = new URLSearchParams(query).get("perf");
  if (requested === "1" || requested === "0") {
    writeHudStorage(enabled);
  }
  if (enabled) {
    mountPerfHud(getPerfSnapshot);
  }
}

function readHudStorage(): string | null {
  try {
    return window.localStorage.getItem(HUD_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeHudStorage(enabled: boolean) {
  try {
    if (enabled) {
      window.localStorage.setItem(HUD_STORAGE_KEY, "1");
    } else {
      window.localStorage.removeItem(HUD_STORAGE_KEY);
    }
  } catch {
    // Storage can be unavailable (private mode): the HUD stays session-only.
  }
}
