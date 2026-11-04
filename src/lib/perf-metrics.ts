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
 * clears it) so regular usage never pays for HUD DOM updates. It floats at
 * the bottom edge of the page: a collapsed pill carries two headline
 * numbers, and expanding it documents every metric beside its live value.
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

/** One headline number for the collapsed pill, e.g. `60fps · 0.8ms`. */
export function formatHudHeadline(snapshot: PerfSnapshot): string {
  const fps = snapshot.scrollFps.samples > 0 ? snapshot.scrollFps.average : snapshot.scrollFps.last;
  return `${fps || "--"}fps · ${snapshot.listRender.averageMs.toFixed(1)}ms`;
}

/**
 * The HUD is draggable, so its place on the screen is the reader's choice.
 * The default anchors to the bottom-right edge; a dragged (or restored)
 * position pins with left/top instead.
 */
export type HudPosition = { left: number; top: number };

const HUD_POSITION_KEY = "astro:perf-hud-pos";
const HUD_EDGE = 8;

/** Clamps a position so the HUD stays fully inside the viewport. */
export function clampHudPosition(
  position: HudPosition,
  width: number,
  height: number,
  viewportWidth: number,
  viewportHeight: number,
): HudPosition {
  const maxLeft = Math.max(HUD_EDGE, viewportWidth - width - HUD_EDGE);
  const maxTop = Math.max(HUD_EDGE, viewportHeight - height - HUD_EDGE);
  return {
    left: Math.min(Math.max(HUD_EDGE, Math.round(position.left)), maxLeft),
    top: Math.min(Math.max(HUD_EDGE, Math.round(position.top)), maxTop),
  };
}

/**
 * Parses a stored position; `null` when absent or malformed so a corrupted
 * value falls back to the default edge anchor instead of breaking the HUD.
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
      typeof parsed.top !== "number" ||
      !Number.isFinite(parsed.left) ||
      !Number.isFinite(parsed.top)
    ) {
      return null;
    }
    return clampHudPosition(
      { left: parsed.left, top: parsed.top },
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

const panelStyles: Partial<CSSStyleDeclaration> = {
  position: "fixed",
  right: "12px",
  bottom: "12px",
  zIndex: "2147483647",
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-end",
  gap: "6px",
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
  width: "336px",
  maxHeight: "min(520px, calc(100vh - 96px))",
  overflowY: "auto",
  borderRadius: "12px",
  border: "1px solid rgba(148, 163, 184, 0.28)",
  background: "rgba(7, 10, 16, 0.94)",
  color: "#c9d6ea",
  fontSize: "11px",
  lineHeight: "1.5",
  padding: "0",
  boxShadow: "0 12px 32px rgba(0, 0, 0, 0.55)",
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
  position: "sticky",
  top: "0",
  background: "rgba(7, 10, 16, 0.96)",
  zIndex: "1",
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
 * Static documentation shown inside the expanded panel: what each metric
 * measures and how to read it. Rows stay label→value pairs so the panel scans
 * as a table instead of prose; the muted line under each title says what the
 * numbers mean.
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
    doc: "导航开始到首次提交渲染 / 首次内容绘制 / 最大内容绘制；本地服务下通常都在 1s 内",
    rows: [
      { label: "ready", value: (s) => `${s.appReadyMs ?? "--"} ms` },
      {
        label: "FCP / LCP",
        value: (s) =>
          `${s.firstContentfulPaintMs ?? "--"} / ${s.largestContentfulPaintMs ?? "--"} ms`,
      },
    ],
  },
  {
    title: "滚动 SCROLL FPS",
    doc: "仅在实际滚动时采样，一个手势一个样本；worst 是最差的一次手势",
    rows: [
      {
        label: "last / avg / worst",
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
      { label: "手势数", value: (s) => `${s.scrollFps.samples}` },
    ],
  },
  {
    title: "列表渲染 LIST RENDER",
    doc: "RUN HISTORY 每次提交渲染的耗时；avg 稳定在个位数毫秒属正常",
    rows: [
      {
        label: "last / avg / max",
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
        label: "提交次数 / 行数",
        value: (s) => `${s.listRender.count} / ${s.listRender.lastRows}`,
      },
    ],
  },
  {
    title: "网络 NETWORK",
    doc: "api 是 /api/*（事件流、快照、健康检查），静态是控制台资源；流式下 api 随事件批次增长属预期",
    rows: [
      {
        label: "api / 静态",
        value: (s) => `${s.network.apiRequests} / ${s.network.assetRequests} 请求`,
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
        label: "最长",
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

const usageCopy = [
  "?perf=0 关闭并清除记忆 · 拖动标题或胶囊可移动面板",
  "控制台读取同样数据：window.__astroPerf.snapshot()",
  "复现与对比：pnpm perf:fixture + pnpm perf:bench",
].join("\n");

/**
 * Mounts the opt-in HUD: a floating, collapsible panel that the reader can
 **drag anywhere** (pill and panel header both carry the drag; the place is
 * remembered across visits). Collapsed it is one pill with two headline
 * numbers; expanded it shows three tone-coded tiles plus every metric as
 * label→value rows. Pure DOM on purpose — React renders must not be
 * influenced by the tool that measures them — so expansion, drag and collapse
 * are ordinary DOM state, not component state.
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
  hudTitle.textContent = "PERF 页面性能";

  const collapse = doc.createElement("button");
  collapse.type = "button";
  collapse.textContent = "—";
  collapse.title = "收起面板";
  collapse.setAttribute("aria-label", "收起性能面板");
  Object.assign(collapse.style, collapseButtonStyles);

  hudBar.append(grip, hudTitle, collapse);
  panel.append(hudBar);

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
    panel.append(title, note);
    for (const row of section.rows) {
      const rowNode = doc.createElement("div");
      Object.assign(rowNode.style, rowStyles);
      const label = doc.createElement("span");
      Object.assign(label.style, rowLabelStyles);
      label.textContent = row.label;
      const value = doc.createElement("span");
      Object.assign(value.style, rowValueStyles);
      rowNode.append(label, value);
      panel.append(rowNode);
      rowValueNodes.push({ node: value, read: row.value, tone: row.tone });
    }
  }

  const usage = doc.createElement("p");
  Object.assign(usage.style, usageStyles);
  usage.textContent = usageCopy;
  panel.append(usage);

  // Drag: the pill and the panel header move the host. A press that never
  // moves past the threshold stays a click (the pill toggles expansion); a
  // real drag persists the dropped position. The host switches from its
  // default bottom-right anchor to left/top on the first placement.
  let justDragged = false;
  const placeAt = (left: number, top: number) => {
    host.style.left = `${left}px`;
    host.style.top = `${top}px`;
    host.style.right = "auto";
    host.style.bottom = "auto";
  };

  const storedPosition = resolveHudPosition(
    readHudStorage(HUD_POSITION_KEY),
    host.offsetWidth || 240,
    host.offsetHeight || 32,
    window.innerWidth,
    window.innerHeight,
  );
  if (storedPosition) {
    placeAt(storedPosition.left, storedPosition.top);
  }

  const persistPosition = () => {
    const rect = host.getBoundingClientRect();
    writeHudPosition({
      left: Math.round(rect.left),
      top: Math.round(rect.top),
    });
  };

  const clampIntoViewport = () => {
    if (host.style.left === "" || host.style.top === "") {
      return;
    }
    const rect = host.getBoundingClientRect();
    const next = clampHudPosition(
      { left: rect.left, top: rect.top },
      rect.width,
      rect.height,
      window.innerWidth,
      window.innerHeight,
    );
    placeAt(next.left, next.top);
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
        dragging = true;
        handle.setPointerCapture?.(event.pointerId);
        const next = clampHudPosition(
          {
            left: moveEvent.clientX - grabOffset.x,
            top: moveEvent.clientY - grabOffset.y,
          },
          host.offsetWidth,
          host.offsetHeight,
          window.innerWidth,
          window.innerHeight,
        );
        placeAt(next.left, next.top);
      };
      const onUp = () => {
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onUp);
        handle.removeEventListener("pointercancel", onUp);
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
    pill.textContent = `PERF ${formatHudHeadline(snapshot)}`;
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
    pill.hidden = next;
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
  window.addEventListener(
    "pagehide",
    () => {
      window.clearInterval(timer);
      window.removeEventListener("resize", clampIntoViewport);
    },
    { once: true },
  );
  return host;
}

/**
 * Resolves the HUD preference (`?perf=1|0` over `localStorage`) and mounts the
 * HUD when enabled. Split from {@link mountPerfHud} so the storage write only
 * happens on an explicit query-param decision.
 */
export function setupPerfHud(query: string = window.location.search): void {
  const stored = readHudStorage(HUD_STORAGE_KEY);
  const enabled = resolvePerfHudEnabled(query, stored);
  const requested = new URLSearchParams(query).get("perf");
  if (requested === "1" || requested === "0") {
    if (enabled) {
      writeHudStorage(HUD_STORAGE_KEY, "1");
    } else {
      clearHudStorage(HUD_STORAGE_KEY);
    }
  }
  if (enabled) {
    mountPerfHud(getPerfSnapshot);
  }
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

function clearHudStorage(key: string) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Storage can be unavailable (private mode): the HUD stays session-only.
  }
}

function writeHudPosition(position: HudPosition) {
  writeHudStorage(HUD_POSITION_KEY, JSON.stringify(position));
}
