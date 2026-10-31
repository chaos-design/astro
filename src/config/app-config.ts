import { Monitor, Moon, Sun } from "lucide-react";
import type { PlatformId } from "@/types/trace";

export type ActiveView = "topology" | "trajectory";
export type HistoryRangeId =
  | "1h"
  | "3h"
  | "6h"
  | "12h"
  | "1d"
  | "3d"
  | "5d"
  | "7d";
export type Theme = "dark" | "light" | "system";

type AppDefaults = {
  activeView: ActiveView;
  consoleOpenMinWidth: number;
  deepView: boolean;
  guideOpen: boolean;
  /**
   * How much history RUN HISTORY and the global search dialog load by default.
   * A user preference (Settings → 默认时间范围), not a build constant.
   */
  historyRange: HistoryRangeId;
  historyOpenMinWidth: number;
  /**
   * Whether RUN HISTORY opens with the Live filter armed — only the messages
   * whose run is executing right now. Off by default: the filter can match
   * nothing, and a panel that opens empty reads as broken rather than as
   * "nothing is running".
   */
  liveView: boolean;
  menuOpen: boolean;
  /**
   * Fallback agent when no preference is stored. This mirrors the first entry
   * of the agent dropdown so the default selection is the top of the list.
   */
  platform: PlatformId;
  replayCursor: number;
  replayMode: boolean;
  replayPlaying: boolean;
  replaySpeed: number;
  theme: Theme;
};

/**
 * User-facing defaults used only when no persisted preference exists.
 * Width thresholds preserve the current responsive behavior on first load.
 */
export const appDefaults: AppDefaults = {
  activeView: "topology",
  consoleOpenMinWidth: 1180,
  deepView: true,
  guideOpen: false,
  historyRange: "3h",
  historyOpenMinWidth: 900,
  liveView: false,
  menuOpen: false,
  platform: "claude",
  replayCursor: 0,
  replayMode: false,
  replayPlaying: false,
  replaySpeed: 1,
  theme: "dark",
};

/**
 * Repository the header link points at. One constant for the icon, its tooltip
 * and the tests, so a rename never leaves a dead link in the console.
 */
export const appRepository = {
  label: "GitHub",
  title: "在 GitHub 上查看 ASTRO 源码",
  url: "https://github.com/chaos-design/astro",
} as const;

/**
 * Selectable history ranges, in the order the settings dialog lists them —
 * four per row: the hour choices on the first row, the day choices on the
 * second, from an hour to a week.
 *
 * Hours rather than calendar days on purpose: "最近 3 小时" must mean the same
 * span whether the console is opened at 09:00 or 23:00, and the same value is
 * reused by the global search dialog (whose hour/day presets are exactly
 * these; `today` / `yesterday` / `custom` exist only in that dialog).
 */
export const historyRangeOptions: ReadonlyArray<{
  id: HistoryRangeId;
  /** Short form for dense chrome, e.g. the RUN HISTORY empty state. */
  shortLabel: string;
  label: string;
  hours: number;
}> = [
  { id: "1h", shortLabel: "1 小时", label: "最近 1 小时", hours: 1 },
  { id: "3h", shortLabel: "3 小时", label: "最近 3 小时", hours: 3 },
  { id: "6h", shortLabel: "6 小时", label: "最近 6 小时", hours: 6 },
  { id: "12h", shortLabel: "12 小时", label: "最近 12 小时", hours: 12 },
  { id: "1d", shortLabel: "1 天", label: "最近 1 天", hours: 24 },
  { id: "3d", shortLabel: "3 天", label: "最近 3 天", hours: 3 * 24 },
  { id: "5d", shortLabel: "5 天", label: "最近 5 天", hours: 5 * 24 },
  { id: "7d", shortLabel: "7 天", label: "最近 7 天", hours: 7 * 24 },
];

/** Range used until the user picks another one in Settings. */
export const defaultHistoryRange: HistoryRangeId = appDefaults.historyRange;

export function isHistoryRangeId(
  value: string | null | undefined,
): value is HistoryRangeId {
  return historyRangeOptions.some((option) => option.id === value);
}

export function getHistoryRangeOption(range: HistoryRangeId) {
  return (
    historyRangeOptions.find((option) => option.id === range) ??
    historyRangeOptions[0]
  );
}

/** Span of a range in hours; the RUN HISTORY window is measured in these. */
export function getHistoryRangeHours(range: HistoryRangeId): number {
  return getHistoryRangeOption(range).hours;
}

/**
 * Release string shown in the application header. Kept in sync with the
 * root package.json version and asserted by tests/app-config.test.ts.
 */
export const appVersion = "0.0.3";

/**
 * Timing values shared by live UI effects.
 * Keeping them here makes animation and refresh cadence explicit and tunable.
 */
export const appTimings = {
  activeRunTimeoutMs: 24 * 60 * 60 * 1_000,
  activeTransitionMs: 4_200,
  replayStepBaseMs: 900,
  sessionDurationRefreshMs: 1_000,
} as const;

/**
 * Stable layout constraints for dense, nested history content and the
 * responsive studio header.
 */
export const appLayout = {
  historyPromptListMaxHeight: 300,
  historyPromptRowEstimate: 116,
  /**
   * Viewport width (px) at and below which the studio header collapses its
   * horizontal nav into the mobile disclosure menu. Must stay in step with the
   * `@media (max-width: 900px)` header rules in src/styles.css; the assertion
   * in tests/app-config.test.ts keeps the two from drifting apart.
   */
  headerNavCollapseMaxWidth: 900,
} as const;

/**
 * Namespaced browser-storage keys. Every current key starts with ASTROX_ so
 * this application's preferences remain distinguishable from other products.
 */
export const storageKeys = {
  activeView: "ASTROX_ACTIVE_VIEW",
  consoleOpen: "ASTROX_CONSOLE_OPEN",
  deepView: "ASTROX_DEEP_VIEW",
  historyOpen: "ASTROX_HISTORY_OPEN",
  historyRange: "ASTROX_HISTORY_RANGE",
  inspectorTab: "ASTROX_INSPECTOR_TAB",
  platform: "ASTROX_PLATFORM",
  runHistoryLiveView: "ASTROX_RUN_HISTORY_LIVE_VIEW",
  theme: "ASTROX_THEME",
} as const;

/**
 * Keys from earlier releases that are deliberately not read any more.
 *
 * `ASTROX_RUN_HISTORY_LIVE_FILTER` armed a view of *every* message of the
 * agent; the Live filter now shows only the executing messages. Its stored
 * `true` would therefore open the panel on a filter that matches nothing on an
 * idle machine, so the value is dropped rather than migrated — the new
 * preference is written alongside (and the old key removed) by the app.
 */
export const retiredStorageKeys = {
  runHistoryLiveFilter: "ASTROX_RUN_HISTORY_LIVE_FILTER",
} as const;

/**
 * Previous key names accepted during migration. They are removed as soon as
 * the corresponding ASTROX_ preference is written.
 */
export const legacyStorageKeys = {
  platform: "astro-platform",
  theme: "astro-theme",
} as const;

/**
 * Theme selector choices and their icons. The IDs are persisted as Theme
 * values while labels are used only in the visible selector.
 */
export const themeOptions: ReadonlyArray<{
  id: Theme;
  label: string;
  icon: typeof Sun;
}> = [
  { id: "light", label: "浅色", icon: Sun },
  { id: "dark", label: "深色", icon: Moon },
  { id: "system", label: "跟随系统", icon: Monitor },
];

/**
 * Resolved fallback used if local storage contains an unsupported theme value.
 */
export const defaultThemeOption =
  themeOptions.find((option) => option.id === appDefaults.theme) ??
  themeOptions[0];

/**
 * Column definitions used by the trajectory view. `lane` is the zero-based
 * layout index consumed by trajectory rows and connectors.
 */
export const trajectoryLanes = [
  { id: "input", label: "Input", lane: 0 },
  { id: "model", label: "Model", lane: 2 },
  { id: "tools", label: "Tools", lane: 1 },
] as const;

/**
 * Shared panel-header classes keep history, log, and inspector headers aligned.
 */
export const panelHeaderClass =
  "panel-header flex min-h-12 items-center justify-between gap-2 border-b border-[var(--line)] px-2.5 py-[9px]";
export const panelHeaderCopyClass = "flex min-w-0 flex-col";

/**
 * Default category labels for trajectory atoms when no atom-specific label is
 * defined. These values are intentionally short for the compact log layout.
 */
export const trajectoryKindLabels: Readonly<Record<string, string>> = {
  action: "GATE",
  agent: "AGENT",
  context: "MEMORY",
  eval: "EVAL",
  handoff: "HANDOFF",
  hook: "HOOK",
  input: "SYSTEM",
  loop: "LOOP",
  memory: "MEMORY",
  model: "MODEL",
  release: "OUTPUT",
  reply: "RESPONSE",
  skill: "SKILL",
  store: "STORE",
  tool: "TOOL",
  trace: "TRACE",
  trajectory: "TRACE",
  usage: "USAGE",
};

/**
 * Atom-specific trajectory labels that override the broader kind labels.
 */
export const trajectoryKeyLabels: Readonly<Record<string, string>> = {
  "memory.capture": "MEMORY",
  "memory.recall": "MEMORY",
  "prompt.input": "SYSTEM",
  "session.resume": "SYSTEM",
  "stage.checkpoint": "STORE",
  "stage.finish": "LOOP",
  "stage.start": "LOOP",
  observation: "CONTEXT",
  run: "SYSTEM",
};

/**
 * Demo data is allowed only during local development or automated test modes.
 * Production builds with no events must never present synthetic trace data.
 */
export function shouldShowDemo(
  eventCount: number,
  environment: Pick<ImportMetaEnv, "DEV" | "MODE">,
) {
  return (
    eventCount === 0 &&
    (environment.DEV || environment.MODE === "test")
  );
}
