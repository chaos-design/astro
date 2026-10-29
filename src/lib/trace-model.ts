import { buildExecutionTopology } from "./execution-topology.ts";
import {
  getExceptionOutcome,
  isToolFailureEvent,
} from "./exception-events.ts";
import { isWaitingTraceEvent } from "./trace-status.ts";
import { getWaitingEventsForSource } from "../config/atom-platforms.ts";
import type {
  EventMeta,
  FlowEntry,
  MessageCategory,
  RunTerminalReason,
  TraceEvent,
  TraceEventInput,
  TraceFlow,
  TraceNode,
  TracePayload,
  TracePromptRun,
  TraceRunStatus,
  TraceSession,
} from "@/types/trace";

const eventOrder = [
  "SessionStart",
  "UserPromptSubmit",
  "AgentMessage",
  "Reasoning",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "PermissionRequest",
  "PermissionDenied",
  "Notification",
  "SubagentStart",
  "SubagentStop",
  "Stop",
  "StopFailure",
  "Elicitation",
  "ElicitationResult",
  "Interrupt",
  "SessionEnd",
];

export const eventMeta: Record<string, EventMeta> = {
  SessionStart: { label: "Session", tone: "session", lane: 0 },
  SessionEnd: { label: "Session end", tone: "complete", lane: 0 },
  UserPromptSubmit: { label: "Prompt", tone: "prompt", lane: 0 },
  AgentMessage: { label: "Agent", tone: "agent", lane: 0 },
  Reasoning: { label: "Reasoning", tone: "reasoning", lane: 2 },
  PreToolUse: { label: "Tool call", tone: "tool", lane: 1 },
  PostToolUse: { label: "Tool result", tone: "tool", lane: 1 },
  PostToolUseFailure: { label: "Tool failure", tone: "failed", lane: 1 },
  PermissionRequest: { label: "Permission", tone: "signal", lane: 2 },
  PermissionDenied: { label: "Permission denied", tone: "failed", lane: 2 },
  Notification: { label: "Signal", tone: "signal", lane: 2 },
  SubagentStart: { label: "Subagent", tone: "signal", lane: 2 },
  SubagentStop: { label: "Subagent end", tone: "signal", lane: 2 },
  Stop: { label: "Response", tone: "complete", lane: 0 },
  StopFailure: { label: "Response failure", tone: "failed", lane: 0 },
  Elicitation: { label: "Input requested", tone: "signal", lane: 2 },
  ElicitationResult: { label: "Input received", tone: "signal", lane: 2 },
  PreCompact: { label: "Compacting", tone: "reasoning", lane: 2 },
  PostCompact: { label: "Compacted", tone: "agent", lane: 2 },
  Interrupt: { label: "Interrupted", tone: "failed", lane: 0 },
  Unknown: { label: "Event", tone: "unknown", lane: 2 },
};

export const sourceMeta = {
  trae: { label: "TRAE", tone: "lime" },
  claude: { label: "CLAUDE", tone: "amber" },
  codex: { label: "CODEX", tone: "cyan" },
  deepseek: { label: "DEEPSEEK", tone: "cyan" },
  browser: { label: "BROWSER", tone: "violet" },
  opencode: { label: "OPENCODE", tone: "violet" },
  zcode: { label: "ZCODE", tone: "violet" },
  workbuddy: { label: "WORKBUDDY", tone: "lime" },
  gemini: { label: "GEMINI", tone: "cyan" },
  qwen: { label: "QWEN", tone: "violet" },
  copilot: { label: "COPILOT", tone: "amber" },
  cursor: { label: "CURSOR", tone: "lime" },
  cline: { label: "CLINE", tone: "violet" },
  windsurf: { label: "WINDSURF", tone: "cyan" },
  iflow: { label: "IFLOW", tone: "amber" },
  generic: { label: "GENERIC", tone: "neutral" },
};

/**
 * Maps known canonical event names onto common, user-facing message categories.
 * Any event name that is not present here (including `Unknown` and native event
 * names that have no canonical mapping) falls back to `session`, so every
 * event is covered by one of the user-facing buckets.
 */
const messageCategoryByEvent: Record<string, MessageCategory> = {
  SessionStart: "session",
  SessionEnd: "session",
  Interrupt: "session",
  UserPromptSubmit: "prompt",
  AgentMessage: "agent",
  Stop: "agent",
  StopFailure: "agent",
  Reasoning: "reasoning",
  PreCompact: "reasoning",
  PostCompact: "reasoning",
  PreToolUse: "tool",
  PostToolUse: "tool",
  PostToolUseFailure: "tool",
  PermissionRequest: "interaction",
  PermissionDenied: "interaction",
  Notification: "interaction",
  Elicitation: "interaction",
  ElicitationResult: "interaction",
  SubagentStart: "subagent",
  SubagentStop: "subagent",
};

export const messageCategoryOrder: readonly MessageCategory[] = [
  "prompt",
  "agent",
  "reasoning",
  "tool",
  "interaction",
  "subagent",
  "session",
];

export const messageCategoryLabels: Readonly<Record<MessageCategory, string>> = {
  prompt: "Prompt",
  agent: "Agent",
  reasoning: "Reasoning",
  tool: "Tool",
  interaction: "Interaction",
  subagent: "Subagent",
  session: "Session",
};

export function getMessageCategory(
  event: Pick<TraceEvent, "eventName">,
): MessageCategory {
  return messageCategoryByEvent[event.eventName] ?? "session";
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function normalizeSource(value: unknown, fallback = "generic") {
  const source = String(value || fallback).trim().toLowerCase();
  if (source.includes("claude")) return "claude";
  if (source.includes("codex") || source.includes("openai")) return "codex";
  if (source.includes("deepseek") || source === "dsh") return "deepseek";
  if (source.includes("workbuddy") || source.includes("codebuddy")) {
    return "workbuddy";
  }
  if (source.includes("trae")) return "trae";
  if (source.includes("opencode")) return "opencode";
  if (source.includes("zcode")) return "zcode";
  if (
    source.includes("browser") ||
    source.includes("chrome") ||
    source.includes("extension")
  ) {
    return "browser";
  }
  return source.replace(/[^a-z0-9._-]+/g, "-") || fallback;
}

function canonicalizeEventName(value: unknown) {
  const name = String(value || "Unknown");
  const compactName = name.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "");
  if (
    ["askuserquestion", "requestuserinput", "userquestion"].includes(
      compactName,
    )
  ) {
    return "PermissionRequest";
  }
  const match = eventOrder.find(
    (eventName) =>
      eventName.toLowerCase() === name.toLowerCase() ||
      eventName
        .replace(/([a-z])([A-Z])/g, "$1_$2")
        .toLowerCase() === name.toLowerCase(),
  );
  return match || name;
}

export function createTraceLocator(event: TraceEvent) {
  return `trace://${encodeURIComponent(event.source)}/${encodeURIComponent(
    event.sessionId,
  )}/${encodeURIComponent(event.id)}`;
}

export function getSessionKey(event: TraceEvent) {
  return [event.source, event.workspaceId, event.sessionId].join("::");
}

/**
 * A canonical event built by {@link normalizeTraceEvent} (or by the recorder
 * on the server). Streaming paths re-derive projections from lists of these
 * on every batch, so re-normalizing them would allocate a full copy of the
 * session per frame; the shape check short-circuits that.
 */
function isCanonicalTraceEvent(
  value: TraceEventInput | TraceEvent,
): value is TraceEvent {
  const candidate = value as Partial<TraceEvent>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.capturedAt === "string" &&
    typeof candidate.source === "string" &&
    typeof candidate.sessionId === "string" &&
    typeof candidate.workspaceId === "string" &&
    typeof candidate.eventName === "string" &&
    typeof candidate.nativeEventName === "string" &&
    typeof candidate.locator === "string" &&
    typeof candidate.payload === "object" &&
    candidate.payload !== null &&
    !Array.isArray(candidate.payload)
  );
}

export function normalizeTraceEvent(
  value: TraceEventInput,
  index = 0,
): TraceEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Trace event must be a JSON object.");
  }
  if (isCanonicalTraceEvent(value)) {
    return value;
  }
  if (value.payload != null &&
      (typeof value.payload !== "object" || Array.isArray(value.payload))) {
    throw new TypeError("Trace payload must be a JSON object.");
  }
  const payload = (value.payload || value) as TracePayload;
  const eventName = canonicalizeEventName(
    value.eventName ||
      value.event_name ||
      value.hook_event_name ||
      payload.hook_event_name ||
      "Unknown",
  );
  const capturedAt =
    value.capturedAt ||
    value.timestamp ||
    payload.timestamp ||
    new Date().toISOString();
  const source = normalizeSource(
    value.source || payload.source,
    value.schemaVersion === 1 || value.hook_event_name ? "trae" : "generic",
  );
  const cwd = value.cwd || payload.cwd || null;
  const sessionId = String(
    value.sessionId ||
      value.session_id ||
      payload.session_id ||
      payload.thread_id ||
      "unknown-session",
  );
  const event: TraceEvent = {
    schemaVersion: value.schemaVersion || 1,
    id: String(value.id || `${sessionId}-${index}-${capturedAt}`),
    capturedAt: String(capturedAt),
    source,
    sourceVersion: value.sourceVersion || value.source_version || null,
    workspaceId:
      String(
        value.workspaceId ||
          value.workspace_id ||
          (cwd ? stableHash(cwd) : "unknown"),
      ),
    sessionId,
    turnId:
      value.turnId || value.turn_id || payload.turn_id || null,
    parentId:
      value.parentId || value.parent_id || payload.agent_id || null,
    eventName,
    nativeEventName:
      value.nativeEventName ||
      value.event_name ||
      value.hook_event_name ||
      payload.hook_event_name ||
      eventName,
    toolUseId:
      value.toolUseId ||
      value.tool_use_id ||
      payload.tool_use_id ||
      payload.call_id ||
      null,
    toolName:
      value.toolName ||
      value.tool_name ||
      payload.tool_name ||
      payload.name ||
      null,
    cwd: cwd ? String(cwd) : null,
    status: value.status || payload.status || null,
    sequence:
      typeof value.sequence === "number" && Number.isFinite(value.sequence)
        ? value.sequence
        : null,
    payload,
    locator: "",
  };
  event.locator = value.locator || createTraceLocator(event);
  return event;
}

export function parseImportedTrace(text: string): TraceEvent[] {
  const trimmed = text.trim();
  if (!trimmed) {
    return [];
  }

  if (trimmed.startsWith("[")) {
    const parsed: unknown = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) {
      throw new TypeError("JSON import must be an array.");
    }
    return parsed.map((item, index) =>
      normalizeTraceEvent(item as TraceEventInput, index),
    );
  }

  return trimmed
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line, index) =>
      normalizeTraceEvent(JSON.parse(line) as TraceEventInput, index),
    );
}

export function getEventTimestamp(event: TraceEvent) {
  const parsed = Date.parse(event.capturedAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function formatDuration(milliseconds: number) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) {
    return "--";
  }
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1000));
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) {
    const minutes = totalMinutes;
    return `${minutes}m ${seconds}s`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes}m ${seconds}s`;
}

type SessionDisplayStateSource = {
  duration: number;
  start: number;
  status: TraceRunStatus;
};

export function getSessionDisplayState(
  session: SessionDisplayStateSource,
  now: number,
  activeRunTimeoutMs = Number.POSITIVE_INFINITY,
): {
  duration: number;
  status: TraceRunStatus;
} {
  const advancing =
    session.status === "active" || session.status === "waiting";
  if (!advancing) {
    return {
      duration: session.duration,
      status: session.status,
    };
  }

  const liveDuration = Math.max(session.duration, now - session.start);
  const durationLimit = Number.isFinite(activeRunTimeoutMs)
    ? Math.max(0, activeRunTimeoutMs)
    : Number.POSITIVE_INFINITY;
  const timedOut = liveDuration >= durationLimit;

  return {
    duration: Math.min(liveDuration, durationLimit),
    status: timedOut ? "terminated" : session.status,
  };
}

export function getSessionDuration(
  session: SessionDisplayStateSource,
  now: number,
  activeRunTimeoutMs = Number.POSITIVE_INFINITY,
) {
  return getSessionDisplayState(
    session,
    now,
    activeRunTimeoutMs,
  ).duration;
}

function extractText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(extractText).filter(Boolean).join(" ");
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return extractText(record.text || record.input_text || record.output_text ||
      record.message || record.content) || JSON.stringify(value);
  }
  return value == null ? "" : String(value);
}

/**
 * Event summaries are pure functions of the (immutable) event, and they are
 * requested repeatedly — per rendered log row, per projection rebuild, per
 * search pass. The WeakMap ties the cache to the event's lifetime, mirroring
 * the search-haystack cache in `event-search.ts`.
 */
const eventSummaries = new WeakMap<TraceEvent, string>();

export function getEventSummary(event: TraceEvent): string {
  if (eventSummaries.has(event)) {
    return eventSummaries.get(event) as string;
  }
  const summary = extractText(getSummaryValue(event));
  eventSummaries.set(event, summary);
  return summary;
}

function getSummaryValue(event: TraceEvent): unknown {
  const payload = event.payload || {};
  if (event.eventName === "UserPromptSubmit") {
    return (
      payload.prompt ||
      payload.message ||
      payload.payload?.message ||
      extractText(payload.content || payload.payload?.content) ||
      "Prompt submitted"
    );
  }
  if (event.eventName === "AgentMessage") {
    return (
      payload.message ||
      payload.payload?.message ||
      payload.text ||
      extractText(payload.content || payload.payload?.content) ||
      "Agent message"
    );
  }
  if (event.eventName === "Reasoning") {
    return (
      payload.summary ||
      payload.text ||
      extractText(payload.content || payload.payload?.content) ||
      "Reasoning update"
    );
  }
  if (event.eventName === "SessionStart") {
    return payload.source || payload.matcher || "Agent runtime initialized";
  }
  if (event.eventName === "Notification") {
    return (
      payload.message ||
      payload.notification_type ||
      payload.payload?.type ||
      event.nativeEventName ||
      "Runtime signal"
    );
  }
  // A failure must not borrow the normal completion wording: payload-less
  // clients (WorkBuddy) only deliver the event name, and "Response committed"
  // on a StopFailure row reads as success.
  if (event.eventName === "StopFailure") {
    return (
      payload.error_message ||
      payload.last_assistant_message ||
      payload.message ||
      payload.reason ||
      "Response failed"
    );
  }
  if (event.eventName === "Stop") {
    return (
      payload.last_assistant_message ||
      payload.message ||
      payload.reason ||
      "Response committed"
    );
  }
  if (event.eventName === "SessionEnd") {
    return payload.reason || payload.message || "Session ended";
  }
  return (
    payload.llm_tool_name ||
    event.toolName ||
    payload.tool_input?.command ||
    "Tool execution"
  );
}

export function getExecutionInstruction(
  event: TraceEvent | null,
  startEvent?: TraceEvent | null,
) {
  const source = startEvent || event;
  const toolInput = source?.payload?.tool_input;
  const rawCommand =
    toolInput?.command ||
    toolInput?.cmd ||
    source?.payload?.command ||
    event?.payload?.tool_input?.command ||
    event?.payload?.tool_input?.cmd ||
    event?.payload?.command;
  const command = Array.isArray(rawCommand)
    ? rawCommand.map(String).join(" ")
    : typeof rawCommand === "string"
      ? rawCommand
      : "";
  return (
    command.replace(/\s+/g, " ").trim() ||
    source?.toolName ||
    event?.toolName ||
    event?.eventName ||
    "Event"
  );
}

/**
 * Raw prompt text, without the display placeholder that
 * {@link getEventSummary} falls back to. Empty when the client reported the
 * prompt lifecycle without delivering its input (WorkBuddy, for example).
 */
export function getPromptInput(event: TraceEvent): string {
  const payload = (event.payload || {}) as Record<string, unknown>;
  const nested = payload.payload as Record<string, unknown> | undefined;
  const value =
    payload.prompt ??
    payload.message ??
    nested?.message ??
    extractText(payload.content ?? nested?.content);
  return extractText(value).replace(/\s+/g, " ").trim();
}

/**
 * Session title: the first prompt that actually carries input. Prompts whose
 * text was never delivered are skipped so the run list shows a real request
 * instead of a placeholder.
 */
export function getSessionTitle(events: TraceEvent[]) {
  for (const event of events) {
    if (event.eventName !== "UserPromptSubmit") {
      continue;
    }
    const value = getPromptInput(event);
    if (value) {
      return value;
    }
  }
  return events[0]?.cwd?.split("/").filter(Boolean).at(-1) || "Untitled trace";
}

function getTraceRunState(
  events: readonly TraceEvent[],
  waitingEvents?: readonly string[],
): {
  status: TraceRunStatus;
  reason: RunTerminalReason | null;
  detail: string | null;
} {
  let status: TraceRunStatus = "active";
  let reason: RunTerminalReason | null = null;
  let detail: string | null = null;
  let runEnded = false;
  for (const event of events) {
    const exception = getExceptionOutcome(event, waitingEvents);
    if (
      event.eventName === "SessionStart" ||
      event.eventName === "UserPromptSubmit"
    ) {
      status = "active";
      reason = null;
      detail = null;
      runEnded = false;
    } else if (exception) {
      status = exception.status;
      reason = exception.reason;
      detail = readStatusDetail(event);
      // A terminal outcome (turn failure, interruption, session end) ends
      // the run: later progress noise must not resurrect it to "active" in
      // the run history.
      runEnded = exception.terminal;
    } else if (isWaitingTraceEvent(event, waitingEvents)) {
      status = "waiting";
      reason = null;
      detail = readStatusDetail(event);
    } else if (event.eventName === "Stop") {
      status = "complete";
      reason = "completed";
      detail = null;
      runEnded = true;
    } else if (
      !runEnded &&
      (status === "waiting" || status === "failed") &&
      isExecutionProgressEvent(event)
    ) {
      status = "active";
      reason = null;
      detail = null;
    }
  }
  return { status, reason, detail };
}

/** Short human-readable cause (payload reason / error / status token). */
function readStatusDetail(event: TraceEvent) {
  const candidates = [
    // Clients report failure text under different keys: Claude sends
    // `error_message` on StopFailure/PostToolUseFailure and `reason` on
    // PermissionDenied, while derived clients reuse `reason` or `status`.
    event.payload?.error_message,
    event.payload?.denial_reason,
    event.payload?.reason,
    event.payload?.error,
    event.payload?.message,
    event.status,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim().slice(0, 120);
    }
  }
  return null;
}

function getTraceRunStatus(
  events: readonly TraceEvent[],
  waitingEvents?: readonly string[],
): TraceRunStatus {
  return getTraceRunState(events, waitingEvents).status;
}

/**
 * Prompt runs are a pure function of the session object. Sessions that a
 * streaming batch did not touch keep their identity (see
 * {@link createSessionProjection}), so this cache lets every untouched row in
 * RUN HISTORY keep the exact same props — and skip re-rendering entirely.
 */
const promptRunsBySession = new WeakMap<TraceSession, TracePromptRun[]>();

export function buildSessionPromptRuns(
  session: TraceSession,
): TracePromptRun[] {
  const cached = promptRunsBySession.get(session);
  if (cached) {
    return cached;
  }
  const promptIndexes = session.events.flatMap((event, index) =>
    event.eventName === "UserPromptSubmit" ? [index] : [],
  );

  const runs = promptIndexes.map((startIndex, index): TracePromptRun => {
    const endIndex = promptIndexes[index + 1] ?? session.events.length;
    const promptWindow = session.events.slice(startIndex, endIndex);
    const terminalIndex = promptWindow.findIndex((event) =>
      ["Stop", "StopFailure", "SessionEnd", "Interrupt"].includes(
        event.eventName,
      ),
    );
    const events =
      terminalIndex >= 0
        ? promptWindow.slice(0, terminalIndex + 1)
        : promptWindow;
    const prompt = events[0];
    if (!prompt) {
      throw new Error(`Prompt run ${session.key}:${index} has no events.`);
    }
    const start = getEventTimestamp(prompt);
    const end = getEventTimestamp(events.at(-1) || prompt);
    const observed = getTraceRunState(
      events,
      getWaitingEventsForSource(session.source),
    );
    // A Prompt that is followed by another Prompt ended when the next one
    // began, even though it reported no terminal event of its own.
    const superseded =
      observed.status === "active" && index < promptIndexes.length - 1;
    const status: TraceRunStatus = superseded
      ? "complete"
      : observed.status === "active"
        ? session.status
        : observed.status;

    return {
      key: `${session.key}::prompt::${prompt.id}`,
      sessionKey: session.key,
      sessionId: session.id,
      source: session.source,
      workspaceId: session.workspaceId,
      cwd: session.cwd,
      prompt,
      events,
      title:
        getPromptInput(prompt) ||
        getEventSummary(prompt).replace(/\s+/g, " ").trim(),
      index,
      role: index === 0 ? "initial" : ("follow-up" as const),
      start,
      end,
      duration: Math.max(0, end - start),
      status,
      terminalReason: superseded
        ? "completed"
        : status === "active" || status === "waiting"
          ? null
          : observed.reason,
      statusDetail: superseded ? null : observed.detail,
      toolCount: events.filter(
        (event) => event.eventName === "PreToolUse",
      ).length,
    };
  });
  promptRunsBySession.set(session, runs);
  return runs;
}

function compareSessionEvents(left: TraceEvent, right: TraceEvent) {
  const timeDifference = getEventTimestamp(left) - getEventTimestamp(right);
  if (timeDifference !== 0) {
    return timeDifference;
  }
  return (left.sequence ?? 0) - (right.sequence ?? 0);
}

/** Build one session from its (already grouped, sortable) events. */
function createSession(key: string, events: TraceEvent[]): TraceSession {
  // Session-local sort: the caller owns `events` (a fresh group or a fresh
  // merge), so sorting in place never touches a shared array.
  events.sort(compareSessionEvents);
  const first = events[0];
  if (!first) {
    throw new Error(`Session ${key} has no events.`);
  }
  const start = getEventTimestamp(first);
  const end = getEventTimestamp(events.at(-1) || first);
  const state = getTraceRunState(
    events,
    getWaitingEventsForSource(first.source),
  );

  return {
    key,
    id: first.sessionId,
    source: first.source,
    workspaceId: first.workspaceId,
    cwd: first.cwd,
    events,
    title: getSessionTitle(events),
    start,
    end,
    duration: Math.max(0, end - start),
    status: state.status,
    terminalReason: state.reason,
    statusDetail: state.detail,
    toolCount: events.filter((event) => event.eventName === "PreToolUse")
      .length,
  };
}

const bySessionStartDesc = (left: TraceSession, right: TraceSession) =>
  right.start - left.start;

export function buildSessions(
  inputEvents: Array<TraceEvent | TraceEventInput>,
): TraceSession[] {
  const grouped = new Map<string, TraceEvent[]>();
  const knownIds = new Set<string>();
  inputEvents.map(normalizeTraceEvent).forEach((event) => {
    if (knownIds.has(event.id)) return;
    knownIds.add(event.id);
    const key = getSessionKey(event);
    const events = grouped.get(key) || [];
    events.push(event);
    grouped.set(key, events);
  });

  return [...grouped.entries()]
    .map(([key, events]) => createSession(key, events))
    .sort(bySessionStartDesc);
}

type SessionProjectionCache = {
  count: number;
  firstId: string;
  lastId: string;
  midId: string;
  sessions: TraceSession[];
  byKey: Map<string, TraceSession>;
};

/**
 * Streaming-aware session projection.
 *
 * Live capture appends to the event list every few hundred milliseconds.
 * Rebuilding every session from scratch on each batch re-sorts all events and
 * hands every RUN HISTORY row a brand-new object, which defeats the row
 * memoization and makes long sessions feel heavy. This projection keeps the
 * previous session objects and rebuilds only the sessions the appended slice
 * actually touched, so untouched rows keep their identity (and their cached
 * Prompt runs) across batches.
 *
 * The cache is validated against the event list's boundaries — first, middle,
 * and last ids plus the length — and falls back to a full rebuild whenever the
 * list is replaced instead of appended to (an import, a reset, a clear).
 */
export function createSessionProjection(): (
  events: TraceEvent[],
) => TraceSession[] {
  let cache: SessionProjectionCache | null = null;

  const snapshot = (
    events: TraceEvent[],
    sessions: TraceSession[],
    byKey: Map<string, TraceSession>,
  ): TraceSession[] => {
    cache = {
      count: events.length,
      firstId: events[0]?.id || "",
      lastId: events.at(-1)?.id || "",
      midId: events[events.length >> 1]?.id || "",
      sessions,
      byKey,
    };
    return sessions;
  };

  const fullBuild = (events: TraceEvent[]) => {
    const grouped = new Map<string, TraceEvent[]>();
    const knownIds = new Set<string>();
    for (const event of events) {
      if (knownIds.has(event.id)) {
        continue;
      }
      knownIds.add(event.id);
      const key = getSessionKey(event);
      const bucket = grouped.get(key);
      if (bucket) {
        bucket.push(event);
      } else {
        grouped.set(key, [event]);
      }
    }
    const byKey = new Map<string, TraceSession>();
    for (const [key, sessionEvents] of grouped) {
      byKey.set(key, createSession(key, sessionEvents));
    }
    return snapshot(
      events,
      [...byKey.values()].sort(bySessionStartDesc),
      byKey,
    );
  };

  return (events) => {
    if (cache === null) {
      return fullBuild(events);
    }
    const current = cache;
    if (events.length === current.count) {
      const unchanged =
        (events[0]?.id || "") === current.firstId &&
        (events.at(-1)?.id || "") === current.lastId &&
        (events[events.length >> 1]?.id || "") === current.midId;
      return unchanged ? current.sessions : fullBuild(events);
    }
    const appendedOnly =
      events.length > current.count &&
      (events[0]?.id || "") === current.firstId &&
      (events[current.count - 1]?.id || "") === current.lastId;
    if (!appendedOnly) {
      return fullBuild(events);
    }

    const touched = new Map<string, TraceEvent[]>();
    for (let index = current.count; index < events.length; index += 1) {
      const event = events[index];
      const key = getSessionKey(event);
      const bucket = touched.get(key);
      if (bucket) {
        bucket.push(event);
      } else {
        touched.set(key, [event]);
      }
    }
    for (const [key, appended] of touched) {
      const previous = current.byKey.get(key);
      current.byKey.set(
        key,
        createSession(
          key,
          previous ? [...previous.events, ...appended] : appended,
        ),
      );
    }
    return snapshot(
      events,
      [...current.byKey.values()].sort(bySessionStartDesc),
      current.byKey,
    );
  };
}

function isExecutionProgressEvent(event: TraceEvent) {
  return [
    "AgentMessage",
    "ElicitationResult",
    "PostToolUse",
    "PreToolUse",
    "Reasoning",
    "SubagentStart",
    "SubagentStop",
  ].includes(event.eventName);
}

function getToolStatus(postEvent: TraceEvent | null) {
  if (!postEvent) {
    return "running";
  }
  return isToolFailureEvent(postEvent) ? "failed" : "complete";
}

function createFlowEntries(events: TraceEvent[]): FlowEntry[] {
  const entries: FlowEntry[] = [];
  const toolEntries = new Map<string, FlowEntry[]>();
  const usedIds = new Set<string>();

  events.forEach((event, stepIndex) => {
    if (event.eventName === "UserPromptSubmit") toolEntries.clear();
    const toolKey = JSON.stringify([
      getSessionKey(event), event.parentId, event.turnId, event.toolUseId,
    ]);
    if (event.eventName === "PreToolUse") {
      const baseId = `tool-${event.toolUseId || event.id}`;
      let id = baseId;
      while (usedIds.has(id)) id += `:${event.id}`;
      usedIds.add(id);
      const entry = {
        id,
        eventName: "PreToolUse",
        eventNames: ["PreToolUse"],
        startEvent: event,
        endEvent: null,
        timestamp: getEventTimestamp(event),
        stepIndex,
        endStepIndex: null,
      };
      entries.push(entry);
      if (event.toolUseId) {
        const pending = toolEntries.get(toolKey) || [];
        pending.push(entry);
        toolEntries.set(toolKey, pending);
      }
      return;
    }

    if (
      ["PostToolUse", "PostToolUseFailure"].includes(event.eventName) &&
      event.toolUseId
    ) {
      const entry = toolEntries.get(toolKey)?.shift();
      if (entry) {
        entry.endEvent = event;
        entry.endStepIndex = stepIndex;
        entry.eventNames.push(event.eventName);
        return;
      }
    }

    entries.push({
      id: `event-${event.id}`,
      eventName: event.eventName,
      eventNames: [event.eventName],
      startEvent: event,
      endEvent: null,
      timestamp: getEventTimestamp(event),
      stepIndex,
      endStepIndex: null,
    });
  });

  return entries.sort((left, right) => left.timestamp - right.timestamp);
}

export function getFlowNodeIdForEvent(
  event?: TraceEvent | null,
  nodes?: readonly TraceNode[],
) {
  if (nodes) {
    return nodes.find((node) => node.data.startEvent.id === event?.id ||
      node.data.endEvent?.id === event?.id)?.id || "";
  }
  if (
    event?.toolUseId &&
    ["PreToolUse", "PostToolUse", "PostToolUseFailure"].includes(
      event.eventName,
    )
  ) {
    return `tool-${event.toolUseId}`;
  }
  return event ? `event-${event.id}` : "";
}

export function buildFlow(
  events: TraceEvent[],
  enabledTypes = new Set(eventOrder),
): TraceFlow {
  const entries = createFlowEntries(events).filter((entry) => {
    const hasKnownEnabledType = entry.eventNames.some((name) =>
      enabledTypes.has(name),
    );
    const hasUnknownType = entry.eventNames.some((name) => !eventMeta[name]);
    return (
      hasKnownEnabledType ||
      (hasUnknownType && enabledTypes.has("Unknown"))
    );
  });
  const laneCounts = new Map<number, number>();
  const nodes: TraceNode[] = entries.map((entry, index) => {
    const meta = eventMeta[entry.eventName] || eventMeta.Unknown;
    const laneIndex = laneCounts.get(meta.lane) || 0;
    laneCounts.set(meta.lane, laneIndex + 1);
    const startTime = getEventTimestamp(entry.startEvent);
    const endTime = entry.endEvent
      ? getEventTimestamp(entry.endEvent)
      : startTime;
    const toolStatus =
      entry.eventName === "PreToolUse"
        ? getToolStatus(entry.endEvent)
        : null;

    return {
      id: entry.id,
      type: "trace" as const,
      position: {
        x: 36 + meta.lane * 330,
        y: 30 + index * 142,
      },
      data: {
        ...entry,
        index,
        label:
          entry.startEvent.toolName ||
          entry.startEvent.payload?.notification_type ||
          meta.label,
        meta,
        status:
          toolStatus ||
          (["Stop", "SessionEnd"].includes(entry.eventName)
            ? "complete"
            : entry.startEvent.status || "recorded"),
        duration: entry.endEvent ? Math.max(0, endTime - startTime) : null,
      },
    };
  });

  const edges = nodes.slice(1).map((node, index) => ({
    id: `edge-${nodes[index].id}-${node.id}`,
    source: nodes[index].id,
    target: node.id,
    type: "smoothstep",
    animated: node.data.status === "running",
    style: { stroke: "var(--edge)", strokeWidth: 1.4 },
  }));

  return { nodes, edges };
}

export function buildHarnessFlow(
  inputEvents: Array<TraceEvent | TraceEventInput>,
  platformId = "codex",
) {
  return buildExecutionTopology(inputEvents.map(normalizeTraceEvent), platformId);
}

type SearchField = { path: string; value: string };

function collectSearchFields(
  value: unknown,
  path = "",
  output: SearchField[] = [],
  seen = new WeakSet<object>(),
): SearchField[] {
  if (value === null || value === undefined) {
    return output;
  }
  if (typeof value === "object") {
    if (seen.has(value)) {
      return output;
    }
    seen.add(value);
    for (const [key, child] of Object.entries(value)) {
      collectSearchFields(child, path ? `${path}.${key}` : key, output, seen);
    }
    return output;
  }
  output.push({ path, value: String(value) });
  return output;
}

function createSnippet(value: string, matchIndex: number, matchLength: number) {
  const start = Math.max(0, matchIndex - 62);
  const end = Math.min(value.length, matchIndex + matchLength + 98);
  return `${start ? "..." : ""}${value.slice(start, end)}${
    end < value.length ? "..." : ""
  }`;
}

export function searchTraceEvents(
  events: Array<TraceEvent | TraceEventInput>,
  query: string,
) {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return [];
  }

  return events.flatMap((inputEvent) => {
    const event = normalizeTraceEvent(inputEvent);
    const fields = collectSearchFields({
      locator: event.locator,
      id: event.id,
      source: event.source,
      sessionId: event.sessionId,
      eventName: event.eventName,
      nativeEventName: event.nativeEventName,
      toolName: event.toolName,
      cwd: event.cwd,
      payload: event.payload,
    });
    const match = fields.find(
      ({ path, value }) =>
        path.toLowerCase().includes(needle) ||
        value.toLowerCase().includes(needle),
    );
    if (!match) {
      return [];
    }
    const searchableValue = match.path.toLowerCase().includes(needle)
      ? `${match.path}: ${match.value}`
      : match.value;
    const matchIndex = searchableValue.toLowerCase().indexOf(needle);
    return [{
      event,
      eventId: event.id,
      sessionKey: getSessionKey(event),
      locator: event.locator,
      path: match.path,
      snippet: createSnippet(searchableValue, matchIndex, needle.length),
    }];
  });
}

export function createDemoEvents(now = Date.now()): TraceEvent[] {
  const sessionId = "demo-runtime-7f31";
  const definitions: Array<[number, string, TracePayload]> = [
    [-9200, "SessionStart", {}],
    [
      -8800,
      "UserPromptSubmit",
      {
        prompt: "Trace this agent run and render the execution topology.",
        turn: 1,
        turn_id: "demo-turn-1",
      },
    ],
    [
      -8260,
      "Reasoning",
      {
        summary: "Inspect the runtime structure and identify the active data flow.",
        turn: 1,
        turn_id: "demo-turn-1",
      },
    ],
    [
      -7720,
      "PreToolUse",
      {
        tool_use_id: "tool-read",
        tool_name: "Read",
        tool_input: { path: "src/app.tsx" },
        turn: 1,
        turn_id: "demo-turn-1",
      },
    ],
    [
      -7040,
      "PostToolUse",
      {
        tool_use_id: "tool-read",
        tool_name: "Read",
        tool_response: { status: "ok", bytes: 18420 },
        turn: 1,
        turn_id: "demo-turn-1",
      },
    ],
    [
      -6420,
      "Reasoning",
      {
        summary: "Locate the topology, trajectory, and inspector components.",
        turn: 2,
        turn_id: "demo-turn-2",
      },
    ],
    [
      -5940,
      "PreToolUse",
      {
        tool_use_id: "tool-search",
        tool_name: "Search",
        tool_input: {
          query: "trajectory-row topology-routing-indicator inspector-header",
          path: "src",
        },
        turn: 2,
        turn_id: "demo-turn-2",
      },
    ],
    [
      -5480,
      "PostToolUse",
      {
        tool_use_id: "tool-search",
        tool_name: "Search",
        tool_response: { status: "ok", matches: 18, files: 3 },
        turn: 2,
        turn_id: "demo-turn-2",
      },
    ],
    [
      -4860,
      "PreToolUse",
      {
        tool_use_id: "tool-edit",
        tool_name: "Edit",
        tool_input: {
          path: "src/app.tsx",
          replacements: 6,
          scope: "trajectory hierarchy and inspector header",
        },
        turn: 2,
        turn_id: "demo-turn-2",
      },
    ],
    [
      -3980,
      "PostToolUse",
      {
        tool_use_id: "tool-edit",
        tool_name: "Edit",
        tool_response: {
          status: "ok",
          changedLines: 142,
          files: ["src/app.tsx", "src/styles.css"],
        },
        turn: 2,
        turn_id: "demo-turn-2",
      },
    ],
    [
      -3260,
      "Reasoning",
      {
        summary: "Validate hierarchy, responsive layout, and event selection.",
        turn: 3,
        turn_id: "demo-turn-3",
      },
    ],
    [
      -2680,
      "PreToolUse",
      {
        tool_use_id: "tool-test",
        tool_name: "RunCommand",
        tool_input: { cmd: "pnpm test && pnpm build" },
        turn: 3,
        turn_id: "demo-turn-3",
      },
    ],
    [
      -1460,
      "PostToolUse",
      {
        tool_use_id: "tool-test",
        tool_name: "RunCommand",
        tool_response: {
          exitCode: 0,
          stdout: "25 tests passed; production build complete",
        },
        turn: 3,
        turn_id: "demo-turn-3",
      },
    ],
    [
      -920,
      "AgentMessage",
      {
        message: "The loop-aware execution trajectory is ready.",
        turn: 3,
        turn_id: "demo-turn-3",
      },
    ],
    [
      -420,
      "Notification",
      {
        notification_type: "idle_prompt",
        message: "Agent completed the task.",
        turn: 3,
        turn_id: "demo-turn-3",
      },
    ],
    [
      0,
      "Stop",
      {
        last_assistant_message: "Implementation complete. Tests passed.",
        loop_count: 3,
        turn: 3,
        turn_id: "demo-turn-3",
      },
    ],
  ];

  return definitions.map(([offset, eventName, details], index) =>
    normalizeTraceEvent({
      schemaVersion: 2,
      id: `demo-${index}`,
      capturedAt: new Date(now + offset).toISOString(),
      source: "codex",
      workspaceId: "demo-workspace",
      sessionId,
      eventName,
      toolUseId: details.tool_use_id || null,
      toolName: details.tool_name || null,
      cwd: "/workspace/astro",
      payload: {
        session_id: sessionId,
        event_name: eventName,
        cwd: "/workspace/astro",
        ...details,
      },
    }),
  );
}

export const supportedEventTypes = eventOrder;
