import type { AtomicFlowEvent, AtomicPhase } from "../vendor/atomic-flow/browser.ts";
import type { HarnessNode, TraceEvent } from "../types/trace.ts";

const RUN_CONTEXT_KEYS = new Set([
  "session.resume",
  "stage.start",
  "prompt.input",
  "run",
  "agent.select",
  "memory.recall",
]);

export type TrajectoryAtom = {
  atomId: string;
  count: number;
  duration: number;
  event: TraceEvent;
  id: string;
  key: string;
  kind: string;
  label: string;
  occurredAt: string;
  sequence: number;
  status: "complete" | "failed" | "idle" | "running" | "waiting";
  summary: string;
  tone: string;
  turn: number;
};

export type TrajectoryTurn = {
  atoms: TrajectoryAtom[];
  duration: number;
  event: TraceEvent;
  occurredAt: string;
  status: TrajectoryAtom["status"];
  summary: string;
  turn: number;
};

export type TrajectoryModel = {
  context: TrajectoryAtom[];
  turns: TrajectoryTurn[];
};

export type TrajectorySegmentPosition = {
  left: number;
  width: number;
};

type MutableTrajectoryAtom = TrajectoryAtom & {
  lastOccurredAt: string;
};

export function getTrajectorySegmentPosition(
  index: number,
  itemCount: number,
): TrajectorySegmentPosition {
  const slotCount = Math.max(1, itemCount);
  const slot = Math.max(0, Math.min(index, slotCount - 1));
  return {
    left: (slot / slotCount) * 100,
    width: (1 / slotCount) * 100,
  };
}

export function buildTraceTurnIndex(
  events: readonly TraceEvent[],
): ReadonlyMap<string, number> {
  const turnByEventId = new Map<string, number>();
  const explicitTurns = new Map<string, number>();
  let currentTurn = 1;
  let hasSeenPrompt = false;
  let loopClosed = false;

  for (const event of events) {
    const payloadTurn = event.payload.turn ?? event.payload.iteration;
    const numericTurn =
      typeof payloadTurn === "number" &&
      Number.isSafeInteger(payloadTurn) &&
      payloadTurn > 0
        ? payloadTurn
        : undefined;

    if (numericTurn !== undefined) {
      currentTurn = numericTurn;
    } else if (event.turnId) {
      const knownTurn = explicitTurns.get(event.turnId);
      if (knownTurn !== undefined) {
        currentTurn = knownTurn;
      } else {
        const assignedTurn = Math.max(currentTurn, explicitTurns.size + 1);
        explicitTurns.set(event.turnId, assignedTurn);
        currentTurn = assignedTurn;
      }
    } else if (event.eventName === "UserPromptSubmit") {
      if (hasSeenPrompt) {
        currentTurn += 1;
      }
      hasSeenPrompt = true;
      loopClosed = false;
    } else if (
      loopClosed &&
      ["Reasoning", "PreToolUse", "AgentMessage"].includes(event.eventName)
    ) {
      currentTurn += 1;
      loopClosed = false;
    }

    turnByEventId.set(event.id, currentTurn);

    if (["PostToolUse", "PostToolUseFailure"].includes(event.eventName)) {
      loopClosed = true;
    }
  }

  return turnByEventId;
}

export function buildTrajectoryModel(
  events: readonly TraceEvent[],
  atomicEvents: readonly AtomicFlowEvent[],
  nodes: readonly HarnessNode[],
): TrajectoryModel {
  const traceEventById = new Map(events.map((event) => [event.id, event]));
  const turnByEventId = buildTraceTurnIndex(events);
  const nodeByKey = new Map(nodes.map((node) => [node.data.key, node]));
  const aggregated = new Map<string, MutableTrajectoryAtom>();

  for (const atomicEvent of atomicEvents) {
    if (atomicEvent.atom.key === "loop.turn") {
      continue;
    }
    const traceEventId = atomicEvent.payload?.values?.traceEventId;
    if (typeof traceEventId !== "string") {
      continue;
    }
    const traceEvent = traceEventById.get(traceEventId);
    if (!traceEvent) {
      continue;
    }

    const isContext = RUN_CONTEXT_KEYS.has(atomicEvent.atom.key);
    const turn = turnByEventId.get(traceEvent.id) ?? 1;
    const aggregateKey = `${isContext ? "context" : turn}:${atomicEvent.atom.key}:${atomicEvent.instance.id}`;
    const existing = aggregated.get(aggregateKey);
    const node = nodeByKey.get(atomicEvent.atom.key);
    const nextStatus = statusForPhase(atomicEvent.phase);

    if (existing) {
      existing.count += 1;
      existing.duration = Math.max(
        0,
        Date.parse(atomicEvent.occurredAt) - Date.parse(existing.occurredAt),
      );
      existing.event = traceEvent;
      existing.lastOccurredAt = atomicEvent.occurredAt;
      existing.status =
        existing.status === "failed" ? "failed" : nextStatus;
      existing.summary =
        atomicEvent.payload?.summary ||
        atomicEvent.payload?.title ||
        existing.summary;
      continue;
    }

    aggregated.set(aggregateKey, {
      atomId: node?.id ?? "",
      count: 1,
      duration: 0,
      event: traceEvent,
      id: aggregateKey,
      key: atomicEvent.atom.key,
      kind: atomicEvent.atom.kind,
      label: atomicEvent.atom.label,
      lastOccurredAt: atomicEvent.occurredAt,
      occurredAt: atomicEvent.occurredAt,
      sequence: atomicEvent.sequence,
      status: nextStatus,
      summary:
        atomicEvent.payload?.summary ||
        atomicEvent.payload?.title ||
        atomicEvent.atom.label,
      tone: node?.data.tone ?? toneForKind(atomicEvent.atom.kind),
      turn,
    });
  }

  const atoms = [...aggregated.values()].sort(
    (left, right) => left.sequence - right.sequence,
  );
  const context = atoms.filter((atom) => atom.id.startsWith("context:"));
  const turnNumbers = [
    ...new Set(
      atoms
        .filter((atom) => !atom.id.startsWith("context:"))
        .map((atom) => atom.turn),
    ),
  ].toSorted((left, right) => left - right);

  return {
    context,
    turns: turnNumbers.map((turn) => {
      const turnAtoms = atoms.filter(
        (atom) => atom.turn === turn && !atom.id.startsWith("context:"),
      );
      const first = turnAtoms[0];
      const last = turnAtoms.at(-1) ?? first;
      const hasFailure = turnAtoms.some((atom) => atom.status === "failed");
      const hasWaiting = turnAtoms.some((atom) => atom.status === "waiting");
      const hasRunning = turnAtoms.some((atom) => atom.status === "running");
      return {
        atoms: turnAtoms,
        duration: Math.max(
          0,
          Date.parse(last.lastOccurredAt) - Date.parse(first.occurredAt),
        ),
        event: last.event,
        occurredAt: first.occurredAt,
        status: hasFailure
          ? "failed"
          : hasWaiting
            ? "waiting"
            : hasRunning
              ? "running"
              : "complete",
        summary: last.summary,
        turn,
      };
    }),
  };
}

function statusForPhase(
  phase: AtomicPhase,
): TrajectoryAtom["status"] {
  if (phase === "error") {
    return "failed";
  }
  if (phase === "end" || phase === "skipped") {
    return "complete";
  }
  if (phase === "scheduled") {
    return "idle";
  }
  if (phase === "waiting") {
    return "waiting";
  }
  return "running";
}

function toneForKind(kind: string): string {
  if (["tool", "store"].includes(kind)) {
    return "tool";
  }
  if (["model", "loop", "action", "eval"].includes(kind)) {
    return "reasoning";
  }
  if (["reply", "release"].includes(kind)) {
    return "complete";
  }
  if (["input", "hook"].includes(kind)) {
    return "prompt";
  }
  if (["trace", "trajectory", "usage", "handoff"].includes(kind)) {
    return "signal";
  }
  return "agent";
}
