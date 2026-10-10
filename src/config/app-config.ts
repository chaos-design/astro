import { Monitor, Moon, Sun } from "lucide-react";
import type { PlatformId } from "@/types/trace";

export type ActiveView = "topology" | "trajectory";
export type Theme = "dark" | "light" | "system";

type AppDefaults = {
  activeView: ActiveView;
  consoleOpenMinWidth: number;
  deepView: boolean;
  guideOpen: boolean;
  historyOpenMinWidth: number;
  menuOpen: boolean;
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
  historyOpenMinWidth: 900,
  menuOpen: false,
  platform: "codex",
  replayCursor: 0,
  replayMode: false,
  replayPlaying: false,
  replaySpeed: 1,
  theme: "dark",
};

/**
 * Release string shown in the application header. Kept in sync with the
 * root package.json version and asserted by tests/app-config.test.ts.
 */
export const appVersion = "0.0.2-alpha.1";

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
 * Stable layout constraints for dense, nested history content.
 */
export const appLayout = {
  historyPromptListMaxHeight: 270,
  historyPromptRowEstimate: 116,
} as const;

/**
 * Namespaced browser-storage keys. Every current key starts with ASTROX_ so
 * this application's preferences remain distinguishable from other products.
 */
export const storageKeys = {
  consoleOpen: "ASTROX_CONSOLE_OPEN",
  historyOpen: "ASTROX_HISTORY_OPEN",
  inspectorTab: "ASTROX_INSPECTOR_TAB",
  platform: "ASTROX_PLATFORM",
  theme: "ASTROX_THEME",
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
