import type {
  AtomicDefinition,
  AtomicFlowEvent,
  AtomicKind,
  AtomicLevel,
  AtomicPhase,
  AtomicValue,
} from "../vendor/atomic-flow/browser.ts";
import { getAtomPlatformConfig } from "../config/atom-platforms.ts";
import type { PlatformId, TraceEvent } from "../types/trace.ts";
import {
  isUserQuestionEvent,
  isUserQuestionStartEvent,
} from "./trace-event-kind.ts";
import { getEventSummary } from "./trace-model.ts";
import { isWaitingTraceEvent } from "./trace-status.ts";

type ProjectionStep = {
  atomId: string;
  phase: AtomicPhase;
  instanceGroup?: string;
};

const RUNTIME_ATOM_KEYS = new Set([
  "prompt.input",
  "session.resume",
  "stage.start",
  "stage.finish",
  "run",
  "agent.select",
  "model.invoke",
  "loop.turn",
  "action.gate",
  "observation",
  "tool.call",
  "tool.resolve",
  "tool.execute",
  "tool.result",
  "handoff",
  "user.question",
  "reply.final",
  "usage.record",
  "telemetry.append",
  "trajectory.project",
]);

const EVENT_PROJECTIONS: Readonly<Record<string, readonly ProjectionStep[]>> = {
  SessionStart: [
    { atomId: "session-resume", phase: "end" },
    { atomId: "stage-start", phase: "end" },
  ],
  UserPromptSubmit: [
    { atomId: "prompt-input", phase: "end" },
    { atomId: "run", phase: "start", instanceGroup: "run" },
    { atomId: "loop-turn", phase: "start", instanceGroup: "turn" },
    { atomId: "agent-select", phase: "end" },
    { atomId: "memory-recall", phase: "end" },
  ],
  Reasoning: [{ atomId: "model-invoke", phase: "delta", instanceGroup: "model" }],
  PreToolUse: [
    { atomId: "model-invoke", phase: "end", instanceGroup: "model" },
    { atomId: "action-gate", phase: "end" },
    { atomId: "tool-call", phase: "start", instanceGroup: "tool" },
    { atomId: "tool-resolve", phase: "end", instanceGroup: "tool-resolve" },
    { atomId: "tool-execute", phase: "start", instanceGroup: "tool-execute" },
  ],
  PostToolUse: [
    { atomId: "tool-execute", phase: "end", instanceGroup: "tool-execute" },
    { atomId: "tool-call", phase: "end", instanceGroup: "tool" },
    { atomId: "tool-result", phase: "end", instanceGroup: "tool-result" },
    { atomId: "observation", phase: "end" },
    { atomId: "checkpoint", phase: "end" },
    { atomId: "memory-capture", phase: "end" },
  ],
  PostToolUseFailure: [
    { atomId: "tool-execute", phase: "error", instanceGroup: "tool-execute" },
    { atomId: "tool-call", phase: "error", instanceGroup: "tool" },
    { atomId: "tool-result", phase: "error", instanceGroup: "tool-result" },
    { atomId: "observation", phase: "error" },
    { atomId: "checkpoint", phase: "end" },
  ],
  PermissionRequest: [{ atomId: "user-question", phase: "start" }],
  Elicitation: [{ atomId: "user-question", phase: "start" }],
  ElicitationResult: [{ atomId: "user-question", phase: "end" }],
  Notification: [{ atomId: "trace-append", phase: "end" }],
  SubagentStart: [
    { atomId: "handoff", phase: "start", instanceGroup: "subagent" },
    { atomId: "agent-result", phase: "scheduled", instanceGroup: "subagent-result" },
  ],
  SubagentStop: [
    { atomId: "agent-result", phase: "end", instanceGroup: "subagent-result" },
    { atomId: "handoff", phase: "end", instanceGroup: "subagent" },
  ],
  AgentMessage: [
    { atomId: "model-invoke", phase: "end", instanceGroup: "model" },
    { atomId: "final-reply", phase: "end" },
    { atomId: "usage", phase: "end" },
  ],
  Stop: [
    { atomId: "final-reply", phase: "end" },
    { atomId: "quality-gate", phase: "end" },
    { atomId: "final-artifact", phase: "end" },
    { atomId: "output-commit", phase: "end" },
    { atomId: "stage-finish", phase: "end" },
    { atomId: "run", phase: "end", instanceGroup: "run" },
    { atomId: "trace-append", phase: "end" },
    { atomId: "trajectory-project", phase: "end" },
  ],
  StopFailure: [
    { atomId: "model-invoke", phase: "error", instanceGroup: "model" },
    { atomId: "run", phase: "error", instanceGroup: "run" },
    { atomId: "trace-append", phase: "end" },
  ],
  SessionEnd: [
    { atomId: "stage-finish", phase: "end" },
    { atomId: "run", phase: "end", instanceGroup: "run" },
    { atomId: "trajectory-project", phase: "end" },
  ],
  Interrupt: [
    { atomId: "stage-finish", phase: "end" },
    { atomId: "run", phase: "end", instanceGroup: "run" },
    { atomId: "trajectory-project", phase: "end" },
  ],
};

export type AtomicTraceProjection = {
  events: AtomicFlowEvent[];
  primarySequenceByTraceId: ReadonlyMap<string, number>;
  traceIdBySequence: ReadonlyMap<number, string>;
};

export function projectTraceEvents(
  traceEvents: readonly TraceEvent[],
  platformId: PlatformId,
): AtomicTraceProjection {
  const config = getAtomPlatformConfig(platformId);
  const atomById = new Map(config.atoms.map((atom) => [atom.id, atom]));
  const projectedEvents: AtomicFlowEvent[] = [];
  const primarySequenceByTraceId = new Map<string, number>();
  const traceIdBySequence = new Map<number, string>();
  const activeModelByContext = new Map<string, string>();
  const runId = traceEvents[0]?.sessionId ?? "empty-run";
  let sequence = 0;

  traceEvents.forEach((traceEvent, traceIndex) => {
    const context = JSON.stringify([
      traceEvent.source, traceEvent.workspaceId, traceEvent.sessionId, traceEvent.parentId,
    ]);
    if (traceEvent.eventName === "UserPromptSubmit") activeModelByContext.delete(context);
    const fallbackAtomId = config.eventAtomMap[traceEvent.eventName] ?? "trace-append";
    const steps: readonly ProjectionStep[] = isUserQuestionEvent(traceEvent)
      ? userQuestionProjection(traceEvent)
      : isWaitingTraceEvent(traceEvent)
        ? waitingProjection(traceEvent)
        : EVENT_PROJECTIONS[traceEvent.eventName] ?? [
            { atomId: fallbackAtomId, phase: fallbackPhase(traceEvent) },
          ];
    const closesModel = ["Stop", "SessionEnd", "Interrupt"].includes(traceEvent.eventName) &&
      activeModelByContext.has(context);
    const effectiveSteps: readonly ProjectionStep[] = closesModel
      ? [{ atomId: "model-invoke", phase: traceEvent.status === "failed" ? "error" : "end",
          instanceGroup: "model" }, ...steps]
      : steps;

    effectiveSteps.forEach((step) => {
      const sourceAtom = atomById.get(step.atomId) ?? atomById.get(fallbackAtomId);
      if (sourceAtom === undefined) {
        return;
      }
      sequence += 1;
      let id = instanceId(traceEvent, step, traceIndex);
      if (step.instanceGroup === "model") {
        id = activeModelByContext.get(context) ?? `${traceEvent.sessionId}:model:${traceEvent.id}`;
        if (step.phase === "end" || step.phase === "error") {
          activeModelByContext.delete(context);
        } else {
          activeModelByContext.set(context, id);
        }
      }
      const event: AtomicFlowEvent = {
        atom: toAtomicDefinition(sourceAtom),
        eventId: `${traceEvent.id}:${step.atomId}:${sequence}`,
        instance: {
          id,
          ...(traceEvent.parentId ? { parentId: traceEvent.parentId } : {}),
          ...(turnNumber(traceEvent) !== undefined
            ? { iteration: turnNumber(traceEvent) }
            : {}),
        },
        occurredAt: traceEvent.capturedAt,
        payload: {
          ...(step.phase === "error" ? { code: "TRACE_EVENT_FAILED" } : {}),
          summary: getEventSummary(traceEvent),
          title: traceEvent.toolName ?? traceEvent.eventName,
          values: atomicValues(traceEvent),
        },
        phase: step.phase,
        runId,
        sequence,
      };
      projectedEvents.push(event);
      traceIdBySequence.set(sequence, traceEvent.id);
    });

    const primaryAtomId = fallbackAtomId;
    const primary = projectedEvents.findLast(
      (event) =>
        traceIdBySequence.get(event.sequence) === traceEvent.id &&
        atomById.get(primaryAtomId)?.key === event.atom.key,
    );
    const latest = primary ?? projectedEvents.at(-1);
    if (latest !== undefined) {
      primarySequenceByTraceId.set(traceEvent.id, latest.sequence);
    }
  });

  return {
    events: projectedEvents,
    primarySequenceByTraceId,
    traceIdBySequence,
  };
}

function waitingProjection(event: TraceEvent): readonly ProjectionStep[] {
  if (
    event.eventName === "PermissionRequest" ||
    event.eventName === "PermissionDenied" ||
    event.eventName === "Elicitation"
  ) {
    return [{ atomId: "user-question", phase: "waiting" }];
  }
  return [
    { atomId: "model-invoke", phase: "waiting", instanceGroup: "model" },
    { atomId: "trace-append", phase: "end" },
  ];
}

function userQuestionProjection(
  event: TraceEvent,
): readonly ProjectionStep[] {
  const phase =
    event.eventName === "PostToolUseFailure" ||
    (event.eventName === "PermissionDenied" && event.payload.retry !== true)
      ? "error"
      : isUserQuestionStartEvent(event)
        ? "waiting"
        : "end";
  return [
    {
      atomId: "user-question",
      instanceGroup: "question",
      phase,
    },
  ];
}

export function toAtomicDefinition(
  atom: {
    key: string;
    kind: string;
    label: string;
  },
): AtomicDefinition {
  return {
    key: atom.key,
    kind: atomicKind(atom.kind),
    label: atom.label,
    level: atomLevel(atom.key),
  };
}

export function atomLevel(atomKey: string): AtomicLevel {
  return RUNTIME_ATOM_KEYS.has(atomKey) ? "runtime" : "deep";
}

function atomicKind(kind: string): AtomicKind {
  const aliases: Readonly<Record<string, AtomicKind>> = {
    checkpoint: "store",
    gate: "action",
    observation: "context",
    output: "reply",
    question: "input",
    reasoning: "model",
    run: "loop",
    subagent: "agent",
    telemetry: "trace",
  };
  const resolved = aliases[kind] ?? kind;
  return isAtomicKind(resolved) ? resolved : "trace";
}

function isAtomicKind(value: string): value is AtomicKind {
  return [
    "action",
    "agent",
    "context",
    "eval",
    "handoff",
    "hook",
    "input",
    "loop",
    "memory",
    "model",
    "release",
    "reply",
    "skill",
    "store",
    "tool",
    "trace",
    "trajectory",
    "usage",
  ].includes(value);
}

function fallbackPhase(event: TraceEvent): AtomicPhase {
  if (event.status === "failed") {
    return "error";
  }
  return event.eventName.toLowerCase().includes("start") ? "start" : "end";
}

function instanceId(event: TraceEvent, step: ProjectionStep, index: number): string {
  const toolId = event.toolUseId ?? atomicString(event.payload.tool_use_id);
  const subagentId =
    atomicString(event.payload.agent_id) ??
    atomicString(event.payload.subagent_id) ??
    event.parentId;
  const suffix =
    step.instanceGroup?.startsWith("tool") && toolId
      ? toolId
      : step.instanceGroup?.startsWith("subagent") && subagentId
        ? subagentId
        : step.instanceGroup === "run"
          ? event.sessionId
          : step.instanceGroup === "turn"
            ? event.turnId ?? event.id
            : step.instanceGroup === "model"
              ? event.turnId ?? toolId ?? event.id
              : step.instanceGroup === "question"
                ? toolId ?? event.turnId ?? event.id
              : event.id;
  return `${event.sessionId}:${step.instanceGroup ?? step.atomId}:${suffix || index}`;
}

function turnNumber(event: TraceEvent): number | undefined {
  const value = event.payload.turn ?? event.payload.iteration;
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : undefined;
}

function atomicValues(event: TraceEvent): Readonly<Record<string, AtomicValue>> {
  const values: Record<string, AtomicValue> = {
    eventName: event.eventName,
    source: event.source,
    traceEventId: event.id,
  };
  if (event.toolName) {
    values.toolName = event.toolName;
  }
  if (event.toolUseId) {
    values.toolUseId = event.toolUseId;
  }
  const input = toAtomicValue(
    event.eventName === "UserPromptSubmit"
      ? event.payload
      : event.payload.tool_input ?? event.payload.prompt ?? event.payload.message,
  );
  if (input !== undefined) {
    values.input = input;
  }
  const output = toAtomicValue(
    event.payload.tool_response ??
      event.payload.last_assistant_message ??
      event.payload.message,
  );
  if (output !== undefined) {
    values.output = output;
  }
  return values;
}

function toAtomicValue(value: unknown): AtomicValue | undefined {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value
      .map(toAtomicValue)
      .filter((item): item is AtomicValue => item !== undefined);
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).flatMap(([key, child]) => {
        const converted = toAtomicValue(child);
        return converted === undefined ? [] : [[key, converted]];
      }),
    );
  }
  return undefined;
}

function atomicString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}
