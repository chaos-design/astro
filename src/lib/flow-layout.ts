import {
  type FlowGraphMetrics,
  type GraphEdge,
  type GraphPoint,
  type GraphRect,
  OrthogonalRouter,
  type PortConstraint,
  type RouteDiagnostic,
} from "../vendor/flow-graph/index.ts";
import type {
  ExecutionTopology,
  HarnessNode,
  LayerDefinition,
  SignalEdge,
} from "../types/trace.ts";

const CANVAS_PADDING = 24;
const NODE_HEIGHT = 60;
const ROUTER = new OrthogonalRouter({
  bendPenalty: 32,
  clearance: 12,
  crossingPenalty: 960,
  maxCoordinatesPerAxis: 72,
  maxOptimizationPasses: 32,
  parallelGap: 16,
  portStubLength: 18,
});

export type RoutedTopologyEdge = SignalEdge & {
  endPoint: GraphPoint;
  fallback: boolean;
  length: number;
  path: string;
  points: readonly GraphPoint[];
  startPoint: GraphPoint;
};

export type FlowLayout = {
  diagnostics: readonly RouteDiagnostic[];
  edges: readonly RoutedTopologyEdge[];
  height: number;
  layers: readonly (LayerDefinition & { atomIds: string[] })[];
  metrics: FlowGraphMetrics;
  nodes: readonly HarnessNode[];
  width: number;
};

export function createFlowLayout(topology: ExecutionTopology): FlowLayout {
  const nodeById = new Map(topology.nodes.map((node) => [node.id, node]));
  const layerByNodeId = new Map<string, LayerDefinition>();
  for (const layer of topology.layers) {
    for (const atomId of layer.atomIds) {
      layerByNodeId.set(atomId, layer);
    }
  }
  const canvasRouteBounds = topologyBounds(topology);

  const result = ROUTER.route({
    edges: topology.edges.map((edge) =>
      toGraphEdge(edge, layerByNodeId, canvasRouteBounds),
    ),
    nodes: topology.nodes.map((node) => ({
      bounds: nodeBounds(node),
      id: node.id,
    })),
    obstacles: topology.layers.map((layer) => ({
      bounds: layerHeaderBounds(layer),
      id: `${layer.id}:header`,
      padding: 0,
    })),
  });
  const routeById = new Map(result.routes.map((route) => [route.id, route]));
  const edges = topology.edges.flatMap((edge) => {
    const route = routeById.get(edge.id);
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (route === undefined || source === undefined || target === undefined) {
      return [];
    }
    const startPoint = route.points[0];
    const endPoint = route.points.at(-1);
    if (startPoint === undefined || endPoint === undefined) {
      return [];
    }
    return [
      {
        ...edge,
        endPoint,
        fallback: route.fallback,
        length: route.length,
        path: route.path,
        points: route.points,
        startPoint,
      },
    ];
  });

  let width = canvasRouteBounds.width;
  let height = canvasRouteBounds.height;
  for (const edge of edges) {
    for (const point of edge.points) {
      width = Math.max(width, point.x + CANVAS_PADDING);
      height = Math.max(height, point.y + CANVAS_PADDING);
    }
  }

  return {
    diagnostics: result.diagnostics,
    edges,
    height,
    layers: topology.layers,
    metrics: result.metrics,
    nodes: topology.nodes,
    width,
  };
}

function toGraphEdge(
  edge: SignalEdge,
  layerByNodeId: ReadonlyMap<string, LayerDefinition>,
  canvasRouteBounds: GraphRect,
): GraphEdge {
  const sourceLayer = layerByNodeId.get(edge.source);
  const targetLayer = layerByNodeId.get(edge.target);
  const routeBounds =
    sourceLayer !== undefined && sourceLayer.id === targetLayer?.id
      ? layerBounds(sourceLayer)
      : canvasRouteBounds;
  return {
    id: edge.id,
    routeBounds,
    source: {
      nodeId: edge.source,
      port: portFromHandle(edge.sourceHandle),
    },
    target: {
      nodeId: edge.target,
      port: portFromHandle(edge.targetHandle),
    },
  };
}

function topologyBounds(topology: ExecutionTopology): GraphRect {
  let width = CANVAS_PADDING;
  let height = CANVAS_PADDING;
  for (const layer of topology.layers) {
    width = Math.max(width, layer.position.x + layer.width + CANVAS_PADDING);
    height = Math.max(height, layer.position.y + layer.height + CANVAS_PADDING);
  }
  for (const node of topology.nodes) {
    width = Math.max(width, node.position.x + topology.meta.nodeWidth + CANVAS_PADDING);
    height = Math.max(height, node.position.y + NODE_HEIGHT + CANVAS_PADDING);
  }
  return { height, width, x: 0, y: 0 };
}

function portFromHandle(handle: string | undefined): PortConstraint {
  const side = handle?.split("-").at(-1);
  if (side === "top" || side === "right" || side === "bottom" || side === "left") {
    return { mode: "fixed", side };
  }
  return { mode: "preferred" };
}

function nodeBounds(node: HarnessNode): GraphRect {
  return {
    height: NODE_HEIGHT,
    width: 180,
    x: node.position.x,
    y: node.position.y,
  };
}

function layerBounds(layer: LayerDefinition): GraphRect {
  return {
    height: layer.height,
    width: layer.width,
    x: layer.position.x,
    y: layer.position.y,
  };
}

function layerHeaderBounds(layer: LayerDefinition): GraphRect {
  return {
    height: 42,
    width: Math.min(230, layer.width - 20),
    x: layer.position.x + 8,
    y: layer.position.y + 2,
  };
}
