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

/**
 * How long the console keeps its event stream open before it stops syncing.
 * `off` means "no limit". Measured in hours because the console is expected to
 * survive a working day, not a calendar date.
 */
export type MaxSyncId = "1h" | "4h" | "8h" | "12h" | "24h" | "off";

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
  /**
   * How long the console keeps consuming the event stream. A console left open
   * overnight keeps every captured event and re-derives sessions from it; after
   * this budget it stops syncing and offers to resume. Eight hours covers a
   * working day, and the setting can be raised or removed.
   */
  maxSync: MaxSyncId;
  menuOpen: boolean;
  /**
   * The floating performance HUD (scroll fps, list render, long tasks). A
   * diagnostic tool, not part of the console: off by default so a normal
   * session never shows it, and it measures without touching captured events.
   */
  perfHud: boolean;
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
  maxSync: "8h",
  menuOpen: false,
  perfHud: false,
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

/**
 * Longest history window the service will ship in one snapshot.
 *
 * The service caps the same number; the client needs it to stop offering
 * "load earlier" once the window can no longer grow. One month is well past
 * the 7-day preference and keeps a single snapshot bounded.
 */
export const maxStreamWindowHours = 24 * 31;

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
 * Length of the console's sync window, in the order Settings lists them: two
 * rows of three. The default (eight hours) covers a working day; `off` leaves
 * the stream open until the tab closes, which is only sane on a machine you are
 * watching.
 */
export const maxSyncOptions: ReadonlyArray<{
  id: MaxSyncId;
  label: string;
  /** 0 means "no limit". */
  hours: number;
}> = [
  { id: "1h", label: "1 小时", hours: 1 },
  { id: "4h", label: "4 小时", hours: 4 },
  { id: "8h", label: "8 小时", hours: 8 },
  { id: "12h", label: "12 小时", hours: 12 },
  { id: "24h", label: "24 小时", hours: 24 },
  { id: "off", label: "不限制", hours: 0 },
];

export function isMaxSyncId(
  value: string | null | undefined,
): value is MaxSyncId {
  return maxSyncOptions.some((option) => option.id === value);
}

/** Hours until syncing stops; `0` means the stream is never stopped early. */
export function getMaxSyncHours(id: MaxSyncId): number {
  return (
    maxSyncOptions.find((option) => option.id === id) ?? maxSyncOptions[0]
  ).hours;
}

/** Human label of the sync window, for the status chip and the empty state. */
export function getMaxSyncLabel(id: MaxSyncId): string {
  return (
    maxSyncOptions.find((option) => option.id === id) ?? maxSyncOptions[0]
  ).label;
}

/**
 * Release string shown in the application header. Kept in sync with the
 * root package.json version and asserted by tests/app-config.test.ts.
 */
export const appVersion = "0.0.4";

/**
 * Timing values shared by live UI effects.
 * Keeping them here makes animation and refresh cadence explicit and tunable.
 */
export const appTimings = {
  activeRunTimeoutMs: 24 * 60 * 60 * 1_000,
  activeTransitionMs: 4_200,
  /**
   * How long the console waits for the local Demo dataset before giving up.
   * The file is a few kilobytes on the same machine, so a slow answer means
   * the service is down or wedged — the console reports it and keeps its
   * empty state instead of waiting on the skeleton.
   */
  demoFetchTimeoutMs: 4_000,
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
   * Visible run count at and below which RUN HISTORY renders sparse: the
   * panel has vertical room to spare, so card titles take the six-line clamp
   * (`.run-history__list.is-sparse` in src/styles.css) instead of the dense
   * two-line cut. Above it the compact clamp returns for scannability.
   */
  runHistorySparseListRows: 4,
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
  /**
   * API base for a deployed console (`?api=` persists here). Empty means
   * same-origin; see `src/lib/api-base.ts` for the resolution order.
   */
  apiBase: "ASTROX_API_BASE",
  consoleOpen: "ASTROX_CONSOLE_OPEN",
  deepView: "ASTROX_DEEP_VIEW",
  historyOpen: "ASTROX_HISTORY_OPEN",
  historyRange: "ASTROX_HISTORY_RANGE",
  inspectorTab: "ASTROX_INSPECTOR_TAB",
  maxSync: "ASTROX_MAX_SYNC",
  platform: "ASTROX_PLATFORM",
  /** The performance HUD toggle (Settings → 性能). */
  perfHud: "ASTROX_PERF_HUD",
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
 *
 * `astro:perf-hud` is the flag the retired `?perf=1` URL parameter wrote: it
 * holds `"1"` when the reader opted in, not `"true"`, so the initial read
 * (`resolvePerfHudInitial`, below) interprets it — a stored `"1"` still
 * arms the HUD, and the key is dropped when the new preference is first
 * written.
 */
export const legacyStorageKeys = {
  perfHud: "astro:perf-hud",
  platform: "astro-platform",
  theme: "astro-theme",
} as const;

/**
 * Resolves the performance HUD's initial armed state from storage only — the
 * `perf` URL parameter is retired; Settings → 性能 is the single switch.
 *
 * The primary key is written by the app as `"true"`/`"false"`. When it is
 * absent, the legacy `?perf=1`-era flag is honoured once: it stored `"1"`
 * (not `"true"`), so only that exact value still arms the HUD. Anything else
 * — no primary, no legacy, a garbage value — falls back to the default (off);
 * the app removes the legacy key on its first write.
 */
export function resolvePerfHudInitial(storage: {
  getItem(key: string): string | null;
}): boolean {
  const current = storage.getItem(storageKeys.perfHud);
  if (current === "true" || current === "false") {
    return current === "true";
  }
  return (current ?? storage.getItem(legacyStorageKeys.perfHud)) === "1"
    ? true
    : appDefaults.perfHud;
}

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
 *
 * This is the *permission*, not the data: the sample run itself is a local
 * resource file served by the service (`data/demo-events.json`), so the
 * console also requires the dataset to have loaded before it renders (`isDemo`
 * in `app.tsx`).
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

/**
 * The full gate that decides whether the sample run is rendered *now*. It needs
 * three things, and they are checked here so the rule has one definition:
 *
 *  - no captured events — the sample never overwrites real data;
 *  - the build permitting Demo (dev/test) **or** the reader's explicit
 *    `?demo=1` preview opt-in (production builds, the deployed preview page);
 *  - the dataset itself is loaded separately in `app.tsx`; this gate only
 *    says "are we allowed to", not "did it arrive".
 *
 * `demoOptIn` is the parsed result of the `?demo=1` param
 * (`isDemoPreviewEnabled`), so a production console keeps its honest empty
 * state unless the reader turns it on — the sample is an opt-in, never a
 * silent fallback to captured evidence.
 */
export function isDemoGateOpen(
  eventCount: number,
  environment: Pick<ImportMetaEnv, "DEV" | "MODE">,
  demoOptIn: boolean,
) {
  return eventCount === 0 && (shouldShowDemo(0, environment) || demoOptIn);
}

