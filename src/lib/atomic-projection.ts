import type {
  AtomicDefinition,
  AtomicFlowEvent,
  AtomicKind,
  AtomicLevel,
  AtomicPhase,
  AtomicValue,
} from "../vendor/atomic-flow/browser.ts";
import { getAtomPlatformConfig } from "../config/atom-platforms.ts";
import type { PlatformConfig, PlatformId, TraceEvent } from "../types/trace.ts";

type AtomById = Map<string, PlatformConfig["atoms"][number]>;
import {
  isBlockingUserQuestionStartEvent,
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
  // The answerable case is projected by `userQuestionProjection` below; this
  // branch is the system-authorization gate (no questions / plan).
  PermissionRequest: [{ atomId: "action-gate", phase: "start" }],
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

/** Events that close the running model span in the active context. */
const CLOSES_MODEL_EVENTS = new Set(["Stop", "SessionEnd", "Interrupt"]);

/**
 * Stable context key for the active model span. Built as one delimited string
 * instead of `JSON.stringify` of an array, so the hot projection loop stops
 * allocating an array plus serialized form per event.
 */
function contextKey(
  source: string,
  workspaceId: string,
  sessionId: string,
  parentId: string | null | undefined,
): string {
  return `${source}\u0001${workspaceId}\u0001${sessionId}\u0001${parentId ?? ""}`;
}

export type AtomicTraceProjection = {
  events: AtomicFlowEvent[];
  primarySequenceByTraceId: ReadonlyMap<string, number>;
  traceIdBySequence: ReadonlyMap<number, string>;
};

/**
 * The running state of one forward fold: everything a later event may
 * depend on (the sequence counter, the open model spans per context, the
 * sequence index and the projected list itself). A fresh fold starts from
 * the empty state; the incremental projection folds an appended slice on top
 * of the previous fold's state, so a stable prefix is never re-projected.
 */
type AtomicFoldState = {
  events: AtomicFlowEvent[];
  primarySequenceByTraceId: Map<string, number>;
  traceIdBySequence: Map<number, string>;
  activeModelByContext: Map<string, string>;
  sequence: number;
};

function emptyAtomicFoldState(): AtomicFoldState {
  return {
    events: [],
    primarySequenceByTraceId: new Map(),
    traceIdBySequence: new Map(),
    activeModelByContext: new Map(),
    sequence: 0,
  };
}

function foldTraceEvents(
  traceEvents: readonly TraceEvent[],
  start: number,
  runId: string,
  state: AtomicFoldState,
  atomById: AtomById,
  config: ReturnType<typeof getAtomPlatformConfig>,
): void {
  for (let traceIndex = start; traceIndex < traceEvents.length; traceIndex += 1) {
    const traceEvent = traceEvents[traceIndex];
    const context = contextKey(
      traceEvent.source,
      traceEvent.workspaceId,
      traceEvent.sessionId,
      traceEvent.parentId,
    );
    if (traceEvent.eventName === "UserPromptSubmit") {
      state.activeModelByContext.delete(context);
    }
    const fallbackAtomId = config.eventAtomMap[traceEvent.eventName] ?? "trace-append";
    const answerableQuestion =
      isUserQuestionEvent(traceEvent) &&
      (!isUserQuestionStartEvent(traceEvent) ||
        isBlockingUserQuestionStartEvent(traceEvent) ||
        traceEvent.eventName === "Notification");
    const steps: readonly ProjectionStep[] = answerableQuestion
      ? userQuestionProjection(traceEvent)
      : isWaitingTraceEvent(traceEvent, config.waitingEvents)
        ? waitingProjection(traceEvent)
        : EVENT_PROJECTIONS[traceEvent.eventName] ?? [
            { atomId: fallbackAtomId, phase: fallbackPhase(traceEvent) },
          ];
    const closesModel =
      CLOSES_MODEL_EVENTS.has(traceEvent.eventName) &&
      state.activeModelByContext.has(context);
    const effectiveSteps: readonly ProjectionStep[] = closesModel
      ? [
          {
            atomId: "model-invoke",
            phase: traceEvent.status === "failed" ? "error" : "end",
            instanceGroup: "model",
          },
          ...steps,
        ]
      : steps;

    // The primary atom's key for this event; tracking the last sequence that
    // projects onto it locally replaces the old `findLast` over the whole
    // projected list (an O(n·m) scan of every event against every prior step).
    const primaryKey = atomById.get(fallbackAtomId)?.key;
    let lastPrimarySequence = 0;
    effectiveSteps.forEach((step) => {
      const sourceAtom =
        atomById.get(step.atomId) ?? atomById.get(fallbackAtomId);
      if (sourceAtom === undefined) {
        return;
      }
      state.sequence += 1;
      const sequence = state.sequence;
      let id = instanceId(traceEvent, step, traceIndex);
      if (step.instanceGroup === "model") {
        id =
          state.activeModelByContext.get(context) ??
          `${traceEvent.sessionId}:model:${traceEvent.id}`;
        if (step.phase === "end" || step.phase === "error") {
          state.activeModelByContext.delete(context);
        } else {
          state.activeModelByContext.set(context, id);
        }
      }
      if (sourceAtom.key === primaryKey) {
        lastPrimarySequence = sequence;
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
      state.events.push(event);
      state.traceIdBySequence.set(sequence, traceEvent.id);
    });

    // `sequence` counts every push, so after this event's steps it is the
    // sequence of the last projected step overall — exactly what the old
    // `projectedEvents.at(-1)` fallback read.
    if (state.sequence > 0) {
      state.primarySequenceByTraceId.set(
        traceEvent.id,
        lastPrimarySequence || state.sequence,
      );
    }
  }
}

export function projectTraceEvents(
  traceEvents: readonly TraceEvent[],
  platformId: PlatformId,
): AtomicTraceProjection {
  const config = getAtomPlatformConfig(platformId);
  const atomById = new Map(config.atoms.map((atom) => [atom.id, atom]));
  const state = emptyAtomicFoldState();
  const runId = traceEvents[0]?.sessionId ?? "empty-run";
  foldTraceEvents(traceEvents, 0, runId, state, atomById, config);
  return {
    events: state.events,
    primarySequenceByTraceId: state.primarySequenceByTraceId,
    traceIdBySequence: state.traceIdBySequence,
  };
}

/**
 * The incremental atomic projection: the same fold as {@link projectTraceEvents},
 * but one instance folds only the slice appended since its last call when the
 * prefix is unchanged, so a streaming batch re-projects a few hundred events
 * instead of the whole session. The stable-prefix rule mirrors
 * `createSessionProjection`: an equal-length call whose first / mid / last ids
 * all match is the same history and reuses the cached state as-is; a longer
 * call that still starts with the same prefix folds just the tail; anything
 * else (a session switch, a replay, a shorter list) rebuilds from scratch.
 *
 * The result wraps a fresh `events` array whenever the fold changed (consumers
 * compare it by reference); an unchanged re-derive returns the previous
 * projection object untouched, so an idle re-render retires no downstream
 * cache. The two sequence maps keep their identity — they have no readers
 * outside this module, and copying them would cost a second O(n) pass the
 * fold just saved.
 */
export function createAtomicProjection(): (
  traceEvents: readonly TraceEvent[],
  platformId: PlatformId,
) => AtomicTraceProjection {
  type Cache = {
    platformId: PlatformId;
    config: ReturnType<typeof getAtomPlatformConfig>;
    atomById: AtomById;
    count: number;
    firstId: string;
    lastId: string;
    midId: string;
    state: AtomicFoldState;
    runId: string;
  };
  let cache: Cache | null = null;
  // The last returned projection. A batch that neither appends nor rebuilds
  // (a platform re-render, a deferred value re-derive) returns this same
  // object instead of paying a fresh O(n) copy of the projected list — the
  // identity-stable result is exactly what lets every downstream memo hit.
  let lastResult: AtomicTraceProjection | null = null;

  const fullBuild = (
    traceEvents: readonly TraceEvent[],
    platformId: PlatformId,
  ): void => {
    const config = getAtomPlatformConfig(platformId);
    const atomById = new Map(config.atoms.map((atom) => [atom.id, atom]));
    const state = emptyAtomicFoldState();
    const runId = traceEvents[0]?.sessionId ?? "empty-run";
    foldTraceEvents(traceEvents, 0, runId, state, atomById, config);
    cache = {
      platformId,
      config,
      atomById,
      count: traceEvents.length,
      firstId: traceEvents[0]?.id || "",
      lastId: traceEvents.at(-1)?.id || "",
      midId: traceEvents[traceEvents.length >> 1]?.id || "",
      state,
      runId,
    };
  };

  return (traceEvents, platformId) => {
    let changed = false;
    const current = cache;
    if (current === null || current.platformId !== platformId) {
      fullBuild(traceEvents, platformId);
      changed = true;
    } else if (traceEvents.length === current.count) {
      // Same length: the same history only when the first / mid / last ids
      // still name the cached list; otherwise rebuild from scratch.
      const unchanged =
        traceEvents.length === 0 ||
        ((traceEvents[0]?.id || "") === current.firstId &&
          (traceEvents.at(-1)?.id || "") === current.lastId &&
          (traceEvents[traceEvents.length >> 1]?.id || "") === current.midId);
      if (!unchanged) {
        fullBuild(traceEvents, platformId);
        changed = true;
      }
    } else {
      const appendedOnly =
        traceEvents.length > current.count &&
        (traceEvents[0]?.id || "") === current.firstId &&
        (traceEvents[current.count - 1]?.id || "") === current.lastId;
      // `midId` names the cached prefix's middle, so a list that rewrote the
      // middle (a replay, a session switch) cannot masquerade as an append.
      if (
        appendedOnly &&
        (current.count === 0 ||
          (traceEvents[current.count >> 1]?.id || "") === current.midId)
      ) {
        foldTraceEvents(
          traceEvents,
          current.count,
          current.runId,
          current.state,
          current.atomById,
          current.config,
        );
        cache = {
          ...current,
          count: traceEvents.length,
          lastId: traceEvents.at(-1)?.id || "",
          midId: traceEvents[traceEvents.length >> 1]?.id || "",
        };
        changed = true;
      } else {
        fullBuild(traceEvents, platformId);
        changed = true;
      }
    }
    if (!changed && lastResult) {
      return lastResult;
    }
    const state = cache!.state;
    lastResult = {
      events: [...state.events],
      primarySequenceByTraceId: state.primarySequenceByTraceId,
      traceIdBySequence: state.traceIdBySequence,
    };
    return lastResult;
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
        ? isBlockingUserQuestionStartEvent(event)
          ? "waiting"
          : "delta"
        : "end";
  return [
    {
      atomId: "user-question",
      instanceGroup: "question",
      phase,
    },
  ];
}

// `sourceAtom` is a stable object from the platform config, reused by every
// projected event of that atom type. The definition is pure, so cache it once
// per atom instead of rebuilding it (and its alias/kind work) on every step —
// a streaming batch projects tens of thousands of events through a handful of
// atoms. The WeakMap keys on object identity and needs no invalidation.
const atomicDefinitionCache = new WeakMap<
  object,
  AtomicDefinition
>();

export function toAtomicDefinition(
  atom: {
    key: string;
    kind: string;
    label: string;
  },
): AtomicDefinition {
  const cached = atomicDefinitionCache.get(atom);
  if (cached) {
    return cached;
  }
  const definition: AtomicDefinition = {
    key: atom.key,
    kind: atomicKind(atom.kind),
    label: atom.label,
    level: atomLevel(atom.key),
  };
  atomicDefinitionCache.set(atom, definition);
  return definition;
}

export function atomLevel(atomKey: string): AtomicLevel {
  return RUNTIME_ATOM_KEYS.has(atomKey) ? "runtime" : "deep";
}

// Module-level constants: per-event predicates may only consult module-level
// Sets, and the alias table must not be rebuilt on every projection step.
const ATOMIC_KIND_ALIASES: Readonly<Record<string, AtomicKind>> = {
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

const ATOMIC_KINDS = new Set<AtomicKind>([
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
]);

function atomicKind(kind: string): AtomicKind {
  const resolved = ATOMIC_KIND_ALIASES[kind] ?? kind;
  return isAtomicKind(resolved) ? resolved : "trace";
}

function isAtomicKind(value: string): value is AtomicKind {
  return ATOMIC_KINDS.has(value as AtomicKind);
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
