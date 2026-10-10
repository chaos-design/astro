import {
  foldAtomicEvents,
  type AtomicFlowEvent,
} from "../vendor/atomic-flow/browser";
import {
  Bot,
  BrainCircuit,
  CircleDashed,
  CirclePlay,
  Gauge,
  GitBranch,
  GitPullRequestArrow,
  LoaderCircle,
  MemoryStick,
  MessageSquareText,
  Repeat2,
  ShieldCheck,
  TerminalSquare,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import {
  guideAtomCopy,
  guideSectionCopy,
} from "../config/atom-guide-copy";
import { atomLevel } from "../lib/atomic-projection";
import { createFlowLayoutKey, refreshFlowLayout } from "../lib/flow-layout-cache";
import { FlowLayoutClient } from "../lib/flow-layout-client";
import type { FlowLayout, RoutedTopologyEdge } from "../lib/flow-layout";
import type {
  AtomStatus,
  ExecutionTopology,
  HarnessNode,
  LayerDefinition,
} from "../types/trace";

const CANVAS_INSET = 12;
const MAX_CANVAS_SCALE = 1.08;
const MIN_INITIAL_LAYOUT_MS = 1_500;
const FLOW_SIGNAL_MIN_DURATION = 1.8;
const FLOW_SIGNAL_MAX_DURATION = 4;
const FLOW_SIGNAL_SPEED = 160;
const MAX_CACHED_LAYOUTS = 32;
const layoutClient = new FlowLayoutClient();
const layoutCache = new Map<string, Promise<FlowLayout>>();

const atomIcons: Readonly<Record<string, LucideIcon>> = {
  agent: Bot,
  checkpoint: CircleDashed,
  context: MemoryStick,
  gate: ShieldCheck,
  handoff: GitPullRequestArrow,
  input: MessageSquareText,
  loop: Repeat2,
  model: BrainCircuit,
  observation: GitBranch,
  output: GitBranch,
  question: MessageSquareText,
  reasoning: BrainCircuit,
  run: CirclePlay,
  subagent: Bot,
  telemetry: CircleDashed,
  tool: TerminalSquare,
  usage: Gauge,
};

type AtomRuntimeView = {
  count: number;
  latestSequence?: number;
  status: AtomStatus;
};

type RuntimeCanvasProps = {
  activeAtomId: string;
  activeEdgeIds: ReadonlySet<string>;
  atomicEvents: readonly AtomicFlowEvent[];
  deepView: boolean;
  locateRequest: number;
  onSelectNode: (node: HarnessNode) => void;
  selectedAtomId: string;
  topology: ExecutionTopology;
};

export const RuntimeCanvas = memo(function RuntimeCanvas({
  activeAtomId,
  activeEdgeIds,
  atomicEvents,
  deepView,
  locateRequest,
  onSelectNode,
  selectedAtomId,
  topology,
}: RuntimeCanvasProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const locateRequestRef = useRef(locateRequest);
  const locateTimerRef = useRef<number | undefined>(undefined);
  const initialLayoutStartedRef = useRef(Date.now());
  const initialLayoutResolvedRef = useRef(false);
  const layoutTimerRef = useRef<number | undefined>(undefined);
  const [viewport, setViewport] = useState({ height: 0, width: 0 });
  const [routedLayout, setLayout] = useState<FlowLayout>();
  const [layoutError, setLayoutError] = useState("");
  const [layoutPending, setLayoutPending] = useState(true);
  const [locatedAtomId, setLocatedAtomId] = useState("");
  const visibleTopology = useMemo(
    () => topologyForView(topology, deepView),
    [deepView, topology],
  );
  const graphKey = useMemo(
    () => createFlowLayoutKey(visibleTopology),
    [visibleTopology],
  );
  const layout = useMemo(
    () => routedLayout && refreshFlowLayout(routedLayout, visibleTopology),
    [routedLayout, visibleTopology],
  );
  const requestLayout = useEffectEvent(() => layoutClient.layout(visibleTopology));
  const runtimeViews = useMemo(
    () => runtimeViewsForEvents(atomicEvents),
    [atomicEvents],
  );

  useEffect(() => {
    let active = true;
    setLayoutPending(true);
    setLayoutError("");
    let request = layoutCache.get(graphKey);
    if (request === undefined) {
      request = requestLayout();
      layoutCache.set(graphKey, request);
      if (layoutCache.size > MAX_CACHED_LAYOUTS) {
        layoutCache.delete(layoutCache.keys().next().value!);
      }
      void request.catch(() => {
        if (layoutCache.get(graphKey) === request) {
          layoutCache.delete(graphKey);
        }
      });
    }
    void request
      .then((nextLayout) => {
        const commitLayout = () => {
          if (!active) {
            return;
          }
          initialLayoutResolvedRef.current = true;
          setLayout(nextLayout);
          setLayoutPending(false);
        };
        if (initialLayoutResolvedRef.current) {
          commitLayout();
          return;
        }
        const elapsed = Date.now() - initialLayoutStartedRef.current;
        layoutTimerRef.current = window.setTimeout(
          commitLayout,
          Math.max(0, MIN_INITIAL_LAYOUT_MS - elapsed),
        );
      })
      .catch((cause: unknown) => {
        if (active) {
          setLayoutError(cause instanceof Error ? cause.message : String(cause));
          setLayoutPending(false);
        }
      });
    return () => {
      active = false;
      window.clearTimeout(layoutTimerRef.current);
    };
  }, [graphKey]);

  useLayoutEffect(() => {
    const element = viewportRef.current;
    if (element === null) {
      return;
    }
    const measure = () => {
      const bounds = element.getBoundingClientRect();
      setViewport((current) =>
        current.width === bounds.width && current.height === bounds.height
          ? current
          : { height: bounds.height, width: bounds.width },
      );
    };
    measure();
    const observer =
      typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
    observer?.observe(element);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  useEffect(() => {
    if (locateRequestRef.current === locateRequest || !selectedAtomId) {
      return;
    }
    const node = viewportRef.current?.querySelector<HTMLDivElement>(
      `[data-node-id="${CSS.escape(selectedAtomId)}"]`,
    );
    if (!node) {
      return;
    }
    locateRequestRef.current = locateRequest;
    window.clearTimeout(locateTimerRef.current);
    setLocatedAtomId(selectedAtomId);
    node.focus({ preventScroll: true });
    locateTimerRef.current = window.setTimeout(
      () => setLocatedAtomId(""),
      1_800,
    );
  }, [layout, locateRequest, selectedAtomId]);

  useEffect(
    () => () => window.clearTimeout(locateTimerRef.current),
    [],
  );

  const scale = canvasContainScale(
    layout?.width ?? 0,
    layout?.height ?? 0,
    viewport.width,
    viewport.height,
  );
  const scaledWidth = (layout?.width ?? 0) * scale;
  const scaledHeight = (layout?.height ?? 0) * scale;
  const verticalOffset = Math.max(
    0,
    (Math.max(0, viewport.height - CANVAS_INSET * 2) - scaledHeight) / 2,
  );

  return (
    <div
      aria-busy={layoutPending}
      className="runtime-canvas-viewport"
      data-layout-state={layoutPending ? "routing" : layoutError ? "error" : "ready"}
      ref={viewportRef}
    >
      {layout === undefined ? (
        layoutError ? (
          <div className="topology-loading is-error" role="alert">
            {layoutError}
          </div>
        ) : (
          <div className="topology-loading" role="status">
            <span className="topology-loading__status">正在准备拓扑布局</span>
            <svg
              aria-hidden="true"
              className="topology-loading__graph"
              viewBox="0 0 760 320"
            >
              <g className="flow-skeleton-edge is-phase-2">
                <path d="M142 160 H244" />
              </g>
              <g className="flow-skeleton-edge is-phase-3">
                <path d="M332 160 H410" />
                <path d="M332 160 C368 160 370 244 410 244" />
              </g>
              <g className="flow-skeleton-edge is-phase-4">
                <path d="M512 160 H618" />
                <path d="M512 244 C560 244 568 160 618 160" />
              </g>
              <g className="flow-skeleton-node is-input is-phase-1" transform="translate(54 132)">
                <rect height="56" rx="7" width="88" />
                <circle cx="15" cy="28" r="4" />
                <text x="28" y="33">
                  INPUT
                </text>
              </g>
              <g className="flow-skeleton-node is-route is-phase-2" transform="translate(244 132)">
                <rect height="56" rx="7" width="88" />
                <circle cx="15" cy="28" r="4" />
                <text x="28" y="33">
                  ROUTE
                </text>
              </g>
              <g
                className="flow-skeleton-node is-runtime is-phase-3"
                transform="translate(410 132)"
              >
                <rect height="56" rx="7" width="102" />
                <circle cx="15" cy="28" r="4" />
                <text x="28" y="33">
                  RUNTIME
                </text>
              </g>
              <g className="flow-skeleton-node is-tool is-phase-3" transform="translate(410 216)">
                <rect height="56" rx="7" width="102" />
                <circle cx="15" cy="28" r="4" />
                <text x="28" y="33">
                  TOOL
                </text>
              </g>
              <g
                className="flow-skeleton-node is-output is-phase-4"
                transform="translate(618 132)"
              >
                <rect height="56" rx="7" width="88" />
                <circle cx="15" cy="28" r="4" />
                <text x="28" y="33">
                  OUTPUT
                </text>
              </g>
            </svg>
          </div>
        )
      ) : (
        <>
          <div
            className={`runtime-canvas-fit${layoutPending ? " is-reflowing" : ""}`}
            style={{
              height: scaledHeight,
              marginTop: verticalOffset,
              width: scaledWidth,
            }}
          >
            <div
              className={`runtime-canvas${
                locatedAtomId ? " is-locating" : ""
              }`}
              style={{
                height: layout.height,
                transform: `scale(${scale})`,
                width: layout.width,
              }}
            >
              {layout.layers.map((layer) => (
                <DomainZone key={layer.id} layer={layer} />
              ))}
              <FlowEdges
                activeEdgeIds={activeEdgeIds}
                edges={layout.edges}
                height={layout.height}
                selectedAtomId={selectedAtomId}
                width={layout.width}
              />
              {layout.nodes.map((node) => (
                <AtomNode
                  active={node.id === activeAtomId}
                  key={node.id}
                  node={node}
                  onSelect={onSelectNode}
                  locating={node.id === locatedAtomId}
                  runtime={runtimeViews.get(node.data.key)}
                  selected={node.id === selectedAtomId}
                />
              ))}
            </div>
          </div>
          {layoutPending ? (
            <div
              aria-label="正在更新拓扑布局"
              className="topology-routing-indicator"
              role="status"
            >
              <LoaderCircle aria-hidden="true" />
            </div>
          ) : null}
          {layoutError ? (
            <div className="topology-routing-error" role="alert">
              {layoutError}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
});

function DomainZone({
  layer,
}: {
  layer: LayerDefinition & { atomIds: string[] };
}) {
  return (
    <section
      className={`topology-domain topology-domain--${layer.id}`}
      style={{
        height: layer.height,
        left: layer.position.x,
        top: layer.position.y,
        width: layer.width,
      }}
    >
      <h2>
        {layer.index} · {layer.label.toUpperCase()}
      </h2>
      <p>{layer.description}</p>
    </section>
  );
}

function AtomNode({
  active,
  locating,
  node,
  onSelect,
  runtime,
  selected,
}: {
  active: boolean;
  locating: boolean;
  node: HarnessNode;
  onSelect: (node: HarnessNode) => void;
  runtime?: AtomRuntimeView;
  selected: boolean;
}) {
  const Icon = atomIcons[node.data.kind] ?? CircleDashed;
  const status = runtime?.status ?? node.data.status;
  const guideCopy = guideAtomCopy[node.data.id];
  const displayLabel = guideCopy?.label || node.data.label;
  const displayDescription = guideCopy?.description || node.data.description;
  return (
    <div
      aria-label={`${displayLabel}：${displayDescription}`}
      aria-pressed={selected}
      role="button"
      tabIndex={0}
      className={`harness-node harness-node--${node.data.tone}${
        selected ? " harness-node--selected" : ""
      }${active ? " is-flow-active" : ""}${
        locating ? " is-locate-target" : ""
      }`}
      data-node-id={node.id}
      onClick={() => onSelect(node)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(node);
        }
      }}
      style={{
        left: node.position.x,
        position: "absolute",
        top: node.position.y,
      }}
    >
      <span
        className={`harness-node__status status-${status}`}
        title={
          status === "complete"
            ? "已完成"
            : status === "failed"
              ? "失败"
              : status === "running"
                ? "执行中"
                : "等待中"
        }
      />
      <span className="harness-node__count">x{runtime?.count ?? node.data.count ?? 0}</span>
      <span className="harness-node__icon">
        <Icon aria-hidden="true" />
      </span>
      <strong>{node.data.label}</strong>
      <span className="harness-node__meta">
        <small>{node.data.key}</small>
        {node.data.iterations ? <i>turn {node.data.iterations}</i> : null}
      </span>
      <span className="harness-node__focus">
        {locating
          ? "LOCATED"
          : selected
            ? "SELECTED"
            : node.data.derived
              ? "INFERRED"
              : node.data.kind.toUpperCase()}
      </span>
      <aside className="harness-node__details" aria-hidden="true">
        <strong>{displayLabel}</strong>
        <p>{displayDescription}</p>
        <dl>
          <div>
            <dt>分类</dt>
            <dd>{guideSectionCopy[node.data.section] || node.data.section}</dd>
          </div>
          <div>
            <dt>输入</dt>
            <dd>{node.data.input.join(", ") || "无"}</dd>
          </div>
          <div>
            <dt>输出</dt>
            <dd>{node.data.output.join(", ") || "无"}</dd>
          </div>
        </dl>
      </aside>
    </div>
  );
}

function FlowEdges({
  activeEdgeIds,
  edges,
  height,
  selectedAtomId,
  width,
}: {
  activeEdgeIds: ReadonlySet<string>;
  edges: readonly RoutedTopologyEdge[];
  height: number;
  selectedAtomId: string;
  width: number;
}) {
  const presentations = edges.map((edge) => {
    const active = activeEdgeIds.has(edge.id);
    const complete = edge.data?.complete === true;
    const focused =
      selectedAtomId !== "" &&
      (edge.source === selectedAtomId || edge.target === selectedAtomId);
    const routeKind = edge.data?.routeKind ?? "execution";
    return {
      active,
      complete,
      duration: Math.min(
        FLOW_SIGNAL_MAX_DURATION,
        Math.max(FLOW_SIGNAL_MIN_DURATION, edge.length / FLOW_SIGNAL_SPEED),
      ),
      trailLength: Math.min(edge.length * 0.45, Math.max(28, Math.min(96, edge.length * 0.14))),
      edge,
      focused,
      routeKind,
    };
  });
  return (
    <svg
      aria-hidden="true"
      className="flow-edges"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      width={width}
    >
      <defs>
        {["execution", "data", "feedback", "persistence"].map(
          (kind) => (
            <marker
              id={`flow-arrow-${kind}`}
              key={kind}
              markerHeight="9"
              markerUnits="userSpaceOnUse"
              markerWidth="9"
              orient="auto"
              overflow="visible"
              refX="9"
              refY="4.5"
              viewBox="0 0 9 9"
            >
              <path className={`flow-arrow-${kind}`} d="M0 0.5L9 4.5L0 8.5Z" />
            </marker>
          ),
        )}
      </defs>
      <g className="flow-edge-track-layer">
        {presentations.map(({ edge }) => (
          <path
            className="flow-edge-track"
            d={edge.path}
            key={edge.id}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </g>
      <g className="flow-edge-line-layer">
        {presentations.map(
          ({ active, complete, edge, focused, routeKind }) => (
          <g
            className={`flow-edge-route flow-edge--${routeKind}${
              complete ? " is-complete" : ""
            }${
              active ? " is-active" : ""
            }${focused ? " is-focused" : ""}`}
            data-edge-id={edge.id}
            key={edge.id}
          >
            <path
              className="flow-edge-casing"
              d={edge.path}
              vectorEffect="non-scaling-stroke"
            />
            <path
              className="flow-edge-line"
              d={edge.path}
              markerEnd={`url(#flow-arrow-${routeKind})`}
              vectorEffect="non-scaling-stroke"
            />
            <path
              className="flow-edge-hit-target"
              d={edge.path}
              vectorEffect="non-scaling-stroke"
            />
            <circle
              className="flow-edge-port"
              cx={edge.startPoint.x}
              cy={edge.startPoint.y}
              r="3"
              vectorEffect="non-scaling-stroke"
            />
          </g>
          ),
        )}
      </g>
      <g className="flow-edge-signal-layer">
        {presentations.filter(({ active }) => active).map(({ duration, edge, trailLength }) => (
          <g
            className="flow-edge-signal"
            data-signal-edge-id={edge.id}
            key={edge.id}
            style={{
              "--flow-signal-duration": `${duration}s`,
              "--flow-signal-distance": `${-edge.length}px`,
            } as CSSProperties}
          >
            <path
              className="flow-edge-signal__halo"
              d={edge.path}
              pathLength={edge.length}
              strokeDasharray={`${trailLength} ${edge.length - trailLength}`}
              vectorEffect="non-scaling-stroke"
            />
            <path
              className="flow-edge-signal__core"
              d={edge.path}
              pathLength={edge.length}
              strokeDasharray={`${trailLength} ${edge.length - trailLength}`}
              vectorEffect="non-scaling-stroke"
            />
          </g>
        ))}
      </g>
    </svg>
  );
}

function topologyForView(
  topology: ExecutionTopology,
  deepView: boolean,
): ExecutionTopology {
  if (deepView) {
    return topology;
  }
  const nodes = topology.nodes.filter((node) => atomLevel(node.data.key) === "runtime");
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = topology.edges.filter(
    (edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target),
  );
  const layers = topology.layers
    .map((layer) => ({
      ...layer,
      atomIds: layer.atomIds.filter((atomId) => nodeIds.has(atomId)),
    }))
    .filter((layer) => layer.atomIds.length > 0);
  return {
    ...topology,
    edges,
    layers,
    nodes,
  };
}

function runtimeViewsForEvents(
  events: readonly AtomicFlowEvent[],
): ReadonlyMap<string, AtomRuntimeView> {
  const folded = foldAtomicEvents(events);
  const instancesByAtom = new Map<string, Array<(typeof folded.instances extends ReadonlyMap<string, infer V> ? V : never)>>();
  for (const instance of folded.instances.values()) {
    const instances = instancesByAtom.get(instance.atom.key) ?? [];
    instances.push(instance);
    instancesByAtom.set(instance.atom.key, instances);
  }
  return new Map(
    [...instancesByAtom].map(([atomKey, instances]) => {
      const latest = instances.toSorted(
        (left, right) => right.lastSequence - left.lastSequence,
      )[0];
      return [
        atomKey,
        {
          count: instances.length,
          latestSequence: latest?.lastSequence,
          status:
            latest?.status === "completed"
              ? "complete"
              : latest?.status === "failed"
                ? "failed"
                : latest?.status === "running"
                  ? "running"
                  : latest?.status === "waiting"
                    ? "waiting"
                    : "idle",
        },
      ];
    }),
  );
}

export function canvasContainScale(
  canvasWidth: number,
  canvasHeight: number,
  viewportWidth: number,
  viewportHeight: number,
): number {
  if (canvasWidth <= 0 || canvasHeight <= 0 || viewportWidth <= 0 || viewportHeight <= 0) {
    return 1;
  }
  const availableWidth = Math.max(1, viewportWidth - CANVAS_INSET * 2);
  const availableHeight = Math.max(1, viewportHeight - CANVAS_INSET * 2);
  return Math.min(
    MAX_CANVAS_SCALE,
    availableWidth / canvasWidth,
    availableHeight / canvasHeight,
  );
}
