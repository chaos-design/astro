export type { FlowGraphErrorCode, FlowGraphErrorOptions } from "./errors.ts";
export { FlowGraphError } from "./errors.ts";
export type { GraphSegment, SegmentRelation } from "./geometry.ts";
export {
  compactOrthogonalPoints,
  expandRect,
  isOrthogonalRoute,
  isOrthogonalSegment,
  parallelProximity,
  pointInsideRect,
  rectBottom,
  rectRight,
  routeIntersectsRect,
  routeLength,
  segmentIntersectsRectInterior,
  segmentRelation,
  toSegments,
} from "./geometry.ts";
export { OrthogonalRouter } from "./orthogonal-router.ts";
export { offsetOrthogonalRoute } from "./segment-offset.ts";
export { toRoundedSvgPath } from "./svg-path.ts";
export type {
  FlowGraphInput,
  FlowGraphMetrics,
  FlowGraphResult,
  GraphEdge,
  GraphEndpoint,
  GraphNode,
  GraphObstacle,
  GraphPoint,
  GraphRect,
  OrthogonalRouterOptions,
  PortConstraint,
  PortMode,
  PortSide,
  ResolvedPort,
  RouteDiagnostic,
  RouteDiagnosticCode,
  RoutedGraphEdge,
  RouteMetrics,
  SegmentOffsets,
} from "./types.ts";
