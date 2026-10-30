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
  memo,
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
  PointerEvent as ReactPointerEvent,
  ReactNode,
  RefObject,
} from "react";
import { JsonViewer } from "./components/json-viewer";
import { HistorySearch } from "./components/history-search";
import { AgentSelect } from "./components/agent-select";
import { PromptContent } from "./components/prompt-content";
import { RuntimeCanvas } from "./components/runtime-canvas";
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
  legacyStorageKeys,
  panelHeaderClass,
  panelHeaderCopyClass,
  shouldShowDemo,
  storageKeys,
  themeOptions,
  trajectoryKeyLabels,
  trajectoryKindLabels,
  trajectoryLanes,
  type ActiveView,
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
  createDemoEvents,
  createSessionProjection,
  eventMeta,
  formatDuration,
  getEventSummary,
  getExecutionInstruction,
  getFlowNodeIdForEvent,
  getSessionDisplayState,
  normalizeTraceEvent,
  parseImportedTrace,
} from "./lib/trace-model";
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
  resolveScrollTopForRow,
} from "./lib/log-window";
import {
  describeWorkspacePath,
} from "./lib/workspace-path";
import {
  DEFAULT_RUN_HISTORY_DAYS,
  OTHERS_AGENT_ID,
  canLoadMoreRunHistoryDays,
  filterSessionsByAgent,
  nextRunHistoryVisibleDays,
  pinLiveRunHistory,
  selectVisibleRunHistory,
} from "./lib/run-history-window";
import { atomLevel, projectTraceEvents } from "./lib/atomic-projection";
import {
  buildTraceTurnIndex,
  buildTrajectoryMapSlots,
  buildTrajectoryModel,
  getTrajectorySegmentPosition,
  orderTrajectoryNewestFirst,
  type TrajectoryAtom,
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
import {
  collectLiveRunKeys,
  ensureExpandedRun,
  filterSessionsByLiveKeys,
  getPromptAtomSelection,
  getRunFreshness,
  getRunHistoryDisplayState,
  getRunHistoryTerminalInfo,
  isLiveRunStatus,
  RUN_HISTORY_COARSE_REFRESH_MS,
  runTerminalReasonLabels,
  quantizeTimestamp,
  toggleExpandedRun,
} from "./lib/run-history-state";
import {
  attachScrollFpsTracker,
  markAppReady,
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

function buildLogEntries(events: TraceEvent[]) {
  const turnByEventId = buildTraceTurnIndex(events);
  return events.map((event, index) => ({
    event,
    index,
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
    <Tooltip>
      <Select
        value={theme}
        onValueChange={(value) => onChange(value as Theme)}
      >
        <TooltipTrigger asChild>
          <SelectTrigger
            size="sm"
            className="theme-select"
            aria-label={`颜色主题：${activeTheme.label}`}
          >
            <SelectValue>
              <ActiveIcon />
            </SelectValue>
          </SelectTrigger>
        </TooltipTrigger>
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
      <TooltipContent side="bottom">切换主题</TooltipContent>
    </Tooltip>
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
  return milliseconds < 1_000
    ? `${Math.round(milliseconds)}ms`
    : formatDuration(milliseconds);
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
  onRestart,
  restarting,
  service,
}: {
  connected: boolean;
  error: string;
  onRestart: () => void;
  restarting: boolean;
  service: ServiceHealth | null;
}) {
  const [now, setNow] = useState(() => Date.now());
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
  const liveCount = (counts.active ?? 0) + (counts.waiting ?? 0);

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
      <PopoverContent align="end" className="service-card">
        <header>
          <span className="eyebrow">LOCAL SERVICE</span>
          <strong>
            {error
              ? "服务不可达"
              : connected
                ? "运行中 · 流已连接"
                : "运行中 · 流未连接"}
          </strong>
        </header>
        <dl>
          <div>
            <dt>已运行</dt>
            <dd>{service ? formatDuration(uptime) : "--"}</dd>
          </div>
          <div>
            <dt>启动耗时</dt>
            <dd>{service ? formatBootDuration(service.bootMs) : "--"}</dd>
          </div>
          <div>
            <dt>启动于</dt>
            <dd>{service ? formatRunDate(service.startedAt) : "--"}</dd>
          </div>
          <div>
            <dt>PID · 端口</dt>
            <dd>
              {service ? `${service.pid} · ${service.port}` : "--"}
            </dd>
          </div>
          <div>
            <dt>版本</dt>
            <dd>
              {service ? `${service.build} · node ${service.node}` : "--"}
            </dd>
          </div>
          <div>
            <dt>重启次数</dt>
            <dd>{service ? service.restartCount : 0}</dd>
          </div>
          <div>
            <dt>事件</dt>
            <dd>
              {service ? service.eventCount.toLocaleString() : "--"} ·{" "}
              {service ? service.traceFiles.length : 0} files
            </dd>
          </div>
          <div>
            <dt>会话</dt>
            <dd>
              {service
                ? `${liveCount} live · ${counts.complete ?? 0} complete · ${
                    counts.failed ?? 0
                  } failed · ${counts.terminated ?? 0} terminated`
                : "--"}
            </dd>
          </div>
          <div>
            <dt>数据目录</dt>
            <dd title={service?.dataRoot}>{service?.dataRoot || "--"}</dd>
          </div>
        </dl>
        {error ? <p className="service-card__error">{error}</p> : null}
        <p className="service-card__hint">
          重启会保留当前端口，页面与事件流会自动重连。
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
    const displayState = getSessionDisplayState(
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
  };

  return (
    <article
      className={cn(
        "run-history__item",
        activeGroup && "is-active-group",
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
      {expanded ? (
        <ScrollArea
          id={promptListId}
          className="run-history__prompt-scroll"
          style={{
            height: Math.min(
              appLayout.historyPromptListMaxHeight,
              promptRuns.length * appLayout.historyPromptRowEstimate + 8,
            ),
          }}
        >
          <ol className="run-history__prompts">
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
  gitInfo,
  initialLoading,
  isDemo,
  liveKeys,
  now,
  promptRunsBySession,
  onLoadMore,
  onReloadLatest,
  reloading,
  onSelect,
}: {
  sessions: TraceSession[];
  activeKey: string;
  activePromptRunKey: string;
  isDemo: boolean;
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
  /** True while the fresh snapshot has been requested but not delivered. */
  reloading: boolean;
  onSelect: (sessionKey: string, promptRunKey?: string) => void;
}) {
  const [expandedRuns, setExpandedRuns] = useState<Set<string>>(
    () => new Set(),
  );
  const [hoverCard, setHoverCard] = useState<RunHistoryHoverCard | null>(null);
  const activePromptRunRef = useRef<HTMLDivElement | null>(null);
  const hoverCardRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const hoverAnchorRef = useRef<HTMLElement | null>(null);
  const liveItemRef = useRef<HTMLElement | null>(null);
  // Loading one more day is only ever armed by a real scroll gesture. A list
  // that does not fill the panel keeps its bottom sentinel in view forever,
  // and an always-on observer would then load day after day without the user
  // asking for it. The explicit footer button covers the same need.
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
  const [liveFilter, setLiveFilter] = useState(false);
  const activePromptCount =
    promptRunsBySession.get(activeKey)?.length ?? 0;

  // Live summary for the header chip, derived from the same key set the app
  // uses to keep executing runs inside the window and pin them on top — one
  // definition of "executing" for the list, the chip, and the filter. Narrowed
  // to the rows actually rendered, so the chip can never point at a row that
  // is not in this list, and ordered like the list (pinned run first).
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

  // Filtering only ever narrows the *loaded* list, so switching the filter
  // off or loading more days can never lose a live row.
  const liveFiltering = liveFilter && liveSummary.count > 0;
  const displayedSessions = useMemo(
    () =>
      liveFiltering
        ? filterSessionsByLiveKeys(sessions, liveSummary.liveKeys)
        : sessions,
    [liveFiltering, liveSummary.liveKeys, sessions],
  );

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

  const toggleLiveFilter = useCallback(() => {
    if (liveFilter) {
      setLiveFilter(false);
      return;
    }
    // Entering the filter doubles as the jump: the first live row is the
    // natural anchor when the list suddenly gets much shorter.
    setLiveFilter(true);
    jumpToLiveRun();
  }, [liveFilter, jumpToLiveRun]);

  // The live set is derived from the currently loaded sessions; once every
  // live run has settled the filter would hold up nothing but an empty list.
  useEffect(() => {
    if (liveFilter && liveSummary.count === 0) {
      setLiveFilter(false);
    }
  }, [liveFilter, liveSummary.count]);

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

  // On-demand loading: reveal one more day of history when the sentinel near
  // the bottom of the list scrolls into view — but only after the user has
  // actually scrolled this list. Two guards keep a short list from loading on
  // its own: the sentinel is always visible when the content does not
  // overflow, and the observer re-arms only on the next scroll gesture.
  // While the `N LIVE` filter is armed the list is narrowed to the live rows,
  // so loading more history stays off until the filter clears.
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

  // Anything that changes which rows exist — another agent, another day,
  // another prompt, a collapsed thread, a switched live filter — invalidates
  // a card anchored to one of them. The list is re-derived on every clock
  // tick with a fresh array identity, so the effect keys off the row
  // signature instead of the array.
  const rowSignature = displayedSessions
    .map(
      (session) =>
        `${session.key}:${promptRunsBySession.get(session.key)?.length ?? 0}`,
    )
    .join("|");
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
          <strong>{sessions.length} runs</strong>
        </div>
        <div className="run-history__header-meta">
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
          {liveSummary.count > 0 ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    "run-history__live-jump",
                    liveFiltering && "is-filtering",
                  )}
                  aria-pressed={liveFiltering}
                  aria-label={
                    liveFiltering
                      ? `取消筛选活动消息（${liveSummary.count} 条）`
                      : `只看正在执行的消息（${liveSummary.count} 条）`
                  }
                  onClick={toggleLiveFilter}
                >
                  <Radio aria-hidden="true" />
                  <span>{liveSummary.count} LIVE</span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {liveFiltering ? "取消筛选活动消息" : "只看正在执行的消息"}
              </TooltipContent>
            </Tooltip>
          ) : null}
        </div>
      </header>
      <div
        className="run-history__list min-h-0 overflow-auto p-1.5"
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
          sessions={displayedSessions}
        />
        {initialLoading ? (
          <div className="run-history__loading" aria-busy="true">
            <Loader2 className="size-4 animate-spin" />
            <span>LOADING RUNS…</span>
          </div>
        ) : sessions.length === 0 ? (
          <output className="run-history__empty">No runs in this window</output>
        ) : displayedSessions.length === 0 ? (
          <output className="run-history__empty">
            没有正在执行的消息
          </output>
        ) : null}
        {canLoadMore ? (
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
              title="滚动到底部或点击可加载更早的运行记录"
            >
              LOAD EARLIER DAYS
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
 * One virtualized log row. Memoized on (event, index, selected, running): a
 * streaming batch, a selection change, or a running-marker move then only
 * re-renders the rows whose own state moved instead of re-reconciling every
 * visible row. The `onSelect` dispatch reaches the row through a latest ref
 * so the memo comparator can ignore its identity, and the derived strings
 * (event key, action, summary, formatted time) are computed once per mount —
 * `getEventSummary` additionally caches per event across re-mounts.
 */
const AtomicLogRow = memo(function AtomicLogRow({
  event,
  index,
  onSelect,
  running,
  selected,
}: {
  event: TraceEvent;
  index: number;
  onSelect: (eventId: string) => void;
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
      )}
      onClick={() => onSelectRef.current(event.id)}
      onKeyDown={(keyEvent) => {
        if (keyEvent.key === "Enter" || keyEvent.key === " ") {
          keyEvent.preventDefault();
          onSelectRef.current(event.id);
        }
      }}
    >
      <span className="log-sequence">
        #{String(index + 1).padStart(3, "0")}
      </span>
      <i className="phase-dot" />
      <strong>{getTraceEventKey(event)}</strong>
      <time dateTime={event.capturedAt} title={event.capturedAt}>
        <span>{dateLabel}</span>
        {clockLabel}
      </time>
      <small>
        <span>{getEventAction(event)}</span>
        <span className="atomic-log__summary">
          {getEventSummary(event)}
        </span>
      </small>
    </div>
  );
}, (before, after) =>
  before.event === after.event &&
  before.index === after.index &&
  before.running === after.running &&
  before.selected === after.selected,
);

/**
 * The event log mounts only the rows intersecting the viewport, so a session
 * with tens of thousands of events stays responsive while streaming.
 */
const AtomicLog = memo(function AtomicLog({
  events,
  runningEventId,
  selectedEventId,
  locateRequest,
  query,
  onQueryChange,
  onSelect,
  onLocateSelectedAtom,
  canLocateSelectedAtom,
  live,
}: {
  events: TraceEvent[];
  runningEventId: string;
  selectedEventId: string;
  locateRequest: number;
  query: string;
  onQueryChange: (query: string) => void;
  onSelect: (eventId: string) => void;
  onLocateSelectedAtom: () => void;
  canLocateSelectedAtom: boolean;
  live: boolean;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const locateRequestRef = useRef(locateRequest);
  const scrollFrameRef = useRef(0);
  // Render-cost instrumentation: the body stamps its start time, and the
  // no-deps layout effect below closes the measurement after commit. The
  // samples feed `window.__astroPerf` (and the ?perf=1 HUD) so list render
  // cost is comparable before and after a change.
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
  // Mirror of `scrollPosition` used by the scroll handler: the up chevron
  // only appears once the reader has actually scrolled into older events, and
  // it stays until they are back near the newest ones. The gap between the
  // two thresholds is the hysteresis that stops it from flickering at the
  // boundary.
  const scrollStateRef = useRef({
    canScrollDown: false,
    canScrollUp: false,
  });
  // Filtering scans the cached haystacks, so repeated keystrokes stay cheap;
  // the cache itself is warmed below, outside the keystroke path.
  const visibleEntries = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const entries = buildLogEntries(events);
    const matched = needle
      ? entries.filter(({ event }) => matchesEventQuery(event, needle))
      : entries;
    return [...matched].reverse();
  }, [events, query]);

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
  const slice = layout.items.slice(range.start, range.end);

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
    locateRequestRef.current = locateRequest;
    const list = listRef.current;
    if (!list || !selectedEventId) {
      return;
    }
    const entryIndex = visibleEntries.findIndex(
      (entry) => entry.event.id === selectedEventId,
    );
    if (entryIndex < 0) {
      return;
    }
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
    list.scrollTo({ behavior: explicitLocate ? "smooth" : "auto", top: nextTop });
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
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search tools or text"
            aria-label="搜索事件日志"
          />
          <InputGroupAddon align="inline-start">
            <Search aria-hidden="true" />
          </InputGroupAddon>
        </InputGroup>
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
                    return (
                      <div
                        className="atomic-log__turn"
                        aria-label={`Turn ${item.turn}`}
                        key={`turn-${item.turn}`}
                      >
                        <span>TURN {String(item.turn).padStart(2, "0")}</span>
                      </div>
                    );
                  }
                  const { event, index } = visibleEntries[item.index];
                  return (
                    <AtomicLogRow
                      event={event}
                      index={index}
                      key={event.id}
                      onSelect={onSelect}
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
        {/* The up chevron appears once the reader has scrolled into older
            events (it jumps back to the newest ones) — while Live it doubles
            as "return to the stream", so it must not be suppressed. */}
        {scrollPosition.canScrollUp ? (
          <IconAction
            label={live ? "回到最新事件" : "滚动到顶部"}
            side="left"
            className="atomic-log__scroll-button atomic-log__scroll-button--top"
            onClick={() => scrollToEdge("top")}
          >
            <ChevronUp />
          </IconAction>
        ) : null}
        {scrollPosition.canScrollDown ? (
          <IconAction
            label="滚动到底部"
            side="left"
            className="atomic-log__scroll-button atomic-log__scroll-button--bottom"
            onClick={() => scrollToEdge("bottom")}
          >
            <ChevronDown />
          </IconAction>
        ) : null}
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
  onToggle,
  row,
  selected,
  showTurn = true,
}: {
  depth: number;
  expandable?: boolean;
  expanded?: boolean;
  onActivate: () => void;
  onToggle?: () => void;
  row: TrajectoryDisplayRow;
  selected: boolean;
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
      )}
      style={{ "--depth": depth } as CSSProperties}
      onClick={onActivate}
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
        {trajectoryKeyLabels[row.key] ??
          trajectoryKindLabels[row.kind] ??
          row.kind}
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
        <small>{formatDuration(row.duration)}</small>
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
    occurredAt: turn.occurredAt,
    status: turn.status,
    summary: turn.summary,
    tone: "reasoning",
    turn: turn.turn,
  };
}

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
  const allAtoms = useMemo(
    () => [
      ...model.context,
      ...model.turns.flatMap((turn) => turn.atoms),
    ],
    [model],
  );
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
                      title={`#${slot.start + 1}-${slot.end + 1} · ${slot.count} 个事件 · ${target.data.label}`}
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
      <div className="trajectory-list" ref={listRef}>
        {display.turns.map((turn) => {
          const isExpanded = expandedTurns.has(turn.turn);
          const loopRow = loopRowForTurn(turn);
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
                      row={atom}
                      selected={atom.id === selectedTrajectoryAtomId}
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
                row={atom}
                selected={atom.id === selectedTrajectoryAtomId}
                showTurn={false}
              />
            ))}
          </section>
        ) : null}
      </div>
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

function AtomGuide({
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
      <SheetContent className="atom-guide">
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
}

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
    source: params.get("source"),
    sessionId: params.get("session"),
    eventId: params.get("event"),
  };
}

function getPlatformForSource(source: string | null | undefined) {
  return atomPlatformOptions.find((platform) => platform.source === source)?.id;
}

export default function App() {
  // A hidden tab must not keep the SSE stream, the duration clock, or the
  // health poll running. Suspension only starts after a long hidden period;
  // becoming visible again re-runs the affected effects, which reconnect the
  // stream from the last event we hold and reset the clock.
  const pageVisibility = usePageVisibility();
  const pageSuspended = pageVisibility.suspended;
  const demoEvents = useMemo(
    () =>
      shouldShowDemo(0, import.meta.env)
        ? createDemoEvents()
        : [],
    [],
  );
  const [initialLocation, setInitialLocation] = useState<ReturnType<typeof getInitialLocation> | null>(
    getInitialLocation,
  );
  const [liveEvents, setLiveEvents] = useState<TraceEvent[]>([]);
  // Working directory → git presentation (repo name + branch), resolved by the
  // server from the closest `.git` and delivered with the snapshot plus one
  // `git` message per newly seen directory.
  const [gitInfo, setGitInfo] = useState<
    Record<string, { repo: string; branch: string } | null>
  >({});
  const [eventsLoaded, setEventsLoaded] = useState(false);
  const [importedEvents, setImportedEvents] = useState<TraceEvent[]>([]);
  const [connected, setConnected] = useState(false);
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
  // Set together with the reload above and consumed once by the stream
  // effect: a trace message landing between the click and the re-subscribe
  // would otherwise re-fill the resume cursor and silently downgrade the
  // full-snapshot reload into a tail replay.
  const forceSnapshotRef = useRef(false);
  // Last event the live stream delivered. A reconnect names it so the server
  // replays only the missed tail instead of re-sending the whole history.
  const resumeCursorRef = useRef("");
  const [service, setService] = useState<ServiceHealth | null>(null);
  const [serviceError, setServiceError] = useState("");
  const [restarting, setRestarting] = useState(false);
  const [query, setQuery] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [activeSessionKey, setActiveSessionKey] = useState("");
  const [activePromptRunKey, setActivePromptRunKey] = useState("");
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [selectedAtomId, setSelectedAtomId] =
    useState<AtomSelection>(undefined);
  const [activeView, setActiveView] = useState<ActiveView>(
    appDefaults.activeView,
  );
  // The trajectory view builds its turn model from every event and atom. That
  // is real work for a long run, so the view is mounted on first use instead
  // of on every session selection while the topology is what is on screen.
  const [trajectoryMounted, setTrajectoryMounted] = useState(
    appDefaults.activeView === "trajectory",
  );
  const [deepView, setDeepView] = useState<boolean>(appDefaults.deepView);
  const [guideOpen, setGuideOpen] = useState<boolean>(appDefaults.guideOpen);
  const [historySearchOpen, setHistorySearchOpen] = useState(false);
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
    const fromUrl = getPlatformForSource(initialLocation?.source);
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
  const [agentId, setAgentId] = useState<PlatformId | typeof OTHERS_AGENT_ID>(
    platformId,
  );
  const [runHistoryDays, setRunHistoryDays] = useState(
    DEFAULT_RUN_HISTORY_DAYS,
  );
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

  useEffect(() => {
    // A suspended tab drops the stream instead of buffering it: the server
    // stops writing to a page nobody is reading. The reconnect on resume
    // names the last event we hold, so the refresh replays only what was
    // missed — a full snapshot is reserved for the first load and for a
    // cursor the server no longer recognises.
    if (pageSuspended) {
      return undefined;
    }
    // A manual reload demands the full snapshot regardless of any trace
    // message that slipped in between the click and this re-subscribe.
    const forceSnapshot = forceSnapshotRef.current;
    forceSnapshotRef.current = false;
    const resumeCursor = forceSnapshot
      ? ""
      : resumeCursorRef.current;
    const source = new EventSource(
      resumeCursor
        ? `/api/stream?since=${encodeURIComponent(resumeCursor)}`
        : "/api/stream",
    );
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
    source.addEventListener("ready", () => setConnected(true));
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
        setReloadingEvents(false);
      });
    });
    source.addEventListener("reset", (message: MessageEvent<string>) => {
      const payload = JSON.parse(message.data) as {
        events: TraceEvent[];
        git?: Record<string, { repo: string; branch: string }>;
      };
      const events = payload.events.map(normalizeTraceEvent);
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
        setLiveEvents(events);
        setGitInfo(payload.git ?? {});
        setEventsLoaded(true);
        setReloadingEvents(false);
      });
    });
    source.onerror = () => {
      setConnected(false);
      // A failed reconnect must not leave the manual-reload control spinning
      // forever; EventSource keeps retrying and the next snapshot lands
      // whenever the server answers.
      setReloadingEvents(false);
    };
    source.onopen = () => setConnected(true);
    return () => {
      if (flushTimer !== null) {
        window.clearTimeout(flushTimer);
      }
      source.close();
      setConnected(false);
    };
  }, [pageSuspended, streamEpoch]);

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
  const isDemo = shouldShowDemo(allEvents.length, import.meta.env);
  const visibleEvents = isDemo ? demoEvents : allEvents;
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
  // RUN HISTORY is narrowed to the selected agent first; the day window and
  // the live pinning below are applied to that set.
  const filteredSessions = useMemo(
    () => filterSessionsByAgent(sessions, agentId, configuredSources),
    [agentId, configuredSources, sessions],
  );
  /**
   * Sessions whose message is executing right now. Derived once here because
   * three things must agree on it: keeping the live run inside the visible
   * window, pinning it to the top of the list, and the `N LIVE` chip / filter
   * the panel derives from the same set.
   */
  const liveSessionKeys = useMemo(() => {
    if (isDemo) {
      return new Set<string>();
    }
    return collectLiveRunKeys(
      filteredSessions,
      promptRunsBySession,
      now,
      appTimings.activeRunTimeoutMs,
    );
  }, [filteredSessions, isDemo, now, promptRunsBySession]);
  // Runs shown in RUN HISTORY: narrowed to the selected agent, then to the
  // visible day window (most recent N days), then the executing run is pinned
  // to the top — a resumed session is live *now*, even though it started
  // earlier. Everything is derived at render time.
  const visibleSessions = useMemo(
    () =>
      pinLiveRunHistory(
        selectVisibleRunHistory(
          filteredSessions,
          now,
          runHistoryDays,
          liveSessionKeys,
        ),
        liveSessionKeys,
      ),
    [filteredSessions, liveSessionKeys, now, runHistoryDays],
  );
  const canLoadMoreRunHistory =
    canLoadMoreRunHistoryDays(filteredSessions, now, runHistoryDays);
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
          const promptState = getSessionDisplayState(
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
    const deepLinkedSession = sessions.find(
      (session) =>
        session.id === requested?.sessionId &&
        (!requested?.source || session.source === requested.source),
    );
    const currentSession = sessions.find(
      (session) => session.key === activeSessionKey,
    );
    const nextSession = currentSession || deepLinkedSession || sessions[0];
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
    eventsLoaded,
    initialLocation,
    platformId,
    promptRunsBySession,
    sessions,
  ]);

  const activeSession =
    sessions.find((session) => session.key === activeSessionKey) || sessions[0];
  const activePromptRuns =
    promptRunsBySession.get(activeSession?.key || "") ?? [];
  const activePromptRun =
    activePromptRuns.find((run) => run.key === activePromptRunKey) ||
    activePromptRuns.at(-1);
  const latestPromptRun = activePromptRuns.at(-1);
  const activeEvents =
    activePromptRun?.events ?? activeSession?.events ?? EMPTY_EVENTS;
  const activeDisplayState = activePromptRun
    ? getSessionDisplayState(
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
    params.set("source", activeSession.source);
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
  }, [activeSession, initialLocation, selectedEventId]);

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
      setQuery("");
      setReplayMode(false);
      setPlaying(false);
    },
    [promptRunsBySession, sessionsByKey],
  );

  const selectHistorySearchResult = (entry: HistorySearchEntry) => {
    const targetPlatform = getPlatformForSource(entry.source) ?? platformId;
    preserveAtomSelectionRef.current = targetPlatform !== platformId;
    setPlatformId(targetPlatform);
    setActiveSessionKey(entry.sessionKey);
    setActivePromptRunKey(entry.promptRunKey);
    setSelectedEventId(entry.eventId);
    setSelectedAtomId(
      getAtomIdForEvent(entry.event, targetPlatform) || null,
    );
    setActiveView("topology");
    setHistoryOpen(true);
    setConsoleOpen(true);
    setQuery("");
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
      setImportedEvents((current) =>
        [...new Map([...current, ...imported].map((event) => [event.id, event])).values()],
      );
    } catch (error) {
      window.alert(`Import failed: ${error instanceof Error ? error.message : String(error)}`);
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
        const response = await fetch("/api/events", { method: "DELETE" });
        if (!response.ok) throw new Error(`Server returned ${response.status}`);
      }
      // The SSE reset is ordered with new traces; the HTTP response is not.
      setImportedEvents((current) => current.filter((event) => !importedIds.has(event.id)));
    } catch (error) {
      window.alert(`Clear failed: ${error instanceof Error ? error.message : String(error)}`);
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
        const response = await fetch("/api/health", { cache: "no-store" });
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
  }, [pageSuspended]);

  // Restart the local dashboard service in place. The server spawns a
  // successor that re-binds the same port and then exits; this poll waits for
  // a different pid to answer before re-subscribing the event stream, so the
  // UI never keeps consuming the dying process's stream.
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
      const response = await fetch("/api/restart", { method: "POST" });
      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }
      const deadline = Date.now() + 20_000;
      for (;;) {
        await new Promise((resolve) => setTimeout(resolve, 400));
        try {
          const health = await fetch("/api/health", { cache: "no-store" });
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
      setStreamEpoch((current) => current + 1);
    } catch (error) {
      window.alert(
        `Restart failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setRestarting(false);
    }
  };

  const focusAtom = useCallback(
    (atomId: string) => {
      const node = harnessFlow.nodes.find((item) => item.id === atomId);
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
    [harnessFlow.nodes],
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
    setQuery("");
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
  }, [currentAtomId, focusAtom]);

  const handleTrajectorySelect = useCallback(
    (eventId: string, atomId?: string) => {
      setPlaying(false);
      setReplayMode(false);
      setConsoleOpen(true);
      setQuery("");
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
   * `sessions[0]`, which is the newest *start* and therefore never a resumed
   * run, so a Live click used to dead-end on another finished run while the
   * executing one kept running. Either way the atom selection is cleared,
   * which is what puts the canvas pulse back on the executing atom.
   */
  const handleReplayExit = useCallback(() => {
    startTransition(() => {
      const liveSession = sessions.find((session) =>
        liveSessionKeys.has(session.key),
      );
      const targetSession =
        activeSession && promptExecuting
          ? activeSession
          : liveSession ?? sessions[0];
      const targetPromptRuns =
        promptRunsBySession.get(targetSession?.key || "") ?? [];
      const targetPromptRun = targetPromptRuns.at(-1);
      const targetEvents =
        targetPromptRun?.events ?? targetSession?.events ?? activeEvents;
      if (targetSession && targetSession.key !== activeSession?.key) {
        setActiveSessionKey(targetSession.key);
      }
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
    liveSessionKeys,
    promptExecuting,
    promptRunsBySession,
    sessions,
  ]);

  // Loading one more day is pure filtering over already-loaded sessions, so it
  // is synchronous: the previous implementation faked a 320ms "loading" state
  // on top of instantaneous work, which made the list feel slower than it is.
  const handleLoadMoreRunHistory = useCallback(() => {
    setRunHistoryDays((current) =>
      nextRunHistoryVisibleDays(filteredSessions, now, current),
    );
  }, [filteredSessions, now]);

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
    setReloadingEvents(true);
    resumeCursorRef.current = "";
    forceSnapshotRef.current = true;
    setStreamEpoch((current) => current + 1);
  }, [reloadingEvents]);

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
    <main className="studio-shell">
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
              {activeSession ? `Agent · ${activeSession.source} · ${activeEvents.length} events` : "No captured events"}
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
          <span
            className={cn(
              "run-status",
              connected ? "status-complete" : "status-offline",
            )}
            title={
              connected
                ? `事件流已连接 · 最新事件 ${
                    lastEventAt ? formatRunDate(lastEventAt) : "尚无"
                  }`
                : "事件流已断开，列表可能不是最新的"
            }
          >
            <i />
            {connected
              ? lastEventAt
                ? `synced ${formatClock(lastEventAt).slice(0, 8)}`
                : "accepted"
              : isDemo
                ? "demo"
                : "offline"}
          </span>
          {/* Not rendered — not just hidden — below the header breakpoint: a
              CSS-hidden trigger would leave its open popover orphaned on a
              resize. The nav panel keeps the restart action. */}
          {headerNavCollapsed ? null : (
            <ServiceStatus
              service={service}
              connected={connected}
              error={serviceError}
              restarting={restarting}
              onRestart={() => {
                void restartDashboard();
              }}
            />
          )}
          <ThemeSwitcher theme={theme} onChange={setTheme} />
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
              gitInfo={gitInfo}
              isDemo={isDemo}
              liveKeys={liveSessionKeys}
              now={now}
              promptRunsBySession={promptRunsBySession}
              canLoadMore={canLoadMoreRunHistory}
              initialLoading={!eventsLoaded && !isDemo}
              onLoadMore={handleLoadMoreRunHistory}
              onReloadLatest={handleReloadLatestEvents}
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
              <Tooltip>
                <TooltipTrigger asChild>
                  <div>
                    <AgentSelect
                      value={agentId}
                      onChange={(nextAgent) => {
                        // Switching agents re-filters run history and
                        // re-projects the whole flow for large sessions; keep
                        // the picker responsive by treating the derived work
                        // as a transition.
                        startTransition(() => {
                          setAgentId(nextAgent);
                          setRunHistoryDays(DEFAULT_RUN_HISTORY_DAYS);
                          if (nextAgent !== OTHERS_AGENT_ID) {
                            setPlatformId(nextAgent);
                          }
                        });
                      }}
                    />
                  </div>
                </TooltipTrigger>
                <TooltipContent side="bottom">切换智能体平台</TooltipContent>
              </Tooltip>
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
                runningEventId={
                  executingLive && pendingEvent ? pendingEvent.id : ""
                }
                live={liveActive}
                selectedEventId={selectedEventId || ""}
                locateRequest={logLocateRequest}
                query={query}
                onQueryChange={setQuery}
                onSelect={handleLogSelect}
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
      <HistorySearch
        open={historySearchOpen}
        onOpenChange={setHistorySearchOpen}
        onSelect={selectHistorySearchResult}
        promptRunsBySession={promptRunsBySession}
        sessions={sessions}
      />
    </main>
  );
}
