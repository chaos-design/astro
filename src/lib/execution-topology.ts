import {
  getAtomPlatformConfig,
  topologyGeometry,
} from "../config/atom-platforms.ts";
import {
  isUserQuestionEvent,
  isUserQuestionStartEvent,
  isUserQuestionToolEvent,
} from "./trace-event-kind.ts";
import { isWaitingTraceEvent } from "./trace-status.ts";
import type {
  AtomDefinition,
  AtomStatus,
  EdgeDefinition,
  ExecutionTopology,
  HarnessNode,
  PlatformConfig,
  RouteKind,
  SignalEdge,
  TraceEvent,
} from "@/types/trace";

type SubagentAtomTemplate = [
  id: string,
  label: string,
  key: string,
  kind: string,
  tone: string,
  eventTypes: string[],
];

type SubagentRun = {
  id: string;
  safeId: string;
  startEvent: TraceEvent;
  stopEvent: TraceEvent | null;
  events: TraceEvent[];
};

const subagentAtomTemplates: SubagentAtomTemplate[] = [
  ["spawn", "Subagent Spawn", "subagent.spawn", "subagent", "signal", ["SubagentStart"]],
  ["run", "Run", "run", "run", "prompt", ["SubagentStart"]],
  ["agent-select", "Agent Select", "agent.select", "agent", "reasoning", ["SubagentStart"]],
  ["model-invoke", "Model Invoke", "model.invoke", "model", "reasoning", ["Reasoning", "AgentMessage"]],
  ["action-gate", "Action Gate", "action.gate", "gate", "reasoning", ["PreToolUse", "Stop"]],
  ["tool-call", "Tool Call", "tool.call", "tool", "tool", ["PreToolUse", "PostToolUse", "PostToolUseFailure"]],
  ["observation", "Observation", "observation", "observation", "agent", ["PostToolUse", "PostToolUseFailure"]],
  ["result", "Agent Result", "agent.result", "subagent", "complete", ["SubagentStop"]],
];

const questionToolExclusions = new Set([
  "checkpoint",
  "memory-capture",
  "observation",
  "tool-call",
  "tool-execute",
  "tool-result",
  "tool-resolve",
]);

function eventTime(event?: TraceEvent | null) {
  const timestamp = event ? Date.parse(event.capturedAt) : Number.NaN;
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function getSubagentId(event: TraceEvent | undefined, index: number) {
  return String(
    event?.payload?.agent_id ||
      event?.payload?.subagent_id ||
      event?.payload?.task_id ||
      event?.parentId ||
      `subagent-${index + 1}`,
  );
}

function buildSubagentRuns(events: TraceEvent[]): SubagentRun[] {
  return events
    .filter((event) => event.eventName === "SubagentStart")
    .map((startEvent, index) => {
      const id = getSubagentId(startEvent, index);
      const startIndex = events.indexOf(startEvent);
      const stopEvent = events
        .slice(startIndex + 1)
        .find(
          (event) =>
            event.eventName === "SubagentStop" &&
            getSubagentId(event, index) === id,
        );
      const endTime = stopEvent ? eventTime(stopEvent) : Number.POSITIVE_INFINITY;
      const childEvents = events.filter((event) => {
        const belongsToSubagent =
          event.parentId === id ||
          event.payload?.agent_id === id ||
          event.payload?.subagent_id === id;
        const timestamp = eventTime(event);
        return (
          belongsToSubagent &&
          timestamp >= eventTime(startEvent) &&
          timestamp <= endTime
        );
      });
      return {
        id,
        safeId: id.replace(/[^a-zA-Z0-9_-]+/g, "-"),
        startEvent,
        stopEvent: stopEvent || null,
        events: childEvents,
      };
    });
}

function getAtomStatus(
  event: TraceEvent | null | undefined,
  events: TraceEvent[],
  complete: boolean,
  waitingEvents?: readonly string[],
): AtomStatus {
  if (!event) return "idle";
  if (
    !complete &&
    event.id === events.at(-1)?.id &&
    isWaitingTraceEvent(event, waitingEvents)
  ) {
    return "waiting";
  }
  if (
    event.status === "failed" ||
    event.eventName === "PostToolUseFailure" ||
    event.payload?.tool_response?.error ||
    Number(event.payload?.tool_response?.exitCode) > 0
  ) {
    return "failed";
  }
  if (isUserQuestionEvent(event) && !isUserQuestionStartEvent(event)) {
    return "complete";
  }
  if (!complete && event.id === events.at(-1)?.id) return "running";
  return "complete";
}

function createBaseNodes(
  events: TraceEvent[],
  complete: boolean,
  atoms: AtomDefinition[],
  platform: PlatformConfig,
): HarnessNode[] {
  return atoms.map((atom, index) => {
    const matchingEvents = events.filter((event) =>
      atomMatchesEvent(atom, event, atom.eventTypes),
    );
    const countTypes = atom.countEventTypes || atom.eventTypes;
    const count = events.filter((event) =>
      atomMatchesEvent(atom, event, countTypes),
    ).length;
    const event = matchingEvents.at(-1) || null;
    const endEvent =
      atom.id === "tool-call" || atom.id === "tool-execute"
        ? [...matchingEvents]
            .reverse()
            .find((candidate) =>
              ["PostToolUse", "PostToolUseFailure"].includes(
                candidate.eventName,
              ),
            ) || null
        : null;

    return {
      id: `harness-${atom.id}`,
      type: "harness",
      position: atom.position,
      draggable: false,
      data: {
        ...atom,
        index,
        count,
        platform: platform.id,
        actor: event?.source?.toUpperCase() || "SYSTEM",
        status: getAtomStatus(
          endEvent || event,
          events,
          complete,
          platform.waitingEvents,
        ),
        gateState:
          atom.kind === "gate"
            ? event
              ? "PASS"
              : "WAIT"
            : null,
        iterations: events.filter(
          (candidate) => candidate.eventName === "PreToolUse",
        ).length,
        event,
        eventIds: matchingEvents.map((candidate) => candidate.id),
        startEvent: event,
        endEvent,
        meta: { tone: atom.tone },
      },
    };
  });
}

function atomMatchesEvent(
  atom: AtomDefinition,
  event: TraceEvent,
  eventTypes: readonly string[],
) {
  if (atom.id === "user-question" && isUserQuestionEvent(event)) {
    return true;
  }
  if (
    isUserQuestionToolEvent(event) &&
    questionToolExclusions.has(atom.id)
  ) {
    return false;
  }
  return eventTypes.includes(event.eventName);
}

function createSubagentNodes(
  run: SubagentRun,
  runIndex: number,
  startIndex: number,
  platform: PlatformConfig,
): HarnessNode[] {
  const y = 1190 + runIndex * 210;
  return subagentAtomTemplates.map(
    ([id, label, key, kind, tone, eventTypes], atomIndex) => {
      const matchingEvents = run.events.filter((event) =>
        eventTypes.includes(event.eventName),
      );
      const exactEvent =
        id === "spawn"
          ? run.startEvent
          : id === "result"
            ? run.stopEvent
            : matchingEvents.at(-1);
      const event = exactEvent || run.startEvent;
      const status = run.stopEvent
        ? "complete"
        : id === "spawn" || id === "run" || id === "agent-select"
          ? "complete"
          : id === "model-invoke"
            ? "running"
            : "idle";
      const position = { x: 55 + atomIndex * 190, y };

      return {
        id: `harness-subagent-${run.safeId}-${id}`,
        type: "harness",
        position,
        draggable: false,
        data: {
          id,
          key: `subagent.${key}`,
          label,
          section: `Subagent ${runIndex + 1}`,
          layer: `subagent-${run.safeId}`,
          kind,
          tone,
          position,
          platform: platform.id,
          eventTypes,
          input: atomIndex ? ["previous.output"] : ["delegated.task"],
          output:
            atomIndex === subagentAtomTemplates.length - 1
              ? ["subagent.result"]
              : ["next.input"],
          description: `${label} within child agent ${run.id}.`,
          index: startIndex + atomIndex,
          count: Math.max(1, matchingEvents.length),
          actor: "SUBAGENT",
          status,
          gateState:
            kind === "gate" ? (status === "idle" ? "WAIT" : "PASS") : null,
          iterations: run.events.filter(
            (candidate) => candidate.eventName === "PreToolUse",
          ).length,
          derived: !exactEvent,
          subagentId: run.id,
          event,
          eventIds: matchingEvents.map((candidate) => candidate.id),
          startEvent: event,
          endEvent: id === "result" ? run.stopEvent : null,
          meta: { tone },
        },
      };
    },
  );
}

function makeEdge(
  definition: EdgeDefinition,
  index: number,
  complete: boolean,
): SignalEdge {
  const [
    source,
    target,
    label = "",
    kind = "forward",
    sourceHandle = "source-right",
    targetHandle = "target-left",
    waypoints = [],
    condition,
  ] = definition;
  const sourceId = source.startsWith("harness-") ? source : `harness-${source}`;
  const targetId = target.startsWith("harness-") ? target : `harness-${target}`;
  const routeKind = getRouteKind(source, target, kind);

  return {
    id: `harness-edge-${index}-${sourceId}-${targetId}`,
    source: sourceId,
    target: targetId,
    sourceHandle,
    targetHandle,
    type: "signal",
    label,
    zIndex: 5,
    className: `harness-edge harness-edge--${kind}`,
    data: {
      kind,
      active: false,
      complete: condition === "complete" && complete,
      routeKind,
      waypoints,
      duration: 1.6,
      delay: 0,
    },
  };
}

function getRouteKind(
  source: string,
  target: string,
  kind: string,
): RouteKind {
  if (
    (source === "tool-execute" && target === "tool-result") ||
    (source === "tool-result" && target === "observation")
  ) {
    return "data";
  }
  if (kind === "record" && target !== "usage") {
    return "persistence";
  }
  if (
    kind === "prompt" ||
    kind === "memory" ||
    target === "usage"
  ) {
    return source === "observation" ? "feedback" : "data";
  }
  if (
    (source === "observation" && target === "loop-turn") ||
    (source === "final-reply" && target === "quality-gate")
  ) {
    return "feedback";
  }
  return "execution";
}

export function buildExecutionTopology(
  events: TraceEvent[],
  platformId = "codex",
): ExecutionTopology {
  const platform = getAtomPlatformConfig(platformId);
  const subagentRuns = buildSubagentRuns(events);
  const subagentIds = new Set(subagentRuns.map((run) => run.id));
  const primaryEvents = events.filter(
    (event) =>
      !event.parentId ||
      !subagentIds.has(event.parentId) ||
      ["SubagentStart", "SubagentStop"].includes(event.eventName),
  );
  const lastPromptIndex = events.findLastIndex(
    (event) => event.eventName === "UserPromptSubmit",
  );
  const lastTerminalIndex = events.findLastIndex((event) =>
    ["Stop", "SessionEnd", "Interrupt"].includes(event.eventName),
  );
  const complete = lastTerminalIndex >= Math.max(0, lastPromptIndex);
  const toolCount = primaryEvents.filter(
    (event) => event.eventName === "PreToolUse",
  ).length;
  const baseNodes = createBaseNodes(
    primaryEvents,
    complete,
    platform.atoms,
    platform,
  );
  const subagentNodes = subagentRuns.flatMap((run, index) =>
    createSubagentNodes(run, index, baseNodes.length + index * 8, platform),
  );
  const nodes = [...baseNodes, ...subagentNodes];
  const dynamicEdges: EdgeDefinition[] = [];

  subagentRuns.forEach((run, runIndex) => {
    const layerY = 1130 + runIndex * 210;
    const prefix = `harness-subagent-${run.safeId}`;
    dynamicEdges.push([
      "handoff",
      `${prefix}-spawn`,
      `delegate ${runIndex + 1}`,
      "subagent",
      "source-left",
      "target-left",
      [
        { x: 300 - runIndex * 12, y: 582 },
        { x: 15 - runIndex * 12, y: 582 },
        { x: 15 - runIndex * 12, y: layerY + 102 },
      ],
    ]);
    for (
      let atomIndex = 0;
      atomIndex < subagentAtomTemplates.length - 1;
      atomIndex += 1
    ) {
      dynamicEdges.push([
        `${prefix}-${subagentAtomTemplates[atomIndex][0]}`,
        `${prefix}-${subagentAtomTemplates[atomIndex + 1][0]}`,
        "",
        "subagent",
      ]);
    }
    dynamicEdges.push([
      `${prefix}-result`,
      "agent-result",
      "return",
      "subagent",
      "source-right",
      "target-right",
      [
        { x: 1590 + runIndex * 12, y: layerY + 102 },
        { x: 1590 + runIndex * 12, y: 792 },
      ],
    ]);
  });

  const edges = [...platform.edges, ...dynamicEdges].map((definition, index) =>
    makeEdge(definition, index, complete),
  );
  const layers = [
    ...platform.layers,
    ...subagentRuns.map((run, index) => ({
      id: `subagent-${run.safeId}`,
      index: String(7 + index).padStart(2, "0"),
      label: "Subagent Execute",
      description: `${run.id} · complete child execution chain`,
      tone: "signal",
      position: { x: 30, y: 1130 + index * 210 },
      width: 1580,
      height: 180,
    })),
  ].map((layer) => ({
    ...layer,
    atomIds: nodes
      .filter((node) => node.data.layer === layer.id)
      .map((node) => node.id),
  }));

  return {
    nodes,
    edges,
    layers,
    platform,
    meta: {
      subagentCount: subagentRuns.length,
      toolCount,
      complete,
      nodeWidth: topologyGeometry.nodeWidth,
      nodeHeight: topologyGeometry.nodeHeight,
    },
  };
}
