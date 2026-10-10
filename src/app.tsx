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
  FileInput,
  Focus,
  Layers,
  ListTree,
  LocateFixed,
  Loader2,
  Menu,
  Network,
  Pause,
  Play,
  Radio,
  RotateCcw,
  Search,
  SkipBack,
  SkipForward,
  Sparkles,
  TerminalSquare,
  Trash2,
} from "lucide-react";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  ComponentProps,
  CSSProperties,
  ReactNode,
} from "react";
import { JsonViewer } from "./components/json-viewer";
import { HistorySearch } from "./components/history-search";
import { PlatformIcon } from "./components/platform-icon";
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
  atomPlatformOptions,
  getAtomIdForEvent,
  getAtomPlatformConfig,
} from "./config/atom-platforms";
import {
  buildSessionPromptRuns,
  buildFlow,
  buildHarnessFlow,
  buildSessions,
  createDemoEvents,
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
import {
  buildHistorySearchIndex,
  type HistorySearchEntry,
} from "./lib/history-search";
import {
  DEFAULT_RUN_HISTORY_DAYS,
  OTHERS_AGENT_ID,
  canLoadMoreRunHistoryDays,
  filterSessionsByAgent,
  nextRunHistoryVisibleDays,
  selectVisibleRunHistory,
} from "./lib/run-history-window";
import { atomLevel, projectTraceEvents } from "./lib/atomic-projection";
import {
  buildTraceTurnIndex,
  buildTrajectoryModel,
  getTrajectorySegmentPosition,
  type TrajectoryAtom,
  type TrajectoryTurn,
} from "./lib/trajectory-model";
import {
  type AtomSelection,
  isFollowingLive,
  isPromptExecuting,
  resolveLocateAtomId,
  resolveSelectedAtomId,
  toggleAtomSelection,
} from "./lib/atom-selection";
import {
  ensureExpandedRun,
  getPromptAtomSelection,
  getRunHistoryDisplayState,
  toggleExpandedRun,
} from "./lib/run-history-state";
import {
  getTraceEventKey,
  isUserQuestionEvent,
  isUserQuestionStartEvent,
} from "./lib/trace-event-kind";
import type {
  HarnessNode,
  HarnessNodeData,
  PlatformId,
  SignalEdge,
  TraceEvent,
  TraceNode as TraceNodeType,
  TracePromptRun,
  TraceSession,
} from "@/types/trace";

type InspectorTab = "input" | "output" | "raw";
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

function formatClock(timestamp: string | number) {
  return new Date(timestamp).toLocaleTimeString([], {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
  });
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
  return `${formatDate(timestamp)} ${new Date(timestamp).toLocaleTimeString([], {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })}`;
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

type RunHistoryRowDetails = {
  code: string;
  duration: number;
  extraLabel: string;
  extraValue: string | number;
  source: string;
  start: number;
  status: "demo" | TraceSession["status"];
  title: string;
};

function RunHistoryRowContent({
  code,
  duration,
  extraLabel,
  extraValue,
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
        <small>{formatRunDate(start)}</small>
        <span className="run-history__tags">
          <span>
            AGENT <b>{source}</b>
          </span>
          <span>
            STATUS <b>{status}</b>
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

function RunHistoryTooltipContent({
  code,
  duration,
  extraLabel,
  extraValue,
  source,
  start,
  status,
  title,
}: RunHistoryRowDetails) {
  return (
    <TooltipContent side="right" align="start" collisionPadding={12}>
      <div className="run-history__tooltip">
        <strong>{title}</strong>
        <span>{formatRunDate(start)}</span>
        <span>{code}</span>
        <span>AGENT · {source}</span>
        <span>STATUS · {status}</span>
        <span>DURATION · {formatDuration(duration)}</span>
        <span>
          {extraLabel} · {extraValue}
        </span>
      </div>
    </TooltipContent>
  );
}

function RunHistory({
  sessions,
  activeKey,
  activePromptRunKey,
  canLoadMore,
  initialLoading,
  isDemo,
  loadingMore,
  now,
  promptRunsBySession,
  onLoadMore,
  onSelect,
}: {
  sessions: TraceSession[];
  activeKey: string;
  activePromptRunKey: string;
  isDemo: boolean;
  now: number;
  promptRunsBySession: ReadonlyMap<string, TracePromptRun[]>;
  canLoadMore: boolean;
  initialLoading: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  onSelect: (sessionKey: string, promptRunKey?: string) => void;
}) {
  const [expandedRuns, setExpandedRuns] = useState<Set<string>>(
    () => new Set(),
  );
  const activePromptRunRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const activePromptCount =
    promptRunsBySession.get(activeKey)?.length ?? 0;

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
  // the bottom of the list scrolls into view.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    const list = listRef.current;
    if (!canLoadMore || !sentinel || !list) {
      return undefined;
    }
    if (typeof IntersectionObserver === "undefined") {
      onLoadMore();
      return undefined;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          onLoadMore();
        }
      },
      { root: list, rootMargin: "160px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [canLoadMore, onLoadMore, sessions.length]);

  const toggleRun = (key: string) => {
    setExpandedRuns((current) => toggleExpandedRun(current, key));
  };

  return (
    <section className="run-history grid size-full min-h-0 grid-rows-[48px_minmax(0,1fr)]">
      <header className={panelHeaderClass}>
        <div className={panelHeaderCopyClass}>
          <span className="eyebrow">RUN HISTORY</span>
          <strong>{sessions.length} runs</strong>
        </div>
      </header>
      <div className="run-history__list min-h-0 overflow-auto p-1.5" ref={listRef}>
        {sessions.map((session) => {
          const promptRuns = promptRunsBySession.get(session.key) ?? [];
          const firstPromptRun = promptRuns[0];
          const displayState = getRunHistoryDisplayState(
            session,
            promptRuns,
            now,
            appTimings.activeRunTimeoutMs,
          );
          const displayStatus = displayState.status;
          const displayDuration = displayState.duration;
          const hasPromptThread = promptRuns.length > 1;
          const expanded = hasPromptThread && expandedRuns.has(session.key);
          const parentSelected =
            session.key === activeKey && !hasPromptThread;
          const activeGroup =
            session.key === activeKey && hasPromptThread;
          const promptListId = `run-prompts-${session.key.replace(
            /[^a-zA-Z0-9_-]+/g,
            "-",
          )}`;

          return (
            <article
              className={cn(
                "run-history__item",
                activeGroup && "is-active-group",
              )}
              key={session.key}
            >
              <Tooltip>
                <TooltipTrigger asChild>
                  <div
                    role="button"
                    tabIndex={0}
                    aria-pressed={parentSelected}
                    className={cn(
                      "run-history__row",
                      hasPromptThread && "has-prompt-thread",
                      parentSelected && "is-selected",
                    )}
                    onClick={() =>
                      onSelect(session.key, promptRuns.at(-1)?.key)
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onSelect(session.key, promptRuns.at(-1)?.key);
                      }
                    }}
                  >
                    <RunHistoryRowContent
                      code={getShortId(session.id)}
                      duration={displayDuration}
                      extraLabel="PROMPTS"
                      extraValue={promptRuns.length}
                      source={session.source}
                      start={firstPromptRun?.start ?? session.start}
                      status={isDemo ? "demo" : displayStatus}
                      title={session.title}
                    />
                  </div>
                </TooltipTrigger>
                <RunHistoryTooltipContent
                  code={session.id}
                  duration={displayDuration}
                  extraLabel="PROMPTS"
                  extraValue={promptRuns.length}
                  source={session.source}
                  start={firstPromptRun?.start ?? session.start}
                  status={isDemo ? "demo" : displayStatus}
                  title={session.title}
                />
              </Tooltip>
              {hasPromptThread ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-controls={promptListId}
                  aria-expanded={expanded}
                  aria-label={`${expanded ? "收起" : "展开"} Prompt 层级`}
                  className="run-history__expand"
                  onClick={() => toggleRun(session.key)}
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
                      promptRuns.length *
                        appLayout.historyPromptRowEstimate +
                        8,
                    ),
                  }}
                >
                  <ol className="run-history__prompts">
                    {promptRuns.map((promptRun) => {
                      const promptSelected =
                        promptRun.key === activePromptRunKey;
                      const promptDisplayState = getSessionDisplayState(
                        promptRun,
                        now,
                        appTimings.activeRunTimeoutMs,
                      );
                      const roleLabel =
                        promptRun.role === "initial"
                          ? "INITIAL"
                          : `FOLLOW-UP ${String(promptRun.index).padStart(2, "0")}`;
                      return (
                        <li key={promptRun.key}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div
                                ref={
                                  promptSelected
                                    ? activePromptRunRef
                                    : undefined
                                }
                                role="button"
                                tabIndex={0}
                                aria-pressed={promptSelected}
                                className={cn(
                                  "run-history__row",
                                  "run-history__prompt-run",
                                  promptSelected && "is-selected",
                                )}
                                onClick={() =>
                                  onSelect(session.key, promptRun.key)
                                }
                                onKeyDown={(event) => {
                                  if (
                                    event.key === "Enter" ||
                                    event.key === " "
                                  ) {
                                    event.preventDefault();
                                    onSelect(session.key, promptRun.key);
                                  }
                                }}
                              >
                                <RunHistoryRowContent
                                  code={`${roleLabel} · ${getShortId(
                                    promptRun.prompt.id,
                                  )}`}
                                  duration={promptDisplayState.duration}
                                  extraLabel="EVENTS"
                                  extraValue={promptRun.events.length}
                                  source={promptRun.source}
                                  start={promptRun.start}
                                  status={
                                    isDemo
                                      ? "demo"
                                      : promptDisplayState.status
                                  }
                                  title={promptRun.title}
                                />
                              </div>
                            </TooltipTrigger>
                            <RunHistoryTooltipContent
                              code={`${roleLabel} · ${promptRun.prompt.id}`}
                              duration={promptDisplayState.duration}
                              extraLabel="EVENTS"
                              extraValue={promptRun.events.length}
                              source={promptRun.source}
                              start={promptRun.start}
                              status={
                                isDemo
                                  ? "demo"
                                  : promptDisplayState.status
                              }
                              title={promptRun.title}
                            />
                          </Tooltip>
                        </li>
                      );
                    })}
                  </ol>
                </ScrollArea>
              ) : null}
            </article>
          );
        })}
        {initialLoading ? (
          <div className="run-history__loading" aria-busy="true">
            <Loader2 className="size-4 animate-spin" />
            <span>LOADING RUNS…</span>
          </div>
        ) : sessions.length === 0 ? (
          <output className="run-history__empty">No runs in this window</output>
        ) : null}
        {canLoadMore ? (
          <div
            aria-hidden="true"
            className="run-history__more"
            ref={sentinelRef}
          />
        ) : null}
        {loadingMore ? (
          <div className="run-history__loading run-history__loading--more" aria-busy="true">
            <Loader2 className="size-4 animate-spin" />
            <span>LOADING MORE…</span>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function AtomicLog({
  events,
  runningEventId,
  selectedEventId,
  locateRequest,
  query,
  onQueryChange,
  onSelect,
  onLocateSelectedAtom,
  canLocateSelectedAtom,
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
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const locateRequestRef = useRef(locateRequest);
  const [scrollPosition, setScrollPosition] = useState({
    canScrollDown: false,
    canScrollUp: false,
  });
  const visibleEntries = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const entries = buildLogEntries(events);
    const matched = needle
      ? entries.filter(({ event }) =>
          JSON.stringify(event).toLowerCase().includes(needle),
        )
      : entries;
    return [...matched].reverse();
  }, [events, query]);

  const syncScrollPosition = useCallback(() => {
    const list = listRef.current;
    if (!list) {
      return;
    }
    const remaining = list.scrollHeight - list.clientHeight - list.scrollTop;
    setScrollPosition({
      canScrollDown: remaining > 2,
      canScrollUp: list.scrollTop > 2,
    });
  }, []);

  useEffect(() => {
    const explicitLocate = locateRequestRef.current !== locateRequest;
    locateRequestRef.current = locateRequest;
    const list = listRef.current;
    scrollRowWithinContainer(
      list,
      list?.querySelector<HTMLElement>(
        '.atomic-log__row[aria-pressed="true"]',
      ) ?? null,
      explicitLocate,
    );
  }, [locateRequest, query, selectedEventId]);

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
          onScroll={syncScrollPosition}
          tabIndex={0}
        >
          {visibleEntries.map(({ event, index, turn }, visibleIndex) => {
            const selected = event.id === selectedEventId;
            const running = event.id === runningEventId;
            const meta = eventMeta[event.eventName] || eventMeta.Unknown;
            const startsTurn =
              visibleIndex === 0 ||
              visibleEntries[visibleIndex - 1]?.turn !== turn;
            return (
              <Fragment key={event.id}>
                {startsTurn ? (
                  <div className="atomic-log__turn" aria-label={`Turn ${turn}`}>
                    <span>TURN {String(turn).padStart(2, "0")}</span>
                  </div>
                ) : null}
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
                  onClick={() => onSelect(event.id)}
                  onKeyDown={(keyEvent) => {
                    if (keyEvent.key === "Enter" || keyEvent.key === " ") {
                      keyEvent.preventDefault();
                      onSelect(event.id);
                    }
                  }}
                >
                  <span className="log-sequence">
                    #{String(index + 1).padStart(3, "0")}
                  </span>
                  <i className="phase-dot" />
                  <strong>{getTraceEventKey(event)}</strong>
                  <time dateTime={event.capturedAt} title={event.capturedAt}>
                    <span>{formatDate(event.capturedAt)}</span>
                    {formatClock(event.capturedAt)}
                  </time>
                  <small>
                    <span>{getEventAction(event)}</span>
                    <span className="atomic-log__summary">
                      {getEventSummary(event)}
                    </span>
                  </small>
                </div>
              </Fragment>
            );
          })}
          {!visibleEntries.length ? (
            <output className="atomic-log__empty grid h-full place-items-center">
              No matching events
            </output>
          ) : null}
        </div>
        {scrollPosition.canScrollUp ? (
          <IconAction
            label="滚动到顶部"
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
}

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

function TrajectoryView({
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
  const mapMinWidth = Math.max(360, nodes.length * 18);

  return (
    <section className="trajectory-view">
      <header className="trajectory-header">
        <hgroup>
          <span className="eyebrow">RUN TRAJECTORY</span>
          <strong>Loop-aware atomic execution</strong>
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
        <div className="trajectory-map__tracks">
          <div
            className="trajectory-map__track-content"
            style={{ minWidth: mapMinWidth }}
          >
            {trajectoryLanes.map(({ id, label, lane }) => (
              <i className={`trajectory-map__lane trajectory-map__lane--${id}`} key={label}>
                {nodes.map((node) => {
                  if (node.data.meta.lane !== lane) {
                    return null;
                  }
                  const segment = getTrajectorySegmentPosition(
                    node.data.index,
                    nodes.length,
                  );
                  return (
                    <b
                      key={node.id}
                      role="button"
                      tabIndex={0}
                      aria-label={`选择 ${node.data.label}`}
                      aria-pressed={node.id === selectedNodeId}
                      className={cn(
                        `tone-bg-${node.data.meta.tone}`,
                        node.id === selectedNodeId && "is-selected",
                        node.data.status === "active" && "is-running",
                      )}
                      onClick={() =>
                        onSelect(
                          (node.data.endEvent || node.data.startEvent).id,
                        )
                      }
                      onKeyDown={(keyEvent) => {
                        if (
                          keyEvent.key === "Enter" ||
                          keyEvent.key === " "
                        ) {
                          keyEvent.preventDefault();
                          onSelect(
                            (node.data.endEvent || node.data.startEvent).id,
                          );
                        }
                      }}
                      style={
                        {
                          "--segment-left": `${segment.left}%`,
                          "--segment-width": `${segment.width}%`,
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
        {model.context.length ? (
          <section className="trajectory-turn trajectory-context">
            <header>
              <strong>RUN CONTEXT</strong>
              <span>{model.context.length} atoms</span>
            </header>
            {model.context.map((atom) => (
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
        {model.turns.map((turn) => {
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
      </div>
    </section>
  );
}

function ReplayFooter({
  events,
  cursor,
  live,
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
          aria-label="跟随实时事件"
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
}

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
  const [eventsLoaded, setEventsLoaded] = useState(false);
  const [importedEvents, setImportedEvents] = useState<TraceEvent[]>([]);
  const [connected, setConnected] = useState(false);
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
  const [deepView, setDeepView] = useState<boolean>(appDefaults.deepView);
  const [guideOpen, setGuideOpen] = useState<boolean>(appDefaults.guideOpen);
  const [historySearchOpen, setHistorySearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState<boolean>(appDefaults.menuOpen);
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
  const [platformId, setPlatformId] = useState<PlatformId>(
    () =>
      getPlatformForSource(initialLocation?.source) ??
      (readStorageValue(
          window.localStorage,
          storageKeys.platform,
          appDefaults.platform,
          legacyStorageKeys.platform,
        ) as PlatformId),
  );
  // The agent dropdown drives which agent's runs load. A configured agent is a
  // PlatformId; OTHERS_AGENT_ID is the trailing catch-all. Picking a configured
  // agent also drives the topology platform; "Others" leaves it unchanged.
  const [agentId, setAgentId] = useState<PlatformId | typeof OTHERS_AGENT_ID>(
    platformId,
  );
  const [runHistoryDays, setRunHistoryDays] = useState(
    DEFAULT_RUN_HISTORY_DAYS,
  );
  const [runHistoryLoadingMore, setRunHistoryLoadingMore] = useState(false);
  const runHistoryLoadingMoreRef = useRef(false);
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

  useEffect(() => {
    const source = new EventSource("/api/stream");
    source.addEventListener("ready", () => setConnected(true));
    source.addEventListener("trace", (message: MessageEvent<string>) => {
      const event = normalizeTraceEvent(JSON.parse(message.data));
      setLiveEvents((current) =>
        current.some((item) => item.id === event.id)
          ? current
          : [...current, event],
      );
    });
    source.addEventListener("reset", (message: MessageEvent<string>) => {
      setLiveEvents(
        (JSON.parse(message.data) as TraceEvent[]).map(normalizeTraceEvent),
      );
      setEventsLoaded(true);
    });
    source.onerror = () => setConnected(false);
    source.onopen = () => setConnected(true);
    return () => source.close();
  }, []);

  const allEvents = useMemo(
    () => [...new Map([...importedEvents, ...liveEvents].map((event) => [event.id, event])).values()],
    [liveEvents, importedEvents],
  );
  const isDemo = shouldShowDemo(allEvents.length, import.meta.env);
  const visibleEvents = isDemo ? demoEvents : allEvents;
  const sessions = useMemo(() => buildSessions(visibleEvents), [visibleEvents]);
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
  // Runs shown in RUN HISTORY: narrowed to the selected agent, then to the
  // visible day window (most recent N days). Both are derived at render time.
  const filteredSessions = useMemo(
    () => filterSessionsByAgent(sessions, agentId, configuredSources),
    [agentId, configuredSources, sessions],
  );
  const visibleSessions = useMemo(
    () => selectVisibleRunHistory(filteredSessions, now, runHistoryDays),
    [filteredSessions, now, runHistoryDays],
  );
  const canLoadMoreRunHistory =
    canLoadMoreRunHistoryDays(filteredSessions, now, runHistoryDays);
  const hasAdvancingRun =
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
    });
  const historySearchEntries = useMemo(
    () => buildHistorySearchIndex(sessions, promptRunsBySession),
    [promptRunsBySession, sessions],
  );

  useEffect(() => {
    if (!hasAdvancingRun) {
      return undefined;
    }

    setNow(Date.now());
    const timer = window.setInterval(
      () => setNow(Date.now()),
      appTimings.sessionDurationRefreshMs,
    );
    return () => window.clearInterval(timer);
  }, [hasAdvancingRun]);

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
  const activeEvents = activePromptRun?.events ?? activeSession?.events ?? [];
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
  const followingSessionLive = isFollowingLive(
    selectedAtomId,
    replayMode,
    activeSession?.key === sessions[0]?.key,
  );
  const followingLive =
    followingSessionLive &&
    (!latestPromptRun || activePromptRun?.key === latestPromptRun.key);
  const promptExecuting = isPromptExecuting(
    activeDisplayState?.status,
    isDemo,
  );
  const executingLive = promptExecuting && !replayMode;

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
    if (!playing || !activeEvents.length) {
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
  }, [activeEvents.length, playing, replaySpeed]);

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
  const flow = useMemo(() => buildFlow(displayedEvents), [displayedEvents]);
  const harnessFlow = useMemo(
    () => buildHarnessFlow(displayedEvents, platformId),
    [displayedEvents, platformId],
  );
  const atomicProjection = useMemo(
    () => projectTraceEvents(displayedEvents, platformId),
    [displayedEvents, platformId],
  );
  const inspectionFlow = flow;
  const selectedEvent =
    displayedEvents.find((event) => event.id === selectedEventId) || null;
  const mappedAtomId = getAtomIdForEvent(selectedEvent, platformId);
  const currentAtomId = resolveSelectedAtomId(
    selectedAtomId,
    mappedAtomId,
  );
  const activeExecutionAtomId = executingLive
    ? getAtomIdForEvent(activeEvents.at(-1) || null, platformId)
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
  const trajectoryNodes = useMemo<TraceNodeType[]>(
    () =>
      flow.nodes.map((node) => ({
        ...node,
        selected: node.id === selectedNodeId,
      })),
    [flow.nodes, selectedNodeId],
  );
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

  const selectSession = (key: string, promptRunKey?: string) => {
    const session = sessionsByKey.get(key);
    const promptRuns = promptRunsBySession.get(key) ?? [];
    const promptRun =
      promptRuns.find((candidate) => candidate.key === promptRunKey) ||
      promptRuns.at(-1);
    const event = promptRun?.events.at(-1) || session?.events.at(-1);
    setActiveSessionKey(key);
    setActivePromptRunKey(promptRun?.key || "");
    setSelectedEventId(event?.id || "");
    setSelectedAtomId(
      getPromptAtomSelection(
        promptRun?.status ?? session?.status,
        getAtomIdForEvent(event || null, platformId),
      ),
    );
    setConsoleOpen(true);
    setQuery("");
    setReplayMode(false);
    setPlaying(false);
  };

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

  const focusAtom = (atomId: string) => {
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
  };

  const locateTrajectorySelection = () => {
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
  };

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
                <button
                  type="button"
                  onClick={() => {
                    fileInputRef.current?.click();
                    setMenuOpen(false);
                  }}
                >
                  <FileInput />
                  Import run
                </button>
                <button
                  type="button"
                  disabled={!activeSession}
                  onClick={() => {
                    exportTrace();
                    setMenuOpen(false);
                  }}
                >
                  <Download />
                  Export run
                </button>
                <button
                  type="button"
                  className="action-menu__danger"
                  onClick={() => {
                    clearEvents();
                    setMenuOpen(false);
                  }}
                >
                  <Trash2 />
                  Clear local events
                </button>
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
        <div className="studio-header__actions">
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
            onClick={() => setHistorySearchOpen(true)}
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
          >
            <i />
            {connected ? "accepted" : isDemo ? "demo" : "offline"}
          </span>
          <ThemeSwitcher theme={theme} onChange={setTheme} />
        </div>
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
              isDemo={isDemo}
              now={now}
              promptRunsBySession={promptRunsBySession}
              canLoadMore={canLoadMoreRunHistory}
              initialLoading={!eventsLoaded && !isDemo}
              loadingMore={runHistoryLoadingMore}
              onLoadMore={() => {
                if (runHistoryLoadingMoreRef.current) {
                  return;
                }
                runHistoryLoadingMoreRef.current = true;
                setRunHistoryLoadingMore(true);
                setRunHistoryDays((current) =>
                  nextRunHistoryVisibleDays(filteredSessions, now, current),
                );
                window.setTimeout(() => {
                  runHistoryLoadingMoreRef.current = false;
                  setRunHistoryLoadingMore(false);
                }, 320);
              }}
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
                <Select
                  value={agentId}
                  onValueChange={(value) => {
                    const nextAgent = value as PlatformId | typeof OTHERS_AGENT_ID;
                    setAgentId(nextAgent);
                    setRunHistoryDays(DEFAULT_RUN_HISTORY_DAYS);
                    if (nextAgent !== OTHERS_AGENT_ID) {
                      setPlatformId(nextAgent);
                    }
                  }}
                >
                  <TooltipTrigger asChild>
                    <SelectTrigger
                      size="sm"
                      className={cn(
                        "platform-select",
                        agentId === OTHERS_AGENT_ID
                          ? "platform-select--others"
                          : `platform-select--${agentId}`,
                      )}
                      aria-label="切换智能体平台"
                    >
                      <SelectValue />
                    </SelectTrigger>
                  </TooltipTrigger>
                  <SelectContent position="popper" align="end">
                    <SelectGroup>
                      {atomPlatformOptions.map((platform) => (
                        <SelectItem key={platform.id} value={platform.id}>
                          <PlatformIcon platform={platform.id} />
                          {platform.label}
                        </SelectItem>
                      ))}
                      <SelectItem value={OTHERS_AGENT_ID}>
                        <Layers />
                        <span>Others</span>
                      </SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
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
                  onClick={() => setActiveView("trajectory")}
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
                onSelectNode={(node) => {
                  const deselecting = selectedAtomId === node.id;
                  setPlaying(false);
                  setReplayMode(false);
                  setSelectedAtomId((current) =>
                    toggleAtomSelection(current, node.id),
                  );
                  const boundEvent = node.data.endEvent || node.data.event;
                  setSelectedEventId(deselecting ? "" : boundEvent?.id || "");
                }}
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
              <TrajectoryView
                atomNodes={harnessFlow.nodes}
                atomicEvents={atomicProjection.events}
                nodes={trajectoryNodes}
                events={displayedEvents}
                locateRequest={trajectoryLocateRequest}
                selectedAtomId={currentAtomId}
                selectedEventId={selectedEventId || ""}
                selectedNodeId={selectedNodeId}
                canLocateSelection={Boolean(locateAtomId && locateAtomEvent)}
                onLocateSelection={locateTrajectorySelection}
                onSelect={(eventId, atomId) => {
                  setPlaying(false);
                  setReplayMode(false);
                  setConsoleOpen(true);
                  setQuery("");
                  const event = activeEvents.find(
                    (candidate) => candidate.id === eventId,
                  );
                  setSelectedAtomId(
                    atomId || getAtomIdForEvent(event || null, platformId) || null,
                  );
                  setSelectedEventId(eventId);
                  setTrajectoryLocateRequest((current) => current + 1);
                  setLogLocateRequest((current) => current + 1);
                }}
              />
            </div>
          </div>

          <ReplayFooter
            events={activeEvents}
            cursor={replayCursor}
            live={executingLive}
            playing={playing}
            speed={replaySpeed}
            onSeek={(index) => {
              setSelectedAtomId(undefined);
              setReplayMode(true);
              setPlaying(false);
              setReplayCursor(index);
            }}
            onRestart={() => {
              setSelectedAtomId(undefined);
              setReplayMode(true);
              setReplayCursor(0);
              setPlaying(true);
            }}
            onTogglePlay={() => {
              setSelectedAtomId(undefined);
              if (
                !replayMode ||
                replayCursor >= activeEvents.length - 1
              ) {
                setReplayMode(true);
                setReplayCursor(0);
                setPlaying(true);
                return;
              }
              setPlaying((current) => !current);
            }}
            onSpeedChange={setReplaySpeed}
            onExit={() => {
              const latestSession = sessions[0];
              const latestPromptRuns =
                promptRunsBySession.get(latestSession?.key || "") ?? [];
              const latestPromptRun = latestPromptRuns.at(-1);
              const latestEvents =
                latestPromptRun?.events ?? latestSession?.events ?? activeEvents;
              if (latestSession && latestSession.key !== activeSession?.key) {
                setActiveSessionKey(latestSession.key);
              }
              setActivePromptRunKey(latestPromptRun?.key || "");
              setSelectedEventId(latestEvents.at(-1)?.id || "");
              setSelectedAtomId(undefined);
              setPlaying(false);
              setReplayMode(false);
              setReplayCursor(
                Math.max(0, latestEvents.length - 1),
              );
            }}
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
                  executingLive ? activeEvents.at(-1)?.id || "" : ""
                }
                selectedEventId={selectedEventId || ""}
                locateRequest={logLocateRequest}
                query={query}
                onQueryChange={setQuery}
                onSelect={(eventId) => {
                  setPlaying(false);
                  setReplayMode(false);
                  const selecting = selectedEventId !== eventId;
                  const event = activeEvents.find(
                    (candidate) => candidate.id === eventId,
                  );
                  setSelectedAtomId(
                    selecting
                      ? getAtomIdForEvent(event || null, platformId) || null
                      : null,
                  );
                  setSelectedEventId(selecting ? eventId : "");
                }}
                canLocateSelectedAtom={Boolean(currentAtomId)}
                onLocateSelectedAtom={() => {
                  if (!currentAtomId) {
                    return;
                  }
                  setActiveView("topology");
                  focusAtom(currentAtomId);
                }}
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
        entries={historySearchEntries}
        open={historySearchOpen}
        onOpenChange={setHistorySearchOpen}
        onSelect={selectHistorySearchResult}
      />
    </main>
  );
}
