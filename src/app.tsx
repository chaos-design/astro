import {
  Activity,
  Boxes,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleHelp,
  CircleStop,
  CircleX,
  Clock3,
  CornerUpRight,
  Download,
  File,
  FileInput,
  Focus,
  Folder,
  Link2,
  ListTree,
  LocateFixed,
  Loader2,
  Menu,
  Network,
  Pause,
  Play,
  Radio,
  RefreshCw,
  RotateCcw,
  Search,
  SkipBack,
  SkipForward,
  Sparkles,
  TerminalSquare,
  Timer,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import {
  lazy,
  memo,
  Suspense,
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  startTransition,
  useState,
  useSyncExternalStore,
} from "react";
import type {
  ComponentProps,
  CSSProperties,
  FormEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
  RefObject,
} from "react";
import { JsonViewer } from "./components/json-viewer";
import { AgentSelect } from "./components/agent-select";
import {
  ConsoleNotices,
  type Notice,
  type NoticeTone,
} from "./components/console-notices";
import { PromptContent } from "./components/prompt-content";
import { RepositoryLink } from "./components/repo-link";
import { RuntimeCanvas } from "./components/runtime-canvas";
import { SettingsDialog } from "./components/settings-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  guideAtomCopy,
  guideHighlightItems,
  guideHistoryStatusDescription,
  guideHistoryStatusItems,
  guideKindItems,
  guideLayerCopy,
  guideLineItems,
  guideObservabilityItems,
  guideReadSteps,
  guideSectionCopy,
  guideStatusItems,
} from "./config/atom-guide-copy";
import {
  appDefaults,
  appLayout,
  appTimings,
  appVersion,
  defaultThemeOption,
  getHistoryRangeHours,
  getHistoryRangeOption,
  getMaxSyncHours,
  getMaxSyncLabel,
  isHistoryRangeId,
  isMaxSyncId,
  legacyStorageKeys,
  maxStreamWindowHours,
  panelHeaderClass,
  panelHeaderCopyClass,
  retiredStorageKeys,
  resolvePerfHudInitial,
  isDemoGateOpen,
  shouldShowDemo,
  storageKeys,
  themeOptions,
  trajectoryLanes,
  type ActiveView,
  type HistoryRangeId,
  type MaxSyncId,
  type Theme,
} from "./config/app-config";
import {
  agentOptions,
  atomPlatformOptions,
  getAtomIdForEvent,
  getAtomPlatformConfig,
} from "./config/atom-platforms";
import {
  buildSessionPromptRuns,
  buildFlow,
  buildHarnessFlow,
  buildPairDurations,
  buildPairLinks,
  createSessionProjection,
  eventMeta,
  formatDuration,
  formatLogSequence,
  getEventSummary,
  getEventTimestamp,
  getExecutionInstruction,
  getFlowNodeIdForEvent,
  normalizeTraceEvent,
  parseImportedTrace,
  type TracePairLink,
} from "./lib/trace-model";
import {
  loadDemoEvents,
  isDemoPreviewEnabled,
  staticDemoDatasetEndpoint,
  type DemoLoadResult,
} from "./lib/demo-events";
import {
  joinApi,
  resolveApiBase,
} from "./lib/api-base";
import {
  readStorageBoolean,
  readStorageValue,
  writeStorageValue,
} from "./lib/local-storage";
import type { HistorySearchEntry } from "./lib/history-search";
import {
  matchesEventQuery,
  warmEventSearchCache,
} from "./lib/event-search";
import {
  type LogRowMetrics,
  LOG_ROW_ESTIMATE,
  LOG_ROW_GAP,
  LOG_TURN_ESTIMATE,
  buildLogLayout,
  findVisibleRange,
  includeTurnRow,
  resolveScrollTopForRow,
} from "./lib/log-window";
import {
  describeWorkspacePath,
} from "./lib/workspace-path";
import {
  OTHERS_AGENT_ID,
  canLoadMoreRunHistory,
  filterSessionsByAgent,
  nextRunHistoryVisibleHours,
  pinLiveRunHistory,
  scopeLiveRunIndex,
  selectLiveRunHistory,
  selectVisibleRunHistory,
} from "./lib/run-history-window";
import { capChangeResumesSync, getSyncStopDelay } from "./lib/sync-budget";
import { atomLevel, projectTraceEvents } from "./lib/atomic-projection";
import {
  atomTypeLabel,
  eventAtomType,
  type EventAtomType,
} from "./lib/atom-types";
import {
  buildTraceTurnIndex,
  buildTrajectoryMapSlots,
  buildTrajectoryModel,
  getTrajectorySegmentPosition,
  orderTrajectoryNewestFirst,
  type TrajectoryAtom,
  type TrajectoryMapSlot,
  type TrajectoryTurn,
} from "./lib/trajectory-model";
import {
  getPageVisibilitySnapshot,
  getServerPageVisibilitySnapshot,
  subscribePageVisibility,
} from "./lib/page-visibility";
import {
  type AtomSelection,
  isFollowingLive,
  isLiveFollowingLatest,
  isPromptExecuting,
  resolveLocateAtomId,
  resolveSelectedAtomId,
  toggleAtomSelection,
} from "./lib/atom-selection";
import { isSameEventSequence } from "./lib/event-snapshot";
import {
  collectLiveRunKeys,
  ensureExpandedRun,
  getPromptAtomSelection,
  getRunDisplayState,
  getRunFreshness,
  getRunHistoryDisplayState,
  getRunHistoryTerminalInfo,
  isLiveRunStatus,
  isSparseRunHistoryList,
  RUN_HISTORY_COARSE_REFRESH_MS,
  runTerminalReasonLabels,
  quantizeTimestamp,
  toggleExpandedRun,
} from "./lib/run-history-state";
import {
  attachScrollFpsTracker,
  getPerfSnapshot,
  markAppReady,
  mountPerfHud,
  recordListRender,
} from "./lib/perf-metrics";
import {
  getTraceEventKey,
  isUserQuestionEvent,
  isUserQuestionStartEvent,
} from "./lib/trace-event-kind";
import type {
  HarnessNode,
  HarnessNodeData,
  PlatformId,
  RunTerminalReason,
  SignalEdge,
  TraceEvent,
  TraceNode as TraceNodeType,
  TracePromptRun,
  TraceRunStatus,
  TraceSession,
} from "@/types/trace";

type InspectorTab = "input" | "output" | "raw";

/**
 * The history search dialog is ⌘K-only. Its chunk carries the calendar, the
 * filter menus and the index UI — none of which the first frame needs — so it
 * is loaded after the console paints instead of blocking it. The preload below
 * makes the first open immediate in practice.
 */
const LazyHistorySearch = lazy(() =>
  import("./components/history-search").then((module) => ({
    default: module.HistorySearch,
  })),
);

function preloadHistorySearch() {
  return import("./components/history-search");
}

/**
 * Shared empty collections. Reusing one instance keeps memoized children from
 * re-rendering on every parent render when there is nothing to show.
 */
const EMPTY_EVENTS: TraceEvent[] = [];
/**
 * Minimum horizontal slot per node in the trajectory lane overview. Below
 * roughly this width the segments stop being distinguishable (and clickable),
 * so the track scrolls instead of compressing further. Sized with the mark
 * itself: a 22px minimum keeps the blocks apart once they get short, and a
 * 52px slot leaves every single-atom mark clearly wide.
 */
const TRAJECTORY_MIN_SLOT_PX = 52;
/**
 * Upper bound on lane-overview marks per lane. A 10k-node run otherwise draws
 * 10k segments, which is both unreadable and expensive to paint; slots
 * aggregate consecutive nodes so the map stays a bounded timeline.
 */
const TRAJECTORY_MAP_MAX_SLOTS = 96;
type ActiveTransition = {
  fromId: string;
  toId: string;
  key: string;
};

function scrollRowWithinContainer(
  container: HTMLElement | null,
  row: HTMLElement | null,
  center: boolean,
) {
  if (!container || !row) {
    return;
  }
  if (!center) {
    row.scrollIntoView({ behavior: "smooth", block: "nearest" });
    return;
  }
  const containerBounds = container.getBoundingClientRect();
  const rowBounds = row.getBoundingClientRect();
  container.scrollTop =
    container.scrollTop +
    rowBounds.top -
    containerBounds.top -
    (container.clientHeight - rowBounds.height) / 2;
}

/**
 * Id shared by the mobile nav toggle and the header actions it discloses. The
 * same element is the horizontal desktop nav, so it is never aria-hidden.
 */
const headerNavMenuId = "studio-header-nav-menu";

// Reused Intl formatters: constructing one per call is expensive, and these
// run for every log/trajectory row on every render.
const clockFormatter = new Intl.DateTimeFormat(undefined, {
  hour12: false,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  fractionalSecondDigits: 3,
});
const runTimeFormatter = new Intl.DateTimeFormat(undefined, {
  hour12: false,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function formatClock(timestamp: string | number) {
  return clockFormatter.format(new Date(timestamp));
}

function formatDate(timestamp: string | number) {
  const date = new Date(timestamp);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function formatRunDate(timestamp: string | number) {
  return `${formatDate(timestamp)} ${runTimeFormatter.format(new Date(timestamp))}`;
}

/**
 * The trajectory's own durations (wall-time and closed-pair) use a stepped
 * unit rule so a value reads in the smallest honest unit: under 10s it is a
 * `ms` span, 10–60s a `s` span, then `m`, `h`, and `d` as it grows. Whole-second
 * `formatDuration` would print a 4s tool call as "4s" with no sub-second
 * siblings, so the trajectory resolves each span to its dominant unit instead
 * of compounding (`1m 4s`) — one number per tier, stepping ms → s → m → h → d.
 */
function formatDurationMs(milliseconds: number) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) {
    return "--";
  }
  const s = milliseconds / 1000;
  if (s < 10) {
    return `${Math.round(milliseconds)}ms`;
  }
  const m = s / 60;
  if (m < 1) {
    return `${Math.round(s)}s`;
  }
  const h = m / 60;
  if (h < 1) {
    return `${Math.round(m)}m`;
  }
  const d = h / 24;
  if (d < 1) {
    return `${Math.round(h)}h`;
  }
  return `${Math.round(d)}d`;
}

/**
 * The duration colour spec, a single source for how a span's magnitude is
 * coloured. It is a heat scale, not a status colour: a fast tool call reads
 * calm (completed), a slow one warms to amber, and a long one reads failed-red
 * so a hot spot is visible at a glance. The tiers track the stepped units —
 * <10s, <1m, <10m, beyond — so the colour answers "is this slow" at a glance.
 * Applied to the trajectory's wall-time and pair badges; the badge keeps its
 * shape but lets the colour encode speed.
 */
type DurationHeat = "idle" | "fast" | "normal" | "slow" | "very-slow";

const DURATION_HEAT = {
  idle: 0,
  fast: 10_000,
  normal: 60_000,
  slow: 600_000,
} as const;

function durationHeatClass(milliseconds: number): DurationHeat {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) {
    return "idle";
  }
  if (milliseconds < DURATION_HEAT.fast) {
    return "fast";
  }
  if (milliseconds < DURATION_HEAT.normal) {
    return "normal";
  }
  if (milliseconds < DURATION_HEAT.slow) {
    return "slow";
  }
  return "very-slow";
}

/**
 * The trajectory legend: the status markers (what each dot colour means) and
 * the duration heat tiers (what each duration colour means). The user reported
 * the colour + marker codes as unclear, so the view carries this key — the
 * same variables the dots and badges use, so the legend can never drift from
 * the marks it explains.
 */
const STATUS_LEGEND: ReadonlyArray<{ label: string; tone: string }> = [
  { label: "complete", tone: "complete" },
  { label: "running", tone: "running" },
  { label: "waiting", tone: "waiting" },
  { label: "failed", tone: "failed" },
];

/**
 * The duration heat tiers, labelled by the threshold that opens the tier (one
 * number, matching the stepped units the row prints: <10s, <1m, <10m, ≥10m).
 */
const DURATION_LEGEND: ReadonlyArray<{ label: string; heat: DurationHeat }> = [
  { heat: "fast", label: "<10s" },
  { heat: "normal", label: "<1m" },
  { heat: "slow", label: "<10m" },
  { heat: "very-slow", label: "≥10m" },
];

function getEventAction(event: TraceEvent) {
  if (isUserQuestionStartEvent(event)) {
    return "WAITING";
  }
  if (isUserQuestionEvent(event)) {
    return event.eventName === "PostToolUseFailure" ||
      event.eventName === "PermissionDenied"
      ? "FAILED"
      : "ANSWERED";
  }
  if (["Interrupt", "SessionEnd"].includes(event.eventName)) {
    return "TERMINATED";
  }
  if (["PreToolUse", "SessionStart", "SubagentStart"].includes(event.eventName)) {
    return "START";
  }
  if (
    ["PostToolUse", "Stop", "SubagentStop"].includes(
      event.eventName,
    )
  ) {
    return "END";
  }
  if (event.eventName === "PostToolUseFailure") {
    return "FAILED";
  }
  return "CAPTURED";
}

function getShortId(id: unknown) {
  const value = String(id || "");
  return value.length > 16
    ? `${value.slice(0, 7)}...${value.slice(-5)}`
    : value;
}

function buildLogEntries(events: TraceEvent[], platformId: string) {
  const turnByEventId = buildTraceTurnIndex(events);
  // The paired duration map is the single place a LOG row learns how long a
  // closed pair took; unpaired events get `null` and show no badge.
  const pairDurations = buildPairDurations(events);
  // Same pairing truth, for the marker: both halves of a pair carry a shared
  // pairId and each other's id, so a click can locate the other half. `T<n>`
  // names the LOG separator above the row and `#<row>` names the partner's
  // LOG row — both come from the same indices this row is printed with.
  const pairLinks = buildPairLinks(events, turnByEventId);
  return events.map((event, index) => ({
    event,
    index,
    // The TYPE badge reads the primary atom's key/kind, the same atom data
    // the trajectory badge and hover card use — never the event name.
    atomType: eventAtomType(event, platformId),
    pairDuration: pairDurations.get(event.id) ?? null,
    pairLink: pairLinks.get(event.id) ?? null,
    turn: turnByEventId.get(event.id) ?? 1,
  }));
}

function getPayloadForTab(
  node: TraceNodeType | null,
  event: TraceEvent | null,
  tab: InspectorTab,
) {
  if (!node || !event) {
    return null;
  }

  const start = node.data.startEvent;
  const end = node.data.endEvent;

  if (tab === "input") {
    if (start.eventName === "UserPromptSubmit") {
      return start.payload;
    }
    return (
      start.payload.tool_input || {
        prompt: start.payload.prompt,
        message: start.payload.message,
        source: start.payload.source,
      }
    );
  }

  if (tab === "output") {
    return (
      end?.payload?.tool_response || {
        message:
          event.payload.last_assistant_message ||
          event.payload.message ||
          null,
      }
    );
  }

  return event;
}

function findTransitionEdges(
  edges: SignalEdge[],
  fromId: string,
  toId: string,
): Set<string> {
  if (!fromId || !toId || fromId === toId) {
    return new Set<string>();
  }

  const walk = (directed: boolean): Set<string> | null => {
    const queue: Array<{ nodeId: string; path: string[] }> = [
      { nodeId: fromId, path: [] },
    ];
    const visited = new Set([fromId]);

    while (queue.length) {
      const current = queue.shift();
      if (!current) {
        break;
      }
      const neighbors = edges.flatMap((edge) => {
        if (edge.source === current.nodeId) {
          return [{ nodeId: edge.target, edgeId: edge.id }];
        }
        if (!directed && edge.target === current.nodeId) {
          return [{ nodeId: edge.source, edgeId: edge.id }];
        }
        return [];
      });

      for (const neighbor of neighbors) {
        if (visited.has(neighbor.nodeId)) {
          continue;
        }
        const path = [...current.path, neighbor.edgeId];
        if (neighbor.nodeId === toId) {
          return new Set(path);
        }
        visited.add(neighbor.nodeId);
        queue.push({ nodeId: neighbor.nodeId, path });
      }
    }
    return null;
  };

  return (
    walk(true) ||
    walk(false) ||
    new Set(
      edges
        .filter((edge) => edge.target === toId || edge.source === toId)
        .map((edge) => edge.id),
    )
  );
}

/**
 * Subscribes to a CSS media query so the header can drop its mobile-only
 * disclosure state as soon as the viewport grows past the breakpoint.
 */
function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);

  useEffect(() => {
    const media = window.matchMedia(query);
    const sync = () => setMatches(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, [query]);

  return matches;
}

/**
 * One trace-level action (import / export / clear). The desktop brand menu and
 * the collapsed mobile header menu share the same list so both stay in step.
 */
type HeaderNavAction = {
  id: string;
  label: string;
  icon: typeof Menu;
  disabled?: boolean;
  danger?: boolean;
  run: () => void;
};

function HeaderNavActions({
  actions,
  onSelect,
}: {
  actions: ReadonlyArray<HeaderNavAction>;
  onSelect: () => void;
}) {
  return (
    <>
      {actions.map(({ id, label, icon: Icon, disabled, danger, run }) => (
        <button
          key={id}
          type="button"
          className={cn(
            "nav-menu__action",
            danger ? "action-menu__danger is-danger" : "",
          )}
          disabled={disabled}
          onClick={() => {
            run();
            onSelect();
          }}
        >
          <Icon />
          {label}
        </button>
      ))}
    </>
  );
}

function IconAction({
  label,
  children,
  className,
  side = "bottom",
  ...props
}: Omit<ComponentProps<typeof Button>, "children"> & {
  label: string;
  children: ReactNode;
  side?: ComponentProps<typeof TooltipContent>["side"];
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="console"
          size="console-icon"
          className={className}
          aria-label={label}
          {...props}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side={side}>{label}</TooltipContent>
    </Tooltip>
  );
}

function StatusIcon({ status }: { status: string }) {
  if (status === "failed") {
    return <CircleX className="status-failure" aria-hidden="true" />;
  }
  if (status === "active") {
    return <Activity className="status-running" aria-hidden="true" />;
  }
  if (status === "waiting") {
    return <Clock3 className="status-waiting" aria-hidden="true" />;
  }
  if (status === "terminated") {
    return <CircleStop className="status-terminated" aria-hidden="true" />;
  }
  if (status === "complete") {
    return <CheckCircle2 className="status-success" aria-hidden="true" />;
  }
  return <Clock3 aria-hidden="true" />;
}

function PanelToggle({
  expanded,
  onToggle,
  side,
}: {
  expanded: boolean;
  onToggle: () => void;
  side: "left" | "right";
}) {
  const pointsLeft = side === "left" ? expanded : !expanded;
  const label = `${expanded ? "收起" : "展开"}${
    side === "left" ? "运行记录" : "事件面板"
  }`;

  return (
    <IconAction
      label={label}
      className={cn(
        "panel-toggle",
        `panel-toggle--${side}`,
        !expanded && "is-collapsed",
      )}
      onClick={onToggle}
      side={side === "left" ? "right" : "left"}
    >
      {pointsLeft ? <ChevronLeft /> : <ChevronRight />}
    </IconAction>
  );
}

function ThemeSwitcher({
  theme,
  onChange,
}: {
  theme: Theme;
  onChange: (theme: Theme) => void;
}) {
  const activeTheme =
    themeOptions.find((option) => option.id === theme) || defaultThemeOption;
  const ActiveIcon = activeTheme.icon;

  return (
    // Sun/moon glyph plus a menu: no hover card. The `aria-label` still names
    // the current theme, which is the only part the icon cannot show.
    <Select value={theme} onValueChange={(value) => onChange(value as Theme)}>
      <SelectTrigger
        size="sm"
        className="theme-select"
        aria-label={`颜色主题：${activeTheme.label}`}
      >
        <SelectValue>
          <ActiveIcon />
        </SelectValue>
      </SelectTrigger>
      <SelectContent position="popper" align="end">
        <SelectGroup>
          {themeOptions.map(({ id, label, icon: Icon }) => (
            <SelectItem key={id} value={id}>
              <Icon />
              {label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

/**
 * Snapshot of `/api/health`: process identity, startup cost, uptime and the
 * capture-side session summary. Everything here is O(1) on the server, so the
 * card can poll while the studio is open.
 */
type ServiceHealth = {
  pid: number;
  url: string;
  host: string;
  port: number;
  startedAt: string;
  restartedAt: string | null;
  restartCount: number;
  /** Process start → listening. Grows with the amount of stored history. */
  bootMs: number;
  uptimeMs: number;
  node: string;
  clientCount: number;
  eventCount: number;
  sessionCounts: Record<string, number>;
  dataRoot: string;
  traceFiles: string[];
  build: string;
  /** Client-side receipt time, used to advance the uptime locally. */
  fetchedAt: number;
};

function formatBootDuration(milliseconds: number) {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) {
    return "--";
  }
  if (milliseconds < 1_000) {
    return `${Math.round(milliseconds)} ms`;
  }
  // Sub-10s boots are the common case after a warm start; rounding them to
  // whole seconds lost the difference between 1.2s and 4.4s.
  if (milliseconds < 10_000) {
    return `${(milliseconds / 1_000).toFixed(1)} s`;
  }
  return formatDuration(milliseconds);
}

/**
 * One subscription for the whole console. `suspended` turns on only after the
 * tab has been hidden long enough to matter, so switching tabs for a moment
 * never costs a reconnect.
 */
function usePageVisibility() {
  return useSyncExternalStore(
    subscribePageVisibility,
    getPageVisibilitySnapshot,
    getServerPageVisibilitySnapshot,
  );
}

/**
 * Local service card: uptime, startup cost, process details, and the restart
 * control. The uptime advances locally between polls so it reads as a clock
 * instead of a value that jumps every few seconds.
 */
function ServiceStatus({
  connected,
  error,
  onChangeDataRoot,
  onRestart,
  restarting,
  service,
  syncPaused,
}: {
  connected: boolean;
  error: string;
  onChangeDataRoot: (path: string) => Promise<boolean>;
  onRestart: () => void;
  restarting: boolean;
  service: ServiceHealth | null;
  /** The sync budget is spent: the stream is closed on purpose, not dropped. */
  syncPaused: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [editingRoot, setEditingRoot] = useState(false);
  const [rootDraft, setRootDraft] = useState("");
  const [savingRoot, setSavingRoot] = useState(false);
  const submitRoot = async (event: FormEvent) => {
    event.preventDefault();
    if (savingRoot) {
      return;
    }
    setSavingRoot(true);
    const saved = await onChangeDataRoot(rootDraft);
    setSavingRoot(false);
    if (saved) {
      setEditingRoot(false);
    }
  };
  // The uptime reads as a clock, but a suspended tab has nothing to advance:
  // the value is recomputed from `fetchedAt` the moment the console resumes.
  const { suspended } = usePageVisibility();
  useEffect(() => {
    if (suspended) {
      return undefined;
    }
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [suspended]);

  const uptime = service
    ? Math.max(0, service.uptimeMs + (now - service.fetchedAt))
    : 0;
  const health = error
    ? "error"
    : !service
      ? "pending"
      : connected
        ? "online"
        : "degraded";
  const counts = service?.sessionCounts ?? {};
  // `build` is the service's own release string. `unknown` is its honest
  // answer when neither package.json nor the installed runtime's plugin.json
  // could be read — the card names that case instead of printing a bare
  // "unknown" next to the Node runtime.
  const reportedVersion = service?.build ?? "";
  const versionKnown = Boolean(reportedVersion) && reportedVersion !== "unknown";
  const versionMatches = versionKnown && reportedVersion === appVersion;
  // Every recorded status, not a single "live" number: the server counts what
  // the recorders wrote, while RUN HISTORY's `N LIVE` additionally requires
  // recent activity, so folding active + waiting into "live" made the card
  // disagree with the panel beside it.
  const sessionCounts = [
    { label: "active", tone: "running", value: counts.active ?? 0 },
    { label: "waiting", tone: "waiting", value: counts.waiting ?? 0 },
    { label: "complete", tone: "completed", value: counts.complete ?? 0 },
    { label: "failed", tone: "failed", value: counts.failed ?? 0 },
    { label: "terminated", tone: "terminated", value: counts.terminated ?? 0 },
  ] as const;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="service-status"
          data-health={health}
          aria-label="本地服务状态与运行时长"
          title={
            service
              ? `本地服务 PID ${service.pid} · 已运行 ${formatDuration(uptime)}`
              : "本地服务状态"
          }
        >
          <i aria-hidden="true" />
          <Timer aria-hidden="true" />
          <span>
            {restarting
              ? "RESTARTING"
              : service
                ? formatDuration(uptime)
                : error
                  ? "OFFLINE"
                  : "…"}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="service-card"
        // The card is a status readout: taking focus would outline the restart
        // button the moment the popover opens and read as a call to action.
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <header className="service-card__head">
          <div className="service-card__identity" data-health={health}>
            <i aria-hidden="true" />
            <div>
              <span className="eyebrow">LOCAL SERVICE</span>
              <strong>
                {error
                  ? "服务不可达"
                  : syncPaused
                    ? "运行中 · 同步已按上限停止"
                    : connected
                      ? "运行中 · 事件流已连接"
                      : "运行中 · 事件流未连接"}
              </strong>
            </div>
          </div>
          <span className="service-card__clock" title="已运行时长">
            {service ? formatDuration(uptime) : "--"}
          </span>
        </header>
        <p className="service-card__endpoint">
          <code>
            {service ? `${service.host}:${service.port}` : "127.0.0.1:5678"}
          </code>
          <span>PID {service ? service.pid : "--"}</span>
          <span>node {service ? service.node : "--"}</span>
        </p>

        <section className="service-card__group">
          <h4>版本</h4>
          <div className="service-card__versions">
            <div>
              <span>控制台</span>
              <strong>v{appVersion}</strong>
              <em>当前页面构建</em>
            </div>
            <div data-mismatch={versionKnown && !versionMatches}>
              <span>服务</span>
              <strong>{versionKnown ? `v${reportedVersion}` : "未上报"}</strong>
              <em>
                {!service
                  ? "等待服务响应"
                  : versionKnown
                    ? versionMatches
                      ? "与控制台一致"
                      : "与控制台不一致"
                    : "未读到清单文件"}
              </em>
            </div>
          </div>
          {service && versionKnown && !versionMatches ? (
            <p className="service-card__notice">
              控制台与服务版本不一致：刷新页面以加载新构建，或重启服务让两侧对齐。
            </p>
          ) : null}
          {service && !versionKnown ? (
            <p className="service-card__notice">
              服务未上报版本号：它从源码目录或缺少清单文件的旧安装启动。重启服务会重新
              读取 package.json / plugin.json。
            </p>
          ) : null}
        </section>

        <section className="service-card__group">
          <h4>进程</h4>
          <dl>
            <div>
              <dt>启动于</dt>
              <dd>{service ? formatRunDate(service.startedAt) : "--"}</dd>
            </div>
            <div>
              <dt>启动耗时</dt>
              <dd>{service ? formatBootDuration(service.bootMs) : "--"}</dd>
            </div>
            <div>
              <dt>重启</dt>
              <dd>{service ? `${service.restartCount} 次` : "--"}</dd>
            </div>
            <div>
              <dt>客户端</dt>
              <dd>{service ? service.clientCount : "--"}</dd>
            </div>
          </dl>
        </section>

        <section className="service-card__group">
          <h4>数据</h4>
          <dl>
            <div>
              <dt>事件</dt>
              <dd>{service ? service.eventCount.toLocaleString() : "--"}</dd>
            </div>
            <div>
              <dt>轨迹文件</dt>
              <dd>{service ? service.traceFiles.length : "--"}</dd>
            </div>
          </dl>
          <div className="service-card__path">
            <div className="service-card__path-head">
              <span className="service-card__path-label">数据目录</span>
              {service ? (
                <button
                  type="button"
                  className="service-card__path-edit"
                  onClick={() => {
                    setRootDraft(service.dataRoot || "");
                    setEditingRoot((current) => !current);
                  }}
                >
                  {editingRoot ? "取消" : "更改"}
                </button>
              ) : null}
            </div>
            {editingRoot ? (
              <form className="service-card__root-form" onSubmit={submitRoot}>
                <input
                  aria-label="数据目录路径"
                  className="service-card__root-input"
                  onChange={(event) => setRootDraft(event.currentTarget.value)}
                  placeholder="/Users/you/.astrox"
                  spellCheck={false}
                  value={rootDraft}
                />
                <Button
                  className="service-card__root-save"
                  disabled={savingRoot || restarting}
                  size="sm"
                  type="submit"
                  variant="outline"
                >
                  {savingRoot || restarting ? "保存中…" : "保存并重启"}
                </Button>
              </form>
            ) : (
              <code title={service?.dataRoot}>{service?.dataRoot || "--"}</code>
            )}
            <em>
              各采集客户端（录制器）写入的会话事件 JSONL 保存在这里；轨迹文件按客户端与
              会话分目录存放，是控制台全部读数的来源。更改后服务会重启并重新读取该目录。
            </em>
          </div>
        </section>

        <section
          className="service-card__group"
          title="录制器上报的会话状态；RUN HISTORY 的 N LIVE 还要求最近有活动"
        >
          <h4>会话</h4>
          <div className="service-card__counts">
            {sessionCounts.map((entry) => (
              <div key={entry.label} data-tone={entry.tone}>
                <strong>{service ? entry.value : "--"}</strong>
                <span>{entry.label}</span>
              </div>
            ))}
          </div>
        </section>

        <div className="service-card__footer">
          {error ? <p className="service-card__error">{error}</p> : null}
          <p className="service-card__hint">
            {syncPaused
              ? "已按「最长同步时长」停止接收新事件；重启服务、点击顶部 paused 标记，或在设置中调高「最长同步时长」，都可以继续同步。"
              : "重启会保留当前端口，页面与事件流会自动重连。"}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="service-card__restart"
            disabled={restarting}
            onClick={onRestart}
          >
            <RefreshCw
              data-icon="inline-start"
              className={restarting ? "animate-spin" : ""}
            />
            {restarting ? "正在重启…" : "重启本地服务"}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

type RunHistoryRowDetails = {
  code: string;
  duration: number;
  cwd: string | null;
  extraLabel: string;
  extraValue: string | number;
  /** Unabbreviated id, shown in the hover card only. */
  fullCode: string;
  /** Git presentation of the working directory, when one was resolved. */
  git: { repo: string; branch: string } | null;
  /** Executing or waiting: the row carries the live affordances. */
  live?: boolean;
  /** Recorded cause of a terminal state (`interrupted`, `error`, …). */
  reason?: string | null;
  /** Milliseconds of silence for an executing run, when it looks dead. */
  staleFor?: number;
  source: string;
  start: number;
  status: "demo" | TraceSession["status"];
  title: string;
  /** LLM model the prompt ran on, when a client recorded one. */
  model?: string;
};

/**
 * A live run keeps a `RUNNING` / `WAITING` capsule in its tag row so the
 * executing message is identifiable from the list itself, without opening it
 * or hunting for the breathing status icon.
 */
function RunHistoryLiveTag({
  status,
}: {
  status: "demo" | TraceSession["status"];
}) {
  if (status !== "active" && status !== "waiting") {
    return null;
  }
  return (
    <span className="run-history__live-tag" data-live-status={status}>
      <span className="run-history__live-pulse" aria-hidden="true" />
      {status === "waiting" ? "WAITING" : "RUNNING"}
    </span>
  );
}

/**
 * An `active` row whose stream went silent keeps its live status but says so
 * out loud: the status alone would otherwise read as "still working" long
 * after the agent died. A `waiting` row uses the same affordance with a much
 * longer threshold and its own wording — an unanswered permission prompt is
 * "idle", not "stale".
 */
function RunHistoryStaleTag({
  staleFor,
  waiting = false,
}: {
  staleFor: number;
  waiting?: boolean;
}) {
  return (
    <span
      className="run-history__stale-tag"
      data-kind={waiting ? "waiting" : "active"}
      title={
        waiting
          ? `已 ${formatDuration(staleFor)} 没有新事件，等待可能已无人处理`
          : `已 ${formatDuration(staleFor)} 没有新事件，可能已中断或进程已退出`
      }
    >
      <TriangleAlert aria-hidden="true" />
      {waiting ? "IDLE" : "STALE"} {formatDuration(staleFor)}
    </span>
  );
}

const workspacePathIcons = {
  directory: Folder,
  error: TriangleAlert,
  file: File,
} as const;

/**
 * The run's working directory. When git information was resolved for the
 * directory, the label becomes the repository name and a branch badge rides
 * next to it (ellipsized, with the full branch name on hover); otherwise the
 * last path segment stands in. The full path lives in the row's hover card.
 */
function RunHistoryPath({
  cwd,
  git,
}: {
  cwd: string | null;
  git?: { repo: string; branch: string } | null;
}) {
  const path = useMemo(() => describeWorkspacePath(cwd), [cwd]);
  const Icon = workspacePathIcons[path.kind];
  return (
    <span
      className={cn(
        "run-history__path",
        path.kind === "error" && "is-unknown",
      )}
    >
      <Icon aria-hidden="true" />
      <span className="run-history__path-name">{git?.repo || path.name}</span>
      {git?.branch ? (
        <span className="run-history__branch" title={git.branch}>
          {git.branch}
        </span>
      ) : null}
    </span>
  );
}

function RunHistoryRowContent({
  code,
  cwd,
  duration,
  extraLabel,
  extraValue,
  git,
  live = false,
  model,
  reason,
  staleFor,
  source,
  start,
  status,
  title,
}: RunHistoryRowDetails) {
  return (
    <>
      <StatusIcon status={status} />
      <span className="run-history__copy">
        <strong>{title}</strong>
        <RunHistoryPath cwd={cwd} git={git} />
        <small>{formatRunDate(start)}</small>
        <span className="run-history__tags">
          {live ? (
            staleFor ? (
              <RunHistoryStaleTag
                staleFor={staleFor}
                waiting={status === "waiting"}
              />
            ) : (
              <RunHistoryLiveTag status={status} />
            )
          ) : null}
          <span>
            AGENT <b>{source}</b>
          </span>
          {model ? (
            <span>
              MODEL <b>{model}</b>
            </span>
          ) : null}
          <span>
            STATUS <b>{status}</b>
            {reason ? <em className="run-history__reason"> · {reason}</em> : null}
          </span>
          <span>
            DURATION <b>{formatDuration(duration)}</b>
          </span>
          <span>
            {extraLabel} <b>{extraValue}</b>
          </span>
        </span>
        <code>{code}</code>
      </span>
    </>
  );
}

function RunHistoryDetailsCard({
  cwd,
  duration,
  extraLabel,
  extraValue,
  fullCode,
  git,
  model,
  reason,
  source,
  staleFor,
  start,
  status,
  title,
}: RunHistoryRowDetails) {
  const path = useMemo(() => describeWorkspacePath(cwd), [cwd]);
  const titleRef = useRef<HTMLElement | null>(null);
  // Long titles clamp at six lines; the toggle only appears when the text
  // actually overflows the clamp.
  const [titleExpanded, setTitleExpanded] = useState(false);
  const [titleOverflows, setTitleOverflows] = useState(false);
  useLayoutEffect(() => {
    const el = titleRef.current;
    if (!el) {
      return;
    }
    setTitleOverflows(el.scrollHeight > el.clientHeight + 1);
  }, [title, titleExpanded]);
  const toggleable = titleOverflows || titleExpanded;
  const lines: Array<[string, string]> = [
    ["AGENT", source],
    ["STATUS", reason ? `${status} · ${reason}` : status],
    ["DURATION", formatDuration(duration)],
    [extraLabel, String(extraValue)],
    ["WORKING DIR", path.full || "not recorded"],
  ];
  if (staleFor) {
    lines.splice(2, 0, [
      "SILENT FOR",
      `${formatDuration(staleFor)} · 无新事件`,
    ]);
  }
  if (git?.branch) {
    lines.splice(4, 0, ["BRANCH", git.branch]);
  }
  // After the other splices: MODEL sits right below AGENT in every case.
  if (model) {
    lines.splice(1, 0, ["MODEL", model]);
  }
  return (
    <div className="run-history__tooltip">
      <strong
        className={cn(
          "run-history__title",
          titleExpanded && "is-expanded",
          toggleable && "is-toggleable",
        )}
        onClick={
          toggleable
            ? () => setTitleExpanded((current) => !current)
            : undefined
        }
        onKeyDown={
          toggleable
            ? (event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setTitleExpanded((current) => !current);
                }
              }
            : undefined
        }
        ref={titleRef}
        role={toggleable ? "button" : undefined}
        tabIndex={toggleable ? 0 : undefined}
        title={toggleable ? (titleExpanded ? "点击折叠" : "点击展开") : undefined}
      >
        {title}
      </strong>
      <span>{formatRunDate(start)}</span>
      <span>{fullCode}</span>
      {lines.map(([label, value]) => (
        <span key={label}>
          <b className="run-history__tooltip-label">{label}</b> · {value}
        </span>
      ))}
    </div>
  );
}

type RunHistoryHoverCard = {
  details: RunHistoryRowDetails;
  key: string;
};

/**
 * One hover card serves the whole list. A tooltip root per row multiplies into
 * hundreds of roots that re-render on every clock tick, and while the pointer
 * sweeps the list fast the previous row's card can outlive its row and stay on
 * screen. A single layer that follows the hovered row cannot go stale: another
 * row swaps the content in place, and the card stays open while the pointer
 * moves onto it, so long content can be read and scrolled.
 */
const RunHistoryHoverCardLayer = memo(function RunHistoryHoverCardLayer({
  anchorRef,
  card,
  cardRef,
  onCardPointerLeave,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  card: RunHistoryHoverCard | null;
  cardRef: RefObject<HTMLDivElement | null>;
  onCardPointerLeave: (event: ReactPointerEvent<HTMLDivElement>) => void;
}) {
  useLayoutEffect(() => {
    if (!card) {
      return undefined;
    }
    const element = cardRef.current;
    if (!element) {
      return undefined;
    }
    let frame = 0;
    const place = () => {
      frame = 0;
      const anchor = anchorRef.current;
      if (!anchor || !anchor.isConnected) {
        element.style.visibility = "hidden";
        return;
      }
      const listBounds = anchor
        .closest(".run-history__list")
        ?.getBoundingClientRect();
      const anchorBounds = anchor.getBoundingClientRect();
      // Scrolled past its row: hide instead of pinning the card to the edge of
      // the window, and restore it when the row scrolls back into the list.
      if (
        listBounds &&
        (anchorBounds.bottom < listBounds.top ||
          anchorBounds.top > listBounds.bottom)
      ) {
        element.style.visibility = "hidden";
        return;
      }
      const cardBounds = element.getBoundingClientRect();
      const gap = 8;
      // To the right of the row, vertically aligned with it; flip to the left
      // side when the right edge has no room. Both axes are clamped to the
      // window so the card never lands half outside the viewport.
      const onRight = anchorBounds.right + gap;
      const onLeft = anchorBounds.left - gap - cardBounds.width;
      const left =
        onRight + cardBounds.width <= window.innerWidth - gap
          ? onRight
          : Math.max(
              gap,
              Math.min(onLeft, window.innerWidth - gap - cardBounds.width),
            );
      const top = Math.min(
        Math.max(gap, anchorBounds.top),
        Math.max(gap, window.innerHeight - gap - cardBounds.height),
      );
      element.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
      element.style.visibility = "visible";
    };
    const schedule = () => {
      if (frame) {
        return;
      }
      frame = window.requestAnimationFrame(place);
    };
    place();
    // Capture phase: the prompt thread scrolls inside its own viewport, and the
    // card has to keep tracking its row there as well.
    document.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    return () => {
      if (frame) {
        window.cancelAnimationFrame(frame);
      }
      document.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
    };
  }, [anchorRef, card, cardRef]);

  if (!card) {
    return null;
  }

  return (
    <div
      className="run-history__hovercard"
      onPointerLeave={onCardPointerLeave}
      ref={cardRef}
      role="tooltip"
    >
      <div className="run-history__card">
        <RunHistoryDetailsCard key={card.key} {...card.details} />
      </div>
    </div>
  );
});

/**
 * One RUN HISTORY group: the session row plus its expandable prompt thread.
 * Memoized on primitives and stable references so the 1s duration tick only
 * reaches rows that can actually change: a live row receives the exact clock
 * (its duration advances every second), a finished row a 30s-quantized one —
 * its status and duration never depend on `now`. The parent pass derives
 * status/duration once and hands them over as primitives, so a tick that
 * changes nothing about a row skips that row's render entirely.
 */
/**
 * The suffix shown next to `STATUS`: a finished run states *why* it ended
 * (`interrupted`, `timeout`, the recorded error text), a live one shows
 * nothing. This is what keeps `terminated` from being a dead end.
 */
function describeRunReason(
  status: TraceRunStatus,
  terminalReason: RunTerminalReason | null | undefined,
  detail: string | null | undefined,
): string | null {
  if (isLiveRunStatus(status)) {
    return null;
  }
  if (status === "terminated") {
    return terminalReason ? runTerminalReasonLabels[terminalReason] : "terminated";
  }
  if (status === "failed") {
    return detail || (terminalReason ? runTerminalReasonLabels[terminalReason] : "error");
  }
  return null;
}

const RunHistoryItem = memo(function RunHistoryItem({
  activeKey,
  activePromptRunKey,
  activePromptRunRef,
  duration,
  expanded,
  gitInfo,
  isDemo,
  isLiveAnchor,
  liveItemRef,
  now,
  onHoverRow,
  onSelect,
  onToggleRun,
  promptRuns,
  session,
  status,
}: {
  activeKey: string;
  activePromptRunKey: string;
  activePromptRunRef: RefObject<HTMLDivElement | null>;
  duration: number;
  expanded: boolean;
  gitInfo: Record<string, { repo: string; branch: string } | null>;
  isDemo: boolean;
  /** Session row of the first live run: the `N LIVE` jump target. */
  isLiveAnchor: boolean;
  liveItemRef: RefObject<HTMLElement | null>;
  now: number;
  onHoverRow: (
    event: ReactPointerEvent<HTMLDivElement>,
    rowKey: string,
    details: RunHistoryRowDetails,
  ) => void;
  onSelect: (sessionKey: string, promptRunKey?: string) => void;
  onToggleRun: (key: string) => void;
  promptRuns: TracePromptRun[];
  session: TraceSession;
  status: TraceRunStatus;
}) {
  // Newest prompt on top: the thread renders in reverse chronological
  // order while selection, live marking, and labels keep using the
  // original index order. The executing prompt outranks chronology — a
  // resumed thread can leave an older prompt running while later ones already
  // finished — so the message being watched is always the first row.
  const promptRows = promptRuns.map((promptRun) => {
    // Freshness-aware: a historical message whose recorder died mid-run must
    // not keep wearing the RUNNING capsule (nor light the footer Live) —
    // only the message still producing events counts as live.
    const displayState = getRunDisplayState(
      promptRun,
      now,
      appTimings.activeRunTimeoutMs,
    );
    return {
      displayState,
      promptLive: !isDemo && isLiveRunStatus(displayState.status),
      promptRun,
    };
  });
  const reversedPromptRows = [...promptRows].reverse();
  const displayPromptRows = [
    ...reversedPromptRows.filter((row) => row.promptLive),
    ...reversedPromptRows.filter((row) => !row.promptLive),
  ];
  // The thread is sized to its measured content, capped at the configured
  // maximum. A fixed `rows × estimate` height clipped the last row whenever a
  // title wrapped (short threads are exactly the case where one clipped row is
  // the whole second message), so the estimate is now only the first-paint
  // fallback until the ResizeObserver reports the real height.
  const promptListRef = useRef<HTMLOListElement | null>(null);
  const [measuredThreadHeight, setMeasuredThreadHeight] = useState(0);
  useLayoutEffect(() => {
    if (!expanded) {
      setMeasuredThreadHeight(0);
      return undefined;
    }
    const node = promptListRef.current;
    if (!node) {
      return undefined;
    }
    const measure = () => setMeasuredThreadHeight(node.scrollHeight);
    measure();
    // A wrapped title, a new prompt, or a width change moves the content
    // height; observing the list keeps the cap exact without polling.
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [expanded, promptRuns.length]);
  const estimatedThreadHeight =
    promptRuns.length * appLayout.historyPromptRowEstimate + 8;
  // A short thread that overshoots the ceiling by less than a quarter is shown
  // whole: at two or three messages, one clipped row and a scrollbar is a
  // worse answer than a slightly taller panel. Longer threads keep the cap so
  // the rest of RUN HISTORY stays on screen.
  const threadHeight = measuredThreadHeight
    ? measuredThreadHeight <=
      appLayout.historyPromptListMaxHeight * 1.25
      ? measuredThreadHeight
      : appLayout.historyPromptListMaxHeight
    : Math.min(appLayout.historyPromptListMaxHeight, estimatedThreadHeight);
  const firstPromptRun = promptRuns[0];
  const hasPromptThread = promptRuns.length > 1;
  const parentSelected = session.key === activeKey && !hasPromptThread;
  const activeGroup = session.key === activeKey && hasPromptThread;
  const live = !isDemo && isLiveRunStatus(status);
  const liveStatus = live ? status : undefined;
  const promptListId = `run-prompts-${session.key.replace(
    /[^a-zA-Z0-9_-]+/g,
    "-",
  )}`;
  const git = session.cwd ? gitInfo[session.cwd] ?? null : null;
  // Silence and end cause are derived from the same numbers the parent pass
  // already computed, so this stays O(1) per row.
  const lastPromptRun = promptRuns.at(-1);
  const parentFreshness = getRunFreshness(
    isDemo ? undefined : status,
    lastPromptRun?.end ?? session.end,
    now,
  );
  const parentTerminal = getRunHistoryTerminalInfo(
    session,
    promptRuns,
    now,
    appTimings.activeRunTimeoutMs,
  );
  const parentDetails: RunHistoryRowDetails = {
    code: getShortId(session.id),
    cwd: session.cwd,
    duration,
    extraLabel: "PROMPTS",
    extraValue: promptRuns.length,
    fullCode: session.id,
    git,
    live,
    reason: describeRunReason(
      status,
      parentTerminal.reason,
      parentTerminal.detail,
    ),
    staleFor: parentFreshness.stale ? parentFreshness.idleFor : undefined,
    source: session.source,
    start: firstPromptRun?.start ?? session.start,
    status: isDemo ? "demo" : status,
    title: session.title,
    // The session row is the only row for single-prompt runs, so it carries
    // the newest prompt's model; multi-prompt rows show it per sub-row.
    model: lastPromptRun?.model,
  };

  return (
    <article
      className={cn(
        "run-history__item",
        activeGroup && "is-active-group",
        // A lone run only fills the panel while its sub-message thread is open;
        // a collapsed thread keeps the compact card.
        hasPromptThread && expanded && "is-thread-open",
        live && "is-live",
      )}
      data-live-status={liveStatus}
      ref={isLiveAnchor ? liveItemRef : undefined}
    >
      <div
        role="button"
        tabIndex={0}
        aria-pressed={parentSelected}
        data-live-status={liveStatus}
        data-stale={parentDetails.staleFor ? "true" : undefined}
        className={cn(
          "run-history__row",
          hasPromptThread && "has-prompt-thread",
          parentSelected && "is-selected",
          live && "is-live",
        )}
        onClick={() => onSelect(session.key, promptRuns.at(-1)?.key)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelect(session.key, promptRuns.at(-1)?.key);
          }
        }}
        onPointerOver={(event) =>
          onHoverRow(event, session.key, parentDetails)
        }
      >
        <RunHistoryRowContent {...parentDetails} />
      </div>
      {hasPromptThread ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-controls={promptListId}
          aria-expanded={expanded}
          aria-label={`${expanded ? "收起" : "展开"} Prompt 层级`}
          className="run-history__expand"
          onClick={() => onToggleRun(session.key)}
        >
          <ChevronRight />
        </Button>
      ) : null}
      {/* The thread stays mounted for every multi-prompt row and animates
          between its measured height and 0. Unmounting it on collapse made
          every expand a teleport: the executing row grew by hundreds of
          pixels in one commit and shoved the whole list (the N LIVE jumping).
          A collapsed thread is visibility-hidden, so it neither paints nor
          participates in a11y or focus, and its margins collapse with it. */}
      {hasPromptThread ? (
        <ScrollArea
          id={promptListId}
          className={cn(
            "run-history__prompt-scroll",
            !expanded && "is-collapsed",
          )}
          style={{ height: expanded ? threadHeight : 0 }}
          aria-hidden={!expanded}
        >
          <ol className="run-history__prompts" ref={promptListRef}>
            {displayPromptRows.map(({ displayState, promptLive, promptRun }) => {
              const promptSelected = promptRun.key === activePromptRunKey;
              const roleLabel =
                promptRun.role === "initial"
                  ? "INITIAL"
                  : `FOLLOW-UP ${String(promptRun.index).padStart(2, "0")}`;
              const promptCode = `${roleLabel} · ${promptRun.prompt.id}`;
              const promptLiveStatus = promptLive
                ? displayState.status
                : undefined;
              const promptFreshness = getRunFreshness(
                isDemo ? undefined : displayState.status,
                promptRun.end,
                now,
              );
              const promptTerminal = getRunHistoryTerminalInfo(
                promptRun,
                [promptRun],
                now,
                appTimings.activeRunTimeoutMs,
              );
              const promptDetails: RunHistoryRowDetails = {
                code: promptCode,
                cwd: promptRun.cwd,
                duration: displayState.duration,
                extraLabel: "EVENTS",
                extraValue: promptRun.events.length,
                fullCode: promptCode,
                git: promptRun.cwd
                  ? gitInfo[promptRun.cwd] ?? null
                  : null,
                live: promptLive,
                reason: describeRunReason(
                  displayState.status,
                  promptTerminal.reason,
                  promptTerminal.detail,
                ),
                staleFor: promptFreshness.stale
                  ? promptFreshness.idleFor
                  : undefined,
                source: promptRun.source,
                start: promptRun.start,
                status: isDemo ? "demo" : displayState.status,
                title: promptRun.title,
                model: promptRun.model,
              };
              return (
                <li key={promptRun.key}>
                  <div
                    ref={promptSelected ? activePromptRunRef : undefined}
                    role="button"
                    tabIndex={0}
                    aria-pressed={promptSelected}
                    data-live-status={promptLiveStatus}
                    data-stale={promptDetails.staleFor ? "true" : undefined}
                    className={cn(
                      "run-history__row",
                      "run-history__prompt-run",
                      promptSelected && "is-selected",
                      promptLive && "is-live",
                    )}
                    onClick={() => onSelect(session.key, promptRun.key)}
                    onKeyDown={(event) => {
                      if (
                        event.key === "Enter" ||
                        event.key === " "
                      ) {
                        event.preventDefault();
                        onSelect(session.key, promptRun.key);
                      }
                    }}
                    onPointerOver={(event) =>
                      onHoverRow(event, promptRun.key, promptDetails)
                    }
                  >
                    <RunHistoryRowContent {...promptDetails} />
                  </div>
                </li>
              );
            })}
          </ol>
        </ScrollArea>
      ) : null}
    </article>
  );
});

/**
 * The rows themselves. Memoized apart from the hover card so moving the pointer
 * across the list only re-renders the card layer instead of every row. The 1s
 * duration tick still reaches this thin map — it hands live rows the fresh
 * clock and derives each row's status/duration once — while
 * {@link RunHistoryItem} memoization keeps every row that cannot have changed
 * from re-rendering at all.
 */
const RunHistoryRows = memo(function RunHistoryRows({
  activeKey,
  activePromptRunKey,
  activePromptRunRef,
  expandedRuns,
  firstLiveKey,
  gitInfo,
  isDemo,
  liveItemRef,
  now,
  onHoverRow,
  onSelect,
  onToggleRun,
  promptRunsBySession,
  sessions,
}: {
  activeKey: string;
  activePromptRunKey: string;
  activePromptRunRef: RefObject<HTMLDivElement | null>;
  expandedRuns: ReadonlySet<string>;
  /** Session key of the first live row: the `N LIVE` jump target. */
  firstLiveKey: string;
  gitInfo: Record<string, { repo: string; branch: string } | null>;
  isDemo: boolean;
  liveItemRef: RefObject<HTMLElement | null>;
  now: number;
  onHoverRow: (
    event: ReactPointerEvent<HTMLDivElement>,
    rowKey: string,
    details: RunHistoryRowDetails,
  ) => void;
  onSelect: (sessionKey: string, promptRunKey?: string) => void;
  onToggleRun: (key: string) => void;
  promptRunsBySession: ReadonlyMap<string, TracePromptRun[]>;
  sessions: TraceSession[];
}) {
  // Finished rows re-render from a coarse clock; only live rows get the 1s one.
  const coarseNow = quantizeTimestamp(now, RUN_HISTORY_COARSE_REFRESH_MS);
  return (
    <>
      {sessions.map((session) => {
        const promptRuns = promptRunsBySession.get(session.key) ?? [];
        const { duration, status } = getRunHistoryDisplayState(
          session,
          promptRuns,
          now,
          appTimings.activeRunTimeoutMs,
        );
        return (
          <RunHistoryItem
            activeKey={activeKey}
            activePromptRunKey={activePromptRunKey}
            activePromptRunRef={activePromptRunRef}
            duration={duration}
            expanded={expandedRuns.has(session.key)}
            gitInfo={gitInfo}
            isDemo={isDemo}
            isLiveAnchor={session.key === firstLiveKey}
            key={session.key}
            liveItemRef={liveItemRef}
            now={!isDemo && isLiveRunStatus(status) ? now : coarseNow}
            onHoverRow={onHoverRow}
            onSelect={onSelect}
            onToggleRun={onToggleRun}
            promptRuns={promptRuns}
            session={session}
            status={status}
          />
        );
      })}
    </>
  );
});

const RunHistory = memo(function RunHistory({
  sessions,
  activeKey,
  activePromptRunKey,
  canLoadMore,
  demoError,
  gitInfo,
  initialLoading,
  isDemo,
  liveFilter,
  liveKeys,
  now,
  promptRunsBySession,
  rangeLabel,
  onLoadMore,
  onReloadLatest,
  onToggleLiveFilter,
  reloading,
  onSelect,
}: {
  sessions: TraceSession[];
  activeKey: string;
  activePromptRunKey: string;
  isDemo: boolean;
  /**
   * Why the sample dataset could not be loaded, when this console was supposed
   * to show it. The empty state names the reason, because an empty list with no
   * explanation reads as "this agent never ran anything".
   */
  demoError: string | null;
  /**
   * Armed live filter: the rows are the messages that are executing right
   * now, filtered out of the selected agent's *whole* history (the parent
   * drops the time window) and pinned, expanded and located. Persisted by the
   * parent, so the chip, the settings dialog and the list agree.
   */
  liveFilter: boolean;
  /** Keys of the executing runs; these rows are pinned to the top. */
  liveKeys: ReadonlySet<string>;
  now: number;
  promptRunsBySession: ReadonlyMap<string, TracePromptRun[]>;
  canLoadMore: boolean;
  gitInfo: Record<string, { repo: string; branch: string } | null>;
  initialLoading: boolean;
  onLoadMore: () => void;
  /** Drop the client's loaded history and pull a fresh snapshot. */
  onReloadLatest: () => void;
  onToggleLiveFilter: () => void;
  /** True while the fresh snapshot has been requested but not delivered. */
  reloading: boolean;
  /** Human label of the configured default range, for the empty state. */
  rangeLabel: string;
  onSelect: (sessionKey: string, promptRunKey?: string) => void;
}) {
  const [expandedRuns, setExpandedRuns] = useState<Set<string>>(
    () => new Set(),
  );
  const [hoverCard, setHoverCard] = useState<RunHistoryHoverCard | null>(null);
  // Sparse/dense is a whole-list re-clamp (every title changes its line
  // ceiling), so the decision carries hysteresis: a count hovering at the
  // threshold — sessions aging out of the window while a re-run enters it —
  // must not re-clamp the list on each crossing.
  const sparseRef = useRef(false);
  const sparseList = isSparseRunHistoryList(
    sessions.length,
    sparseRef.current,
    appLayout.runHistorySparseListRows,
  );
  sparseRef.current = sparseList;
  const activePromptRunRef = useRef<HTMLDivElement | null>(null);
  const hoverCardRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const hoverAnchorRef = useRef<HTMLElement | null>(null);
  const liveItemRef = useRef<HTMLElement | null>(null);
  // Loading earlier messages is only ever armed by a real scroll gesture. A
  // list that does not fill the panel keeps its bottom sentinel in view
  // forever, and an always-on observer would then widen the window again and
  // again without the user asking for it. The explicit footer button covers the
  // same need.
  const loadArmedRef = useRef(false);
  const [loadArmed, setLoadArmed] = useState(false);
  // `onSelect` comes from the app shell and changes identity whenever the
  // selected events move; dispatching through a latest ref keeps the row
  // callback stable so RunHistoryItem memoization survives live batches.
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const handleRunSelect = useCallback((key: string, promptRunKey?: string) => {
    onSelectRef.current(key, promptRunKey);
  }, []);
  const [liveJumpRequest, setLiveJumpRequest] = useState(0);
  const activePromptCount =
    promptRunsBySession.get(activeKey)?.length ?? 0;

  // Live summary for the header chip, derived from the same key set the app
  // uses to keep executing runs inside the window and pin them on top — one
  // definition of "executing" for the list, the chip, and the Live filter.
  // Narrowed to the rows actually rendered, so the chip can never point at a
  // row that is not in this list, and ordered like the list (pinned run first).
  const liveSummary = useMemo(() => {
    if (isDemo || liveKeys.size === 0) {
      return { count: 0, firstLiveKey: "", liveKeys: [] as string[] };
    }
    const live = sessions
      .filter((session) => liveKeys.has(session.key))
      .map((session) => session.key);
    return {
      count: live.length,
      firstLiveKey: live[0] ?? "",
      liveKeys: live,
    };
  }, [isDemo, liveKeys, sessions]);

  // Arming the filter means "show me only what is executing, starting with the
  // message that is running": the parent drops the time window for the armed
  // list so a resumed session still qualifies, and the rows below are the live
  // ones only. Demo traces are synthetic and never live, so the demo list
  // ignores the arm.
  const liveFiltering = liveFilter && !isDemo;

  useEffect(() => {
    if (liveJumpRequest === 0) {
      return;
    }
    scrollRowWithinContainer(listRef.current, liveItemRef.current, true);
  }, [liveJumpRequest]);

  const jumpToLiveRun = useCallback(() => {
    if (!liveSummary.firstLiveKey) {
      return;
    }
    // A live Prompt inside a collapsed thread would otherwise jump to a row
    // that is still hidden, so the target group is expanded first.
    setExpandedRuns((current) =>
      ensureExpandedRun(current, liveSummary.firstLiveKey, true),
    );
    setLiveJumpRequest((current) => current + 1);
  }, [liveSummary.firstLiveKey]);

  /*
   * "A message was just sent" is visible here as a *new* key entering the live
   * set: the run that was executing a second ago is still in the set, so only
   * an addition means someone sent something. While the filter is armed the
   * panel answers it the way the sender expects — the message is expanded and
   * scrolled into view, whatever its age and wherever it sits in the agent's
   * history — instead of leaving the user to hunt for the new row.
   *
   * The comparison lives in a ref rather than in state: it is bookkeeping for
   * this effect alone, and storing it in state would schedule a second render
   * on every live batch.
   */
  const previousLiveKeysRef = useRef<ReadonlySet<string>>(new Set());
  useEffect(() => {
    const previous = previousLiveKeysRef.current;
    previousLiveKeysRef.current = liveKeys;
    if (!liveFiltering || liveKeys.size === 0) {
      return;
    }
    const justStarted = [...liveKeys].some((key) => !previous.has(key));
    if (!justStarted) {
      return;
    }
    jumpToLiveRun();
  }, [jumpToLiveRun, liveFiltering, liveKeys]);

  // The armed list is a live index: every live thread renders expanded, so
  // the executing Prompt — the message the user just sent — is a row of its
  // own instead of a hidden child. This is what makes "the message I am
  // waiting on" reachable without a second click. It only fills in missing
  // keys, so a manual collapse afterwards is left alone until the live set
  // changes again.
  useEffect(() => {
    if (!liveFiltering) {
      return;
    }
    setExpandedRuns((current) => {
      const missing = liveSummary.liveKeys.filter((key) => !current.has(key));
      if (!missing.length) {
        return current;
      }
      const next = new Set(current);
      for (const key of missing) {
        next.add(key);
      }
      return next;
    });
  }, [liveFiltering, liveSummary.liveKeys]);

  // Zero live rows must NOT clear the arm. The armed view is a filter, so an
  // empty list is its honest answer — the panel says "nothing is executing"
  // and re-locates a run on its own the moment one starts. Auto-clearing here
  // would silently turn the filter into "show everything" and overwrite the
  // user's persisted choice on every idle visit.

  // A manual reload exists to reveal what the loaded history was missing, so
  // when the fresh snapshot lands the list must point at it: the executing
  // run when one is live, otherwise the top of the list — both are the
  // newest state the reload promised. `reloading` flips false inside the
  // same transition that swapped in the snapshot, so this effect always
  // reads the fresh summary.
  const wasReloadingRef = useRef(reloading);
  useEffect(() => {
    const finished = wasReloadingRef.current && !reloading;
    wasReloadingRef.current = reloading;
    if (!finished) {
      return;
    }
    if (liveSummary.firstLiveKey) {
      jumpToLiveRun();
    } else {
      listRef.current?.scrollTo({ top: 0 });
    }
  }, [jumpToLiveRun, liveSummary.firstLiveKey, reloading]);

  useEffect(() => {
    if (!activeKey) {
      return;
    }
    setExpandedRuns((current) =>
      ensureExpandedRun(current, activeKey, activePromptCount >= 2),
    );
  }, [activeKey, activePromptCount]);

  useEffect(() => {
    activePromptRunRef.current?.scrollIntoView({
      block: "nearest",
    });
  }, [activePromptRunKey]);

  // On-demand loading: widen the window when the sentinel near the bottom of
  // the list scrolls into view — but only after the user has actually scrolled
  // this list. Two guards keep a short list from loading on its own: the
  // sentinel is always visible when the content does not overflow, and the
  // observer re-arms only on the next scroll gesture.
  // The armed Live filter reads the whole history (no window), so widening stays
  // off there until the filter is switched back.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    const list = listRef.current;
    if (!canLoadMore || !loadArmed || liveFiltering || !sentinel || !list) {
      return undefined;
    }
    if (typeof IntersectionObserver === "undefined") {
      return undefined;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting || !loadArmedRef.current) {
          return;
        }
        // One day per gesture: the sentinel stays in view right after the
        // load, so a still-armed observer would immediately load the next.
        loadArmedRef.current = false;
        setLoadArmed(false);
        onLoadMore();
      },
      { root: list, rootMargin: "120px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [canLoadMore, liveFiltering, loadArmed, onLoadMore, sessions.length]);

  const handleListScroll = useCallback(() => {
    const list = listRef.current;
    if (!list || loadArmedRef.current) {
      return;
    }
    // A real scroll gesture (not the programmatic scroll of a live jump).
    if (list.scrollTop <= 0) {
      return;
    }
    loadArmedRef.current = true;
    setLoadArmed(true);
  }, []);

  const requestMore = useCallback(() => {
    loadArmedRef.current = false;
    setLoadArmed(false);
    onLoadMore();
  }, [onLoadMore]);

  const toggleRun = useCallback((key: string) => {
    setExpandedRuns((current) => toggleExpandedRun(current, key));
  }, []);

  const closeHoverCard = useCallback(() => {
    hoverAnchorRef.current = null;
    setHoverCard((current) => (current === null ? current : null));
  }, []);

  /*
   * The card must disappear as soon as the pointer is no longer on its row or
   * on the card itself. Relying on `pointerleave` alone misses the cases where
   * the pointer leaves through a gap, the row scrolls away under it, or the
   * window loses focus — the card then stayed on screen until another row was
   * hovered ("needs a second trigger to hide"). A capture-phase pointermove
   * watchdog answers the question directly: is the pointer over either
   * element right now?
   */
  const hasHoverCard = hoverCard !== null;
  useEffect(() => {
    if (!hasHoverCard) {
      return undefined;
    }
    const handlePointerMove = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (
        hoverCardRef.current?.contains(target) ||
        hoverAnchorRef.current?.contains(target)
      ) {
        return;
      }
      closeHoverCard();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeHoverCard();
      }
    };
    window.addEventListener("pointermove", handlePointerMove, true);
    window.addEventListener("blur", closeHoverCard);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove, true);
      window.removeEventListener("blur", closeHoverCard);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeHoverCard, hasHoverCard]);

  // Anything that changes which rows exist — another agent, another range,
  // another prompt, a collapsed thread, a switched live filter — invalidates
  // a card anchored to one of them. The list is re-derived on every clock
  // tick with a fresh array identity, so the effect keys off the row
  // signature instead of the array.
  const rowSignature = sessions
    .map(
      (session) =>
        `${session.key}:${promptRunsBySession.get(session.key)?.length ?? 0}`,
    )
    .join("|");
  // A lone run should not float as one small card above an empty panel: with
  // exactly one row shown it stretches to fill the remaining panel height, and
  // the moment a second run lands the list reverts to the compact card stack
  // (the `is-sparse` clamp). Zero rows (loading/empty) never carry the class.
  const isSingleRun = sessions.length === 1;
  useEffect(() => {
    closeHoverCard();
  }, [closeHoverCard, expandedRuns, rowSignature]);

  /**
   * One handler covers entering a row, whatever part of it the pointer is on
   * (the working-directory chip included — it is plain text now). The state
   * update is skipped when nothing changed, which keeps a fast sweep across
   * the list from re-rendering at pointer-event rate.
   */
  const handleRowHover = useCallback(
    (
      event: ReactPointerEvent<HTMLDivElement>,
      rowKey: string,
      details: RunHistoryRowDetails,
    ) => {
      hoverAnchorRef.current = event.currentTarget;
      setHoverCard((current) =>
        current !== null && current.key === rowKey
          ? current
          : { details, key: rowKey },
      );
    },
    [],
  );

  // The card is hoverable on purpose: it has to stay open while the pointer
  // moves onto it so long content can be read and scrolled. Leaving the list is
  // therefore only a dismissal when the pointer did not move onto the card, and
  // leaving the card is only a dismissal when it did not move back onto a row.
  const handleListPointerLeave = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const card = hoverCardRef.current;
      if (
        card &&
        event.relatedTarget instanceof Node &&
        card.contains(event.relatedTarget)
      ) {
        return;
      }
      closeHoverCard();
    },
    [closeHoverCard],
  );

  const handleCardPointerLeave = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const list = listRef.current;
      if (
        list &&
        event.relatedTarget instanceof Node &&
        list.contains(event.relatedTarget)
      ) {
        return;
      }
      closeHoverCard();
    },
    [closeHoverCard],
  );

  return (
    <section className="run-history grid size-full min-h-0 grid-rows-[48px_minmax(0,1fr)]">
      <header className={panelHeaderClass}>
        <div className={panelHeaderCopyClass}>
          <span className="eyebrow">RUN HISTORY</span>
          {/* Armed, the second line carries the scope instead of a count: the
              chip already says how many are live, and "全部历史" is the part
              that is easy to get wrong — the filter reads the agent's whole
              history, so the range in Settings no longer applies. */}
          {liveFiltering ? (
            <strong
              className="run-history__scope"
              title="Live 筛选读取该智能体的全部历史，不受时间范围限制"
            >
              All
            </strong>
          ) : (
            <strong>
              {/* Before the first snapshot there is no count to report; "0
                  runs" would state a fact that is only true for half a second
                  and reads as "nothing was captured". */}
              {initialLoading
                ? "loading…"
                : `${sessions.length} ${sessions.length === 1 ? "run" : "runs"}`}
            </strong>
          )}
        </div>
        <div className="run-history__header-meta">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className={cn(
                  "run-history__live-jump",
                  liveSummary.count === 0 && "is-idle",
                  liveFiltering && "is-filtering",
                )}
                aria-pressed={liveFiltering}
                aria-label={
                  liveFiltering
                    ? `关闭 Live 筛选（当前显示 ${liveSummary.count} 条正在执行的消息）`
                    : `打开 Live 筛选：只看正在执行的消息（${liveSummary.count} 条）`
                }
                onClick={() => {
                  const arming = !liveFilter;
                  onToggleLiveFilter();
                  // Arming doubles as the jump: the executing message is the
                  // reason to open this view, so it must not need a second
                  // click to become visible.
                  if (arming) {
                    jumpToLiveRun();
                  }
                }}
              >
                <Radio aria-hidden="true" />
                <span>{liveSummary.count} LIVE</span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" align="start" className="run-history__live-hint">
              {liveFiltering
                ? `关闭 Live 筛选，回到按 ${rangeLabel}窗口加载的消息`
                : `${liveSummary.count} 条消息正在执行。判定：该消息最新一次运行仍处于 running / waiting，且最近有活动（running 要求 10 分钟内、waiting 要求 60 分钟内），崩溃残留的会话不计入。计数覆盖全部客户端，不受时间范围限制。点击开启 Live 筛选，仅显示这 ${liveSummary.count} 条。`}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className={cn(
                  "run-history__reload",
                  reloading && "is-reloading",
                )}
                disabled={reloading || isDemo}
                aria-label="重新加载最新消息列表"
                onClick={onReloadLatest}
              >
                <RefreshCw aria-hidden="true" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {reloading ? "正在加载最新消息…" : "重新加载最新消息列表"}
            </TooltipContent>
          </Tooltip>
        </div>
      </header>
      <div
        className={cn(
          "run-history__list min-h-0 overflow-auto p-1.5",
          // A sparse list has the vertical room to show each message whole, so
          // the cards grow taller instead of cutting every title at two lines;
          // a dense list keeps the compact clamp for scannability. The
          // decision is hysteresis-stable (see `sparseList`).
          sparseList && "is-sparse",
          // A lone run stretches to fill the panel instead of floating as one
          // small card; with two or more rows the compact stack returns.
          isSingleRun && "is-single",
        )}
        ref={listRef}
        onPointerLeave={handleListPointerLeave}
        onScroll={handleListScroll}
      >
        <RunHistoryRows
          activeKey={activeKey}
          activePromptRunKey={activePromptRunKey}
          activePromptRunRef={activePromptRunRef}
          expandedRuns={expandedRuns}
          firstLiveKey={liveSummary.firstLiveKey}
          isDemo={isDemo}
          liveItemRef={liveItemRef}
          now={now}
          onHoverRow={handleRowHover}
          onSelect={handleRunSelect}
          onToggleRun={toggleRun}
          gitInfo={gitInfo}
          promptRunsBySession={promptRunsBySession}
          sessions={sessions}
        />
        {initialLoading ? (
          // A skeleton carries the shape of the list that is about to land, so
          // the panel does not read as "0 runs" for the half second (or, on a
          // large history, the few seconds) the snapshot takes to arrive.
          <div className="run-history__skeleton" role="status" aria-busy="true">
            <span className="sr-only">正在载入运行记录…</span>
            {[0, 1, 2, 3].map((index) => (
              <span
                aria-hidden="true"
                className="run-history__skeleton-row"
                key={index}
                style={
                  {
                    "--skeleton-index": index,
                  } as CSSProperties
                }
              >
                <i className="run-history__skeleton-dot" />
                <span className="run-history__skeleton-lines">
                  <i />
                  <i />
                </span>
              </span>
            ))}
          </div>
        ) : sessions.length === 0 ? (
          <output className="run-history__empty">
            {liveFiltering ? (
              <>
                <strong>当前没有正在执行的消息</strong>
                <span>关闭 Live 筛选可回到最近 {rangeLabel}内的消息</span>
              </>
            ) : demoError ? (
              <>
                <strong>最近 {rangeLabel}内没有消息</strong>
                <span>示例数据不可用：{demoError}</span>
              </>
            ) : (
              `最近 ${rangeLabel}内没有消息`
            )}
          </output>
        ) : null}
        {/* Loading earlier messages only makes sense against the windowed
            list: the armed Live filter already reads the agent's whole history,
            so a wider window could not add a row. */}
        {canLoadMore && !liveFiltering ? (
          <>
            <div
              aria-hidden="true"
              className="run-history__more"
              ref={sentinelRef}
            />
            {/* Explicit control so a list that does not fill the panel never
                loads history on its own. Auto-load stays scroll-armed. */}
            <button
              type="button"
              className="run-history__load-earlier"
              onClick={requestMore}
              title="滚动到底部或点击可加载更早的消息"
            >
              LOAD EARLIER
            </button>
          </>
        ) : null}
      </div>
      <RunHistoryHoverCardLayer
        anchorRef={hoverAnchorRef}
        card={hoverCard}
        cardRef={hoverCardRef}
        onCardPointerLeave={handleCardPointerLeave}
      />
    </section>
  );
});

/**
 * The single marker shared by LOG rows and trajectory atoms. Its `#number` is
 * the *other half's* LOG row, not a pair ordinal: a pair made of `#027` and
 * `#029` reads `T7·#029` on `#027` and `T7·#027` on `#029`. The two halves
 * cross-reference each other, so "who is paired with whom" is visible without
 * hovering, and clicking jumps straight to that numbered row. The tooltip
 * spells out both rows and the jump target. Kept as a real button so keyboard
 * users get the same jump, and it stops propagation so the jump never doubles
 * as a plain row selection.
 */
function PairLinkMarker({
  link,
  onLocate,
}: {
  link: TracePairLink;
  onLocate: (eventId: string) => void;
}) {
  const roleLabel = link.role === "start" ? "起始" : "结果";
  const targetLabel = link.role === "start" ? "结果" : "起始";
  const targetRow = formatLogSequence(link.partnerIndex);
  const pairHint = `${link.label} · 第 ${link.turn} 轮第 ${link.ordinal} 对 · ${link.rows} · #号是另一半的 LOG 行号`;
  return (
    <button
      type="button"
      className={`pair-link-marker is-${link.role}`}
      title={`${pairHint}，成对${roleLabel}，点击定位${targetLabel}事件 ${targetRow}`}
      aria-label={`${pairHint}，成对${roleLabel}，定位${targetLabel}事件 ${targetRow}`}
      onClick={(clickEvent) => {
        clickEvent.stopPropagation();
        onLocate(link.partnerId);
      }}
      onKeyDown={(keyEvent) => {
        if (keyEvent.key === "Enter" || keyEvent.key === " ") {
          keyEvent.preventDefault();
          keyEvent.stopPropagation();
          onLocate(link.partnerId);
        }
      }}
    >
      <Link2 aria-hidden="true" />
      <b className="pair-link-marker__turn">T{link.turn}</b>
      <span className="pair-link-marker__target">{targetRow}</span>
    </button>
  );
}

/**
 * `buildLogEntries` rebuilds every pair link when a streamed batch appends an
 * event, so the row memo cannot compare links by identity. Compare the fields
 * the row and its tooltip render instead: a batch that leaves a pair unchanged
 * then leaves both of its rows memoized.
 */
function isSamePairLink(
  before: TracePairLink | null,
  after: TracePairLink | null,
) {
  if (before === after) {
    return true;
  }
  if (!before || !after) {
    return false;
  }
  return (
    before.pairId === after.pairId &&
    before.partnerId === after.partnerId &&
    before.role === after.role &&
    before.turn === after.turn &&
    before.ordinal === after.ordinal &&
    before.startIndex === after.startIndex &&
    before.endIndex === after.endIndex &&
    before.partnerIndex === after.partnerIndex &&
    before.label === after.label &&
    before.rows === after.rows
  );
}

/**
 * One virtualized log row. Memoized on (event, index, selected, running): a
 * streaming batch, a selection change, or a running-marker move then only
 * re-renders the rows whose own state moved instead of re-reconciling every
 * visible row. The `onSelect` dispatch reaches the row through a latest ref
 * so the memo comparator can ignore its identity, and the derived strings
 * (event key, action, summary, formatted time) are computed once per mount —
 * `getEventSummary` additionally caches per event across re-mounts.
 */
const AtomicLogRow = memo(function AtomicLogRow({
  atomType,
  event,
  index,
  onLocatePartner,
  onSelect,
  pairDuration,
  pairLink,
  partnerSelected,
  running,
  selected,
}: {
  atomType: EventAtomType | null;
  event: TraceEvent;
  index: number;
  onLocatePartner: (eventId: string) => void;
  onSelect: (eventId: string) => void;
  pairDuration: number | null;
  pairLink: TracePairLink | null;
  partnerSelected: boolean;
  running: boolean;
  selected: boolean;
}) {
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const meta = eventMeta[event.eventName] || eventMeta.Unknown;
  const dateLabel = useMemo(
    () => formatDate(event.capturedAt),
    [event.capturedAt],
  );
  const clockLabel = useMemo(
    () => formatClock(event.capturedAt),
    [event.capturedAt],
  );
  const durationLabel = useMemo(
    () => (pairDuration === null ? null : formatDurationMs(pairDuration)),
    [pairDuration],
  );
  return (
    <div
      data-event-id={event.id}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      className={cn(
        "atomic-log__row",
        `tone-${meta.tone}`,
        running && "is-running",
        selected && !running && "is-selected",
        partnerSelected && !selected && "is-pair-partner",
      )}
      onClick={() => onSelectRef.current(event.id)}
      onKeyDown={(keyEvent) => {
        if (keyEvent.key === "Enter" || keyEvent.key === " ") {
          keyEvent.preventDefault();
          onSelectRef.current(event.id);
        }
      }}
    >
      <span className="log-sequence">{formatLogSequence(index + 1)}</span>
      <i className="phase-dot" />
      <strong className="atomic-log__name">
        {atomType ? (
          <span
            className="atomic-log__type"
            title={`原子类型 ${atomType.label} · ${atomType.key} / ${atomType.kind}`}
          >
            {atomType.label}
          </span>
        ) : null}
        <span className="atomic-log__key">{getTraceEventKey(event)}</span>
      </strong>
      <time dateTime={event.capturedAt} title={event.capturedAt}>
        <span>{dateLabel}</span>
        {clockLabel}
      </time>
      <small>
        <span>{getEventAction(event)}</span>
        <span className="atomic-log__summary">
          {getEventSummary(event)}
        </span>
        {durationLabel !== null ? (
          <span
            className={`atomic-log__duration heat-${durationHeatClass(
              pairDuration as number,
            )}`}
            title={`成对耗时 ${durationLabel}`}
          >
            {durationLabel}
          </span>
        ) : null}
        {pairLink ? (
          <PairLinkMarker link={pairLink} onLocate={onLocatePartner} />
        ) : null}
      </small>
    </div>
  );
}, (before, after) =>
  before.atomType === after.atomType &&
  before.event === after.event &&
  before.index === after.index &&
  before.onLocatePartner === after.onLocatePartner &&
  before.pairDuration === after.pairDuration &&
  isSamePairLink(before.pairLink, after.pairLink) &&
  before.partnerSelected === after.partnerSelected &&
  before.running === after.running &&
  before.selected === after.selected,
);

/**
 * The event log mounts only the rows intersecting the viewport, so a session
 * with tens of thousands of events stays responsive while streaming.
 */
const AtomicLog = memo(function AtomicLog({
  events,
  platformId,
  runningEventId,
  selectedEventId,
  locateRequest,
  queryResetToken,
  onSelect,
  onLocatePartner,
  onLocateSelectedAtom,
  canLocateSelectedAtom,
  live,
}: {
  events: TraceEvent[];
  platformId: string;
  runningEventId: string;
  selectedEventId: string;
  locateRequest: number;
  queryResetToken: number;
  onSelect: (eventId: string) => void;
  onLocatePartner: (eventId: string) => void;
  onLocateSelectedAtom: () => void;
  canLocateSelectedAtom: boolean;
  live: boolean;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const locateRequestRef = useRef(locateRequest);
  const scrollFrameRef = useRef(0);
  // Render-cost instrumentation: the body stamps its start time, and the
  // no-deps layout effect below closes the measurement after commit. The
  // samples feed `window.__astroPerf` (and the Settings → 性能 HUD) so list
  // render cost is comparable before and after a change.
  const renderStartRef = useRef(0);
  renderStartRef.current = performance.now();
  const [metrics, setMetrics] = useState<LogRowMetrics>({
    gap: LOG_ROW_GAP,
    row: LOG_ROW_ESTIMATE,
    turn: LOG_TURN_ESTIMATE,
  });
  const [viewport, setViewport] = useState({ height: 0, top: 0 });
  const [scrollPosition, setScrollPosition] = useState({
    canScrollDown: false,
    canScrollUp: false,
  });
  // The search text is log-local state: a keystroke re-renders only this
  // panel, not the studio around it. Filtering reads a deferred copy of the
  // text, so typing stays immediate while the re-filter runs behind it, and
  // app-root flows that need an empty box bump `queryResetToken`.
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  useEffect(() => {
    setQuery("");
  }, [queryResetToken]);
  // Mirror of `scrollPosition` used by the scroll handler: the up chevron
  // only appears once the reader has actually scrolled into older events, and
  // it stays until they are back near the newest ones. The gap between the
  // two thresholds is the hysteresis that stops it from flickering at the
  // boundary.
  const scrollStateRef = useRef({
    canScrollDown: false,
    canScrollUp: false,
  });
  // Entries are built once per events change; the deferred needle only
  // re-runs the (cached-haystack) filter, so a keystroke never pays for
  // rebuilding every turn separator.
  const entries = useMemo(
    () => buildLogEntries(events, platformId),
    [events, platformId],
  );
  const visibleEntries = useMemo(() => {
    const needle = deferredQuery.trim().toLowerCase();
    const matched = needle
      ? entries.filter(({ event }) => matchesEventQuery(event, needle))
      : entries;
    return [...matched].reverse();
  }, [entries, deferredQuery]);

  // Warm the search haystacks in idle slices: the first keystroke stays fast
  // without making the selection of a long run pay for serializing every
  // event up front.
  useEffect(() => warmEventSearchCache(events), [events]);
  const layout = useMemo(
    () => buildLogLayout(visibleEntries, metrics),
    [metrics, visibleEntries],
  );
  const range = useMemo(
    () => findVisibleRange(layout.offsets, viewport.top, viewport.height),
    [layout.offsets, viewport.height, viewport.top],
  );
  // Never mount a window that ends on a turn separator: its row would sit just
  // outside the window and the chip would label an empty slot at the bottom.
  const mountedRange = includeTurnRow(layout.items, range);
  const slice = layout.items.slice(mountedRange.start, mountedRange.end);

  const syncScrollPosition = useCallback(() => {
    const list = listRef.current;
    if (!list) {
      return;
    }
    const remaining = list.scrollHeight - list.clientHeight - list.scrollTop;
    const current = scrollStateRef.current;
    const canScrollDown = remaining > 2;
    const canScrollUp = current.canScrollUp
      ? list.scrollTop > 24
      : list.scrollTop > 96;
    if (
      canScrollDown === current.canScrollDown &&
      canScrollUp === current.canScrollUp
    ) {
      return;
    }
    scrollStateRef.current = { canScrollDown, canScrollUp };
    setScrollPosition(scrollStateRef.current);
  }, []);

  useLayoutEffect(() => {
    recordListRender(performance.now() - renderStartRef.current, slice.length);
  });

  // Track the viewport before paint so the first visible slice mounts without
  // an empty frame.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) {
      return undefined;
    }
    const syncViewport = () => {
      setViewport({ height: list.clientHeight, top: list.scrollTop });
    };
    syncViewport();
    // Scroll FPS sampling: runs only while the list actually scrolls.
    const disconnectFps = attachScrollFpsTracker(list);
    if (typeof ResizeObserver === "undefined") {
      return disconnectFps;
    }
    const observer = new ResizeObserver(syncViewport);
    observer.observe(list);
    return () => {
      observer.disconnect();
      disconnectFps();
    };
  }, []);

  // Measure the real row and separator heights once they are in the DOM.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) {
      return;
    }
    const row = list.querySelector<HTMLElement>(".atomic-log__row");
    const turn = list.querySelector<HTMLElement>(".atomic-log__turn");
    const next = {
      gap: metrics.gap,
      row: row?.offsetHeight || metrics.row,
      turn: turn?.offsetHeight || metrics.turn,
    };
    if (next.row !== metrics.row || next.turn !== metrics.turn) {
      setMetrics(next);
    }
  }, [metrics, visibleEntries]);

  const handleScroll = useCallback(() => {
    if (scrollFrameRef.current) {
      return;
    }
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = 0;
      const list = listRef.current;
      if (!list) {
        return;
      }
      setViewport((current) =>
        current.top === list.scrollTop
          ? current
          : { height: current.height, top: list.scrollTop },
      );
      syncScrollPosition();
    });
  }, [syncScrollPosition]);

  useEffect(
    () => () => {
      if (scrollFrameRef.current) {
        window.cancelAnimationFrame(scrollFrameRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    const explicitLocate = locateRequestRef.current !== locateRequest;
    const list = listRef.current;
    if (!list || !selectedEventId) {
      return;
    }
    const entryIndex = visibleEntries.findIndex(
      (entry) => entry.event.id === selectedEventId,
    );
    if (entryIndex < 0) {
      // The row is not in the visible list (e.g. a search filter hides it):
      // keep the locate request *pending* — the ref advances only once the
      // row is findable, so the request flushes the moment the row returns
      // (filter cleared, session switched) instead of being silently lost.
      return;
    }
    locateRequestRef.current = locateRequest;
    const nextTop = resolveScrollTopForRow({
      center: explicitLocate,
      rowHeight: metrics.row,
      scrollTop: list.scrollTop,
      top: layout.rowTops[entryIndex],
      viewportHeight: list.clientHeight,
    });
    if (nextTop === null) {
      return;
    }
    // An explicit locate centers the row *instantly*, matching the
    // trajectory's locate (scrollRowWithinContainer): a smooth animation
    // here would run against the virtualized slice re-renders and could be
    // canceled mid-flight, so the feedback must not depend on it.
    list.scrollTop = nextTop;
  }, [
    layout.rowTops,
    locateRequest,
    metrics.row,
    selectedEventId,
    visibleEntries,
  ]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(syncScrollPosition);
    return () => window.cancelAnimationFrame(frame);
  }, [syncScrollPosition, visibleEntries]);

  const scrollToEdge = (edge: "top" | "bottom") => {
    listRef.current?.scrollTo({
      behavior: "smooth",
      top: edge === "top" ? 0 : listRef.current.scrollHeight,
    });
  };

  return (
    <section className="atomic-log grid min-h-0 grid-rows-[48px_minmax(0,1fr)]">
      <header
        className={cn(
          panelHeaderClass,
          "atomic-log__header justify-start gap-2 pl-9",
        )}
      >
        <div className="atomic-log__title">
          <span className="eyebrow">LOG</span>
          <IconAction
            label={
              canLocateSelectedAtom
                ? "定位当前执行原子"
                : "请先选择一个执行原子或事件"
            }
            onClick={onLocateSelectedAtom}
            className="locate-button"
            disabled={!canLocateSelectedAtom}
          >
            <LocateFixed />
          </IconAction>
        </div>
        <InputGroup className="atomic-log__search">
          <InputGroupInput
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search tools or text"
            aria-label="搜索事件日志"
          />
          <InputGroupAddon align="inline-start">
            <Search aria-hidden="true" />
          </InputGroupAddon>
        </InputGroup>
        {/* Scroll controls live in the header, not floating over the list: an
            overlay chevron sat on top of the first visible atom, so the row a
            reader had just scrolled to was half hidden behind a button. In the
            header both edges stay reachable and no row is ever covered. Both
            buttons stay visible at all times — the container reserves the
            two-button width — and the unreachable edge is expressed with a
            disabled state instead of unmounting, so the header layout never
            shifts as the list scrolls. */}
        <div className="atomic-log__scroll-controls">
          <button
            type="button"
            className="atomic-log__scroll-button atomic-log__scroll-button--top"
            aria-label={live ? "回到最新事件" : "滚动到顶部"}
            title={live ? "回到最新事件" : "滚动到顶部"}
            disabled={!scrollPosition.canScrollUp}
            onClick={() => scrollToEdge("top")}
          >
            <ChevronUp aria-hidden="true" />
          </button>
          <button
            type="button"
            className="atomic-log__scroll-button atomic-log__scroll-button--bottom"
            aria-label="滚动到底部"
            title="滚动到底部"
            disabled={!scrollPosition.canScrollDown}
            onClick={() => scrollToEdge("bottom")}
          >
            <ChevronDown aria-hidden="true" />
          </button>
        </div>
      </header>
      <div className="atomic-log__body relative min-h-0 overflow-hidden">
        <div
          ref={listRef}
          className="atomic-log__list size-full min-h-0 overflow-auto px-2 py-1.5 outline-none [scroll-padding-block:38px]"
          aria-label="事件日志，可使用方向键或 Page Up、Page Down 滚动"
          onScroll={handleScroll}
          tabIndex={0}
        >
          {visibleEntries.length ? (
            <div
              className="atomic-log__viewport"
              style={{ height: layout.total }}
            >
              <div
                className="atomic-log__slice"
                style={{ transform: `translateY(${slice[0]?.top ?? 0}px)` }}
              >
                {slice.map((item) => {
                  if (item.kind === "turn") {
                    // Key by position, never by the turn value: two groups can
                    // legitimately repeat a number (a source that restarts its
                    // counter), and duplicate keys left React with orphaned
                    // chips that survived the next agent switch.
                    return (
                      <div
                        className="atomic-log__turn"
                        aria-label={`Turn ${item.turn}`}
                        key={`turn-${item.entryIndex}`}
                      >
                        <span>TURN {String(item.turn).padStart(2, "0")}</span>
                      </div>
                    );
                  }
                  const { atomType, event, index, pairDuration, pairLink } =
                    visibleEntries[item.index];
                  return (
                    <AtomicLogRow
                      atomType={atomType}
                      event={event}
                      index={index}
                      key={event.id}
                      onLocatePartner={onLocatePartner}
                      onSelect={onSelect}
                      pairDuration={pairDuration}
                      pairLink={pairLink}
                      partnerSelected={
                        pairLink?.partnerId === selectedEventId
                      }
                      running={event.id === runningEventId}
                      selected={event.id === selectedEventId}
                    />
                  );
                })}
              </div>
            </div>
          ) : (
            <output className="atomic-log__empty grid h-full place-items-center">
              No matching events
            </output>
          )}
        </div>
      </div>
    </section>
  );
});

function InspectorOverview({
  node,
  atom,
  event,
}: {
  node: TraceNodeType | null;
  atom: HarnessNodeData | null;
  event: TraceEvent | null;
}) {
  const data = node?.data;
  const tone = atom?.tone || data?.meta?.tone || "unknown";
  const status = atom?.status || data?.status || "idle";
  const title = atom?.label || event?.eventName || "Event";
  const details = atom
    ? [
        ["Section", atom.section],
        ["Kind", atom.kind],
        ["State", status],
        ["Gate", atom.gateState || "--"],
        ["Loop turns", atom.iterations ?? "--"],
        ["Bound event", event?.eventName || "--"],
        ["Input ports", atom.input.length],
        ["Output ports", atom.output.length],
      ]
    : [
        ["Source", event?.source || "--"],
        ["Event", event?.eventName || "--"],
        ["Native event", event?.nativeEventName || "--"],
        ["State", status],
        ["Captured", event ? formatClock(event.capturedAt) : "--"],
        [
          "Duration",
          data?.duration === null || data?.duration === undefined
            ? "--"
            : formatDuration(data.duration),
        ],
        ["Tool", event?.toolName || data?.startEvent?.toolName || "--"],
        ["Call ID", event?.toolUseId || data?.startEvent?.toolUseId || "--"],
        ["Turn", event?.turnId || "--"],
      ];

  return (
    <div className="inspector-overview">
      <div className="event-signature">
        <span className={`event-signature__icon tone-${tone}`}>
          {atom?.kind === "tool" || data?.eventName === "PreToolUse" ? (
            <TerminalSquare />
          ) : (
            <Activity />
          )}
        </span>
        <div>
          <strong>{title}</strong>
          <code title={event?.id || atom?.key || undefined}>
            {event?.id || atom?.key || "--"}
          </code>
        </div>
        <span className={`status-pill status-${status}`}>
          <i />
          {status}
        </span>
      </div>
      <p className="inspector-overview__summary">
        {atom?.description ||
          (event ? getEventSummary(event) : "No event is bound to this atom yet.")}
      </p>
      <dl className="detail-list">
        {details.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd title={String(value)}>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function TraceInspector({
  activeTab,
  atom,
  event,
  index,
  node,
  onActiveTabChange,
}: {
  activeTab: string;
  atom: HarnessNodeData | null;
  event: TraceEvent | null;
  index: number;
  node: TraceNodeType | null;
  onActiveTabChange: (tab: string) => void;
}) {
  if ((!node || !event) && !atom) {
    return (
      <section className="message-inspector message-inspector--empty flex min-h-0 flex-col items-center justify-center gap-[7px] p-[22px] text-center">
        <div className="message-inspector__guide" aria-hidden="true">
          <span>
            <Network />
          </span>
          <i />
          <span>
            <ListTree />
          </span>
          <i />
          <span>
            <Focus />
          </span>
        </div>
        <strong>NO EVENT SELECTED</strong>
        <small>Select an atom or log entry to inspect its captured data.</small>
      </section>
    );
  }

  const capturedInput =
    node && event
      ? getPayloadForTab(node, event, "input")
      : event?.payload?.tool_input || event?.payload || null;
  const capturedOutput =
    node && event
      ? getPayloadForTab(node, event, "output")
      : event?.payload?.tool_response || null;
  const promptEvent = event?.eventName === "UserPromptSubmit"
    ? event
    : node?.data.startEvent.eventName === "UserPromptSubmit"
      ? node.data.startEvent
      : null;
  const payloadByTab: Record<InspectorTab, unknown> = {
    input: atom
      ? { contract: atom.input, captured: capturedInput }
      : capturedInput,
    output: atom
      ? { contract: atom.output, captured: capturedOutput }
      : capturedOutput,
    raw: atom
      ? {
          atom: {
            key: atom.key,
            label: atom.label,
            section: atom.section,
            kind: atom.kind,
            status: atom.status,
            gate: atom.gateState,
            iterations: atom.iterations,
            input: atom.input,
            output: atom.output,
          },
          event,
        }
      : event,
  };
  const inspectorTitle = atom
    ? atom.label
    : event
      ? eventMeta[event.eventName]?.label || event.eventName
      : "Event";
  const inspectorSequence =
    event?.sequence ?? (index >= 0 ? index + 1 : (atom?.index ?? 0) + 1);
  const executionInstruction = event
    ? getExecutionInstruction(event, node?.data.startEvent)
    : atom?.label || inspectorTitle;

  return (
    <section className="message-inspector grid min-h-0 grid-rows-[minmax(56px,auto)_minmax(0,1fr)]">
      <header
        className={cn(
          panelHeaderClass,
          "inspector-header min-h-14 border-b-[var(--line-bright)] border-t-2 border-t-[var(--selection-border)] px-3 py-2",
        )}
      >
        <div className={cn(panelHeaderCopyClass, "gap-px")}>
          <span className="eyebrow">
            EVENT INSPECTOR · #{inspectorSequence}
          </span>
          <code
            className="inspector-header__instruction"
            title={executionInstruction}
          >
            {executionInstruction}
          </code>
        </div>
        <Badge
          variant="outline"
          className="inspector-header__focus h-6 max-w-[58%] rounded-full px-2"
          title={event?.locator || atom?.key || inspectorTitle}
        >
          <CornerUpRight data-icon="inline-start" />
          <span className="min-w-0 truncate">{inspectorTitle}</span>
        </Badge>
      </header>
      <Tabs
        value={activeTab}
        onValueChange={onActiveTabChange}
        className="inspector-tabs min-h-0 gap-0"
      >
        <TabsList variant="line" aria-label="检查器数据">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="input">Input</TabsTrigger>
          <TabsTrigger value="output">Output</TabsTrigger>
          <TabsTrigger value="raw">Raw</TabsTrigger>
        </TabsList>
        <TabsContent
          value="overview"
          className="inspector-tabs__content m-0 min-h-0 overflow-auto"
        >
          <InspectorOverview node={node} atom={atom} event={event} />
        </TabsContent>
        {(["input", "output", "raw"] as InspectorTab[]).map((tab) => (
          <TabsContent
            key={tab}
            value={tab}
            className={cn(
              "inspector-tabs__content m-0 min-h-0",
              tab === "input" && promptEvent
                ? "inspector-tabs__content--prompt overflow-hidden"
                : "inspector-tabs__content--json overflow-hidden",
            )}
          >
            {tab === "input" && promptEvent ? (
              <PromptContent key={promptEvent.id} payload={promptEvent.payload} />
            ) : (
              <JsonViewer value={payloadByTab[tab]} />
            )}
          </TabsContent>
        ))}
      </Tabs>
    </section>
  );
}

type TrajectoryDisplayRow = Pick<
  TrajectoryAtom,
  | "count"
  | "duration"
  | "id"
  | "key"
  | "kind"
  | "label"
  | "pairDuration"
  | "pairLink"
  | "occurredAt"
  | "status"
  | "summary"
  | "tone"
  | "turn"
>;

function TrajectoryRow({
  depth,
  expandable = false,
  expanded = false,
  onActivate,
  onHover,
  onLocatePartner,
  onToggle,
  partnerSelected = false,
  row,
  selected,
  showPairMarker = true,
  showTurn = true,
}: {
  depth: number;
  expandable?: boolean;
  expanded?: boolean;
  onActivate: () => void;
  onHover?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onLocatePartner?: (eventId: string) => void;
  onToggle?: () => void;
  partnerSelected?: boolean;
  row: TrajectoryDisplayRow;
  selected: boolean;
  /** One trace event projects into several atoms; only the pair's owner draws the marker. */
  showPairMarker?: boolean;
  showTurn?: boolean;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-expanded={expandable ? expanded : undefined}
      className={cn(
        "trajectory-row",
        expandable && "is-loop",
        selected && "is-selected",
        partnerSelected && !selected && "is-pair-partner",
      )}
      style={{ "--depth": depth } as CSSProperties}
      onClick={onActivate}
      onPointerOver={onHover}
      onKeyDown={(keyEvent) => {
        if (keyEvent.key === "Enter" || keyEvent.key === " ") {
          keyEvent.preventDefault();
          onActivate();
        } else if (
          expandable &&
          ((keyEvent.key === "ArrowRight" && !expanded) ||
            (keyEvent.key === "ArrowLeft" && expanded))
        ) {
          keyEvent.preventDefault();
          onToggle?.();
        }
      }}
    >
      <span
        aria-hidden={!expandable}
        className={cn(
          "trajectory-row__toggle",
          !expandable && "is-leaf",
        )}
        onClick={(clickEvent) => {
          if (!expandable) {
            return;
          }
          clickEvent.stopPropagation();
          onToggle?.();
        }}
      >
        {expandable ? (
          <ChevronRight className={expanded ? "is-expanded" : ""} />
        ) : null}
      </span>
      <span className={`trajectory-row__badge tone-${row.tone}`}>
        {atomTypeLabel(row.key, row.kind)}
      </span>
      <span className="trajectory-row__identity">
        <strong>{row.label}</strong>
        <small>
          {row.key}
          {showTurn ? ` · turn ${row.turn}` : ""}
        </small>
      </span>
      <span className="trajectory-row__count">x{row.count}</span>
      <span className="trajectory-row__summary">{row.summary}</span>
      <time dateTime={row.occurredAt}>
        <span>{formatDate(row.occurredAt)}</span>
        <span>{formatClock(row.occurredAt)}</span>
        {row.pairDuration !== null ? (
          /* The closed pair is the meaningful span; printing the wall-time
             next to it shows two numbers for one duration (a 6s wall and a
             6s pair). The pair badge and its link marker share one line. */
          <span className="trajectory-row__pair-line">
            <small
              className={`trajectory-row__pair heat-${durationHeatClass(
                row.pairDuration,
              )}`}
              title="成对耗时"
            >
              {formatDurationMs(row.pairDuration)}
            </small>
            {row.pairLink && showPairMarker && onLocatePartner ? (
              <PairLinkMarker
                link={row.pairLink}
                onLocate={onLocatePartner}
              />
            ) : null}
          </span>
        ) : (
          <small
            className={`trajectory-row__duration heat-${durationHeatClass(
              row.duration,
            )}`}
          >
            {formatDurationMs(row.duration)}
          </small>
        )}
      </time>
      <i className={`trajectory-row__status status-${row.status}`} />
    </div>
  );
}

function loopRowForTurn(turn: TrajectoryTurn): TrajectoryDisplayRow {
  return {
    count: turn.atoms.length,
    duration: turn.duration,
    id: `loop-turn-${turn.turn}`,
    key: "loop.turn",
    kind: "loop",
    label: "Loop Turn",
    // A turn block is not itself a paired event, so it carries no pair span
    // and no link marker; its closed-pair total surfaces through the hover
    // card instead.
    pairDuration: null,
    pairLink: null,
    occurredAt: turn.occurredAt,
    status: turn.status,
    summary: turn.summary,
    tone: "reasoning",
    turn: turn.turn,
  };
}

/**
 * The hover card's body, fed by the *paired* duration statistics:
 * `pairDuration` is the hovered block's own closed start→end span (null when
 * it is not part of a closed pair), and `pairTotal` is the sum of the closed
 * pair spans in the block — set for a turn block, undefined for a single atom.
 * Unpaired events contribute nothing to either, so a block with no closed pair
 * simply omits the badge instead of printing a 0.
 */
type TrajectoryHoverDetails = {
  /** The atom's closed start→end span, `null` when it is not a closed pair. */
  pairDuration: number | null;
  /** `T<turn>·#<start> ↔ #<end>`: both LOG rows of the pair, turn included. */
  pairLabel?: string;
  /** Sum of the closed pair spans inside the block; a turn block only. */
  pairTotal?: number;
  /** The atom's own wall-time span; a single atom only. */
  duration?: number;
  /** The concrete event name this atom stands for (e.g. `Read`). */
  eventName?: string;
  /** The tool a tool atom runs, when its event carries one. */
  toolName?: string;
  /** The atom's category (TYPE) — resolves the same way as the row badge. */
  type?: string;
  status: string;
  subtitle: string;
  title: string;
};

type TrajectoryHoverCard = {
  details: TrajectoryHoverDetails;
  key: string;
};

function TrajectoryDetailsCard({ details }: { details: TrajectoryHoverDetails }) {
  const pairShown = details.pairDuration !== null;
  // A lane slot's title is already the tool (`Read`), so repeating the same
  // tool on the EVENT line reads as a second, unexplained field. Only show it
  // when it adds information the title does not already carry.
  const toolName =
    details.toolName &&
    details.toolName !== details.title &&
    !details.title.includes(details.toolName)
      ? details.toolName
      : null;
  // Every field uses one value size and one label size (see the card's CSS
  // type scale); colour, not font size, tells the fields apart. The duration
  // carries its heat class and the status keeps its own semantic colour, so
  // "how long" and "how it ended" never read as the same thing.
  return (
    <div className="trajectory-hover__card">
      <strong>{details.title}</strong>
      <span className="trajectory-hover__subtitle">{details.subtitle}</span>
      {details.type ? (
        <span className="trajectory-hover__field">
          <b className="trajectory-hover__label">TYPE</b> ·{" "}
          <i className="trajectory-hover__value is-type">{details.type}</i>
        </span>
      ) : null}
      {details.eventName ? (
        <span className="trajectory-hover__field">
          <b className="trajectory-hover__label">EVENT</b> ·{" "}
          <i className="trajectory-hover__value is-event">
            {details.eventName}
          </i>
          {toolName ? (
            <i className="trajectory-hover__tool"> {toolName}</i>
          ) : null}
        </span>
      ) : null}
      {pairShown ? (
        <span className="trajectory-hover__field">
          <b className="trajectory-hover__label">PAIR</b> ·{" "}
          {details.pairLabel ? (
            <i className="trajectory-hover__pair">{details.pairLabel} · </i>
          ) : null}
          <i
            className={`trajectory-hover__duration heat-${durationHeatClass(
              details.pairDuration as number,
            )}`}
          >
            {formatDurationMs(details.pairDuration as number)}
          </i>
        </span>
      ) : null}
      {details.duration !== undefined && !pairShown ? (
        <span className="trajectory-hover__field">
          <b className="trajectory-hover__label">DURATION</b> ·{" "}
          <i
            className={`trajectory-hover__duration heat-${durationHeatClass(
              details.duration,
            )}`}
          >
            {formatDurationMs(details.duration)}
          </i>
        </span>
      ) : null}
      {details.pairTotal !== undefined ? (
        <span className="trajectory-hover__field">
          <b className="trajectory-hover__label">PAIRS</b> ·{" "}
          <i className="trajectory-hover__duration">
            {formatDurationMs(details.pairTotal)}
          </i>
        </span>
      ) : null}
      <span className="trajectory-hover__field">
        <b className="trajectory-hover__label">STATUS</b> ·{" "}
        <i className={`trajectory-hover__status status-${details.status}`}>
          {details.status}
        </i>
      </span>
    </div>
  );
}

/**
 * One hover card serves the whole trajectory list, mirroring the RUN HISTORY
 * controlled layer: a single fixed layer that follows the hovered block and
 * re-positions imperatively, so a fast sweep across rows never leaves a stale
 * card behind and the card stays open while the pointer moves onto it.
 */
const TrajectoryHoverCardLayer = memo(function TrajectoryHoverCardLayer({
  anchorRef,
  card,
  cardRef,
  onCardPointerLeave,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  card: TrajectoryHoverCard | null;
  cardRef: RefObject<HTMLDivElement | null>;
  onCardPointerLeave: (event: ReactPointerEvent<HTMLDivElement>) => void;
}) {
  useLayoutEffect(() => {
    if (!card) {
      return undefined;
    }
    const element = cardRef.current;
    if (!element) {
      return undefined;
    }
    let frame = 0;
    const place = () => {
      frame = 0;
      const anchor = anchorRef.current;
      if (!anchor || !anchor.isConnected) {
        element.style.visibility = "hidden";
        return;
      }
      // The card anchors to a block in either the list or the lane overview;
      // hide it when that block has scrolled vertically out of its panel.
      const panelBounds = anchor
        .closest(".trajectory-list, .trajectory-map")
        ?.getBoundingClientRect();
      const anchorBounds = anchor.getBoundingClientRect();
      if (
        panelBounds &&
        (anchorBounds.bottom < panelBounds.top ||
          anchorBounds.top > panelBounds.bottom)
      ) {
        element.style.visibility = "hidden";
        return;
      }
      const cardBounds = element.getBoundingClientRect();
      const gap = 8;
      const onRight = anchorBounds.right + gap;
      const onLeft = anchorBounds.left - gap - cardBounds.width;
      const left =
        onRight + cardBounds.width <= window.innerWidth - gap
          ? onRight
          : Math.max(
              gap,
              Math.min(onLeft, window.innerWidth - gap - cardBounds.width),
            );
      const top = Math.min(
        Math.max(gap, anchorBounds.top),
        Math.max(gap, window.innerHeight - gap - cardBounds.height),
      );
      element.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
      element.style.visibility = "visible";
    };
    const schedule = () => {
      if (frame) {
        return;
      }
      frame = window.requestAnimationFrame(place);
    };
    place();
    document.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    return () => {
      if (frame) {
        window.cancelAnimationFrame(frame);
      }
      document.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
    };
  }, [anchorRef, card, cardRef]);

  if (!card) {
    return null;
  }

  return (
    <div
      className="trajectory-hover__layer"
      onPointerLeave={onCardPointerLeave}
      ref={cardRef}
      role="tooltip"
    >
      <TrajectoryDetailsCard key={card.key} details={card.details} />
    </div>
  );
});

const TrajectoryView = memo(function TrajectoryView({
  atomNodes,
  atomicEvents,
  nodes,
  events,
  locateRequest,
  selectedAtomId,
  selectedEventId,
  selectedNodeId,
  canLocateSelection,
  onLocateSelection,
  onLocatePartner,
  onSelect,
}: {
  atomNodes: HarnessNode[];
  atomicEvents: ReturnType<typeof projectTraceEvents>["events"];
  nodes: TraceNodeType[];
  events: TraceEvent[];
  locateRequest: number;
  selectedAtomId: string;
  selectedEventId: string;
  selectedNodeId: string;
  canLocateSelection: boolean;
  onLocateSelection: () => void;
  onLocatePartner: (eventId: string) => void;
  onSelect: (eventId: string, atomId?: string) => void;
}) {
  const model = useMemo(
    () => buildTrajectoryModel(events, atomicEvents, atomNodes),
    [atomNodes, atomicEvents, events],
  );
  const turnKey = model.turns.map((turn) => turn.turn).join("|");
  // Newest first, like RUN HISTORY: the turn and the atom that are executing
  // right now are the first rows, so following a live run never means scrolling
  // past its start. The lane overview above stays a left-to-right timeline.
  const display = useMemo(() => orderTrajectoryNewestFirst(model), [model]);
  const [expandedTurns, setExpandedTurns] = useState<Set<number>>(
    () => new Set(model.turns.at(-1) ? [model.turns.at(-1)!.turn] : []),
  );
  const listRef = useRef<HTMLDivElement | null>(null);
  const locateRequestRef = useRef(locateRequest);
  // One controlled hover layer per list (mirrors RUN HISTORY): the card is a
  // single fixed layer that follows the hovered block, so sweeping across the
  // trajectory rows never leaves a stale tooltip behind.
  const [hoverCard, setHoverCard] = useState<TrajectoryHoverCard | null>(null);
  const hoverCardRef = useRef<HTMLDivElement | null>(null);
  const hoverAnchorRef = useRef<HTMLElement | null>(null);

  const closeHoverCard = useCallback(() => {
    hoverAnchorRef.current = null;
    setHoverCard((current) => (current === null ? current : null));
  }, []);

  const hasHoverCard = hoverCard !== null;
  // Capture-phase watchdog: hide the card the moment the pointer is over
  // neither the card nor its anchor row (leaving through a gap, scrolling the
  // row away, or the window losing focus).
  useEffect(() => {
    if (!hasHoverCard) {
      return undefined;
    }
    const handlePointerMove = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (
        hoverCardRef.current?.contains(target) ||
        hoverAnchorRef.current?.contains(target)
      ) {
        return;
      }
      closeHoverCard();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeHoverCard();
      }
    };
    window.addEventListener("pointermove", handlePointerMove, true);
    window.addEventListener("blur", closeHoverCard);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove, true);
      window.removeEventListener("blur", closeHoverCard);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeHoverCard, hasHoverCard]);

  // Entering a block (any part of it) shows the card; the state update is
  // skipped when nothing changed so a fast sweep doesn't re-render at
  // pointer-event rate.
  const handleRowHover = useCallback(
    (
      event: ReactPointerEvent<HTMLElement>,
      key: string,
      details: TrajectoryHoverDetails,
    ) => {
      hoverAnchorRef.current = event.currentTarget;
      setHoverCard((current) =>
        current !== null && current.key === key
          ? current
          : { details, key },
      );
    },
    [],
  );

  // Leaving the list only dismisses the card when the pointer did not move
  // onto it; leaving the card only dismisses when it did not move back onto a
  // row.
  const handleListPointerLeave = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const card = hoverCardRef.current;
      if (
        card &&
        event.relatedTarget instanceof Node &&
        card.contains(event.relatedTarget)
      ) {
        return;
      }
      closeHoverCard();
    },
    [closeHoverCard],
  );

  const handleCardPointerLeave = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const list = listRef.current;
      const anchor = hoverAnchorRef.current;
      if (
        event.relatedTarget instanceof Node &&
        (list?.contains(event.relatedTarget) ||
          anchor?.contains(event.relatedTarget))
      ) {
        return;
      }
      closeHoverCard();
    },
    [closeHoverCard],
  );

  // The two kinds of block each carry their closed-pair statistics: an atom
  // block shows its own pair span, a turn block shows the sum of the pair
  // spans inside it.
  const atomHoverDetails = useCallback(
    (atom: TrajectoryAtom): TrajectoryHoverDetails => ({
      duration: atom.duration,
      eventName: atom.event.eventName,
      pairDuration: atom.pairDuration,
      // The hover card names *both* rows of the pair, while the compact row
      // marker names only the other half. Both come from the same link.
      pairLabel: atom.pairLink
        ? `T${atom.pairLink.turn}·${atom.pairLink.rows}`
        : undefined,
      status: atom.status,
      subtitle: `${atom.key} · turn ${atom.turn}`,
      title: atom.label,
      toolName: atom.event.toolName || undefined,
      type: atomTypeLabel(atom.key, atom.kind),
    }),
    [],
  );
  const turnHoverDetails = useCallback(
    (turn: TrajectoryTurn): TrajectoryHoverDetails => ({
      pairDuration: null,
      // A turn with no closed pair omits PAIRS entirely; a pair that really
      // spans 0ms still prints `0ms`.
      pairTotal: turn.pairCount > 0 ? turn.totalPairDuration : undefined,
      status: turn.status,
      subtitle: `turn ${turn.turn} · ${turn.atoms.length} atoms`,
      title: "Loop Turn",
      type: "LOOP",
    }),
    [],
  );
  // The lane overview's slots stand for a node range; hovering one shows the
  // range, the newest event it maps to, its tool and its status — the same
  // lean, accurate card the rows use, so the map and the list agree. A slot
  // lives on one lane, so its TYPE is that lane's label (Input / Model / Tools)
  // — the only category that is still true for a range of atoms.
  const slotHoverDetails = useCallback(
    (slot: TrajectoryMapSlot): TrajectoryHoverDetails => {
      const target = nodes[slot.end];
      const event = target?.data.endEvent || target?.data.startEvent;
      const laneLabel =
        trajectoryLanes.find((lane) => lane.lane === slot.lane)?.label;
      return {
        duration: undefined,
        eventName: event?.eventName,
        pairDuration: null,
        status: slot.status,
        subtitle: `#${slot.start + 1}–#${slot.end + 1} · ${slot.count} 事件`,
        title: target?.data.label ?? "Atom",
        toolName: event?.toolName || undefined,
        type: laneLabel,
      };
    },
    [nodes],
  );

  const allAtoms = useMemo(
    () => [
      ...model.context,
      ...model.turns.flatMap((turn) => turn.atoms),
    ],
    [model],
  );
  /**
   * A single tool event fans out into several atoms (a `PreToolUse` projects
   * five, its `PostToolUse` six). Stamping the shared pair id on every one of
   * them would print the same marker half a dozen times for one tool call.
   * Exactly one atom owns the marker: the aggregated `tool.call` step that
   * spans start→result, or the first atom of the pair when a platform has no
   * such step. The data (pairLink) stays on every atom, so the hover card can
   * still identify the pair from any atom.
   */
  const pairMarkerOwnerIds = useMemo(() => {
    const byPair = new Map<string, { id: string; isToolStep: boolean }>();
    for (const atom of allAtoms) {
      if (!atom.pairLink) {
        continue;
      }
      const pairId = atom.pairLink.pairId;
      const isToolStep = atom.key === "tool.call";
      const owner = byPair.get(pairId);
      if (!owner || (isToolStep && !owner.isToolStep)) {
        byPair.set(pairId, { id: atom.id, isToolStep });
      }
    }
    return new Set([...byPair.values()].map((entry) => entry.id));
  }, [allAtoms]);
  const selectedTrajectoryAtom = useMemo(
    () =>
      allAtoms.find(
        (atom) =>
          atom.atomId === selectedAtomId &&
          atom.event.id === selectedEventId,
      ) ||
      allAtoms.find((atom) => atom.event.id === selectedEventId) ||
      allAtoms.findLast((atom) => atom.atomId === selectedAtomId),
    [allAtoms, selectedAtomId, selectedEventId],
  );
  const selectedTurn =
    selectedTrajectoryAtom &&
    !selectedTrajectoryAtom.id.startsWith("context:")
      ? selectedTrajectoryAtom.turn
      : undefined;
  const selectedTrajectoryAtomId = selectedTrajectoryAtom?.id ?? "";
  const selectedTurnExpanded =
    selectedTurn === undefined || expandedTurns.has(selectedTurn);
  const failures = allAtoms.filter((atom) => atom.status === "failed").length;
  const completed = allAtoms.filter(
    (atom) => atom.status === "complete",
  ).length;

  useEffect(() => {
    const latestTurn = model.turns.at(-1)?.turn;
    setExpandedTurns(latestTurn ? new Set([latestTurn]) : new Set());
  }, [events[0]?.sessionId, turnKey]);

  useEffect(() => {
    if (!selectedTrajectoryAtomId) {
      return undefined;
    }
    if (selectedTurn !== undefined && !selectedTurnExpanded) {
      setExpandedTurns((current) => new Set(current).add(selectedTurn));
      return undefined;
    }
    const explicitLocate = locateRequestRef.current !== locateRequest;
    locateRequestRef.current = locateRequest;
    const list = listRef.current;
    scrollRowWithinContainer(
      list,
      list?.querySelector<HTMLElement>(".trajectory-row.is-selected") ?? null,
      explicitLocate,
    );
    return undefined;
  }, [
    locateRequest,
    selectedAtomId,
    selectedEventId,
    selectedTrajectoryAtomId,
    selectedTurn,
    selectedTurnExpanded,
  ]);

  const toggleTurn = (turn: number) => {
    setExpandedTurns((current) => {
      const next = new Set(current);
      if (next.has(turn)) {
        next.delete(turn);
      } else {
        next.add(turn);
      }
      return next;
    });
  };
  /*
   * The lane overview is a timeline. A long run produces thousands of flow
   * nodes; drawing one <b> per node mounted thousands of elements and made
   * every selection re-paint the whole map. Slots aggregate consecutive nodes
   * of a lane, so the map keeps a bounded number of marks (and stays a
   * timeline) no matter how long the run is.
   */
  const mapSlots = useMemo(
    () => buildTrajectoryMapSlots(nodes, TRAJECTORY_MAP_MAX_SLOTS),
    [nodes],
  );
  // A card anchored to a block stays open while that block is still rendered.
  // The model is rebuilt on every streamed batch, so keying this off `model`
  // identity closed the card on every event while the pointer sat still (a
  // pointerenter does not fire again by itself). Only a block that disappears
  // — a collapsed turn, an atom that leaves the window, a re-bucketed slot —
  // invalidates its card; a live batch that appends atoms leaves it open.
  useEffect(() => {
    if (!hoverCard) {
      return;
    }
    const rendered = new Set<string>();
    for (const turn of model.turns) {
      rendered.add(`turn-${turn.turn}`);
      if (!expandedTurns.has(turn.turn)) {
        continue;
      }
      for (const atom of turn.atoms) {
        rendered.add(atom.id);
      }
    }
    for (const atom of model.context) {
      rendered.add(atom.id);
    }
    for (const slot of mapSlots) {
      rendered.add(`slot-${slot.key}`);
    }
    if (!rendered.has(hoverCard.key)) {
      closeHoverCard();
    }
  }, [closeHoverCard, expandedTurns, hoverCard, mapSlots, model]);
  // Width comes from the *busiest* lane: every slot then has room for at least
  // TRAJECTORY_MIN_SLOT_PX and the track scrolls instead of compressing.
  const maxLaneSlotCount = useMemo(() => {
    const counts = new Map<number, number>();
    for (const slot of mapSlots) {
      counts.set(slot.lane, (counts.get(slot.lane) ?? 0) + 1);
    }
    return Math.max(1, ...counts.values());
  }, [mapSlots]);
  const mapMinWidth = Math.max(320, maxLaneSlotCount * TRAJECTORY_MIN_SLOT_PX);
  const selectedIndex = nodes.findIndex((node) => node.id === selectedNodeId);
  const activeIndex = nodes.findIndex((node) => node.data.status === "active");
  const cursorIndex = selectedIndex >= 0 ? selectedIndex : activeIndex;
  const cursorNode = cursorIndex >= 0 ? nodes[cursorIndex] : null;
  const tracksRef = useRef<HTMLDivElement | null>(null);

  // Keep the cursor slot inside the visible slice of the track as the
  // selection or the executing atom moves.
  useEffect(() => {
    const tracks = tracksRef.current;
    if (!tracks || !cursorNode) {
      return;
    }
    const segment = tracks.querySelector<HTMLElement>(
      '[data-cursor="true"]',
    );
    if (!segment) {
      return;
    }
    const bounds = tracks.getBoundingClientRect();
    const box = segment.getBoundingClientRect();
    const margin = 24;
    if (box.left >= bounds.left + margin && box.right <= bounds.right - margin) {
      return;
    }
    tracks.scrollTo({
      behavior: "smooth",
      left:
        tracks.scrollLeft +
        (box.left - bounds.left) -
        bounds.width / 2 +
        box.width / 2,
    });
  }, [cursorIndex, cursorNode, mapMinWidth]);

  return (
    <section className="trajectory-view">
      <header className="trajectory-header">
        <hgroup>
          <span className="eyebrow">RUN TRAJECTORY</span>
          <strong>
            {cursorNode
              ? `ATOM ${cursorIndex + 1}/${nodes.length} · ${cursorNode.data.label}`
              : "Loop-aware atomic execution"}
          </strong>
        </hgroup>
        <IconAction
          label="定位选中或正在执行的原子"
          className="trajectory-locate"
          disabled={!canLocateSelection}
          onClick={onLocateSelection}
        >
          <LocateFixed />
        </IconAction>
        <ul className="trajectory-summary" aria-label="轨迹统计">
          <li>{model.turns.length || 1} TURNS</li>
          <li>{allAtoms.length} ATOMS</li>
          <li>{completed} COMPLETE</li>
          <li className={failures ? "has-failures" : ""}>{failures} FAILED</li>
        </ul>
        <div className="trajectory-legend" aria-label="图例：状态标记与时长色阶">
          <span className="trajectory-legend__group">
            <span className="trajectory-legend__group-label">状态</span>
            {STATUS_LEGEND.map(({ label, tone }) => (
              <i
                className={`trajectory-legend__dot status-${tone}`}
                key={label}
                title={label}
              />
            ))}
          </span>
          <span className="trajectory-legend__group">
            <span className="trajectory-legend__group-label">时长</span>
            {DURATION_LEGEND.map(({ heat, label }) => (
              <span
                className={`trajectory-legend__heat heat-${heat}`}
                key={heat}
                title={`时长 ${label}`}
              >
                {label}
              </span>
            ))}
          </span>
        </div>
      </header>
      <div className="trajectory-map" aria-label="执行泳道概览">
        <div className="trajectory-map__labels" aria-hidden="true">
          {trajectoryLanes.map(({ id, label }) => (
            <span className={`trajectory-map__label tone-${id}`} key={label}>
              {label}
            </span>
          ))}
        </div>
        <div className="trajectory-map__tracks" ref={tracksRef}>
          <div
            className="trajectory-map__track-content"
            style={{ minWidth: mapMinWidth }}
          >
            {cursorNode ? (
              <span
                aria-hidden="true"
                className="trajectory-map__cursor"
                style={{
                  left: `${
                    ((cursorIndex + 0.5) / Math.max(1, nodes.length)) * 100
                  }%`,
                }}
              >
                <span className="trajectory-map__cursor-label">
                  {cursorIndex + 1}/{nodes.length}
                </span>
              </span>
            ) : null}
            {trajectoryLanes.map(({ id, label, lane }) => (
              <i className={`trajectory-map__lane trajectory-map__lane--${id}`} key={label}>
                {mapSlots.map((slot) => {
                  if (slot.lane !== lane) {
                    return null;
                  }
                  const total = Math.max(1, nodes.length);
                  const position = getTrajectorySegmentPosition(
                    slot.start,
                    total,
                  );
                  const width =
                    ((slot.end - slot.start + 1) / total) * 100;
                  const isCursor =
                    cursorIndex >= slot.start && cursorIndex <= slot.end;
                  // The slot stands for a node range; selecting it picks the
                  // newest node in that range.
                  const target = nodes[slot.end];
                  if (!target) {
                    return null;
                  }
                  return (
                    <b
                      key={slot.key}
                      role="button"
                      tabIndex={0}
                      data-cursor={isCursor ? "true" : undefined}
                      aria-label={`选择第 ${slot.start + 1}-${slot.end + 1} 个原子（${slot.count} 个事件）`}
                      aria-pressed={isCursor}
                      className={cn(
                        `tone-bg-${slot.tone}`,
                        isCursor && "is-selected",
                        slot.status === "active" && "is-running",
                        slot.status === "failed" && "is-failed",
                        slot.count > 1 && "is-aggregate",
                      )}
                      onClick={() =>
                        onSelect(
                          (target.data.endEvent || target.data.startEvent).id,
                        )
                      }
                      onPointerOver={(hoverEvent) =>
                        handleRowHover(
                          hoverEvent,
                          `slot-${slot.key}`,
                          slotHoverDetails(slot),
                        )
                      }
                      onKeyDown={(keyEvent) => {
                        if (
                          keyEvent.key === "Enter" ||
                          keyEvent.key === " "
                        ) {
                          keyEvent.preventDefault();
                          onSelect(
                            (target.data.endEvent || target.data.startEvent).id,
                          );
                        }
                      }}
                      style={
                        {
                          "--segment-left": `${position.left}%`,
                          "--segment-width": `${width}%`,
                        } as CSSProperties
                      }
                    />
                  );
                })}
              </i>
            ))}
          </div>
        </div>
      </div>
      <div
        className="trajectory-list"
        onPointerLeave={handleListPointerLeave}
        ref={listRef}
      >
        {display.turns.map((turn) => {
          const isExpanded = expandedTurns.has(turn.turn);
          const loopRow = loopRowForTurn(turn);
          const turnKey = `turn-${turn.turn}`;
          return (
            <section
              key={turn.turn}
              className="trajectory-turn"
              aria-label={`Turn ${turn.turn}`}
            >
              <header>
                <strong>TURN {turn.turn}</strong>
                <span>{turn.atoms.length} atoms</span>
              </header>
              <TrajectoryRow
                depth={0}
                expandable
                expanded={isExpanded}
                onActivate={() => onSelect(turn.event.id)}
                onHover={(hoverEvent) =>
                  handleRowHover(
                    hoverEvent,
                    turnKey,
                    turnHoverDetails(turn),
                  )
                }
                onToggle={() => toggleTurn(turn.turn)}
                row={loopRow}
                selected={false}
              />
              {isExpanded ? (
                <div className="trajectory-turn__atoms">
                  {turn.atoms.map((atom) => (
                    <TrajectoryRow
                      depth={1}
                      key={atom.id}
                      onActivate={() => onSelect(atom.event.id, atom.atomId)}
                      onHover={(hoverEvent) =>
                        handleRowHover(
                          hoverEvent,
                          atom.id,
                          atomHoverDetails(atom),
                        )
                      }
                      onLocatePartner={onLocatePartner}
                      partnerSelected={
                        pairMarkerOwnerIds.has(atom.id) &&
                        atom.pairLink?.partnerId === selectedEventId
                      }
                      row={atom}
                      selected={atom.id === selectedTrajectoryAtomId}
                      showPairMarker={pairMarkerOwnerIds.has(atom.id)}
                    />
                  ))}
                </div>
              ) : null}
            </section>
          );
        })}
        {/* Oldest block last: the context atoms are the run's preamble. */}
        {display.context.length ? (
          <section className="trajectory-turn trajectory-context">
            <header>
              <strong>RUN CONTEXT</strong>
              <span>{display.context.length} atoms</span>
            </header>
            {display.context.map((atom) => (
              <TrajectoryRow
                depth={0}
                key={atom.id}
                onActivate={() => onSelect(atom.event.id, atom.atomId)}
                onHover={(hoverEvent) =>
                  handleRowHover(
                    hoverEvent,
                    atom.id,
                    atomHoverDetails(atom),
                  )
                }
                onLocatePartner={onLocatePartner}
                partnerSelected={
                  pairMarkerOwnerIds.has(atom.id) &&
                  atom.pairLink?.partnerId === selectedEventId
                }
                row={atom}
                selected={atom.id === selectedTrajectoryAtomId}
                showPairMarker={pairMarkerOwnerIds.has(atom.id)}
                showTurn={false}
              />
            ))}
          </section>
        ) : null}
      </div>
      <TrajectoryHoverCardLayer
        anchorRef={hoverAnchorRef}
        card={hoverCard}
        cardRef={hoverCardRef}
        onCardPointerLeave={handleCardPointerLeave}
      />
    </section>
  );
});

const ReplayFooter = memo(function ReplayFooter({
  events,
  cursor,
  live,
  liveRun,
  playing,
  speed,
  onSeek,
  onRestart,
  onTogglePlay,
  onSpeedChange,
  onExit,
}: {
  events: TraceEvent[];
  cursor: number;
  live: boolean;
  /** Whether any run is executing, i.e. whether Live has somewhere to go. */
  liveRun: boolean;
  playing: boolean;
  speed: number;
  onSeek: (cursor: number) => void;
  onRestart: () => void;
  onTogglePlay: () => void;
  onSpeedChange: (speed: number) => void;
  onExit: () => void;
}) {
  const move = (nextCursor: number) => {
    onSeek(Math.max(0, Math.min(events.length - 1, nextCursor)));
  };
  const progress =
    events.length > 1 ? (cursor / (events.length - 1)) * 100 : events.length ? 100 : 0;

  return (
    <footer className="timeline-footer grid min-w-0 grid-cols-[max-content_minmax(100px,1fr)] items-center gap-5 border-t border-[var(--line)] px-3 py-2">
      <div className="replay-controls flex min-w-0 items-center gap-1.5">
        <IconAction label="从头开始回放" variant="playback" size="playback-icon" side="top" onClick={onRestart} disabled={!events.length}>
          <RotateCcw />
        </IconAction>
        <IconAction
          label="上一个事件"
          variant="playback"
          size="playback-icon"
          disabled={!events.length || cursor <= 0}
          side="top"
          onClick={() => move(cursor - 1)}
        >
          <SkipBack />
        </IconAction>
        <IconAction
          label={playing ? "暂停回放" : "开始回放"}
          disabled={!events.length}
          variant="playback"
          size="playback-icon"
          aria-pressed={playing}
          side="top"
          onClick={onTogglePlay}
        >
          {playing ? <Pause /> : <Play />}
        </IconAction>
        <IconAction
          label="下一个事件"
          variant="playback"
          size="playback-icon"
          disabled={cursor >= events.length - 1}
          side="top"
          onClick={() => move(cursor + 1)}
        >
          <SkipForward />
        </IconAction>
        <Select
          value={String(speed)}
          onValueChange={(value) => onSpeedChange(Number(value))}
        >
          <SelectTrigger
            size="playback"
            className="speed-select"
            aria-label="回放速度"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent
            position="popper"
            align="start"
            className="speed-select__content"
          >
            <SelectGroup>
              {[0.5, 1, 2, 4].map((value) => (
                <SelectItem key={value} value={String(value)}>
                  {value}x
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="playback"
          size="playback"
          className={cn("live-button", live && "is-live")}
          // The footer mirrors the run state: live only while the open run is
          // executing, and otherwise a jump to the run that *is* — which is
          // what makes the control usable after a resumed run appears.
          aria-label={
            live
              ? "跟随实时事件"
              : liveRun
                ? "跳到正在执行的运行"
                : "回到最新运行"
          }
          title={
            live
              ? "正在跟随执行中的消息"
              : liveRun
                ? "跳转并跟随正在执行的消息"
                : "没有正在执行的消息，回到最新运行"
          }
          aria-pressed={live}
          onClick={onExit}
        >
          <Radio data-icon="inline-start" />
          Live
        </Button>
      </div>
      <label className="replay-timeline">
        <output>
          Event {events.length ? cursor + 1 : 0} / {events.length}
        </output>
        <input
          type="range"
          disabled={!events.length}
          min="0"
          max={Math.max(0, events.length - 1)}
          value={cursor}
          onChange={(event) => onSeek(Number(event.target.value))}
          aria-label="回放位置"
        />
        <i style={{ width: `${progress}%` }} />
      </label>
    </footer>
  );
});

/**
 * Flow Guide drawer. Memoized because the shell re-renders every second (the
 * live duration clock) and on every capture batch; without the memo the open
 * drawer re-rendered its whole catalog on each tick, which is what made it
 * feel laggy. Its props are stable: the open setter, a `useCallback` locator,
 * and a platform id.
 */
const AtomGuide = memo(function AtomGuide({
  open,
  onOpenChange,
  platformId,
  onLocate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  platformId: PlatformId;
  onLocate: (atomId: string) => void;
}) {
  const config = getAtomPlatformConfig(platformId);
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredAtoms = config.atoms.filter((atom) =>
    [
      atom.label,
      atom.key,
      atom.kind,
      atom.section,
      atom.layer,
      guideAtomCopy[atom.id]?.label,
      guideAtomCopy[atom.id]?.description,
    ]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase()
      .includes(normalizedQuery),
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className="atom-guide"
        // A full-viewport backdrop blur over a live-updating canvas has to be
        // re-blurred on every repaint; a deeper scrim instead reads the same,
        // keeps the drawer smooth, and still separates the drawer from the
        // console underneath.
        overlayClassName="atom-guide__overlay backdrop-blur-none"
      >
        <SheetHeader className="atom-guide__header">
          <span className="eyebrow">ATOMIC RUNTIME REFERENCE</span>
          <SheetTitle>Flow Guide</SheetTitle>
          <SheetDescription>
            {config.label} 原子语义、领域、路径、状态与观测规则。
          </SheetDescription>
        </SheetHeader>
        <Tabs defaultValue="overview" className="atom-guide__tabs">
          <TabsList variant="line" aria-label="指南分类">
            <TabsTrigger value="overview">概览</TabsTrigger>
            <TabsTrigger value="atoms">原子目录</TabsTrigger>
            <TabsTrigger value="observability">观测</TabsTrigger>
          </TabsList>
          <TabsContent value="overview" className="atom-guide__content">
            <GuideSection
              title="如何阅读流程"
              description="从 Prompt 进入 Session，经 Agent、Capability 与 Memory 生成回复，最后写入 Quality 和 Telemetry。"
            >
              <ol className="atom-guide__steps atom-guide__steps--ordered">
                {guideReadSteps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
              <p className="atom-guide__note">
                当前平台包含 {config.atoms.length} 个固定原子和{" "}
                {config.edges.length} 条固定路径。Deep View 会额外显示内部执行原子。
              </p>
            </GuideSection>

            <GuideSection
              title="Runtime Domains"
              description="画布按稳定职责划分为六个领域，边界和标题颜色与运行时保持一致。"
            >
              <div className="atom-guide__domain-grid">
                {config.layers.map((layer) => (
                  <article
                    className={`atom-guide__domain atom-guide__domain--${layer.id}`}
                    key={layer.id}
                  >
                    <code>
                      {layer.index} · {layer.label.toUpperCase()}
                    </code>
                    <strong>{guideLayerCopy[layer.id]?.label}</strong>
                    <p>
                      {guideLayerCopy[layer.id]?.description ||
                        layer.description}
                    </p>
                  </article>
                ))}
              </div>
            </GuideSection>

            <GuideSection
              title="Atom Types"
              description="Kind 描述原子的职责类型；Level 决定默认视图是否展示。"
            >
              <div className="atom-guide__definition-list">
                {guideKindItems.map((item) => (
                  <div key={item.id}>
                    <code>{item.label}</code>
                    <span>{item.description}</span>
                  </div>
                ))}
              </div>
              <div className="atom-guide__levels">
                <p>
                  <strong>runtime</strong>
                  默认显示，表达主要执行路径。
                </p>
                <p>
                  <strong>deep</strong>
                  仅在 Deep View 显示，表达内部解析与执行细节。
                </p>
              </div>
            </GuideSection>

            <GuideSection
              title="路径颜色与线型"
              description="路径类型始终决定颜色和线型；运行状态仅叠加线宽、透明度与流光。"
            >
              <GuideLegend items={guideLineItems} type="route" />
            </GuideSection>

            <GuideSection
              title="运行状态颜色"
              description="原子左上角状态点表示当前事件位置下的最新生命周期状态。"
            >
              <GuideLegend items={guideStatusItems} type="status" />
            </GuideSection>

            <GuideSection
              title="History 状态图标"
              description={guideHistoryStatusDescription}
            >
              <GuideLegend items={guideHistoryStatusItems} type="history" />
            </GuideSection>

            <GuideSection
              title="状态与交互高亮"
              description="Active 和 Complete 保留路径类型色；Hover 和 Selected 使用主题高亮色。"
            >
              <GuideLegend items={guideHighlightItems} type="highlight" />
            </GuideSection>
          </TabsContent>

          <TabsContent value="atoms" className="atom-guide__content">
            <GuideSection
              title="Atom Catalog"
              description="固定原子按领域分组；选择条目可定位到拓扑中的对应原子。"
            >
              <InputGroup className="atom-guide__search">
                <InputGroupAddon align="inline-start">
                  <Search aria-hidden="true" />
                </InputGroupAddon>
                <InputGroupInput
                  aria-label="搜索原子"
                  onChange={(event) => setQuery(event.currentTarget.value)}
                  placeholder="搜索名称、Key、类型或职责"
                  type="search"
                  value={query}
                />
              </InputGroup>
              <p aria-live="polite" className="atom-guide__search-result">
                显示 {filteredAtoms.length} / {config.atoms.length} 个原子
              </p>
              {filteredAtoms.length === 0 ? (
                <output className="atom-guide__empty">
                  没有匹配“{query.trim()}”的原子
                </output>
              ) : (
                config.layers.map((layer) => {
                  const layerAtoms = filteredAtoms.filter(
                    (atom) => atom.layer === layer.id,
                  );
                  return layerAtoms.length ? (
                    <section
                      className={`atom-guide__atom-group atom-guide__atom-group--${layer.id}`}
                      key={layer.id}
                    >
                      <h3>
                        {layer.index} ·{" "}
                        {guideLayerCopy[layer.id]?.label || layer.label}
                      </h3>
                      {layerAtoms.map((atom) => (
                        <button
                          type="button"
                          key={atom.id}
                          className={`atom-guide__atom tone-${atom.tone}`}
                          onClick={() => {
                            onLocate(`harness-${atom.id}`);
                            onOpenChange(false);
                          }}
                        >
                          <span>
                            <strong>
                              {guideAtomCopy[atom.id]?.label || atom.label}
                            </strong>
                            <code>{atom.key}</code>
                          </span>
                          <p>
                            {guideAtomCopy[atom.id]?.description ||
                              atom.description}
                          </p>
                          <small>
                            <span>{atom.kind}</span>
                            <span>{atomLevel(atom.key)}</span>
                            <span>
                              {guideSectionCopy[atom.section] || atom.section}
                            </span>
                          </small>
                        </button>
                      ))}
                    </section>
                  ) : null;
                })
              )}
            </GuideSection>
          </TabsContent>

          <TabsContent value="observability" className="atom-guide__content">
            <GuideSection
              title="Replay & Observability"
              description="Replay、LOG 与 Inspector 从同一事件序列派生，不会修改源 Session。"
            >
              <ul className="atom-guide__steps atom-guide__steps--plain">
                {guideObservabilityItems.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </GuideSection>
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
});

function GuideSection({
  children,
  description,
  title,
}: {
  children: ReactNode;
  description: string;
  title: string;
}) {
  return (
    <section className="atom-guide__section">
      <header>
        <h3>{title}</h3>
        <p>{description}</p>
      </header>
      {children}
    </section>
  );
}

function GuideLegend({
  items,
  type,
}: {
  items: ReadonlyArray<{
    id: string;
    label: string;
    description: string;
    visual?: string;
  }>;
  type: "highlight" | "history" | "route" | "status";
}) {
  return (
    <div className="atom-guide__definition-list atom-guide__color-list">
      {items.map((item) => (
        <div key={item.id}>
          <span className={`atom-guide__sample atom-guide__sample--${type}`}>
            {type === "history" ? (
              <StatusIcon status={item.id} />
            ) : (
              <i data-guide-value={item.id} />
            )}
          </span>
          <span className="atom-guide__color-copy">
            <strong>
              {item.label}
              {item.visual ? ` · ${item.visual}` : ""}
            </strong>
            <small>{item.description}</small>
          </span>
        </div>
      ))}
    </div>
  );
}

function getInitialLocation() {
  const params = new URLSearchParams(window.location.search);
  return {
    // `agent` names the dropdown filter (a configured agent id or "others").
    // `source` is the legacy deep-link parameter, still read so old shared
    // links keep working; new links are written with `agent` only.
    agent: params.get("agent") ?? params.get("source"),
    sessionId: params.get("session"),
    eventId: params.get("event"),
  };
}

function getPlatformForSource(source: string | null | undefined) {
  return atomPlatformOptions.find((platform) => platform.source === source)?.id;
}

/**
 * Demo lifecycle as the console sees it: `off` when this build never asks for
 * sample data, `loading` while the request is in flight, and the loader's own
 * `ready` / `empty` / `error` / `canceled` outcome afterwards.
 */
type DemoDatasetState =
  | { status: "off" | "loading"; events: TraceEvent[] }
  | DemoLoadResult;

export default function App() {
  // A hidden tab must not keep the SSE stream, the duration clock, or the
  // health poll running. Suspension only starts after a long hidden period;
  // becoming visible again re-runs the affected effects, which reconnect the
  // stream from the last event we hold and reset the clock.
  const pageVisibility = usePageVisibility();
  const pageSuspended = pageVisibility.suspended;
  /*
   * Where the data comes from. The local service answers same-origin; a
   * deployed console (Vercel, GitHub Pages) names the service on the reader's
   * machine instead — `?api=` wins and persists, then the stored override,
   * then the same-origin/local-service heuristic. Resolved once per mount:
   * mid-session changes would strand the open stream on the old base.
   */
  const apiBase = useMemo(() => {
    const resolution = resolveApiBase({
      search: window.location.search,
      origin: window.location.origin,
      stored: readStorageValue(window.localStorage, storageKeys.apiBase, ""),
    });
    // `?api=` is the user naming the service for this browser, not just this
    // page view: keep it, including the explicit same-origin reset (`?api=`).
    if (resolution.source === "param") {
      writeStorageValue(window.localStorage, storageKeys.apiBase, resolution.base);
    }
    return resolution.base;
  }, []);
  /*
   * The sample run is a local resource file (`data/demo-events.json`), read by
   * the service and fetched here — the bundle no longer carries synthetic
   * events. Two gates decide whether it loads at all:
   *
   *  - dev/test builds: automatic when there are no captured events (the classic
   *    Demo). Production builds keep their honest empty state unless the reader
   *    explicitly opts in with `?demo=1` — the sample is an opt-in preview on a
   *    deployment, never a silent fallback to captured data.
   */
  const buildDemo = shouldShowDemo(0, import.meta.env);
  const demoOptIn = useMemo(
    () => isDemoPreviewEnabled(window.location.search),
    [],
  );
  const demoAllowed = buildDemo || demoOptIn;
  const [demoDataset, setDemoDataset] = useState<DemoDatasetState>(() => ({
    status: demoAllowed ? "loading" : "off",
    events: [],
  }));
  useEffect(() => {
    if (!demoAllowed) {
      return undefined;
    }
    const controller = new AbortController();
    setDemoDataset({ status: "loading", events: [] });
    void loadDemoEvents({
      // The service on the configured base first; the static copy next to the
      // page itself (base-relative, so a `/console/` mount finds its own copy)
      // is the fallback for a deployment whose service will not answer.
      endpoints: [
        joinApi(apiBase, "/api/demo-events"),
        staticDemoDatasetEndpoint(),
      ],
      signal: controller.signal,
      timeoutMs: appTimings.demoFetchTimeoutMs,
    }).then((result) => {
      // Unmounting aborts the request; that is not a state to render.
      if (controller.signal.aborted) {
        return;
      }
      setDemoDataset(result);
    });
    return () => controller.abort();
  }, [apiBase, demoAllowed]);
  const [initialLocation, setInitialLocation] = useState<ReturnType<typeof getInitialLocation> | null>(
    getInitialLocation,
  );
  const [liveEvents, setLiveEvents] = useState<TraceEvent[]>([]);
  /**
   * Mirror of {@link liveEvents} for the stream effect. The effect must not
   * re-subscribe when the event list changes (it would tear down the
   * connection on every batch), so the snapshot handler reads the list it has
   * to compare against through this ref instead of through a stale closure.
   */
  const liveEventsRef = useRef<TraceEvent[]>([]);
  liveEventsRef.current = liveEvents;
  /**
   * Whether the stream has ever connected, mirrored for the stream effect:
   * the remote-service hint must fire only when a deployed page never managed
   * to connect, not on every transient drop of an established stream.
   */
  const everConnectedRef = useRef(false);
  // The same hint is announced once per page load, not once per retry.
  const remoteConnectHintedRef = useRef(false);
  // Working directory → git presentation (repo name + branch), resolved by the
  // server from the closest `.git` and delivered with the snapshot plus one
  // `git` message per newly seen directory.
  const [gitInfo, setGitInfo] = useState<
    Record<string, { repo: string; branch: string } | null>
  >({});
  const [eventsLoaded, setEventsLoaded] = useState(false);
  // The server only ships the requested time window, so an older run may
  // exist outside it. `truncated` is what keeps "load earlier" actionable:
  // the list itself no longer contains the sessions that would prove it.
  const [historyTruncated, setHistoryTruncated] = useState(false);
  // Every event the service holds, not just the ones inside the current
  // window. The demo gate must not treat a narrow window as "no captured
  // events" and replace a real history with the sample.
  const [capturedEventCount, setCapturedEventCount] = useState(0);
  const [importedEvents, setImportedEvents] = useState<TraceEvent[]>([]);
  // Transient action feedback (import, clear, reload). Replaces the blocking
  // `window.alert` calls, which could not be styled, dismissed or ignored.
  const [notices, setNotices] = useState<Notice[]>([]);
  const noticeSeqRef = useRef(0);
  const dismissNotice = useCallback((id: number) => {
    setNotices((current) => current.filter((notice) => notice.id !== id));
  }, []);
  const pushNotice = useCallback(
    (tone: NoticeTone, message: string, detail?: string) => {
      noticeSeqRef.current += 1;
      const notice = { detail, id: noticeSeqRef.current, message, tone };
      // Three at a time is enough to explain what happened without stacking a
      // wall of toasts over the console.
      setNotices((current) => [...current.slice(-2), notice]);
    },
    [],
  );
  const [connected, setConnected] = useState(false);
  /**
   * Whether the stream has ever reported `ready`. Until it has, "not
   * connected" means "still connecting" — the very first load used to paint
   * the header as `offline`, which reads as a failure while the snapshot is
   * still on its way.
   */
  const [everConnected, setEverConnected] = useState(false);
  // Capture time of the newest event the stream has delivered. Drives the
  // "are we already up to date?" indicator in RUN HISTORY.
  const [lastEventAt, setLastEventAt] = useState(0);
  // Bumped after an in-place service restart to re-subscribe the SSE stream.
  const [streamEpoch, setStreamEpoch] = useState(0);
  // A manual "load latest" drops the resume cursor and re-subscribes the
  // stream, so the server answers with a fresh full snapshot instead of a
  // tail replay. It is the escape hatch for a client whose loaded history
  // went stale — e.g. a historical session resumed execution but its new
  // events never arrived over a broken stream. The flag only spans the
  // re-subscribe: the snapshot handlers clear it once fresh data landed.
  const [reloadingEvents, setReloadingEvents] = useState(false);
  // Mirrors `reloadingEvents` for the stream effect, which must not
  // re-subscribe just because a reload started.
  const reloadingRef = useRef(false);
  // Set together with the reload above and consumed once by the stream
  // effect: a trace message landing between the click and the re-subscribe
  // would otherwise re-fill the resume cursor and silently downgrade the
  // full-snapshot reload into a tail replay.
  const forceSnapshotRef = useRef(false);
  // Last event the live stream delivered. A reconnect names it so the server
  // replays only the missed tail instead of re-sending the whole history.
  const resumeCursorRef = useRef("");
  // Identity of the history on screen, as reported by the stream (`ready` /
  // `reset`). A forced snapshot names it so a restart with unchanged data is
  // answered by `reset-same` instead of megabytes of JSON.
  const snapshotKeyRef = useRef("");
  const [service, setService] = useState<ServiceHealth | null>(null);
  const [serviceError, setServiceError] = useState("");
  const [restarting, setRestarting] = useState(false);
  // The LOG search box owns its text inside AtomicLog: a keystroke must not
  // re-render the whole studio. Flows that need an empty box (selection jumps,
  // history search) bump this token instead of holding the string here.
  const [logQueryResetToken, setLogQueryResetToken] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [activeSessionKey, setActiveSessionKey] = useState("");
  const [activePromptRunKey, setActivePromptRunKey] = useState("");
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [selectedAtomId, setSelectedAtomId] =
    useState<AtomSelection>(undefined);
  // The canvas view and the runtime-atom filter are user preferences, not
  // session state: both survive a reload through localStorage so the studio
  // reopens the way it was left.
  const [activeView, setActiveView] = useState<ActiveView>(() => {
    const stored = readStorageValue(
      window.localStorage,
      storageKeys.activeView,
      appDefaults.activeView,
    );
    return stored === "topology" || stored === "trajectory"
      ? stored
      : appDefaults.activeView;
  });
  // The trajectory view builds its turn model from every event and atom. That
  // is real work for a long run, so the view is mounted on first use instead
  // of on every session selection while the topology is what is on screen.
  const [trajectoryMounted, setTrajectoryMounted] = useState(
    activeView === "trajectory",
  );
  const [deepView, setDeepView] = useState<boolean>(() =>
    readStorageBoolean(
      window.localStorage,
      storageKeys.deepView,
      appDefaults.deepView,
    ),
  );
  // The performance HUD is a diagnostic tool, off by default: the Settings →
  // 性能 toggle arms it. A reader who opted in with the retired `?perf=1`
  // parameter still has the legacy flag honoured once; the first write
  // removes it, after which the settings key is the only source of truth.
  const [perfHud, setPerfHud] = useState<boolean>(() =>
    resolvePerfHudInitial(window.localStorage),
  );
  const [guideOpen, setGuideOpen] = useState<boolean>(appDefaults.guideOpen);
  const [historySearchOpen, setHistorySearchOpen] = useState(false);
  // The dialog chunk is requested on idle; the component is mounted the first
  // time the dialog is opened, so its state survives close/reopen afterwards.
  const [historySearchMounted, setHistorySearchMounted] = useState(false);
  const [menuOpen, setMenuOpen] = useState<boolean>(appDefaults.menuOpen);
  // Mobile-only: the header nav collapses into a disclosure below the same
  // breakpoint the stylesheet uses, so this state is meaningless on desktop.
  const [navMenuOpen, setNavMenuOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(
    () =>
      readStorageBoolean(
        window.localStorage,
        storageKeys.historyOpen,
        window.innerWidth >= appDefaults.historyOpenMinWidth,
      ),
  );
  const [consoleOpen, setConsoleOpen] = useState(
    () =>
      readStorageBoolean(
        window.localStorage,
        storageKeys.consoleOpen,
        window.innerWidth >= appDefaults.consoleOpenMinWidth,
      ),
  );
  // The default agent is the first dropdown option unless a deep link or a
  // stored preference names an agent that is still offered.
  const [platformId, setPlatformId] = useState<PlatformId>(() => {
    const fromUrl = getPlatformForSource(initialLocation?.agent);
    if (fromUrl) {
      return fromUrl;
    }
    const stored = readStorageValue(
      window.localStorage,
      storageKeys.platform,
      appDefaults.platform,
      legacyStorageKeys.platform,
    );
    return agentOptions.some((option) => option.id === stored)
      ? (stored as PlatformId)
      : agentOptions[0].id;
  });
  // The agent dropdown drives which agent's runs load. A configured agent is a
  // PlatformId; OTHERS_AGENT_ID is the trailing catch-all. Picking a configured
  // agent also drives the topology platform; "Others" leaves it unchanged.
  // A deep link may name either: `agent=<id>` follows the dropdown, and the
  // stored topology platform stands in when "Others" carries no projection.
  const [agentId, setAgentId] = useState<PlatformId | typeof OTHERS_AGENT_ID>(
    () => {
      if (initialLocation?.agent === OTHERS_AGENT_ID) {
        return OTHERS_AGENT_ID;
      }
      const fromUrl = getPlatformForSource(initialLocation?.agent);
      return fromUrl ?? platformId;
    },
  );
  // Default history range: a settings preference, shared by RUN HISTORY's
  // visible window and the global search dialog's initial time range.
  const [historyRange, setHistoryRange] = useState<HistoryRangeId>(() => {
    const stored = readStorageValue(
      window.localStorage,
      storageKeys.historyRange,
      appDefaults.historyRange,
    );
    return isHistoryRangeId(stored) ? stored : appDefaults.historyRange;
  });
  const historyRangeHours = getHistoryRangeHours(historyRange);
  const historyRangeLabel = getHistoryRangeOption(historyRange).shortLabel;
  // The window widens on demand. Storing the *width* (not a boolean) keeps one
  // number driving the list and the "load earlier" affordance; switching the
  // range or the agent resets it to the preference.
  const [runHistoryHours, setRunHistoryHours] = useState(historyRangeHours);
  // Hours of the newest snapshot this page asked for. The stream reads it at
  // subscribe time; "load earlier" grows it and re-subscribes, so the service
  // only ever ships the range the list is about to render.
  const streamWindowHoursRef = useRef(historyRangeHours);
  // Live filter: RUN HISTORY narrowed to the messages that are executing right
  // now, drawn from the agent's whole history (no time window). Off by
  // default — the filter is allowed to match nothing, so arming it on load
  // would present an empty panel as the normal state.
  const [liveFilter, setLiveFilter] = useState(() =>
    readStorageBoolean(
      window.localStorage,
      storageKeys.runHistoryLiveView,
      appDefaults.liveView,
    ),
  );
  // Sync budget: the console stops consuming the event stream once it has been
  // syncing for this long. Eight hours by default — a console left open
  // overnight would otherwise keep appending every captured event and
  // re-deriving sessions from an ever-growing list. `off` disables the limit.
  const [maxSync, setMaxSync] = useState<MaxSyncId>(() => {
    const stored = readStorageValue(
      window.localStorage,
      storageKeys.maxSync,
      appDefaults.maxSync,
    );
    return isMaxSyncId(stored) ? stored : appDefaults.maxSync;
  });
  const maxSyncHours = getMaxSyncHours(maxSync);
  // When the current sync window began. Reset by every resume and by a service
  // restart, so the budget always describes the connection that is open now.
  const [syncStartedAt, setSyncStartedAt] = useState(() => Date.now());
  // The budget is spent: the stream is closed and no new event is accepted.
  // Distinct from `connected === false`, which merely says the socket dropped.
  const [syncStopped, setSyncStopped] = useState(false);
  const [theme, setTheme] = useState<Theme>(
    () =>
      readStorageValue(
        window.localStorage,
        storageKeys.theme,
        appDefaults.theme,
        legacyStorageKeys.theme,
      ) as Theme,
  );
  const [activeTransition, setActiveTransition] =
    useState<ActiveTransition | null>(null);
  const [replayMode, setReplayMode] = useState<boolean>(
    appDefaults.replayMode,
  );
  const [playing, setPlaying] = useState<boolean>(
    appDefaults.replayPlaying,
  );
  const [replayCursor, setReplayCursor] = useState<number>(
    appDefaults.replayCursor,
  );
  const [replaySpeed, setReplaySpeed] = useState<number>(
    appDefaults.replaySpeed,
  );
  const [locateRequest, setLocateRequest] = useState(0);
  const [trajectoryLocateRequest, setTrajectoryLocateRequest] = useState(0);
  const [logLocateRequest, setLogLocateRequest] = useState(0);
  const [inspectorTab, setInspectorTab] = useState<string>(() =>
    readStorageValue(
      window.localStorage,
      storageKeys.inspectorTab,
      "overview",
    ),
  );
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const preserveAtomSelectionRef = useRef(false);
  const previousAtomRef = useRef("");
  const navMenuRef = useRef<HTMLDivElement | null>(null);
  const navToggleRef = useRef<HTMLButtonElement | null>(null);
  const headerNavCollapsed = useMediaQuery(
    `(max-width: ${appLayout.headerNavCollapseMaxWidth}px)`,
  );

  const closeNavMenu = useCallback((restoreFocus = false) => {
    setNavMenuOpen(false);
    if (restoreFocus) {
      navToggleRef.current?.focus();
    }
  }, []);

  // A viewport that grows past the breakpoint restores the horizontal nav, so
  // the disclosure state must not survive the resize.
  useEffect(() => {
    if (!headerNavCollapsed) {
      setNavMenuOpen(false);
    }
  }, [headerNavCollapsed]);

  useEffect(() => {
    if (!navMenuOpen) {
      return undefined;
    }
    // Move focus into the panel so keyboard users land on the first control.
    navMenuRef.current
      ?.querySelector<HTMLElement>("button:not([disabled]), [role='combobox']")
      ?.focus();
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (
        !target ||
        navMenuRef.current?.contains(target) ||
        navToggleRef.current?.contains(target)
      ) {
        return;
      }
      closeNavMenu();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      closeNavMenu(true);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeNavMenu, navMenuOpen]);

  useEffect(() => {
    writeStorageValue(window.localStorage, storageKeys.inspectorTab, inspectorTab);
  }, [inspectorTab]);

  useEffect(() => {
    writeStorageValue(window.localStorage, storageKeys.activeView, activeView);
  }, [activeView]);

  useEffect(() => {
    writeStorageValue(window.localStorage, storageKeys.deepView, deepView);
  }, [deepView]);

  useEffect(() => {
    // The legacy `?perf=1`-era flag (its stored `1` is what resolvePerfHudInitial
    // honoured at load) is dropped on the first write, so the settings key
    // becomes the only place the HUD state lives.
    writeStorageValue(
      window.localStorage,
      storageKeys.perfHud,
      perfHud,
      legacyStorageKeys.perfHud,
    );
  }, [perfHud]);

  // The HUD is pure DOM outside the React tree (the tool that measures must
  // never enter the render path); React only decides *whether* it exists.
  // The mount returns an idempotent teardown, so StrictMode's
  // mount/unmount/mount double-invocation is safe.
  useEffect(() => {
    if (!perfHud) {
      return;
    }
    const disconnect = mountPerfHud(getPerfSnapshot);
    return () => disconnect?.();
  }, [perfHud]);

  useEffect(() => {
    writeStorageValue(
      window.localStorage,
      storageKeys.historyRange,
      historyRange,
    );
  }, [historyRange]);

  // Changing the default range must be visible immediately: the existing
  // window may have been widened by hand, so it snaps back to the new default.
  // A larger default also needs data the current snapshot never asked for, so
  // the stream re-subscribes for that window instead of silently showing a
  // short list under a wide range label.
  useEffect(() => {
    setRunHistoryHours(historyRangeHours);
    if (historyRangeHours > streamWindowHoursRef.current) {
      streamWindowHoursRef.current = historyRangeHours;
      resumeCursorRef.current = "";
      snapshotKeyRef.current = "";
      forceSnapshotRef.current = true;
      reloadingRef.current = true;
      setReloadingEvents(true);
      setStreamEpoch((current) => current + 1);
    }
  }, [historyRangeHours]);

  useEffect(() => {
    // The retired key is dropped on the first write: its stored `true` meant
    // "show the agent's whole history", which is the opposite of the Live
    // view's filter, so it must not be migrated into the new preference.
    writeStorageValue(
      window.localStorage,
      storageKeys.runHistoryLiveView,
      liveFilter,
      retiredStorageKeys.runHistoryLiveFilter,
    );
  }, [liveFilter]);

  useEffect(() => {
    writeStorageValue(window.localStorage, storageKeys.maxSync, maxSync);
  }, [maxSync]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      const resolved =
        theme === "system" ? (media.matches ? "dark" : "light") : theme;
      document.documentElement.dataset.theme = resolved;
      document.documentElement.classList.toggle("dark", resolved === "dark");
    };

    applyTheme();
    writeStorageValue(
      window.localStorage,
      storageKeys.theme,
      theme,
      legacyStorageKeys.theme,
    );
    media.addEventListener("change", applyTheme);
    return () => media.removeEventListener("change", applyTheme);
  }, [theme]);

  useEffect(() => {
    writeStorageValue(
      window.localStorage,
      storageKeys.platform,
      platformId,
      legacyStorageKeys.platform,
    );
    previousAtomRef.current = "";
    setActiveTransition(null);
    if (preserveAtomSelectionRef.current) {
      preserveAtomSelectionRef.current = false;
    } else {
      setSelectedAtomId(undefined);
    }
  }, [platformId]);

  useEffect(() => {
    writeStorageValue(
      window.localStorage,
      storageKeys.historyOpen,
      historyOpen,
    );
  }, [historyOpen]);

  useEffect(() => {
    writeStorageValue(
      window.localStorage,
      storageKeys.consoleOpen,
      consoleOpen,
    );
  }, [consoleOpen]);

  // First committed app frame: navigation start → here, exposed through
  // window.__astroPerf as the first-screen metric.
  useEffect(() => {
    markAppReady();
  }, []);

  // Search is the only feature behind a chunk. Pulling it during the first
  // idle window keeps the first paint free of it without ever making ⌘K wait
  // on a request; a browser without idle callbacks falls back to a timeout.
  useEffect(() => {
    let cancelled = false;
    const preload = () => {
      if (!cancelled) {
        void preloadHistorySearch();
      }
    };
    if (typeof window.requestIdleCallback === "function") {
      const handle = window.requestIdleCallback(preload, { timeout: 4000 });
      return () => {
        cancelled = true;
        window.cancelIdleCallback(handle);
      };
    }
    const timer = window.setTimeout(preload, 1500);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (historySearchOpen) {
      setHistorySearchMounted(true);
    }
  }, [historySearchOpen]);

  useEffect(() => {
    // A suspended tab drops the stream instead of buffering it: the server
    // stops writing to a page nobody is reading. The reconnect on resume
    // names the last event we hold, so the refresh replays only what was
    // missed — a full snapshot is reserved for the first load and for a
    // cursor the server no longer recognises.
    if (pageSuspended) {
      return undefined;
    }
    // The sync budget is spent: keep the connection closed until the user
    // resumes. Re-subscribing here would silently undo the whole point of the
    // limit (a capped array that keeps growing).
    if (syncStopped) {
      return undefined;
    }
    // A manual reload demands the full snapshot regardless of any trace
    // message that slipped in between the click and this re-subscribe.
    const forceSnapshot = forceSnapshotRef.current;
    forceSnapshotRef.current = false;
    const resumeCursor = forceSnapshot
      ? ""
      : resumeCursorRef.current;
    // A forced snapshot names the history already on screen: when the service
    // was restarted but nothing was recorded in between, the server answers
    // `reset-same` and the page skips the transfer, the parse and the
    // re-projection entirely.
    const knownSnapshot = forceSnapshot ? snapshotKeyRef.current : "";
    const streamParams = new URLSearchParams();
    const windowHours = streamWindowHoursRef.current;
    if (windowHours > 0) {
      streamParams.set("hours", String(windowHours));
    }
    if (resumeCursor) {
      streamParams.set("since", resumeCursor);
    } else if (knownSnapshot) {
      streamParams.set("snapshot", knownSnapshot);
    }
    const streamQuery = streamParams.toString();
    const source = new EventSource(
      joinApi(apiBase, streamQuery ? `/api/stream?${streamQuery}` : "/api/stream"),
    );
    // A chunked snapshot arrives as a reset frame followed by ordinary `trace`
    // frames. Collecting it here and committing once at `ready` keeps the
    // array copy linear; appending each batch to state would be quadratic on a
    // large history.
    let snapshotEvents: TraceEvent[] | null = null;
    // Ids seen so far: an O(1) set keeps per-event dedup linear in total
    // events instead of rescanning the accumulated array on every message.
    const seenIds = new Set<string>();
    // Live capture arrives in bursts (streaming tool output, subagent
    // storms). Coalescing the queue into one state update per short window
    // re-derives sessions, runs, and flows once per batch instead of once
    // per event, which keeps interaction latency flat while recording.
    let pending: TraceEvent[] = [];
    let flushTimer: number | null = null;
    const flush = () => {
      flushTimer = null;
      const batch = pending;
      pending = [];
      if (!batch.length) {
        return;
      }
      const newest = batch.at(-1)?.capturedAt;
      if (newest) {
        setLastEventAt((current) => Math.max(current, Date.parse(newest) || 0));
      }
      // A burst must not block typing or scrolling: the derived sessions,
      // runs, and flows are recomputed in a transition, so React can keep
      // the current frame interactive and drop superseded batches.
      startTransition(() => setLiveEvents((current) => [...current, ...batch]));
    };
    source.addEventListener("ready", (message: MessageEvent<string>) => {
      const payload = JSON.parse(message.data) as {
        eventCount?: number;
        totalEventCount?: number;
        snapshot?: string;
        hours?: number;
        truncated?: boolean;
      };
      if (payload?.snapshot) {
        snapshotKeyRef.current = payload.snapshot;
      }
      if (typeof payload?.truncated === "boolean") {
        setHistoryTruncated(payload.truncated);
      }
      const capturedTotal = payload?.totalEventCount ?? payload?.eventCount;
      if (typeof capturedTotal === "number") {
        setCapturedEventCount(capturedTotal);
      }
      everConnectedRef.current = true;
      setConnected(true);
      setEverConnected(true);
      if (snapshotEvents) {
        const events = snapshotEvents;
        snapshotEvents = null;
        // Live broadcasts can interleave with the chunks; restore the same
        // chronological order the single-frame snapshot used to guarantee.
        // Timestamps come from the per-event cache instead of re-parsing in
        // every comparison.
        events.sort((left, right) => {
          const delta = getEventTimestamp(left) - getEventTimestamp(right);
          return delta || String(left.id).localeCompare(String(right.id));
        });
        resumeCursorRef.current = events.at(-1)?.id ?? resumeCursorRef.current;
        const newest = events.at(-1)?.capturedAt;
        if (newest) {
          setLastEventAt(Date.parse(newest) || 0);
        }
        startTransition(() => {
          setLiveEvents(events);
          setEventsLoaded(true);
          reloadingRef.current = false;
          setReloadingEvents(false);
        });
      } else {
        // `reset` / `reset-same` already marked the list ready; this covers a
        // resumed connection whose first frame was only a cursor replay.
        setEventsLoaded(true);
        reloadingRef.current = false;
        setReloadingEvents(false);
      }
    });
    // New working directories arrive with their git presentation before the
    // events that reference them, so run rows can name the repo and branch.
    source.addEventListener("git", (message: MessageEvent<string>) => {
      const payload = JSON.parse(message.data) as {
        cwd: string;
        repo: string;
        branch: string;
      };
      if (!payload?.cwd || !payload.repo) {
        return;
      }
      setGitInfo((current) => ({
        ...current,
        [payload.cwd]: { repo: payload.repo, branch: payload.branch },
      }));
    });
    source.addEventListener("trace", (message: MessageEvent<string>) => {
      const event = normalizeTraceEvent(JSON.parse(message.data));
      if (seenIds.has(event.id)) {
        return;
      }
      seenIds.add(event.id);
      resumeCursorRef.current = event.id;
      if (snapshotEvents) {
        // Part of the chunked snapshot: committed once at `ready`.
        snapshotEvents.push(event);
        return;
      }
      pending.push(event);
      flushTimer ??= window.setTimeout(flush, 120);
    });
    // The tail the server replayed for our cursor. It appends like live
    // events: everything older is already in `liveEvents`.
    source.addEventListener("resume", (message: MessageEvent<string>) => {
      const payload = JSON.parse(message.data) as {
        events: TraceEvent[];
        git?: Record<string, { repo: string; branch: string }>;
      };
      const events = payload.events.map(normalizeTraceEvent);
      const fresh = events.filter((event) => !seenIds.has(event.id));
      for (const event of fresh) {
        seenIds.add(event.id);
      }
      resumeCursorRef.current = events.at(-1)?.id ?? resumeCursorRef.current;
      const newest = events.at(-1)?.capturedAt;
      if (newest) {
        setLastEventAt((current) => Math.max(current, Date.parse(newest) || 0));
      }
      if (payload.git && Object.keys(payload.git).length) {
        setGitInfo((current) => ({ ...current, ...payload.git }));
      }
      // A reload can legitimately be answered by a tail replay (the server
      // kept our cursor); either way fresh data landed, so stop waiting —
      // inside the same transition as the append, so the reload-follow effect
      // never reads the summary of the stale list.
      startTransition(() => {
        if (fresh.length) {
          setLiveEvents((current) => [...current, ...fresh]);
        }
        reloadingRef.current = false;
        setReloadingEvents(false);
      });
    });
    // The server confirmed the history we already hold. Nothing to apply: the
    // sessions, the flows and the list are all still valid, so the reload ends
    // without touching a single event.
    source.addEventListener("reset-same", (message: MessageEvent<string>) => {
      const payload = JSON.parse(message.data) as {
        eventCount?: number;
        totalEventCount?: number;
        snapshot?: string;
        truncated?: boolean;
      };
      if (payload?.snapshot) {
        snapshotKeyRef.current = payload.snapshot;
      }
      if (typeof payload?.truncated === "boolean") {
        setHistoryTruncated(payload.truncated);
      }
      const capturedTotal = payload?.totalEventCount ?? payload?.eventCount;
      if (typeof capturedTotal === "number") {
        setCapturedEventCount(capturedTotal);
      }
      if (flushTimer !== null) {
        window.clearTimeout(flushTimer);
        flushTimer = null;
      }
      pending = [];
      startTransition(() => {
        setEventsLoaded(true);
        setReloadingEvents(false);
      });
    });
    source.addEventListener("reset", (message: MessageEvent<string>) => {
      const payload = JSON.parse(message.data) as {
        events: TraceEvent[];
        git?: Record<string, { repo: string; branch: string }>;
        streaming?: boolean;
        truncated?: boolean;
        hours?: number;
        totalEventCount?: number;
      };
      if (typeof payload?.truncated === "boolean") {
        setHistoryTruncated(payload.truncated);
      }
      if (typeof payload?.totalEventCount === "number") {
        setCapturedEventCount(payload.totalEventCount);
      }
      if (payload.streaming) {
        // A chunked snapshot: the reset frame is metadata plus (normally) an
        // empty list, and the events follow as `trace` frames. Keep whatever
        // is on screen until `ready` commits the new list once.
        if (flushTimer !== null) {
          window.clearTimeout(flushTimer);
          flushTimer = null;
        }
        pending = [];
        snapshotEvents = payload.events.map(normalizeTraceEvent);
        for (const event of snapshotEvents) {
          seenIds.add(event.id);
        }
        setGitInfo(payload.git ?? {});
        return;
      }
      /*
       * A restart re-sends the whole history. When the snapshot describes the
       * events already on screen (the common case: nothing was recorded while
       * the service was down), re-applying it would re-normalize every event,
       * rebuild every session and re-render the console for an identical
       * result — measured at ~400 ms of script time on a 27k-event history.
       * The ids are compared first, before anything is normalized.
       */
      const current = liveEventsRef.current;
      const unchanged =
        current.length === payload.events.length &&
        isSameEventSequence(payload.events, current);
      const events = unchanged
        ? current
        : payload.events.map(normalizeTraceEvent);
      // The dedup set belongs to this connection: a resumed stream starts with
      // an empty one, so it is refilled either way.
      for (const event of events) {
        seenIds.add(event.id);
      }
      resumeCursorRef.current = events.at(-1)?.id ?? "";
      // A snapshot replaces queued increments; replaying them afterwards
      // would reorder the event stream.
      if (flushTimer !== null) {
        window.clearTimeout(flushTimer);
        flushTimer = null;
      }
      pending = [];
      const newest = events.at(-1)?.capturedAt;
      setLastEventAt(newest ? Date.parse(newest) || 0 : 0);
      // First paint stays immediate: the snapshot render is a transition, so
      // the shell (header, panels, empty states) paints before the derived
      // topology/trajectory work for a large history lands.
      startTransition(() => {
        // Skipping the assignment is what makes the unchanged case free: the
        // session projection caches by event-array identity, so replacing the
        // array is exactly what would force a full rebuild.
        if (!unchanged) {
          setLiveEvents(events);
        }
        setGitInfo(payload.git ?? {});
        setEventsLoaded(true);
        reloadingRef.current = false;
        setReloadingEvents(false);
      });
    });
    source.onerror = () => {
      setConnected(false);
      // A failed reconnect must not leave the manual-reload control spinning
      // forever; EventSource keeps retrying and the next snapshot lands
      // whenever the server answers.
      setReloadingEvents(false);
      // Only an explicit reload deserves a notice: the stream's own retry
      // loop recovers on its own, and announcing every retry would turn a
      // restarted service into a wall of toasts.
      if (reloadingRef.current) {
        reloadingRef.current = false;
        pushNotice("error", "重新加载失败，事件流会自动重试");
      }
      // A deployed console reaches across origins to reach the local service.
      // When that never connects, say why once — a silent offline chip reads
      // like "no agents are running" when the actual blocker is a refused
      // origin or a service that was never started.
      if (apiBase && !everConnectedRef.current && !remoteConnectHintedRef.current) {
        remoteConnectHintedRef.current = true;
        pushNotice(
          "error",
          "无法连接本地服务",
          `${apiBase || "同源"} — 确认服务已启动，并在服务端设置 ASTRO_CORS_ORIGINS 加入 ${window.location.origin}`,
        );
      }
    };
    source.onopen = () => {
      everConnectedRef.current = true;
      setConnected(true);
    };
    return () => {
      if (flushTimer !== null) {
        window.clearTimeout(flushTimer);
      }
      source.close();
      setConnected(false);
    };
  }, [apiBase, pageSuspended, streamEpoch, syncStopped]);

  const allEvents = useMemo(
    () =>
      importedEvents.length
        ? [
            ...new Map(
              [...importedEvents, ...liveEvents].map((event) => [
                event.id,
                event,
              ]),
            ).values(),
          ]
        : liveEvents,
    [liveEvents, importedEvents],
  );
  // Demo needs three things: no captured events (the sample never overwrites
  // real data), the build or the reader permitting it, and the dataset having
  // actually arrived. dev/test permits it automatically; a production build
  // permits it only through the explicit `?demo=1` preview opt-in. A failed
  // load leaves the console on the truthful empty state rather than pinning a
  // stale or synthetic run.
  const demoGateOpen = isDemoGateOpen(
    Math.max(allEvents.length, capturedEventCount),
    import.meta.env,
    demoOptIn,
  );
  const isDemo = demoDataset.status === "ready" && demoGateOpen;
  const visibleEvents = isDemo ? demoDataset.events : allEvents;
  /*
   * Sample data is a development convenience, never captured evidence. Only the
   * empty console needs the explanation — with real events on screen a missing
   * sample changes nothing — and it is one notice, not a repeated toast: the
   * load happens once per mount.
   */
  const demoError =
    demoDataset.status === "error" && demoGateOpen
      ? demoDataset.error
      : null;
  useEffect(() => {
    if (!demoError) {
      return;
    }
    pushNotice("info", "示例数据不可用", demoError);
  }, [demoError, pushNotice]);
  // The sync budget timer is armed with the resume logic below
  // (`resumeSync`): a cap change must be able to reopen the stream, so the
  // effect lives next to the only definition of "resume".

  // The budget expiring is a silent switch-over in the header; say it out loud
  // once, together with the way back. `syncStopped` is also set on resume and
  // restart, so the announcement is guarded by its own flag.
  const announcedSyncPauseRef = useRef(false);
  useEffect(() => {
    if (!syncStopped) {
      announcedSyncPauseRef.current = false;
      return;
    }
    if (announcedSyncPauseRef.current) {
      return;
    }
    announcedSyncPauseRef.current = true;
    pushNotice(
      "info",
      `已达最长同步时长（${getMaxSyncLabel(maxSync)}），已暂停接收新事件`,
      "点击顶部的 paused 按钮、重启服务，或在设置里调高「最长同步时长」，都可以继续同步",
    );
  }, [maxSync, pushNotice, syncStopped]);

  // Session objects are rebuilt incrementally: a streaming batch only touches
  // the sessions it actually extended, so every other RUN HISTORY row keeps
  // its identity (and its cached Prompt runs) instead of re-rendering.
  const sessionProjection = useMemo(() => createSessionProjection(), []);
  const sessions = useMemo(
    () => sessionProjection(visibleEvents),
    [sessionProjection, visibleEvents],
  );
  const sessionsByKey = useMemo(
    () => new Map(sessions.map((session) => [session.key, session])),
    [sessions],
  );
  const promptRunsBySession = useMemo(
    () =>
      new Map(
        sessions.map((session) => [
          session.key,
          buildSessionPromptRuns(session),
        ]),
      ),
    [sessions],
  );
  const configuredSources = useMemo(
    () => new Set(atomPlatformOptions.map((platform) => platform.source)),
    [],
  );
  // RUN HISTORY is narrowed to the selected agent first; the time window and
  // the live pinning below are applied to that set. The agent is the outer
  // filter — the list is the selected agent's history, and a run of another
  // agent never enters it, whatever state that run is in.
  const filteredSessions = useMemo(
    () => filterSessionsByAgent(sessions, agentId, configuredSources),
    [agentId, configuredSources, sessions],
  );
  /**
   * Every session on the machine whose message is executing right now. Kept
   * apart from the list's own live set on purpose: this one answers "which
   * agent is running", which the agent picker needs in order to point at a
   * neighbour without pulling that neighbour's rows into this list.
   */
  const machineLiveKeys = useMemo(() => {
    if (isDemo) {
      return new Set<string>();
    }
    return collectLiveRunKeys(
      sessions,
      promptRunsBySession,
      now,
      appTimings.activeRunTimeoutMs,
    );
  }, [isDemo, now, promptRunsBySession, sessions]);
  /**
   * Executing messages *inside the selected agent*. One set drives four things
   * that must agree: the window exemption, the pin to the top of the list, the
   * Live filter, and the `N LIVE` chip — a row that is pinned but not counted
   * (or the reverse) reads as a bug.
   *
   * Scoped by the dropdown, not machine-wide. Counting or pinning a live run of
   * another agent put that row at the top of every agent's history, which is
   * how a Codex view ended up showing the Claude message that was executing at
   * the time. The neighbour's run stays discoverable through
   * {@link scopeLiveRunIndex}'s `sources` — the picker marks those agents — so
   * nothing is lost by keeping this list honest.
   */
  const { keys: liveSessionKeys, sources: liveSources } = useMemo(
    () => scopeLiveRunIndex(sessions, machineLiveKeys, filteredSessions),
    [filteredSessions, machineLiveKeys, sessions],
  );
  /**
   * Picker entries with something executing right now: a configured agent by
   * its own id, an ad-hoc source under `Others`.
   */
  const liveAgentIds = useMemo(() => {
    const ids = new Set<string>();
    for (const source of liveSources) {
      ids.add(configuredSources.has(source) ? source : OTHERS_AGENT_ID);
    }
    return ids;
  }, [configuredSources, liveSources]);
  // Runs shown in RUN HISTORY.
  //
  // Two readings of the same history, one derivation:
  // - Live filter armed (`liveFilter`): the *executing* messages only, filtered
  //   out of the agent's whole history — the time window is dropped so a
  //   session resumed a minute ago (and started days ago) still qualifies, but
  //   finished messages are not part of the list. An empty result is a real
  //   answer: nothing is running.
  // - Otherwise: the visible time window (the configured default range,
  //   widened on demand) with the executing run pinned, because a resumed
  //   session is live *now* even though it started earlier.
  //
  // Both paths end in `pinLiveRunHistory` so the executing message is always
  // the first row, and both are derived at render time. Neither path may leave
  // `filteredSessions`: the agent scope is applied first, the time window is
  // measured inside it, and the result is the list.
  //
  // The pin orders live rows by the *start of the run's newest message*, not
  // its latest event: that key is stable for the whole execution of a message
  // (events keep arriving but the order never moves), so two concurrently
  // running messages no longer trade places batch after batch. The message
  // that started executing last sits on top; sending it a new message makes
  // it — not the other — take the top.
  const visibleSessions = useMemo(() => {
    const executionStart = (session: TraceSession) =>
      promptRunsBySession.get(session.key)?.at(-1)?.start ?? session.start;
    if (liveFilter && !isDemo) {
      return selectLiveRunHistory(
        filteredSessions,
        liveSessionKeys,
        executionStart,
      );
    }
    return pinLiveRunHistory(
      selectVisibleRunHistory(
        filteredSessions,
        now,
        runHistoryHours,
        liveSessionKeys,
      ),
      liveSessionKeys,
      executionStart,
    );
  }, [
    filteredSessions,
    isDemo,
    liveFilter,
    liveSessionKeys,
    now,
    runHistoryHours,
    promptRunsBySession,
  ]);
  // The Live filter reads the whole history, so there is no window to widen.
  // `historyTruncated` comes from the service: the snapshot only contains the
  // requested window, so an older session cannot prove that more exists.
  const canLoadMoreHistory =
    !(liveFilter && !isDemo) &&
    runHistoryHours < maxStreamWindowHours &&
    (historyTruncated ||
      canLoadMoreRunHistory(filteredSessions, now, runHistoryHours));
  // Recomputed only when the inputs change instead of on every parent render.
  const hasAdvancingRun = useMemo(
    () =>
      !isDemo &&
      sessions.some((session) => {
        const promptRuns = promptRunsBySession.get(session.key) ?? [];
        const parentState = getRunHistoryDisplayState(
          session,
          promptRuns,
          now,
          appTimings.activeRunTimeoutMs,
        );
        if (parentState.status === "active") {
          return true;
        }
        return promptRuns.some((promptRun) => {
          const promptState = getRunDisplayState(
            promptRun,
            now,
            appTimings.activeRunTimeoutMs,
          );
          return (
            promptState.status === "active" ||
            promptState.status === "waiting"
          );
        });
      }),
    [isDemo, now, promptRunsBySession, sessions],
  );
  useEffect(() => {
    // This is the console's clock: it advances every live duration. Nothing
    // on screen can change while the tab is suspended, so the interval stops
    // and a single `setNow` on resume catches every duration up at once.
    if (!hasAdvancingRun || pageSuspended) {
      return undefined;
    }

    setNow(Date.now());
    const timer = window.setInterval(
      () => setNow(Date.now()),
      appTimings.sessionDurationRefreshMs,
    );
    return () => window.clearInterval(timer);
  }, [hasAdvancingRun, pageSuspended]);

  useEffect(() => {
    const handleGlobalSearchShortcut = (event: KeyboardEvent) => {
      if (
        event.key.toLocaleLowerCase() !== "k" ||
        (!event.metaKey && !event.ctrlKey)
      ) {
        return;
      }
      event.preventDefault();
      setHistorySearchOpen((current) => !current);
    };
    window.addEventListener("keydown", handleGlobalSearchShortcut);
    return () =>
      window.removeEventListener("keydown", handleGlobalSearchShortcut);
  }, []);

  useEffect(() => {
    if (!eventsLoaded || !sessions.length) {
      return;
    }
    const requested = initialLocation;
    // The dropdown owns the fallback pool: arriving without a session — or
    // switching agents — opens the selected agent's newest run. The previous
    // version fell back to `sessions[0]`, the newest run on the machine, which
    // is how a Codex view kept a Claude run on the canvas with no row beside
    // it. An agent with nothing recorded leaves the pool empty and the canvas
    // empty; borrowing another agent's run is exactly the leak this prevents.
    const fallbackPool = filteredSessions;
    // The session id wins over the agent scope: a shared link to a run of
    // another agent must still land on that run.
    const deepLinkedSession =
      fallbackPool.find(
        (session) =>
          session.id === requested?.sessionId &&
          (!requested?.agent ||
            requested.agent === OTHERS_AGENT_ID ||
            session.source === requested.agent),
      ) ??
      (requested?.sessionId
        ? sessions.find((session) => session.id === requested.sessionId)
        : undefined);
    const currentSession = sessions.find(
      (session) => session.key === activeSessionKey,
    );
    const nextSession = currentSession || deepLinkedSession || fallbackPool[0];
    if (!nextSession) {
      setInitialLocation(null);
      return;
    }
    // A shared link that names a run of another agent drags the dropdown with
    // it: the opened run and the list it came from must stay in one scope,
    // otherwise the canvas shows a message no row in RUN HISTORY can point at.
    if (deepLinkedSession && nextSession.key === deepLinkedSession.key) {
      const linkedAgent = configuredSources.has(deepLinkedSession.source)
        ? (deepLinkedSession.source as PlatformId)
        : OTHERS_AGENT_ID;
      if (linkedAgent !== agentId) {
        setAgentId(linkedAgent);
        if (linkedAgent !== OTHERS_AGENT_ID) {
          setPlatformId(linkedAgent);
        }
        // Resolve again with the new scope so the atom projection below is
        // built for the agent the run actually belongs to.
        return;
      }
    }
    const promptRuns = promptRunsBySession.get(nextSession.key) ?? [];
    const linkedPromptRun = requested?.eventId
      ? promptRuns.find((run) =>
          run.events.some((event) => event.id === requested.eventId),
        )
      : undefined;
    const currentPromptRun = promptRuns.find(
      (run) => run.key === activePromptRunKey,
    );
    const nextPromptRun =
      linkedPromptRun || currentPromptRun || promptRuns.at(-1);

    if (nextSession.key !== activeSessionKey) {
      setActiveSessionKey(nextSession.key);
    }
    if ((nextPromptRun?.key || "") !== activePromptRunKey) {
      setActivePromptRunKey(nextPromptRun?.key || "");
    }
    if (requested?.eventId) {
      const linkedEvent = nextPromptRun?.events.find(
        (event) => event.id === requested.eventId,
      );
      if (linkedEvent) {
        setSelectedEventId(linkedEvent.id);
        setSelectedAtomId(getAtomIdForEvent(linkedEvent, platformId));
      }
    }
    setInitialLocation(null);
  }, [
    activePromptRunKey,
    activeSessionKey,
    agentId,
    configuredSources,
    eventsLoaded,
    filteredSessions,
    initialLocation,
    platformId,
    promptRunsBySession,
    sessions,
  ]);

  // The open run resolves inside the agent's scope: arriving without a
  // selection, or switching agents, must not keep another agent's run on the
  // canvas while its row is absent from the list beside it. An explicit deep
  // link still wins — a shared link may name a run of another agent on
  // purpose, and that one is written into `activeSessionKey` directly.
  const activeSession =
    sessions.find((session) => session.key === activeSessionKey) ||
    filteredSessions[0];
  const activePromptRuns =
    promptRunsBySession.get(activeSession?.key || "") ?? [];
  const activePromptRun =
    activePromptRuns.find((run) => run.key === activePromptRunKey) ||
    activePromptRuns.at(-1);
  const latestPromptRun = activePromptRuns.at(-1);
  const activeEvents =
    activePromptRun?.events ?? activeSession?.events ?? EMPTY_EVENTS;
  const activeDisplayState = activePromptRun
    ? getRunDisplayState(
        activePromptRun,
        now,
        appTimings.activeRunTimeoutMs,
      )
    : activeSession
      ? getRunHistoryDisplayState(
          activeSession,
          activePromptRuns,
          now,
          appTimings.activeRunTimeoutMs,
        )
      : undefined;
  // Clicking any executing run opens Live: follow mode is allowed while the
  // ACTIVE run executes, not only for the newest session in the window.
  const promptExecuting = isPromptExecuting(
    activeDisplayState?.status,
    isDemo,
  );
  const followingSessionLive = isFollowingLive(
    selectedAtomId,
    replayMode,
    promptExecuting,
  );
  const followingLive = followingSessionLive;
  const executingLive = promptExecuting && !replayMode;
  // Live rides the newest executed atom: the pulse and the Live button stay
  // active only while the selection has not fallen behind the newest event.
  const latestExecutionAtomId = getAtomIdForEvent(
    activeEvents.at(-1) || null,
    platformId,
  );
  const followingLatestExecutionAtom = isLiveFollowingLatest(
    selectedAtomId,
    latestExecutionAtomId,
  );
  // The Live marker benchmarks the message status: only an in-flight (START)
  // message counts, and only while it belongs to the newest executed node.
  const pendingEvent = useMemo(() => {
    for (let index = activeEvents.length - 1; index >= 0; index -= 1) {
      const event = activeEvents[index];
      if (getEventAction(event) === "START") {
        return event;
      }
    }
    return null;
  }, [activeEvents]);
  // One definition of "the studio is following the executing atom": the run is
  // executing and the selection has not been moved onto an older atom. The
  // canvas pulse, the animated edges, the log live marker and the Live button
  // all read this value, so the button can never claim a state the canvas is
  // not in. Whether a tool call is still pending only decides the log's
  // RUNNING row, not whether Live is on.
  const liveActive = executingLive && followingLatestExecutionAtom;

  useEffect(() => {
    if (!activeSession || initialLocation !== null) {
      return;
    }
    if (
      followingSessionLive &&
      latestPromptRun &&
      latestPromptRun.key !== activePromptRunKey
    ) {
      setActivePromptRunKey(latestPromptRun.key);
      setSelectedEventId(latestPromptRun.events.at(-1)?.id || "");
      return;
    }
    if (followingLive) {
      setSelectedEventId(activeEvents.at(-1)?.id || "");
      return;
    }
    if (selectedEventId === "") {
      return;
    }
    if (
      !selectedEventId ||
      !activeEvents.some((event) => event.id === selectedEventId)
    ) {
      setSelectedEventId(activeEvents.at(-1)?.id || "");
    }
  }, [
    activeEvents,
    activePromptRunKey,
    activeSession,
    followingLive,
    followingSessionLive,
    initialLocation,
    latestPromptRun,
    selectedEventId,
  ]);

  useEffect(() => {
    if (!activeEvents.length) {
      return;
    }
    setReplayCursor((current) =>
      replayMode
        ? Math.min(current, activeEvents.length - 1)
        : followingLive
          ? activeEvents.length - 1
          : Math.max(
              0,
              activeEvents.findIndex((event) => event.id === selectedEventId),
            ),
    );
  }, [activeEvents, followingLive, replayMode, selectedEventId]);

  useEffect(() => {
    // Replay is a timer-driven animation: it pauses with the tab and resumes
    // from the same cursor instead of racing through events unseen.
    if (!playing || !activeEvents.length || pageSuspended) {
      return undefined;
    }
    const timer = window.setInterval(() => {
      setReplayCursor((current) => {
        if (current >= activeEvents.length - 1) {
          setPlaying(false);
          return current;
        }
        return current + 1;
      });
    }, appTimings.replayStepBaseMs / replaySpeed);
    return () => window.clearInterval(timer);
  }, [activeEvents.length, pageSuspended, playing, replaySpeed]);

  useEffect(() => {
    if (!replayMode || !activeEvents.length) {
      return;
    }
    setSelectedAtomId(undefined);
    setSelectedEventId(activeEvents[replayCursor]?.id || "");
  }, [activeEvents, replayCursor, replayMode]);

  useEffect(() => {
    if (!activeSession || initialLocation !== null) {
      return;
    }
    const params = new URLSearchParams(window.location.search);
    // `agent` mirrors the dropdown filter, not the open run: a shared link may
    // name a run of another agent (and still lands on it), so the two
    // parameters are written independently.
    params.set("agent", agentId);
    // The renamed parameter replaces the legacy one instead of accumulating.
    params.delete("source");
    params.set("session", activeSession.id);
    if (selectedEventId) {
      params.set("event", selectedEventId);
    } else {
      params.delete("event");
    }
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}?${params}`,
    );
  }, [activeSession, agentId, initialLocation, selectedEventId]);

  const displayedEvents = replayMode
    ? activeEvents.slice(0, replayCursor + 1)
    : activeEvents;
  // The canvas projections (flow, harness topology, atomic fold) are the
  // expensive part of a streaming batch. Deferring them lets React coalesce
  // several bursts into one canvas render while the log and the run list stay
  // on the newest events.
  const canvasEvents = useDeferredValue(displayedEvents);
  const flow = useMemo(() => buildFlow(canvasEvents), [canvasEvents]);
  const harnessFlow = useMemo(
    () => buildHarnessFlow(canvasEvents, platformId),
    [canvasEvents, platformId],
  );
  const atomicProjection = useMemo(
    () => projectTraceEvents(canvasEvents, platformId),
    [canvasEvents, platformId],
  );
  const inspectionFlow = flow;
  const selectedEvent =
    displayedEvents.find((event) => event.id === selectedEventId) || null;
  const mappedAtomId = getAtomIdForEvent(selectedEvent, platformId);
  const currentAtomId = resolveSelectedAtomId(
    selectedAtomId,
    mappedAtomId,
  );
  const activeExecutionAtomId = liveActive
    ? latestExecutionAtomId
    : replayMode && playing
      ? currentAtomId
      : "";
  const locateAtomId = resolveLocateAtomId(
    selectedAtomId,
    activeExecutionAtomId,
    currentAtomId,
  );
  const locateAtomNode = harnessFlow.nodes.find(
    (node) => node.id === locateAtomId,
  );
  const hasManualAtomSelection =
    typeof selectedAtomId === "string" && selectedAtomId.length > 0;
  const locateAtomEvent = hasManualAtomSelection
    ? selectedEvent ||
      locateAtomNode?.data.endEvent ||
      locateAtomNode?.data.event
    : locateAtomId === activeExecutionAtomId
      ? activeEvents.at(-1) || null
      : selectedEvent ||
        locateAtomNode?.data.endEvent ||
        locateAtomNode?.data.event;
  const animatingFlow = Boolean(activeExecutionAtomId);
  const selectedNodeId = getFlowNodeIdForEvent(selectedEvent, inspectionFlow.nodes);
  const activeTransitionEdges = useMemo(
    () =>
      animatingFlow && activeExecutionAtomId && activeTransition
        ? findTransitionEdges(
            harnessFlow.edges,
            activeTransition.fromId,
            activeTransition.toId,
          )
        : new Set<string>(),
    [activeExecutionAtomId, activeTransition, animatingFlow, harnessFlow.edges],
  );
  const selectedNode =
    inspectionFlow.nodes.find((node) => node.id === selectedNodeId) || null;
  const selectedAtom =
    harnessFlow.nodes.find((node) => node.id === currentAtomId)?.data || null;
  const selectedEventIndex =
    activeEvents.findIndex((event) => event.id === selectedEventId);

  useEffect(() => {
    if (!animatingFlow || !activeExecutionAtomId) {
      previousAtomRef.current = "";
      setActiveTransition(null);
      return undefined;
    }
    const previousAtomId = previousAtomRef.current;
    previousAtomRef.current = activeExecutionAtomId;
    if (!previousAtomId || previousAtomId === activeExecutionAtomId) {
      return undefined;
    }

    const transition: ActiveTransition = {
      fromId: previousAtomId,
      toId: activeExecutionAtomId,
      key: `${previousAtomId}-${activeExecutionAtomId}-${Date.now()}`,
    };
    setActiveTransition(transition);
    const timer = window.setTimeout(() => {
      setActiveTransition((current) =>
        current?.key === transition.key ? null : current,
      );
    }, appTimings.activeTransitionMs);
    return () => window.clearTimeout(timer);
  }, [activeExecutionAtomId, animatingFlow]);

  const selectSession = useCallback(
    (key: string, promptRunKey?: string) => {
      const session = sessionsByKey.get(key);
      const promptRuns = promptRunsBySession.get(key) ?? [];
      const promptRun =
        promptRuns.find((candidate) => candidate.key === promptRunKey) ||
        promptRuns.at(-1);
      const event = promptRun?.events.at(-1) || session?.events.at(-1);
      const status = promptRun?.status ?? session?.status;
      // A running message follows the atom it is executing (no explicit
      // selection); a finished one lands nowhere, so it must not locate the
      // last atom either.
      const atomSelection = getPromptAtomSelection(status);
      setActiveSessionKey(key);
      setActivePromptRunKey(promptRun?.key || "");
      setSelectedEventId(event?.id || "");
      setSelectedAtomId(atomSelection);
      // A waiting run still has a current atom to land on — flash it on the
      // canvas so the blocked point is obvious. A finished run has no landing
      // atom, so an explicit pick is the only thing that locates.
      if (status !== "active" && atomSelection !== null) {
        setLocateRequest((current) => current + 1);
      }
      setConsoleOpen(true);
      setLogQueryResetToken((current) => current + 1);
      setReplayMode(false);
      setPlaying(false);
    },
    [promptRunsBySession, sessionsByKey],
  );

  const selectHistorySearchResult = (entry: HistorySearchEntry) => {
    const targetPlatform = getPlatformForSource(entry.source) ?? platformId;
    preserveAtomSelectionRef.current = targetPlatform !== platformId;
    setPlatformId(targetPlatform);
    // The dropdown filter follows the jump: the opened run and the list it
    // came from must stay visible together under the same agent.
    setAgentId(
      configuredSources.has(entry.source)
        ? (entry.source as PlatformId)
        : OTHERS_AGENT_ID,
    );
    setActiveSessionKey(entry.sessionKey);
    setActivePromptRunKey(entry.promptRunKey);
    setSelectedEventId(entry.eventId);
    setSelectedAtomId(
      getAtomIdForEvent(entry.event, targetPlatform) || null,
    );
    setActiveView("topology");
    setHistoryOpen(true);
    setConsoleOpen(true);
    setLogQueryResetToken((current) => current + 1);
    setReplayMode(false);
    setPlaying(false);
    setHistorySearchOpen(false);
    setLocateRequest((current) => current + 1);
    setLogLocateRequest((current) => current + 1);
  };

  const importTrace = async (file?: File) => {
    if (!file) {
      return;
    }
    try {
      const imported = parseImportedTrace(await file.text());
      if (!imported.length) {
        // A well-formed file with no events used to import "nothing" silently,
        // which looks identical to a broken import.
        pushNotice("info", `${file.name} 中没有可导入的事件`);
        return;
      }
      setImportedEvents((current) =>
        [...new Map([...current, ...imported].map((event) => [event.id, event])).values()],
      );
      pushNotice(
        "success",
        `已导入 ${imported.length} 条事件`,
        `${file.name} · 与本地历史合并显示`,
      );
    } catch (error) {
      pushNotice(
        "error",
        "导入失败：文件不是有效的 ASTRO trace",
        error instanceof Error ? error.message : String(error),
      );
    }
  };

  const exportTrace = () => {
    if (!activeSession) return;
    const content = activeEvents
      .map((event) => JSON.stringify(event))
      .join("\n");
    const url = URL.createObjectURL(
      new Blob([`${content}\n`], { type: "application/x-ndjson" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `astro-${activeSession.source}-${activeSession.id}${
      activePromptRun ? `-prompt-${activePromptRun.index + 1}` : ""
    }.jsonl`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const clearEvents = async () => {
    if (!window.confirm("Clear all locally captured and imported trace events?")) {
      return;
    }
    const importedIds = new Set(importedEvents.map((event) => event.id));
    try {
      if (!isDemo) {
        const response = await fetch(joinApi(apiBase, "/api/events"), {
          method: "DELETE",
        });
        if (!response.ok) throw new Error(`Server returned ${response.status}`);
      }
      // The SSE reset is ordered with new traces; the HTTP response is not.
      setImportedEvents((current) => current.filter((event) => !importedIds.has(event.id)));
      pushNotice("success", "已清空本地事件");
    } catch (error) {
      pushNotice(
        "error",
        "清空失败",
        error instanceof Error ? error.message : String(error),
      );
    }
  };

  /*
   * Service health: polled, not streamed. Uptime, startup cost, pid and the
   * capture-side session summary all come from `/api/health`, which is O(1)
   * on the server, so a 5s poll is cheap even with a large history — and it
   * stops entirely while the tab is suspended, re-reading once on resume.
   */
  useEffect(() => {
    if (pageSuspended) {
      return undefined;
    }
    let active = true;
    const load = async () => {
      try {
        const response = await fetch(joinApi(apiBase, "/api/health"), {
          cache: "no-store",
        });
        if (!response.ok) {
          throw new Error(`Server returned ${response.status}`);
        }
        const payload = (await response.json()) as Omit<ServiceHealth, "fetchedAt">;
        if (!active) {
          return;
        }
        setService({ ...payload, fetchedAt: Date.now() });
        setServiceError("");
      } catch (error) {
        if (!active) {
          return;
        }
        setServiceError(
          error instanceof Error ? error.message : String(error),
        );
      }
    };
    void load();
    const timer = window.setInterval(() => {
      if (!document.hidden) {
        void load();
      }
    }, 5_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [apiBase, pageSuspended]);

  // Restart the local dashboard service in place. The server spawns a
  // successor that re-binds the same port and then exits; this poll waits for
  // a different pid to answer before re-subscribing the event stream, so the
  // UI never keeps consuming the dying process's stream.
  /**
   * Wait for the successor to answer with a different pid, then re-subscribe
   * the stream from a fresh snapshot. Shared by the restart button and the
   * data-directory setting: both replace the process, and the console must
   * neither keep consuming the dying stream nor reuse its cursor.
   */
  const waitForServiceRestart = async (previousPid: number) => {
    const deadline = Date.now() + 20_000;
    for (;;) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      try {
        const health = await fetch(joinApi(apiBase, "/api/health"), {
          cache: "no-store",
        });
        const payload = (await health.json()) as Omit<
          ServiceHealth,
          "fetchedAt"
        >;
        if (payload?.pid && payload.pid !== previousPid) {
          setService({ ...payload, fetchedAt: Date.now() });
          setServiceError("");
          break;
        }
      } catch {
        // The outgoing process is still holding the port; keep waiting.
      }
      if (Date.now() > deadline) {
        throw new Error("重启超时，请检查本地服务进程");
      }
    }
    // New process, new stream: drop the old connection explicitly instead
    // of trusting EventSource to reconnect at the right moment.
    //
    // A restart is not "the same history, newer tail": the new process reads
    // the trace files from scratch, so a file added, removed or rewritten
    // while the service was down only shows up if the console asks for the
    // full snapshot. Reusing the cursor turned a restart into an empty
    // `resume` replay, which left a stale list on screen that looked freshly
    // loaded. The window snaps back to the configured range so the list
    // describes the current filter (agent + range + Live) rather than a
    // hand-widened window that the new process may not even contain.
    resumeCursorRef.current = "";
    forceSnapshotRef.current = true;
    setReloadingEvents(true);
    setRunHistoryHours(historyRangeHours);
    streamWindowHoursRef.current = historyRangeHours;
    setHistoryTruncated(false);
    setStreamEpoch((current) => current + 1);
    // A restart is also the documented way out of a spent sync budget: the
    // new process serves a fresh snapshot, so the clock starts over here
    // instead of leaving the console stopped after a successful restart.
    setSyncStartedAt(Date.now());
    setSyncStopped(false);
  };

  const restartDashboard = async () => {
    if (isDemo) {
      return;
    }
    if (
      !window.confirm(
        "重启本地 ASTRO 服务？端口保持不变，完成后事件流会自动重连并重新加载。",
      )
    ) {
      return;
    }
    const previousPid = service?.pid ?? 0;
    setRestarting(true);
    try {
      const response = await fetch(joinApi(apiBase, "/api/restart"), {
        method: "POST",
      });
      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }
      await waitForServiceRestart(previousPid);
    } catch (error) {
      pushNotice(
        "error",
        "重启本地服务失败",
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setRestarting(false);
    }
  };

  /**
   * Point the service at another trace root. The server persists it to the
   * plugin `.env` (so hooks that start the service later use it too) and
   * restarts; the page then reloads from the new directory.
   */
  const changeDataRoot = async (path: string): Promise<boolean> => {
    if (isDemo) {
      return false;
    }
    const previousPid = service?.pid ?? 0;
    setRestarting(true);
    try {
      const response = await fetch(joinApi(apiBase, "/api/config/data-root"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload?.error || `Server returned ${response.status}`);
      }
      pushNotice(
        "success",
        "数据目录已更新",
        "服务正在重启，完成后会重新读取该目录。",
      );
      await waitForServiceRestart(previousPid);
      return true;
    } catch (error) {
      pushNotice(
        "error",
        "更新数据目录失败",
        error instanceof Error ? error.message : String(error),
      );
      return false;
    } finally {
      setRestarting(false);
    }
  };

  // Locating an atom only needs the topology current at click time, so the
  // callback reads it through a ref and keeps a stable identity: the Flow
  // Guide is memoized on its props, and a per-batch `harnessFlow` would
  // otherwise re-render the whole open drawer on every capture batch.
  const harnessFlowRef = useRef(harnessFlow);
  harnessFlowRef.current = harnessFlow;
  const focusAtom = useCallback(
    (atomId: string) => {
      const node = harnessFlowRef.current.nodes.find(
        (item) => item.id === atomId,
      );
      if (!node) {
        return;
      }
      setPlaying(false);
      setReplayMode(false);
      setSelectedAtomId(atomId);
      setSelectedEventId((node.data.endEvent || node.data.event)?.id || "");
      setDeepView(true);
      setLocateRequest((current) => current + 1);
    },
    [],
  );

  const locateTrajectorySelection = useCallback(() => {
    if (!locateAtomId || !locateAtomEvent) {
      return;
    }
    if (
      !hasManualAtomSelection &&
      locateAtomId === activeExecutionAtomId
    ) {
      setSelectedAtomId(undefined);
    }
    setSelectedEventId(locateAtomEvent.id);
    setConsoleOpen(true);
    setLogQueryResetToken((current) => current + 1);
    setTrajectoryLocateRequest((current) => current + 1);
    setLogLocateRequest((current) => current + 1);
  }, [
    activeExecutionAtomId,
    hasManualAtomSelection,
    locateAtomEvent,
    locateAtomId,
  ]);

  // Event log selection. Kept stable so the virtualized log does not
  // re-reconcile on unrelated parent renders.
  const handleLogSelect = useCallback(
    (eventId: string) => {
      setPlaying(false);
      setReplayMode(false);
      const selecting = selectedEventId !== eventId;
      const event = activeEvents.find((candidate) => candidate.id === eventId);
      setSelectedAtomId(
        selecting ? getAtomIdForEvent(event || null, platformId) || null : null,
      );
      setSelectedEventId(selecting ? eventId : "");
    },
    [activeEvents, platformId, selectedEventId],
  );

  const handleLogLocateAtom = useCallback(() => {
    if (!currentAtomId) {
      return;
    }
    setActiveView("topology");
    focusAtom(currentAtomId);
    // The button lives in the LOG header, so the LOG must react too: bump the
    // log's own locate request to center the atom's event row (mirroring the
    // trajectory locate, which bumps both view requests). A plain
    // selectedEventId change only *reveals* the row when it is off-screen,
    // so a click would read as dead while the row is on screen. Clearing the
    // search filter guarantees the row exists in the filtered list.
    setLogQueryResetToken((current) => current + 1);
    setLogLocateRequest((current) => current + 1);
  }, [currentAtomId, focusAtom]);

  const handleTrajectorySelect = useCallback(
    (eventId: string, atomId?: string) => {
      setPlaying(false);
      setReplayMode(false);
      setConsoleOpen(true);
      setLogQueryResetToken((current) => current + 1);
      const event = activeEvents.find((candidate) => candidate.id === eventId);
      setSelectedAtomId(
        atomId || getAtomIdForEvent(event || null, platformId) || null,
      );
      setSelectedEventId(eventId);
      setTrajectoryLocateRequest((current) => current + 1);
      setLogLocateRequest((current) => current + 1);
    },
    [activeEvents, platformId],
  );

  /**
   * Jump to the other half of a closed pair from either view's link marker.
   * Both panels get a fresh locate request, so the LOG centers the partner row
   * and the trajectory reveals its atom at the same time. A log search could
   * hide that row, so the query is reset first — otherwise the jump would
   * silently do nothing.
   */
  const handleLocatePairPartner = useCallback(
    (partnerId: string) => {
      setPlaying(false);
      setReplayMode(false);
      setConsoleOpen(true);
      setLogQueryResetToken((current) => current + 1);
      const event = activeEvents.find(
        (candidate) => candidate.id === partnerId,
      );
      setSelectedAtomId(
        getAtomIdForEvent(event || null, platformId) || null,
      );
      setSelectedEventId(partnerId);
      setTrajectoryLocateRequest((current) => current + 1);
      setLogLocateRequest((current) => current + 1);
    },
    [activeEvents, platformId],
  );

  const handleCanvasSelectNode = useCallback(
    (node: HarnessNode) => {
      const deselecting = selectedAtomId === node.id;
      setPlaying(false);
      setReplayMode(false);
      setSelectedAtomId((current) => toggleAtomSelection(current, node.id));
      const boundEvent = node.data.endEvent || node.data.event;
      setSelectedEventId(deselecting ? "" : boundEvent?.id || "");
    },
    [selectedAtomId],
  );

  const handleReplaySeek = useCallback((index: number) => {
    // Seeking truncates the displayed event prefix and rebuilds the flow;
    // run the derived work as a transition so rapid clicks stay responsive.
    startTransition(() => {
      setSelectedAtomId(undefined);
      setReplayMode(true);
      setPlaying(false);
      setReplayCursor(index);
    });
  }, []);

  const handleReplayRestart = useCallback(() => {
    startTransition(() => {
      setSelectedAtomId(undefined);
      setReplayMode(true);
      setReplayCursor(0);
      setPlaying(true);
    });
  }, []);

  const handleReplayTogglePlay = useCallback(() => {
    startTransition(() => {
      setSelectedAtomId(undefined);
      if (!replayMode || replayCursor >= activeEvents.length - 1) {
        setReplayMode(true);
        setReplayCursor(0);
        setPlaying(true);
        return;
      }
      setPlaying((current) => !current);
    });
  }, [activeEvents.length, replayCursor, replayMode]);

  /*
   * "Live" means "follow the execution I am looking at". When the open run is
   * itself live, resuming must stay on it (and jump to its newest event);
   * otherwise it has to land on the run that is executing right now — not on
   * `filteredSessions[0]`, which is the newest *start* and therefore never a
   * resumed run, so a Live click used to dead-end on another finished run
   * while the executing one kept running. Either way the atom selection is
   * cleared, which is what puts the canvas pulse back on the executing atom.
   *
   * The jump stays inside the selected agent: `liveSessionKeys` and the pool
   * are both agent-scoped, so pressing Live with nothing running here must not
   * open a run whose row this list does not show.
   */
  const handleReplayExit = useCallback(() => {
    startTransition(() => {
      const liveSession = filteredSessions.find((session) =>
        liveSessionKeys.has(session.key),
      );
      const targetSession =
        activeSession && promptExecuting
          ? activeSession
          : liveSession ?? filteredSessions[0];
      if (!targetSession) {
        return;
      }
      const targetPromptRuns =
        promptRunsBySession.get(targetSession.key) ?? [];
      const targetPromptRun = targetPromptRuns.at(-1);
      const targetEvents =
        targetPromptRun?.events ?? targetSession.events ?? activeEvents;
      setActiveSessionKey(targetSession.key);
      setActivePromptRunKey(targetPromptRun?.key || "");
      setSelectedEventId(targetEvents.at(-1)?.id || "");
      setSelectedAtomId(undefined);
      setPlaying(false);
      setReplayMode(false);
      setReplayCursor(Math.max(0, targetEvents.length - 1));
    });
  }, [
    activeEvents,
    activeSession,
    filteredSessions,
    liveSessionKeys,
    promptExecuting,
    promptRunsBySession,
  ]);

  // Widening the window is usually pure filtering over already-loaded
  // sessions. When the service only shipped the previous window (or says it
  // truncated older history), widening it also re-subscribes for a snapshot
  // that reaches further back; the stream commits it in one transition.
  const handleLoadMoreRunHistory = useCallback(() => {
    const next = Math.min(
      historyTruncated && runHistoryHours < maxStreamWindowHours
        ? runHistoryHours * 2
        : nextRunHistoryVisibleHours(filteredSessions, now, runHistoryHours),
      maxStreamWindowHours,
    );
    if (next <= runHistoryHours) {
      return;
    }
    setRunHistoryHours(next);
    if (next > streamWindowHoursRef.current) {
      // The next snapshot is a superset of what is on screen: drop the cursor
      // (a tail replay would only add new events) and the snapshot key (the
      // server must not answer `reset-same` for a narrower window).
      streamWindowHoursRef.current = next;
      resumeCursorRef.current = "";
      snapshotKeyRef.current = "";
      forceSnapshotRef.current = true;
      reloadingRef.current = true;
      setReloadingEvents(true);
      setStreamEpoch((current) => current + 1);
    }
  }, [filteredSessions, historyTruncated, now, runHistoryHours]);

  /**
   * The console is deliberately between snapshots: a restart is waiting for
   * the successor process to bind the port, or a forced snapshot is in flight.
   * Neither is a dropped connection, so the header must not say `offline`.
   */
  const reconnecting = restarting || reloadingEvents;

  // Manual "load latest" for RUN HISTORY: drop the resume cursor and
  // re-subscribe the stream so the server answers with the full snapshot it
  // currently holds. A historical session that resumed execution but whose
  // new events never made it over a broken stream reappears with its real
  // live status, and the list otherwise catches up with everything the
  // recorder has written since the page loaded.
  const handleReloadLatestEvents = useCallback(() => {
    if (reloadingEvents) {
      return;
    }
    reloadingRef.current = true;
    setReloadingEvents(true);
    resumeCursorRef.current = "";
    forceSnapshotRef.current = true;
    setStreamEpoch((current) => current + 1);
  }, [reloadingEvents]);

  /*
   * Resume after the sync budget stopped the stream. The missed tail is pulled
   * as a fresh snapshot rather than replayed event by event: appending hours of
   * deltas would grow the very array the budget capped, while the snapshot is
   * the current state the list wants anyway. Restarting the local service does
   * the same reset from the other side.
   */
  const resumeSync = useCallback(() => {
    setSyncStartedAt(Date.now());
    setSyncStopped(false);
    handleReloadLatestEvents();
  }, [handleReloadLatestEvents]);

  /*
   * Sync budget. One timeout, re-armed only when the cap or the start of the
   * current sync window changes — no interval, so an idle console costs
   * nothing. When it fires, the stream effect closes its EventSource, which
   * is what stops the appending, the re-derivation and the memory growth;
   * the header chip then offers to resume.
   *
   * The cap is wall-clock from the sync start, so a pause stops the counting
   * too: no timer is armed while `syncStopped`, and the clock only starts
   * over on a resume. Changing the cap re-arms the timer for the time left
   * under the new cap; when the cap moves while the budget had stopped the
   * stream and the new cap still holds — `off` included — the pause lifts
   * through the same reset `resumeSync` performs, so the new cap takes
   * effect without a second click.
   */
  useEffect(() => {
    if (isDemo) {
      return undefined;
    }
    const delay = getSyncStopDelay(syncStartedAt, maxSyncHours, Date.now());
    if (capChangeResumesSync(syncStopped, delay)) {
      resumeSync();
      return undefined;
    }
    if (delay === null) {
      // No cap configured: make sure a previously armed stop is lifted.
      setSyncStopped(false);
      return undefined;
    }
    if (delay <= 0) {
      setSyncStopped(true);
      return undefined;
    }
    const timer = window.setTimeout(() => setSyncStopped(true), delay);
    return () => window.clearTimeout(timer);
  }, [isDemo, maxSyncHours, resumeSync, syncStartedAt, syncStopped]);

  const headerNavActions: ReadonlyArray<HeaderNavAction> = [
    {
      id: "import",
      label: "Import run",
      icon: FileInput,
      run: () => fileInputRef.current?.click(),
    },
    {
      id: "export",
      label: "Export run",
      icon: Download,
      disabled: !activeSession,
      run: exportTrace,
    },
    {
      id: "clear",
      label: "Clear local events",
      icon: Trash2,
      danger: true,
      run: () => {
        void clearEvents();
      },
    },
    {
      id: "restart",
      label: "Restart service",
      icon: RefreshCw,
      run: () => {
        void restartDashboard();
      },
    },
  ];

  return (
    <main
      className="studio-shell"
      data-history-truncated={historyTruncated ? "true" : "false"}
      data-history-window={runHistoryHours}
    >
      <header className="studio-header">
        <div className="studio-brand">
          <span className="brand-mark">
            <Boxes />
          </span>
          <div className="studio-brand__copy">
            <span className="studio-brand__title">
              <strong>ASTRO</strong>
              <span className="studio-brand__version">{`v${appVersion}`}</span>
            </span>
            <small>AGENT STATE TRACE &amp; RUNTIME OBSERVATIONS</small>
          </div>
          <div className="menu-control">
            <IconAction
              label="追踪操作"
              onClick={() => setMenuOpen((current) => !current)}
              aria-expanded={menuOpen}
              className={menuOpen ? "is-active" : ""}
            >
              <Menu />
            </IconAction>
            {menuOpen ? (
              <div className="action-menu">
                <HeaderNavActions
                  actions={headerNavActions}
                  onSelect={() => setMenuOpen(false)}
                />
              </div>
            ) : null}
          </div>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,.jsonl,application/json,application/x-ndjson"
          hidden
          onChange={(event) => {
            void importTrace(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
        <div className="observer-banner">
          <Radio />
          <div>
            <span className="eyebrow">ASTRO EVENT STREAM</span>
            <strong>
              {activeSession
                ? `Agent · ${activeSession.source} · ${activeEvents.length} events`
                : !eventsLoaded && !isDemo
                  ? "正在载入捕获事件…"
                  : "No captured events"}
            </strong>
          </div>
        </div>
        <div
          className="studio-header__actions"
          id={headerNavMenuId}
          ref={navMenuRef}
          data-open={navMenuOpen}
        >
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label="Search history"
            aria-haspopup="dialog"
            aria-pressed={historySearchOpen}
            className={cn(
              "history-search-trigger",
              historySearchOpen && "is-active",
            )}
            onClick={() => {
              setHistorySearchOpen(true);
              setNavMenuOpen(false);
            }}
          >
            <Search data-icon="inline-start" />
            <span>Search history</span>
            <kbd aria-hidden="true">⌘ + K</kbd>
          </Button>
          {reconnecting ? (
            // Between snapshots: the successor process is booting, or the
            // forced snapshot is in flight. This is not a dropped connection —
            // showing `offline` here made a successful restart look like a
            // failure for the ~8 s the new process needs to answer.
            <span
              className="run-status status-waiting"
              title={
                restarting
                  ? "正在重启本地服务，完成后会自动按当前筛选重新加载消息列表"
                  : "正在重新加载事件快照…"
              }
            >
              <i />
              {restarting ? "restarting" : "reloading"}
            </span>
          ) : syncStopped ? (
            // Spent budget, not a dropped socket: the chip becomes the way
            // back in, and says what happened in its tooltip. The restart
            // button in the service card does the same thing from its side.
            <button
              type="button"
              className="run-status status-paused"
              onClick={resumeSync}
              title={`已达最长同步时长（${getMaxSyncLabel(maxSync)}），已停止接收新事件 · 点击继续同步`}
            >
              <i />
              paused
            </button>
          ) : (
            <span
              className={cn(
                "run-status",
                connected
                  ? "status-complete"
                  : everConnected || isDemo
                    ? "status-offline"
                    : "status-waiting",
              )}
              title={
                connected
                  ? `事件流已连接 · 最新事件 ${
                      lastEventAt ? formatRunDate(lastEventAt) : "尚无"
                    }`
                  : everConnected
                    ? "事件流已断开，列表可能不是最新的"
                    : "正在连接事件流…"
              }
            >
              <i />
              {connected
                ? lastEventAt
                  ? `synced ${formatClock(lastEventAt).slice(0, 8)}`
                  : "accepted"
                : isDemo
                  ? "demo"
                  : everConnected
                    ? "offline"
                    : "connecting"}
            </span>
          )}
          {/* Not rendered — not just hidden — below the header breakpoint: a
              CSS-hidden trigger would leave its open popover orphaned on a
              resize. The nav panel keeps the restart action. */}
          {headerNavCollapsed ? null : (
            <ServiceStatus
              service={service}
              connected={connected}
              error={serviceError}
              restarting={restarting}
              syncPaused={syncStopped}
              onChangeDataRoot={changeDataRoot}
              onRestart={() => {
                void restartDashboard();
              }}
            />
          )}
          {/* One row of icon controls on desktop; kept as a group so the
              collapsed nav panel does not stack them one per line. The
              repository link closes the row — it is the only control that
              leaves the console, so it owns the far right edge. */}
          <div className="header-icon-group">
            <SettingsDialog
              activeView={activeView}
              consoleOpen={consoleOpen}
              deepView={deepView}
              historyOpen={historyOpen}
              historyRange={historyRange}
              liveView={liveFilter}
              maxSync={maxSync}
              perfHud={perfHud}
              theme={theme}
              onActiveViewChange={(view) => {
                setActiveView(view);
                if (view === "trajectory") {
                  setTrajectoryMounted(true);
                }
              }}
              onConsoleOpenChange={setConsoleOpen}
              onDeepViewChange={setDeepView}
              onHistoryOpenChange={setHistoryOpen}
              onHistoryRangeChange={setHistoryRange}
              onLiveViewChange={setLiveFilter}
              onMaxSyncChange={setMaxSync}
              onPerfHudChange={setPerfHud}
              onThemeChange={setTheme}
            />
            <ThemeSwitcher theme={theme} onChange={setTheme} />
            <RepositoryLink />
          </div>
          <div className="nav-menu__group">
            <HeaderNavActions
              actions={headerNavActions}
              onSelect={() => setNavMenuOpen(false)}
            />
          </div>
        </div>
        <IconAction
          ref={navToggleRef}
          label={navMenuOpen ? "关闭导航菜单" : "打开导航菜单"}
          className={cn("studio-header__nav-toggle", navMenuOpen && "is-active")}
          aria-expanded={navMenuOpen}
          aria-controls={headerNavMenuId}
          onClick={() =>
            navMenuOpen ? closeNavMenu(true) : setNavMenuOpen(true)
          }
        >
          {navMenuOpen ? <X /> : <Menu />}
        </IconAction>
      </header>

      {demoOptIn && isDemo ? (
        /* A production build renders the sample run only because the reader
           explicitly asked for it with ?demo=1 — make that unmistakable, or
           the sample would look indistinguishable from captured evidence. */
        <div className="studio-shell__sample-banner" role="status">
          <span className="studio-shell__sample-banner__eyebrow">
            示例数据
          </span>
          <span>
            当前展示的是本地示例会话（<code>?demo=1</code>），不是捕获到的真实
            Agent 运行。
          </span>
        </div>
      ) : null}

      <section
        className={cn(
          "studio-workspace",
          !historyOpen && "is-left-collapsed",
          !consoleOpen && "is-right-collapsed",
        )}
        onTransitionEnd={(event) => {
          if (event.propertyName === "grid-template-columns") {
            window.dispatchEvent(new Event("resize"));
          }
        }}
      >
        <aside className="history-column">
          <PanelToggle
            expanded={historyOpen}
            onToggle={() => setHistoryOpen((current) => !current)}
            side="left"
          />
          {historyOpen ? (
            <RunHistory
              sessions={visibleSessions}
              activeKey={activeSession?.key || ""}
              activePromptRunKey={activePromptRun?.key || ""}
              demoError={demoError}
              gitInfo={gitInfo}
              isDemo={isDemo}
              liveFilter={liveFilter}
              liveKeys={liveSessionKeys}
              now={now}
              promptRunsBySession={promptRunsBySession}
              canLoadMore={canLoadMoreHistory}
              initialLoading={!eventsLoaded && !isDemo}
              onLoadMore={handleLoadMoreRunHistory}
              onReloadLatest={handleReloadLatestEvents}
              onToggleLiveFilter={() => setLiveFilter((current) => !current)}
              rangeLabel={historyRangeLabel}
              reloading={reloadingEvents}
              onSelect={selectSession}
            />
          ) : (
            <span className="panel-rail-label">RUNS</span>
          )}
        </aside>

        <section className="canvas-column grid min-h-0 min-w-0 grid-rows-[48px_minmax(0,1fr)_62px]">
          <div className="canvas-toolbar flex min-w-0 items-center gap-2 border-b border-[var(--line)] px-2.5">
            <div className="toolbar-summary flex min-w-0 flex-1 flex-col">
              <span className="eyebrow">
                {activeView === "topology"
                  ? "EXECUTION TOPOLOGY"
                  : "RUN TRAJECTORY"}
              </span>
              <strong>{selectedAtom?.label || "Live execution"}</strong>
            </div>
            <div className="toolbar-actions flex min-w-0 items-center gap-1.5">
              {/* The picker shows the agent name and a chevron, so "切换智能体平台"
                  was a hover card that only restated the control. */}
              <div>
                <AgentSelect
                  liveAgents={liveAgentIds}
                  value={agentId}
                  onChange={(nextAgent) => {
                    // Switching agents re-filters run history and re-projects
                    // the whole flow for large sessions; keep the picker
                    // responsive by treating the derived work as a transition.
                    startTransition(() => {
                      setAgentId(nextAgent);
                      // Another agent starts at the configured default range:
                      // keeping a window the previous agent needed would
                      // silently load a different amount of history.
                      setRunHistoryHours(historyRangeHours);
                      if (nextAgent !== OTHERS_AGENT_ID) {
                        setPlatformId(nextAgent);
                      }
                      // The open run belongs to the scope that was just left.
                      // Dropping the selection lands the canvas, the log and
                      // the list on the new agent's newest message instead of
                      // leaving another agent's run on screen with no row to
                      // point at.
                      setActiveSessionKey("");
                      setActivePromptRunKey("");
                      setSelectedEventId("");
                      setSelectedAtomId(undefined);
                      setReplayMode(false);
                      setPlaying(false);
                    });
                  }}
                />
              </div>
              <div className="canvas-view-switch" role="group" aria-label="画布视图">
                <IconAction
                  label="拓扑视图"
                  className={activeView === "topology" ? "is-active" : ""}
                  aria-pressed={activeView === "topology"}
                  onClick={() => setActiveView("topology")}
                >
                  <Network />
                </IconAction>
                <IconAction
                  label="轨迹视图"
                  className={activeView === "trajectory" ? "is-active" : ""}
                  aria-pressed={activeView === "trajectory"}
                  onClick={() => {
                    setActiveView("trajectory");
                    setTrajectoryMounted(true);
                  }}
                >
                  <ListTree />
                </IconAction>
              </div>
              <IconAction
                label="原子与连线指南"
                aria-pressed={guideOpen}
                onClick={() => setGuideOpen(true)}
              >
                <CircleHelp />
              </IconAction>
              {activeView === "topology" ? (
                <IconAction
                  label={deepView ? "仅显示运行时原子" : "显示全部原子"}
                  aria-pressed={deepView}
                  className={deepView ? "is-active" : ""}
                  onClick={() => setDeepView((current) => !current)}
                >
                  <Sparkles />
                </IconAction>
              ) : null}
            </div>
          </div>

          <div className="runtime-canvas-stack relative min-h-0 min-w-0 overflow-hidden">
            <div
              aria-hidden={activeView !== "topology"}
              className={cn(
                "runtime-view-layer pointer-events-none invisible absolute inset-0 min-h-0 min-w-0",
                activeView === "topology" &&
                  "is-active pointer-events-auto visible",
              )}
            >
              <RuntimeCanvas
                activeAtomId={activeExecutionAtomId}
                activeEdgeIds={activeTransitionEdges}
                atomicEvents={atomicProjection.events}
                deepView={deepView}
                locateRequest={locateRequest}
                onSelectNode={handleCanvasSelectNode}
                selectedAtomId={currentAtomId}
                topology={harnessFlow}
              />
            </div>
            <div
              aria-hidden={activeView !== "trajectory"}
              className={cn(
                "runtime-view-layer pointer-events-none invisible absolute inset-0 min-h-0 min-w-0",
                activeView === "trajectory" &&
                  "is-active pointer-events-auto visible",
              )}
            >
              {trajectoryMounted ? (
                <TrajectoryView
                  atomNodes={harnessFlow.nodes}
                  atomicEvents={atomicProjection.events}
                  nodes={flow.nodes}
                  events={displayedEvents}
                  locateRequest={trajectoryLocateRequest}
                  selectedAtomId={currentAtomId}
                  selectedEventId={selectedEventId || ""}
                  selectedNodeId={selectedNodeId}
                  canLocateSelection={Boolean(locateAtomId && locateAtomEvent)}
                  onLocateSelection={locateTrajectorySelection}
                  onLocatePartner={handleLocatePairPartner}
                  onSelect={handleTrajectorySelect}
                />
              ) : null}
            </div>
          </div>

          <ReplayFooter
            events={activeEvents}
            cursor={replayCursor}
            live={liveActive}
            liveRun={liveSessionKeys.size > 0}
            playing={playing}
            speed={replaySpeed}
            onSeek={handleReplaySeek}
            onRestart={handleReplayRestart}
            onTogglePlay={handleReplayTogglePlay}
            onSpeedChange={setReplaySpeed}
            onExit={handleReplayExit}
          />
        </section>

        <aside className="log-column">
          <PanelToggle
            expanded={consoleOpen}
            onToggle={() => setConsoleOpen((current) => !current)}
            side="right"
          />
          {consoleOpen ? (
            <>
              <AtomicLog
                events={activeEvents}
                platformId={platformId}
                runningEventId={
                  executingLive && pendingEvent ? pendingEvent.id : ""
                }
                live={liveActive}
                selectedEventId={selectedEventId || ""}
                locateRequest={logLocateRequest}
                queryResetToken={logQueryResetToken}
                onSelect={handleLogSelect}
                onLocatePartner={handleLocatePairPartner}
                canLocateSelectedAtom={Boolean(currentAtomId)}
                onLocateSelectedAtom={handleLogLocateAtom}
              />
              <TraceInspector
                activeTab={inspectorTab}
                node={selectedNode}
                event={selectedEvent}
                atom={selectedAtom}
                index={selectedEventIndex}
                onActiveTabChange={setInspectorTab}
              />
            </>
          ) : (
            <span className="panel-rail-label">EVENTS</span>
          )}
        </aside>
      </section>

      <AtomGuide
        open={guideOpen}
        onOpenChange={setGuideOpen}
        platformId={platformId}
        onLocate={focusAtom}
      />
      {historySearchMounted ? (
        <Suspense
          fallback={
            <div
              aria-live="polite"
              className="history-search history-search--pending"
              role="status"
            >
              <span>
                <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                正在打开搜索…
              </span>
            </div>
          }
        >
          <LazyHistorySearch
            defaultAgent={agentId}
            defaultRange={historyRange}
            open={historySearchOpen}
            onOpenChange={setHistorySearchOpen}
            onSelect={selectHistorySearchResult}
            promptRunsBySession={promptRunsBySession}
            sessions={sessions}
          />
        </Suspense>
      ) : null}
      <ConsoleNotices notices={notices} onDismiss={dismissNotice} />
    </main>
  );
}
