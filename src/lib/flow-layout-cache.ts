import type { ExecutionTopology } from "../types/trace.ts";
import type { FlowLayout } from "./flow-layout.ts";

export function createFlowLayoutKey(topology: ExecutionTopology): string {
  return JSON.stringify({
    nodeWidth: topology.meta.nodeWidth,
    nodes: topology.nodes.map((node) => [
      node.id,
      node.position.x,
      node.position.y,
    ]),
    edges: topology.edges.map((edge) => [
      edge.id,
      edge.source,
      edge.target,
      edge.sourceHandle,
      edge.targetHandle,
    ]),
    layers: topology.layers.map((layer) => [
      layer.id,
      layer.position.x,
      layer.position.y,
      layer.width,
      layer.height,
      layer.atomIds,
    ]),
  });
}

// Reuse routed geometry without freezing event data from the first request.
export function refreshFlowLayout(
  layout: FlowLayout,
  topology: ExecutionTopology,
): FlowLayout {
  const nodes = new Map(topology.nodes.map((node) => [node.id, node]));
  const edges = new Map(topology.edges.map((edge) => [edge.id, edge]));
  const layers = new Map(topology.layers.map((layer) => [layer.id, layer]));
  return {
    ...layout,
    nodes: layout.nodes.flatMap((node) => {
      const current = nodes.get(node.id);
      return current ? [{ ...node, data: current.data }] : [];
    }),
    edges: layout.edges.flatMap((route) => {
      const current = edges.get(route.id);
      return current ? [{ ...route, ...current }] : [];
    }),
    layers: layout.layers.flatMap((layer) => {
      const current = layers.get(layer.id);
      return current
        ? [{
            ...current,
            position: layer.position,
            width: layer.width,
            height: layer.height,
          }]
        : [];
    }),
  };
}
