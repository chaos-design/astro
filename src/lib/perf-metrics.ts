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
 * The visible HUD is strictly opt-in: it is armed by the Settings → 性能
 * preference (a browser-local `ASTROX_PERF_HUD` flag), never by a URL
 * parameter. It floats at the bottom edge of the page: a collapsed pill
 * carries two headline numbers, and expanding it grows **upward** from the
 * pill — the tone legend and three tone-coded summary tiles stay resident at
 * the top (scrolling the panel never moves them out of view) and every metric
 * section is rendered expanded below them; only the detail rows scroll.
 */

const LIST_RENDER_SAMPLE_LIMIT = 200;
const SCROLL_FPS_SAMPLE_LIMIT = 100;
/** Frame gap after the last scroll event at which a scroll sample closes. */
const SCROLL_IDLE_MS = 400;
const HUD_UPDATE_MS = 500;

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

/** One headline number for the collapsed pill, e.g. `60fps · 0.8ms`. */
export function formatHudHeadline(snapshot: PerfSnapshot): string {
  const fps = snapshot.scrollFps.samples > 0 ? snapshot.scrollFps.average : snapshot.scrollFps.last;
  return `${fps || "--"}fps · ${snapshot.listRender.averageMs.toFixed(1)}ms`;
}

/**
 * The HUD is draggable, so its place on the screen is the reader's choice.
 * The default anchors to the bottom-right edge; a dragged (or restored)
 * position pins with `left`/`bottom` instead, with the pill's *bottom edge*
 * pinned — the expanded panel grows upward from it, so expanding can never
 * push the pill or the panel off the bottom of the viewport.
 */
export type HudPosition = { left: number; bottom: number };

const HUD_POSITION_KEY = "astro:perf-hud-pos";
const HUD_EDGE = 8;
/** The expanded panel's width; it floats above the pill, right-aligned. */
const HUD_PANEL_WIDTH = 336;

/**
 * Clamps a position so the pill stays fully inside the viewport, and the
 * panel that opens upward from it never runs past the left edge: the pill's
 * minimum left leaves room for the panel's width to its left.
 */
export function clampHudPosition(
  position: HudPosition,
  width: number,
  height: number,
  viewportWidth: number,
  viewportHeight: number,
): HudPosition {
  const minLeft = HUD_EDGE + Math.max(0, HUD_PANEL_WIDTH - width);
  const maxLeft = Math.max(minLeft, viewportWidth - width - HUD_EDGE);
  const maxBottom = Math.max(HUD_EDGE, viewportHeight - height - HUD_EDGE);
  return {
    left: Math.min(Math.max(minLeft, Math.round(position.left)), maxLeft),
    bottom: Math.min(Math.max(HUD_EDGE, Math.round(position.bottom)), maxBottom),
  };
}

/**
 * Parses a stored position; `null` when absent or malformed so a corrupted
 * value falls back to the default edge anchor instead of breaking the HUD.
 * A pre-upgrade position stored `{ left, top }` (the host grew downward, so
 * it could land off-screen) and is treated as absent: the reader simply
 * re-drops the pill instead of guessing a spot.
 */
export function resolveHudPosition(
  stored: string | null,
  width: number,
  height: number,
  viewportWidth: number,
  viewportHeight: number,
): HudPosition | null {
  if (!stored) {
    return null;
  }
  try {
    const parsed = JSON.parse(stored) as Partial<HudPosition>;
    if (
      typeof parsed.left !== "number" ||
      typeof parsed.bottom !== "number" ||
      !Number.isFinite(parsed.left) ||
      !Number.isFinite(parsed.bottom)
    ) {
      return null;
    }
    return clampHudPosition(
      { left: parsed.left, bottom: parsed.bottom },
      width,
      height,
      viewportWidth,
      viewportHeight,
    );
  } catch {
    return null;
  }
}

/** Three headline tiles for the expanded panel, tone-coded by threshold. */
export type HudTile = {
  value: string;
  label: string;
  tone: "ok" | "warn" | "bad";
};

export function getHudTiles(snapshot: PerfSnapshot): HudTile[] {
  const fps =
    snapshot.scrollFps.samples > 0 ? snapshot.scrollFps.average : snapshot.scrollFps.last;
  const render = snapshot.listRender.averageMs;
  return [
    {
      value: `${fps || "--"} fps`,
      label: "滚动帧率",
      tone: fps >= 50 ? "ok" : fps >= 30 ? "warn" : "bad",
    },
    {
      value: `${render.toFixed(1)} ms`,
      label: "列表渲染",
      tone: render <= 8 ? "ok" : render <= 16 ? "warn" : "bad",
    },
    {
      value: `${snapshot.longTasks.count}`,
      label: "长任务",
      tone:
        snapshot.longTasks.count === 0
          ? "ok"
          : snapshot.longTasks.maxMs > 100
            ? "bad"
            : "warn",
    },
  ];
}

const hudToneColor: Record<HudTile["tone"], string> = {
  ok: "#4ade80",
  warn: "#fbbf24",
  bad: "#f87171",
};

// Host: a bottom-anchored box the size of the pill. The pill is its only
// in-flow child, so the host box tracks the pill exactly and the panel
// floats above it (absolute, right-aligned): expanding never shifts the
// pill, and the panel always opens upward from wherever the pill sits.
const panelStyles: Partial<CSSStyleDeclaration> = {
  position: "fixed",
  right: "12px",
  bottom: "12px",
  zIndex: "2147483647",
  pointerEvents: "none",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
};

const pillStyles: Partial<CSSStyleDeclaration> = {
  pointerEvents: "auto",
  display: "inline-flex",
  alignItems: "center",
  gap: "6px",
  padding: "4px 11px",
  borderRadius: "999px",
  border: "1px solid rgba(148, 163, 184, 0.35)",
  background: "rgba(7, 10, 16, 0.88)",
  color: "#c9d6ea",
  font: "inherit",
  fontSize: "10px",
  letterSpacing: "0.06em",
  cursor: "grab",
  boxShadow: "0 4px 16px rgba(0, 0, 0, 0.45)",
  userSelect: "none",
};

const panelBodyStyles: Partial<CSSStyleDeclaration> = {
  pointerEvents: "auto",
  position: "absolute",
  right: "0",
  // The host box is the pill's box: the panel sits 6px above the pill and
  // grows upward with its content, so it never pushes the pill down or
  // leaves the bottom of the viewport. A flex column keeps the header, the
  // legend and the summary tiles pinned while only the metric rows scroll.
  bottom: "calc(100% + 6px)",
  display: "flex",
  flexDirection: "column",
  width: `${HUD_PANEL_WIDTH}px`,
  maxHeight: "min(560px, calc(100vh - 96px))",
  borderRadius: "12px",
  border: "1px solid rgba(148, 163, 184, 0.28)",
  background: "rgba(7, 10, 16, 0.94)",
  color: "#c9d6ea",
  fontSize: "11px",
  lineHeight: "1.5",
  padding: "0",
  boxShadow: "0 12px 32px rgba(0, 0, 0, 0.55)",
};

/**
 * The scrollable region under the resident tiles: with every metric section
 * expanded the content overflows, and the scroll must never carry the legend
 * or the summary tiles with it — the headline numbers stay readable while the
 * reader walks the detail table.
 */
const hudScrollStyles: Partial<CSSStyleDeclaration> = {
  flex: "1 1 auto",
  minHeight: "0",
  overflowY: "auto",
  overscrollBehavior: "contain",
};

/** One-line legend that teaches the tone colours used by the tiles and rows. */
const toneLegendStyles: Partial<CSSStyleDeclaration> = {
  display: "flex",
  gap: "12px",
  padding: "6px 12px 0",
  fontSize: "9px",
  letterSpacing: "0.04em",
  color: "#7f96b5",
  whiteSpace: "nowrap",
};

const toneDotStyles: Partial<CSSStyleDeclaration> = {
  display: "inline-block",
  width: "6px",
  height: "6px",
  borderRadius: "50%",
  flex: "0 0 auto",
};

const hudBarStyles: Partial<CSSStyleDeclaration> = {
  display: "flex",
  alignItems: "center",
  gap: "7px",
  padding: "9px 12px 8px",
  borderBottom: "1px solid rgba(148, 163, 184, 0.18)",
  cursor: "grab",
  userSelect: "none",
  color: "#e8f0ff",
  fontSize: "10px",
  fontWeight: "700",
  letterSpacing: "0.12em",
  flex: "0 0 auto",
};

const collapseButtonStyles: Partial<CSSStyleDeclaration> = {
  marginLeft: "auto",
  width: "20px",
  height: "20px",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "0",
  borderRadius: "5px",
  border: "1px solid rgba(148, 163, 184, 0.3)",
  background: "transparent",
  color: "#c9d6ea",
  font: "inherit",
  fontSize: "11px",
  lineHeight: "1",
  cursor: "pointer",
};

const tilesRowStyles: Partial<CSSStyleDeclaration> = {
  display: "grid",
  gridTemplateColumns: "repeat(3, 1fr)",
  gap: "6px",
  padding: "10px 12px 2px",
};

const tileStyles: Partial<CSSStyleDeclaration> = {
  borderRadius: "8px",
  border: "1px solid rgba(148, 163, 184, 0.2)",
  background: "rgba(148, 163, 184, 0.07)",
  padding: "7px 8px 6px",
  textAlign: "center",
};

const tileValueStyles: Partial<CSSStyleDeclaration> = {
  fontSize: "14px",
  fontWeight: "700",
  fontVariantNumeric: "tabular-nums",
  letterSpacing: "0.02em",
};

const tileLabelStyles: Partial<CSSStyleDeclaration> = {
  marginTop: "2px",
  fontSize: "9px",
  letterSpacing: "0.1em",
  color: "#7f96b5",
};

const sectionTitleStyles: Partial<CSSStyleDeclaration> = {
  margin: "10px 12px 0",
  paddingBottom: "3px",
  fontSize: "9px",
  fontWeight: "700",
  letterSpacing: "0.14em",
  color: "#8fa8c7",
  borderBottom: "1px solid rgba(148, 163, 184, 0.14)",
  display: "flex",
  justifyContent: "space-between",
  gap: "8px",
};

const sectionDocStyles: Partial<CSSStyleDeclaration> = {
  margin: "3px 12px 0",
  fontSize: "9.5px",
  color: "#647c9b",
};

const rowStyles: Partial<CSSStyleDeclaration> = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "baseline",
  gap: "10px",
  padding: "2px 12px 0",
};

const rowLabelStyles: Partial<CSSStyleDeclaration> = {
  color: "#7f96b5",
  flex: "0 0 auto",
};

const rowValueStyles: Partial<CSSStyleDeclaration> = {
  margin: "0",
  color: "#e8f0ff",
  fontVariantNumeric: "tabular-nums",
  textAlign: "right",
  whiteSpace: "pre-wrap",
};

const usageStyles: Partial<CSSStyleDeclaration> = {
  margin: "10px 0 0",
  padding: "8px 12px 10px",
  borderTop: "1px solid rgba(148, 163, 184, 0.18)",
  fontSize: "9.5px",
  lineHeight: "1.6",
  color: "#647c9b",
  whiteSpace: "pre-wrap",
};

/**
 * Static documentation rendered expanded under the resident tiles: what each
 * metric measures and how to read it. Rows stay label→value pairs so the
 * table scans as columns instead of prose; the muted line under each title
 * says what the numbers mean. Labels are Chinese-first — the panel is a
 * reading surface, not an i18n experiment.
 */
const metricSections: Array<{
  title: string;
  doc: string;
  rows: Array<{
    label: string;
    value: (snapshot: PerfSnapshot) => string;
    tone?: (snapshot: PerfSnapshot) => HudTile["tone"] | undefined;
  }>;
}> = [
  {
    title: "加载 LOAD",
    doc: "导航开始到应用就绪 / 首帧内容（FCP）/ 最大内容（LCP）；本地服务下通常都在 1s 内",
    rows: [
      { label: "应用就绪", value: (s) => `${s.appReadyMs ?? "--"} ms` },
      {
        label: "首帧 / 最大内容",
        value: (s) =>
          `${s.firstContentfulPaintMs ?? "--"} / ${s.largestContentfulPaintMs ?? "--"} ms`,
      },
    ],
  },
  {
    title: "滚动 SCROLL FPS",
    doc: "仅在实际滚动时采样，一个手势一个样本；最差 是最差的一次手势",
    rows: [
      {
        label: "最近 · 平均 · 最差",
        value: (s) =>
          `${s.scrollFps.last} / ${s.scrollFps.average} / ${s.scrollFps.worst} fps`,
        tone: (s) => {
          // No gesture yet is "no data", not a degraded signal: the row stays
          // neutral until a real scroll sample exists.
          if (s.scrollFps.samples === 0) {
            return undefined;
          }
          const fps =
            s.scrollFps.samples > 0 ? s.scrollFps.average : s.scrollFps.last;
          return fps >= 50 ? "ok" : fps >= 30 ? "warn" : "bad";
        },
      },
      { label: "滚动手势数", value: (s) => `${s.scrollFps.samples}` },
    ],
  },
  {
    title: "列表渲染 LIST RENDER",
    doc: "RUN HISTORY 每次提交渲染的耗时；平均稳定在个位数毫秒属正常",
    rows: [
      {
        label: "最近 · 平均 · 最大",
        value: (s) =>
          `${s.listRender.lastMs.toFixed(1)} / ${s.listRender.averageMs.toFixed(1)} / ${s.listRender.maxMs.toFixed(1)} ms`,
        tone: (s) =>
          s.listRender.averageMs <= 8
            ? "ok"
            : s.listRender.averageMs <= 16
              ? "warn"
              : "bad",
      },
      {
        label: "渲染次数 / 行数",
        value: (s) => `${s.listRender.count} / ${s.listRender.lastRows}`,
      },
    ],
  },
  {
    title: "网络 NETWORK",
    doc: "接口是 /api/*（事件流、快照、健康检查），静态是控制台资源；流式下接口请求随事件批次增长属预期",
    rows: [
      {
        label: "接口 / 静态请求",
        value: (s) => `${s.network.apiRequests} / ${s.network.assetRequests} 次`,
      },
      {
        label: "传输体积",
        value: (s) => `${(s.network.transferBytes / 1024).toFixed(0)} KB`,
      },
    ],
  },
  {
    title: "长任务 LONG TASKS",
    doc: "阻塞主线程超过 50ms 的任务；排查卡顿先看最长一次的来源（通常是派生管线）",
    rows: [
      {
        label: "次数 / 累计",
        value: (s) => `${s.longTasks.count} / ${s.longTasks.totalMs.toFixed(0)} ms`,
      },
      {
        label: "最长一次",
        value: (s) => `${s.longTasks.maxMs} ms`,
        tone: (s) =>
          s.longTasks.count === 0
            ? "ok"
            : s.longTasks.maxMs > 100
              ? "bad"
              : "warn",
      },
    ],
  },
];

/**
 * Shown at the bottom of the expanded panel: how to toggle the panel from
 * Settings (the URL parameter is retired), how to read the same data from the
 * console, and the repeatable reproduction drivers.
 */
const usageCopy = [
  "面板开关在「设置 → 性能」；拖动标题或胶囊可移动面板，位置会记住",
  "控制台读取同样的数据：window.__astroPerf.snapshot()",
  "复现与对比：pnpm perf:fixture + pnpm perf:bench",
].join("\n");

/**
 * Mounts the opt-in HUD: a floating, collapsible panel the reader can
 * **drag anywhere** (pill and panel header both carry the drag; the place is
 * remembered across visits). Collapsed it is one pill with two headline
 * numbers; expanded it grows **upward** from the pill: the tone legend and
 * three tone-coded summary tiles stay resident at the top and every metric
 * section renders expanded below them — scrolling the panel only scrolls the
 * detail rows, so the headline numbers never leave the screen. Pure DOM on
 * purpose — React renders must not be influenced by the tool that measures
 * them — so expansion, drag and collapse are ordinary DOM state, not
 * component state. The React tree only decides *whether* the HUD exists (the
 * Settings → 性能 preference).
 *
 * Returns the teardown the owner calls on unmount (clears the refresh timer,
 * the resize re-clamp, and removes the host); `null` in a document-less
 * environment.
 */
export function mountPerfHud(
  getSnapshot: () => PerfSnapshot,
  doc: Document = document,
): (() => void) | null {
  if (typeof doc === "undefined") {
    return null;
  }
  const host = doc.createElement("div");
  host.id = "astro-perf-hud";
  Object.assign(host.style, panelStyles);

  const pill = doc.createElement("button");
  pill.type = "button";
  pill.className = "astro-perf-hud__toggle";
  pill.setAttribute("aria-expanded", "false");
  pill.setAttribute("aria-controls", "astro-perf-hud-panel");
  pill.title = "页面性能面板：点击展开，按住拖动可移动";
  Object.assign(pill.style, pillStyles);

  const panel = doc.createElement("div");
  panel.id = "astro-perf-hud-panel";
  panel.className = "astro-perf-hud__panel";
  panel.hidden = true;
  Object.assign(panel.style, panelBodyStyles);

  // Panel header doubles as the drag grip; the collapse button stays exempt.
  const hudBar = doc.createElement("div");
  Object.assign(hudBar.style, hudBarStyles);

  const grip = doc.createElement("span");
  grip.textContent = "⠿";
  grip.style.color = "#7f96b5";
  grip.style.fontSize = "12px";
  grip.setAttribute("aria-hidden", "true");

  const hudTitle = doc.createElement("span");
  hudTitle.textContent = "页面性能";

  const collapse = doc.createElement("button");
  collapse.type = "button";
  collapse.textContent = "—";
  collapse.title = "收起面板";
  collapse.setAttribute("aria-label", "收起性能面板");
  Object.assign(collapse.style, collapseButtonStyles);

  hudBar.append(grip, hudTitle, collapse);
  panel.append(hudBar);

  // One-line legend that teaches the tone colours the tiles and rows use.
  const legend = doc.createElement("div");
  Object.assign(legend.style, toneLegendStyles);
  for (const [tone, word] of [
    ["ok", "正常"],
    ["warn", "关注"],
    ["bad", "异常"],
  ] as const) {
    // Each entry is a flex pair: the tone dot first, then the label, with one
    // even gap between them. A text-node-then-append put the dot on the wrong
    // side and the leading space doubled the dot↔label margin.
    const item = doc.createElement("span");
    item.style.display = "inline-flex";
    item.style.alignItems = "center";
    item.style.gap = "5px";
    const dot = doc.createElement("span");
    Object.assign(dot.style, toneDotStyles);
    dot.style.background = hudToneColor[tone];
    dot.setAttribute("aria-hidden", "true");
    const label = doc.createElement("span");
    label.textContent = word;
    item.append(dot, label);
    legend.append(item);
  }
  panel.append(legend);

  const tilesRow = doc.createElement("div");
  Object.assign(tilesRow.style, tilesRowStyles);
  const tileValueNodes = getHudTiles(getSnapshot()).map(({ value, label }) => {
    const tile = doc.createElement("div");
    Object.assign(tile.style, tileStyles);
    const tileValue = doc.createElement("div");
    Object.assign(tileValue.style, tileValueStyles);
    tileValue.textContent = value;
    const tileLabel = doc.createElement("div");
    Object.assign(tileLabel.style, tileLabelStyles);
    tileLabel.textContent = label;
    tile.append(tileValue, tileLabel);
    tilesRow.append(tile);
    return tileValue;
  });
  panel.append(tilesRow);

  // Every metric section renders expanded in its own scroll region: the
  // legend and the summary tiles above it are pinned (flex siblings outside
  // the scroller), so walking the detail table never moves the headline
  // numbers off the screen. No disclosure control — the panel is a table that
  // is always fully readable, not an accordion.
  const scrollBody = doc.createElement("div");
  scrollBody.className = "astro-perf-hud__scroll";
  Object.assign(scrollBody.style, hudScrollStyles);
  panel.append(scrollBody);

  const rowValueNodes: Array<{
    node: HTMLElement;
    read: (snapshot: PerfSnapshot) => string;
    tone?: (snapshot: PerfSnapshot) => HudTile["tone"] | undefined;
  }> = [];
  for (const section of metricSections) {
    const title = doc.createElement("div");
    Object.assign(title.style, sectionTitleStyles);
    title.textContent = section.title;
    const note = doc.createElement("p");
    Object.assign(note.style, sectionDocStyles);
    note.textContent = section.doc;
    scrollBody.append(title, note);
    for (const row of section.rows) {
      const rowNode = doc.createElement("div");
      Object.assign(rowNode.style, rowStyles);
      const label = doc.createElement("span");
      Object.assign(label.style, rowLabelStyles);
      label.textContent = row.label;
      const value = doc.createElement("span");
      Object.assign(value.style, rowValueStyles);
      rowNode.append(label, value);
      scrollBody.append(rowNode);
      rowValueNodes.push({ node: value, read: row.value, tone: row.tone });
    }
  }

  const usage = doc.createElement("p");
  Object.assign(usage.style, usageStyles);
  usage.textContent = usageCopy;
  scrollBody.append(usage);

  // Drag: the pill and the panel header move the host. A press that never
  // moves past the threshold stays a click (the pill toggles expansion); a
  // real drag persists the dropped position. The host switches from its
  // default bottom-right anchor to left/bottom on the first placement: the
  // pill's *bottom edge* is what gets pinned, so the panel always opens
  // upward and expansion can never leave the viewport through the bottom.
  let justDragged = false;
  const placeAt = (left: number, bottom: number) => {
    host.style.left = `${left}px`;
    host.style.bottom = `${bottom}px`;
    host.style.top = "auto";
    host.style.right = "auto";
  };

  // The host box is the pill's box (the panel floats above it), so the pill's
  // own width/height is what the clamp and the restore need.
  const pillWidth = () => pill.offsetWidth || 240;
  const pillHeight = () => pill.offsetHeight || 32;

  const storedPosition = resolveHudPosition(
    readHudStorage(HUD_POSITION_KEY),
    pillWidth(),
    pillHeight(),
    window.innerWidth,
    window.innerHeight,
  );
  if (storedPosition) {
    placeAt(storedPosition.left, storedPosition.bottom);
  }

  const persistPosition = () => {
    const rect = host.getBoundingClientRect();
    writeHudPosition({
      left: Math.round(rect.left),
      bottom: Math.round(window.innerHeight - rect.bottom),
    });
  };

  const clampIntoViewport = () => {
    if (host.style.left === "" || host.style.bottom === "") {
      return;
    }
    const rect = host.getBoundingClientRect();
    const next = clampHudPosition(
      {
        left: rect.left,
        bottom: window.innerHeight - rect.bottom,
      },
      rect.width,
      rect.height,
      window.innerWidth,
      window.innerHeight,
    );
    placeAt(next.left, next.bottom);
  };

  const attachDrag = (handle: HTMLElement) => {
    handle.addEventListener("pointerdown", (event: PointerEvent) => {
      if (event.button !== 0) {
        return;
      }
      const startPoint = { x: event.clientX, y: event.clientY };
      const rect = host.getBoundingClientRect();
      const grabOffset = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      let dragging = false;
      const onMove = (moveEvent: PointerEvent) => {
        if (
          !dragging &&
          Math.hypot(moveEvent.clientX - startPoint.x, moveEvent.clientY - startPoint.y) < 4
        ) {
          return;
        }
        if (!dragging) {
          dragging = true;
          // While a drag is live the whole page reads as the grip: the cursor
          // must not flicker back to an arrow whenever the pointer outruns
          // the pill for a frame.
          doc.body.style.cursor = "grabbing";
        }
        handle.setPointerCapture?.(event.pointerId);
        // Convert the grabbed top-left back to the pinned bottom edge: the
        // pill's bottom must land where the reader dropped it, and the panel
        // then grows upward from that edge.
        const next = clampHudPosition(
          {
            left: moveEvent.clientX - grabOffset.x,
            bottom:
              window.innerHeight -
              (moveEvent.clientY - grabOffset.y) -
              host.offsetHeight,
          },
          host.offsetWidth,
          host.offsetHeight,
          window.innerWidth,
          window.innerHeight,
        );
        placeAt(next.left, next.bottom);
      };
      const onUp = () => {
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onUp);
        handle.removeEventListener("pointercancel", onUp);
        doc.body.style.cursor = "";
        if (!dragging) {
          return;
        }
        persistPosition();
        // The pill's click fires right after pointerup: swallow the one that
        // ends a drag so dropping the HUD never toggles it.
        justDragged = true;
        window.setTimeout(() => {
          justDragged = false;
        }, 0);
      };
      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", onUp);
      handle.addEventListener("pointercancel", onUp);
    });
  };

  attachDrag(pill);
  attachDrag(hudBar);
  // The collapse button lives inside the drag grip: dragging must not start
  // from it, and its click must reach it.
  collapse.addEventListener("pointerdown", (event) => event.stopPropagation());

  const render = () => {
    const snapshot = getSnapshot();
    pill.textContent = formatHudHeadline(snapshot);
    getHudTiles(snapshot).forEach((tile, index) => {
      const node = tileValueNodes[index];
      node.textContent = tile.value;
      node.style.color = hudToneColor[tile.tone];
    });
    rowValueNodes.forEach(({ node, read, tone }) => {
      node.textContent = read(snapshot);
      const toneValue = tone?.(snapshot);
      node.style.color = toneValue ? hudToneColor[toneValue] : "#e8f0ff";
    });
  };
  render();

  let expanded = false;
  const setExpanded = (next: boolean) => {
    expanded = next;
    panel.hidden = !next;
    // The pill keeps its layout box while the panel is open: the host is
    // sized by the pill and the panel anchors to it — `display: none` would
    // collapse the host and re-anchor the panel, so hide it visually only.
    pill.style.visibility = next ? "hidden" : "visible";
    pill.setAttribute("aria-expanded", String(next));
  };
  pill.addEventListener("click", () => {
    if (!justDragged) {
      setExpanded(!expanded);
    }
  });
  collapse.addEventListener("click", () => setExpanded(false));

  host.append(panel, pill);
  doc.body.appendChild(host);
  // The viewport is not settled while the module boots (an embedded browser
  // can still report a tiny window), so a restored position is re-clamped
  // once real layout exists — that is what keeps a saved spot from snapping
  // to the top-left corner on load.
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(clampIntoViewport);
  });

  const timer = window.setInterval(render, HUD_UPDATE_MS);
  window.addEventListener("resize", clampIntoViewport, { passive: true });
  // The React owner (Settings → 性能) calls this on unmount; it is idempotent
  // so StrictMode's mount/unmount/mount double-invocation is safe.
  let disconnected = false;
  return () => {
    if (disconnected) {
      return;
    }
    disconnected = true;
    window.clearInterval(timer);
    window.removeEventListener("resize", clampIntoViewport);
    host.remove();
  };
}

function readHudStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeHudStorage(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable (private mode): the HUD stays session-only.
  }
}

function writeHudPosition(position: HudPosition) {
  writeHudStorage(HUD_POSITION_KEY, JSON.stringify(position));
}
