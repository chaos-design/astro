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
  padding: "3px 10px",
  borderRadius: "999px",
  border: "1px solid rgba(148, 163, 184, 0.35)",
  background: "rgba(7, 10, 16, 0.88)",
  color: "#c9d6ea",
  font: "inherit",
  fontSize: "10px",
  letterSpacing: "0.06em",
  cursor: "pointer",
  boxShadow: "0 4px 16px rgba(0, 0, 0, 0.45)",
};

const panelBodyStyles: Partial<CSSStyleDeclaration> = {
  pointerEvents: "auto",
  width: "330px",
  maxHeight: "min(460px, calc(100vh - 96px))",
  overflowY: "auto",
  borderRadius: "10px",
  border: "1px solid rgba(148, 163, 184, 0.28)",
  background: "rgba(7, 10, 16, 0.94)",
  color: "#c9d6ea",
  fontSize: "11px",
  lineHeight: "1.55",
  padding: "10px 12px",
  boxShadow: "0 12px 32px rgba(0, 0, 0, 0.55)",
};

const sectionTitleStyles: Partial<CSSStyleDeclaration> = {
  margin: "8px 0 2px",
  fontSize: "9px",
  fontWeight: "700",
  letterSpacing: "0.12em",
  color: "#7f96b5",
};

const valueStyles: Partial<CSSStyleDeclaration> = {
  margin: "0",
  color: "#e8f0ff",
  fontVariantNumeric: "tabular-nums",
  whiteSpace: "pre-wrap",
};

const docStyles: Partial<CSSStyleDeclaration> = {
  margin: "1px 0 0",
  fontSize: "10px",
  color: "#7f96b5",
};

/**
 * Static documentation shown inside the expanded panel: what each metric
 * measures and how to read it. Kept beside the values so the HUD explains
 * itself instead of sending the reader to the manual.
 */
const metricSections: Array<{
  title: string;
  doc: string;
  read: (snapshot: PerfSnapshot) => string;
}> = [
  {
    title: "首屏 FIRST PAINT",
    doc: "ready：导航开始到应用首次提交渲染；fcp / lcp：首次内容绘制与最大内容绘制。本地服务下通常都在 1s 内，明显偏大先看静态资源与首屏快照体积。",
    read: (snapshot) =>
      `ready ${snapshot.appReadyMs ?? "--"}ms · fcp ${snapshot.firstContentfulPaintMs ?? "--"}ms · lcp ${snapshot.largestContentfulPaintMs ?? "--"}ms`,
  },
  {
    title: "滚动 SCROLL FPS",
    doc: "只在列表真实滚动时采样（一个手势一个样本）。avg 是会话平均，worst 是最差的一次手势；低于 45 需要关注该手势期间的长任务。",
    read: (snapshot) =>
      `last ${snapshot.scrollFps.last} · avg ${snapshot.scrollFps.average} · worst ${snapshot.scrollFps.worst}（${snapshot.scrollFps.samples} 次手势）`,
  },
  {
    title: "列表渲染 LIST RENDER",
    doc: "RUN HISTORY 每次提交渲染的耗时与行数。avg 稳定在个位数毫秒属正常；max 反映最差的一次提交（通常是快照落地或大批量事件）。",
    read: (snapshot) =>
      `last ${snapshot.listRender.lastMs.toFixed(1)}ms · avg ${snapshot.listRender.averageMs.toFixed(1)}ms · max ${snapshot.listRender.maxMs.toFixed(1)}ms · ${snapshot.listRender.count} 次 · ${snapshot.listRender.lastRows} 行`,
  },
  {
    title: "网络 NETWORK",
    doc: "api 是 /api/*（事件流、快照、健康检查），assets 是静态资源；字节数为传输体积。流式会话下 api 请求随事件批次增长属预期。",
    read: (snapshot) =>
      `${snapshot.network.totalRequests} 请求（api ${snapshot.network.apiRequests} · 静态 ${snapshot.network.assetRequests}） · ${(snapshot.network.transferBytes / 1024).toFixed(0)}KB`,
  },
  {
    title: "长任务 LONG TASKS",
    doc: "阻塞主线程超过 50ms 的任务。total 反映累计卡顿，max 是最严重的一次；流式高负载下 max 的来源通常在派生管线而非渲染。",
    read: (snapshot) =>
      `${snapshot.longTasks.count} 次 · 累计 ${snapshot.longTasks.totalMs.toFixed(0)}ms · 最长 ${snapshot.longTasks.maxMs}ms`,
  },
];

const usageCopy = [
  "?perf=1 开启（记住选择），?perf=0 关闭并清除；关闭后刷新页面不再出现。",
  "控制台可随时读取同样数据：window.__astroPerf.snapshot()。",
  "性能改动需要前后数字：pnpm perf:fixture（合成历史）+ pnpm perf:bench（逐阶段派生耗时）。",
].join("\n");

/**
 * Mounts the opt-in HUD: a floating, collapsible panel pinned to the bottom
 * edge of the page. Collapsed it is one pill with two headline numbers;
 * expanded it documents every metric beside its live value. Pure DOM on
 * purpose — React renders must not be influenced by the tool that measures
 * them — so expansion is ordinary DOM state, not component state.
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
  pill.title = "页面性能面板：点击展开各指标说明";
  Object.assign(pill.style, pillStyles);

  const panel = doc.createElement("div");
  panel.id = "astro-perf-hud-panel";
  panel.className = "astro-perf-hud__panel";
  panel.hidden = true;
  Object.assign(panel.style, panelBodyStyles);

  const header = doc.createElement("div");
  header.style.margin = "0 0 4px";
  header.style.color = "#e8f0ff";
  header.style.fontSize = "10px";
  header.style.fontWeight = "700";
  header.style.letterSpacing = "0.12em";
  header.textContent = "页面性能 PERF";

  const usage = doc.createElement("p");
  Object.assign(usage.style, docStyles);
  usage.style.marginTop = "10px";
  usage.style.borderTop = "1px solid rgba(148, 163, 184, 0.22)";
  usage.style.paddingTop = "8px";
  usage.style.whiteSpace = "pre-wrap";
  usage.textContent = usageCopy;

  panel.append(header);
  const valueNodes = metricSections.map(({ title, doc: sectionDoc }) => {
    const heading = doc.createElement("div");
    heading.textContent = title;
    Object.assign(heading.style, sectionTitleStyles);
    const value = doc.createElement("p");
    Object.assign(value.style, valueStyles);
    const note = doc.createElement("p");
    Object.assign(note.style, docStyles);
    note.textContent = sectionDoc;
    panel.append(heading, value, note);
    return value;
  });
  panel.append(usage);

  const render = () => {
    const snapshot = getSnapshot();
    pill.textContent = `PERF ${formatHudHeadline(snapshot)}`;
    metricSections.forEach(({ read }, index) => {
      valueNodes[index].textContent = read(snapshot);
    });
  };
  render();

  let expanded = false;
  const setExpanded = (next: boolean) => {
    expanded = next;
    panel.hidden = !next;
    pill.setAttribute("aria-expanded", String(next));
  };
  pill.addEventListener("click", () => {
    setExpanded(!expanded);
  });

  host.append(panel, pill);
  doc.body.appendChild(host);

  const timer = window.setInterval(render, HUD_UPDATE_MS);
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
