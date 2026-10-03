import type { AtomicFlowEvent } from "./types.ts";

export function isTraceObservationEvent(event: AtomicFlowEvent): boolean {
  return event.atom.kind === "trace" || event.atom.kind === "trajectory";
}
