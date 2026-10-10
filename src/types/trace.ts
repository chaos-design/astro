export type XYPosition = {
  x: number;
  y: number;
};

export type GraphNode<Data, Type extends string> = {
  id: string;
  type: Type;
  position: XYPosition;
  data: Data;
  draggable?: boolean;
  selectable?: boolean;
  selected?: boolean;
  style?: Record<string, string | number>;
  zIndex?: number;
};

export type GraphEdge<Data = Record<string, unknown>> = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  type?: string;
  label?: string;
  hidden?: boolean;
  animated?: boolean;
  className?: string;
  data?: Data;
  style?: Record<string, string | number>;
  zIndex?: number;
};

export type TracePayload = {
  [key: string]: unknown;
  agent_id?: string;
  call_id?: string;
  command?: string;
  content?: unknown;
  cwd?: string;
  error?: unknown;
  exitCode?: number;
  hook_event_name?: string;
  last_assistant_message?: string;
  llm_tool_name?: string;
  matcher?: string;
  message?: string;
  name?: string;
  notification_type?: string;
  payload?: TracePayload;
  prompt?: string;
  reason?: string;
  retry?: boolean;
  session_id?: string;
  source?: string;
  status?: string;
  subagent_id?: string;
  summary?: string;
  task_id?: string;
  text?: string;
  thread_id?: string;
  timestamp?: string;
  tool_input?: TracePayload;
  tool_name?: string;
  tool_response?: TracePayload;
  tool_use_id?: string;
  turn_id?: string;
  type?: string;
};

export type TraceEventInput = {
  capturedAt?: string;
  cwd?: string | null;
  event_name?: string;
  eventName?: string;
  hook_event_name?: string;
  id?: string;
  locator?: string;
  nativeEventName?: string;
  parent_id?: string;
  parentId?: string | null;
  payload?: TracePayload;
  schemaVersion?: number;
  sequence?: number | null;
  session_id?: string;
  sessionId?: string;
  source?: string;
  source_version?: string;
  sourceVersion?: string | null;
  status?: string | null;
  timestamp?: string;
  tool_name?: string;
  tool_use_id?: string;
  toolName?: string | null;
  toolUseId?: string | null;
  turn_id?: string;
  turnId?: string | null;
  workspace_id?: string;
  workspaceId?: string;
};

export type TraceEvent = {
  schemaVersion: number;
  id: string;
  capturedAt: string;
  source: string;
  sourceVersion: string | null;
  workspaceId: string;
  sessionId: string;
  turnId: string | null;
  parentId: string | null;
  eventName: string;
  nativeEventName: string;
  toolUseId: string | null;
  toolName: string | null;
  cwd: string | null;
  status: string | null;
  sequence: number | null;
  payload: TracePayload;
  locator: string;
};

export type EventTone =
  | "agent"
  | "complete"
  | "failed"
  | "prompt"
  | "reasoning"
  | "session"
  | "signal"
  | "tool"
  | "unknown";

/**
 * Common, user-facing message categories used to filter trace events.
 * These group the raw event names into semantic buckets for the observability
 * UI. Events without a canonical mapping fall back to `session`, so every
 * known and unknown event is covered by one of these buckets.
 */
export type MessageCategory =
  | "prompt"
  | "agent"
  | "reasoning"
  | "tool"
  | "interaction"
  | "subagent"
  | "session";

export type EventMeta = {
  label: string;
  tone: EventTone;
  lane: number;
};

export type AtomStatus =
  | "complete"
  | "failed"
  | "idle"
  | "running"
  | "waiting";

export type AtomDefinition = {
  id: string;
  key: string;
  label: string;
  section: string;
  layer: string;
  kind: string;
  tone: string;
  position: XYPosition;
  eventTypes: string[];
  countEventTypes?: string[];
  input: string[];
  output: string[];
  description: string;
};

export type LayerDefinition = {
  id: string;
  index: string;
  label: string;
  description: string;
  tone: string;
  position: XYPosition;
  width: number;
  height: number;
  atomIds?: string[];
};

export type EdgeDefinition = [
  source: string,
  target: string,
  label?: string,
  kind?: string,
  sourceHandle?: string,
  targetHandle?: string,
  waypoints?: XYPosition[],
  condition?: string,
];

export type PlatformId =
  | "claude"
  | "codex"
  | "deepseek"
  | "opencode"
  | "trae"
  | "zcode"
  | "workbuddy"
  | "gemini"
  | "qwen"
  | "copilot"
  | "cursor"
  | "cline"
  | "windsurf"
  | "iflow";

export type PlatformDefinition = {
  id: PlatformId;
  label: string;
  source: string;
  runtime: string;
  eventAtomMap: Record<string, string>;
  /**
   * Canonical event names whose arrival marks the run as pending ("waiting")
   * for this agent. When omitted, the shared default waiting detection
   * applies. Configure this per agent so the pending display matches what the
   * agent can actually report (e.g. ZCode cannot capture Elicitation or
   * Notification events).
   */
  waitingEvents?: readonly string[];
};

export type PlatformConfig = PlatformDefinition & {
  atoms: AtomDefinition[];
  edges: EdgeDefinition[];
  layers: LayerDefinition[];
};

export type HarnessNodeData = AtomDefinition & {
  [key: string]: unknown;
  actor: string;
  count: number;
  derived?: boolean;
  endEvent: TraceEvent | null;
  event: TraceEvent | null;
  eventIds: string[];
  flowActive?: boolean;
  gateState: string | null;
  index: number;
  iterations: number;
  meta: { tone: string };
  platform: PlatformId;
  startEvent: TraceEvent | null;
  status: AtomStatus;
  subagentId?: string;
};

export type LayerNodeData = LayerDefinition & {
  [key: string]: unknown;
  atomCount: number;
  atomIds: string[];
};

export type RouteKind = "data" | "execution" | "feedback" | "persistence";

export type SignalEdgeData = {
  [key: string]: unknown;
  active: boolean;
  complete?: boolean;
  delay: number;
  dimmed?: boolean;
  duration: number;
  focused?: boolean;
  kind: string;
  routeKind: RouteKind;
  labelPosition?: XYPosition;
  transitionKey?: string;
  waypoints: XYPosition[];
};

export type HarnessNode = GraphNode<HarnessNodeData, "harness">;
export type LayerNode = GraphNode<LayerNodeData, "layer">;
export type SignalEdge = GraphEdge<SignalEdgeData>;

export type ExecutionTopology = {
  nodes: HarnessNode[];
  edges: SignalEdge[];
  layers: Array<LayerDefinition & { atomIds: string[] }>;
  platform: PlatformConfig;
  meta: {
    subagentCount: number;
    toolCount: number;
    complete: boolean;
    nodeWidth: number;
    nodeHeight: number;
  };
};

export type FlowEntry = {
  id: string;
  eventName: string;
  eventNames: string[];
  startEvent: TraceEvent;
  endEvent: TraceEvent | null;
  timestamp: number;
  stepIndex: number;
  endStepIndex: number | null;
};

export type TraceNodeData = FlowEntry & {
  [key: string]: unknown;
  duration: number | null;
  index: number;
  label: string;
  meta: EventMeta;
  status: string;
};

export type TraceNode = GraphNode<TraceNodeData, "trace">;

export type TraceFlow = {
  nodes: TraceNode[];
  edges: GraphEdge[];
};

export type TraceRunStatus =
  | "active"
  | "complete"
  | "failed"
  | "terminated"
  | "waiting";

export type TraceSession = {
  key: string;
  id: string;
  source: string;
  workspaceId: string;
  cwd: string | null;
  events: TraceEvent[];
  title: string;
  start: number;
  end: number;
  duration: number;
  status: TraceRunStatus;
  toolCount: number;
};

export type TracePromptRun = {
  key: string;
  sessionKey: string;
  sessionId: string;
  source: string;
  workspaceId: string;
  cwd: string | null;
  prompt: TraceEvent;
  events: TraceEvent[];
  title: string;
  index: number;
  role: "initial" | "follow-up";
  start: number;
  end: number;
  duration: number;
  status: TraceRunStatus;
  toolCount: number;
};
