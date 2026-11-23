import { getAtomIdForEvent } from "../config/atom-platforms.ts";
import type { TraceEvent, TracePayload } from "../types/trace.ts";
import {
  buildPairDurations,
  buildPairLinks,
  eventMeta,
  formatLogSequence,
  getEventSummary,
  getEventTimestamp,
  getToolCallCommand,
  getToolCallInvocation,
  type TracePairLink,
} from "./trace-model.ts";
import { buildTraceTurnIndex } from "./trajectory-model.ts";
import {
  getTraceEventKey,
  isUserQuestionStartEvent,
} from "./trace-event-kind.ts";
import type { QuestionDescriptor } from "./interaction-contract.ts";
import {
  mergeQuestionAnswers,
  parseUserQuestionContent,
  type UserQuestionAnswer,
  type UserQuestionContent,
} from "./user-question-content.ts";

/**
 * One event sequence, projected as the artifacts an Agent actually produces.
 *
 * This is a *derived* view: persisted TraceEvents stay immutable, and the
 * payload markdown / question parsing helpers remain the single source of
 * truth for how a payload is read. Nothing here decides run status, topology
 * or anomaly classification — those live in their own modules.
 */

export type AgentStepKind =
  | "thinking"
  | "reply"
  | "tool-result"
  | "question"
  | "event";

export interface AgentStepBase {
  /** Stable step id: bound to the event id, or `stream:<messageId>`. */
  readonly id: string;
  /** Rail anchor: the main event this step is bound to. */
  readonly eventId: string;
  readonly atomId: string;
  readonly sequence: string;
  readonly turn: number;
  readonly capturedAt: string;
  /** eventMeta tone — no second colour table. */
  readonly tone: string;
}

export interface ThinkingStep extends AgentStepBase {
  readonly kind: "thinking";
  readonly text: string;
  readonly source: "reasoning" | "snapshot";
  readonly collapsedByDefault: true;
}

export interface ReplyStep extends AgentStepBase {
  readonly kind: "reply";
  readonly text: string;
  /** Number of streamed snapshots folded into this reply. */
  readonly snapshotCount: number;
  readonly messageId: string | null;
  /** Every event this reply covers, so the rail can focus any snapshot. */
  readonly eventIds: readonly string[];
}

export interface ToolResultStep extends AgentStepBase {
  readonly kind: "tool-result";
  readonly payload: TracePayload;
  readonly eventName: string;
  readonly toolName: string | null;
  /** Captured tool command from the paired start event, never inferred. */
  readonly command: string | null;
  /**
   * The tool's complete execution line: the captured shell command when one
   * exists, otherwise the tool name plus every short input field — so a
   * structured tool (Edit, Read, …) shows its full invocation, not just its
   * result.
   */
  readonly invocation: string | null;
  /**
   * The recorded answers when this result closes a user-question tool — the
   * answer-style read the card shows instead of a JSON body. Empty for
   * every other tool.
   */
  readonly answers: readonly UserQuestionAnswer[];
  /** The paired start event's question prompts, for the answer chips. */
  readonly answerQuestions: readonly QuestionDescriptor[];
  readonly durationMs: number | null;
  readonly pairLink: TracePairLink | null;
}

export interface QuestionStep extends AgentStepBase {
  readonly kind: "question";
  readonly payload: TracePayload;
  /** The one parser for question prompts, plans and answers. */
  readonly parsed: UserQuestionContent;
  /**
   * The question's recorded answers: the answers its own payload carried
   * first, then the recorded answers of the paired result event (a finished
   * question's answers usually arrive with the tool's PostToolUse). Empty
   * while the question is still open.
   */
  readonly answers: readonly UserQuestionAnswer[];
}

export interface GenericStep extends AgentStepBase {
  readonly kind: "event";
  readonly eventName: string;
  readonly key: string;
  readonly summary: string;
  readonly payload: TracePayload;
}

export type AgentStep =
  | ThinkingStep
  | ReplyStep
  | ToolResultStep
  | QuestionStep
  | GenericStep;

export interface AgentViewDiagnostic {
  readonly id: string;
  readonly eventId: string;
  readonly messageId: string | null;
  readonly reason: "prefix-break";
  readonly message: string;
}

export interface AgentView {
  readonly steps: readonly AgentStep[];
  readonly stats: {
    readonly thinking: number;
    readonly replies: number;
    readonly questions: number;
    readonly snapshotsMerged: number;
  };
  readonly diagnostics: readonly AgentViewDiagnostic[];
}

/** Legacy snapshots are ms apart; beyond this they are different replies. */
const LEGACY_SNAPSHOT_GAP_MS = 10 * 60 * 1000;

const TOOL_RESULT_EVENTS = new Set(["PostToolUse", "PostToolUseFailure"]);

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function replyText(event: TraceEvent): string {
  const payload = event.payload ?? {};
  return (
    stringValue(payload.message) ||
    stringValue(payload.text) ||
    stringValue(payload.content) ||
    stringValue(payload.payload?.message) ||
    ""
  );
}

function messageIdOf(event: TraceEvent): string | null {
  const payload = event.payload ?? {};
  const value = payload.messageId ?? payload.messageID;
  const id = typeof value === "string" ? value.trim() : "";
  // Some producers write "default" when the host omits an id. Treat it as no
  // id so snapshots and the final message take the same legacy merge path
  // instead of becoming two separate replies.
  return id && id !== "default" ? id : null;
}

function isStreamSnapshot(event: TraceEvent): boolean {
  return (event.payload ?? {}).streamed === true;
}

/**
 * Pi subagents are written under the parent session with their own origin in
 * the event envelope. Two processes can reuse a short message id, so the
 * origin must scope a reply group: otherwise a child's reply is folded into
 * the main agent's and one of them disappears.
 */
function replyScopeKey(event: TraceEvent): string {
  const scoped = event as TraceEvent & {
    subagentSessionId?: string;
    subagentHandle?: string;
    subagentAgent?: string;
  };
  const origin =
    scoped.subagentSessionId || scoped.subagentHandle || scoped.subagentAgent || "";
  return `${event.sessionId}\u0000${origin}\u0000`;
}

interface Placement {
  readonly index: number;
  readonly step: AgentStep;
}

/**
 * Project a run into thinking / reply / tool-result / question / event steps.
 * The result is computed from the given array only; callers may memoize it.
 */
export function buildAgentView(
  events: readonly TraceEvent[],
  platformId = "chatgpt",
): AgentView {
  const turnByEventId = buildTraceTurnIndex(events);
  const pairDurations = buildPairDurations(events);
  const pairLinks = buildPairLinks(events, turnByEventId);
  const indexById = new Map<string, number>();
  events.forEach((event, index) => indexById.set(event.id, index));

  // One pass buckets AgentMessages by (session, subagent origin, messageId).
  // A per-event `events.filter` here was O(n²) on long streaming runs.
  const replyGroups = new Map<string, TraceEvent[]>();
  events.forEach((event) => {
    if (event.eventName !== "AgentMessage") {
      return;
    }
    const messageId = messageIdOf(event);
    if (!messageId) {
      return;
    }
    const key = `${replyScopeKey(event)}${messageId}`;
    const group = replyGroups.get(key);
    if (group) {
      group.push(event);
    } else {
      replyGroups.set(key, [event]);
    }
  });

  const placement: Placement[] = [];
  const diagnostics: AgentViewDiagnostic[] = [];
  const consumed = new Set<string>();
  let snapshotsMerged = 0;

  const base = (event: TraceEvent): AgentStepBase => ({
    id: `event:${event.id}`,
    eventId: event.id,
    atomId: getAtomIdForEvent(event, platformId),
    sequence: formatLogSequence((indexById.get(event.id) ?? 0) + 1),
    turn: turnByEventId.get(event.id) ?? 1,
    capturedAt: event.capturedAt,
    tone: eventMeta[event.eventName]?.tone ?? "unknown",
  });

  const singleReply = (event: TraceEvent, messageId: string | null): ReplyStep => ({
    ...base(event),
    id: messageId ? `stream:${messageId}:${event.id}` : `event:${event.id}`,
    kind: "reply",
    text: replyText(event),
    snapshotCount: 0,
    messageId,
    eventIds: [event.id],
  });

  const addReplyGroup = (
    group: readonly TraceEvent[],
    messageId: string | null,
  ) => {
    if (!group.length) {
      return;
    }
    const ordered = [...group].sort(
      (left, right) =>
        getEventTimestamp(left) - getEventTimestamp(right) ||
        (indexById.get(left.id) ?? 0) - (indexById.get(right.id) ?? 0),
    );
    const breaks = ordered.filter(
      (event, position) =>
        position > 0 &&
        !replyText(event).startsWith(replyText(ordered[position - 1])),
    );
    if (breaks.length) {
      // Never silently drop a snapshot whose prefix does not line up: record
      // the mismatch and keep every event as its own reply step.
      for (const event of ordered) {
        const breakHere = breaks.includes(event);
        if (breakHere) {
          diagnostics.push({
            id: `prefix-break:${event.id}`,
            eventId: event.id,
            messageId,
            reason: "prefix-break",
            message: messageId
              ? `消息 ${messageId} 的流式前缀不连续，已保留为独立回复`
              : "流式前缀不连续，已保留为独立回复",
          });
        }
        placement.push({
          index: indexById.get(event.id) ?? 0,
          step: singleReply(event, messageId),
        });
      }
      return;
    }
    const final = [...ordered].reverse().find((event) => !isStreamSnapshot(event));
    const anchor = final ?? ordered[ordered.length - 1];
    const streamed = ordered.filter(isStreamSnapshot);
    snapshotsMerged += streamed.length;
    // The badge sequence and the rail anchor must name the same event. Pick
    // the earliest event by *LOG position* (not timestamp), so the card always
    // points at the first line of the reply it represents.
    let firstIndex = Infinity;
    let firstEvent = ordered[0];
    for (const event of ordered) {
      const index = indexById.get(event.id) ?? 0;
      if (index < firstIndex) {
        firstIndex = index;
        firstEvent = event;
      }
    }
    placement.push({
      index: firstIndex,
      step: {
        ...base(anchor),
        eventId: firstEvent.id,
        sequence: formatLogSequence(firstIndex + 1),
        id: messageId ? `stream:${messageId}` : `event:${anchor.id}`,
        kind: "reply",
        text: replyText(final ?? anchor),
        snapshotCount: streamed.length,
        messageId,
        eventIds: ordered.map((event) => event.id),
      },
    });
  };

  events.forEach((event, index) => {
    if (consumed.has(event.id)) {
      return;
    }
    if (event.eventName === "Reasoning") {
      placement.push({
        index,
        step: {
          ...base(event),
          kind: "thinking",
          text: getEventSummary(event),
          source: "reasoning",
          collapsedByDefault: true,
        },
      });
      return;
    }
    if (event.eventName === "AgentMessage") {
      const messageId = messageIdOf(event);
      if (messageId) {
        const group = replyGroups.get(`${replyScopeKey(event)}${messageId}`) ?? [
          event,
        ];
        group.forEach((member) => consumed.add(member.id));
        addReplyGroup(group, messageId);
      } else {
        // Fallback for captures written before messageId existed: only a
        // time-adjacent `startsWith` chain is one reply. Anything else stays
        // its own step rather than risking a wrong merge across messages.
        const group = [event];
        consumed.add(event.id);
        let last = event;
        for (const candidate of events.slice(index + 1)) {
          if (consumed.has(candidate.id) || candidate.eventName !== "AgentMessage") {
            continue;
          }
          if (messageIdOf(candidate)) {
            break;
          }
          const next = replyText(candidate);
          if (
            replyScopeKey(candidate) !== replyScopeKey(last) ||
            !next.startsWith(replyText(last)) ||
            getEventTimestamp(candidate) - getEventTimestamp(last) >
              LEGACY_SNAPSHOT_GAP_MS
          ) {
            break;
          }
          group.push(candidate);
          consumed.add(candidate.id);
          last = candidate;
        }
        addReplyGroup(group, null);
      }
      return;
    }
    if (isUserQuestionStartEvent(event)) {
      const parsed = parseUserQuestionContent(event.payload);
      // A finished question's recorded answers usually arrive with the
      // paired result event (the recorder's PostToolUse), not the start.
      // Project both halves through the one join so the card can highlight
      // the answer no matter which event the host wrote it on.
      const startLink = pairLinks.get(event.id);
      const startPartner = startLink?.partnerId
        ? indexById.get(startLink.partnerId)
        : undefined;
      const recorded =
        startPartner === undefined
          ? []
          : parseUserQuestionContent(events[startPartner].payload ?? {}).answers;
      placement.push({
        index,
        step: {
          ...base(event),
          kind: "question",
          payload: event.payload ?? {},
          parsed,
          answers: mergeQuestionAnswers(parsed.answers, recorded),
        },
      });
      return;
    }
    if (event.eventName === "Stop" || TOOL_RESULT_EVENTS.has(event.eventName)) {
      const pairLink = pairLinks.get(event.id) ?? null;
      const partnerIndex = pairLink?.partnerId
        ? indexById.get(pairLink.partnerId)
        : undefined;
      const startEvent =
        partnerIndex === undefined ? null : events[partnerIndex];
      // A result that closes a user-question tool carries the recorded
      // answers; the option sets that build its answer chips sit on the
      // paired start event.
      const answers = parseUserQuestionContent(event.payload ?? {}).answers;
      const answerQuestions = startEvent
        ? parseUserQuestionContent(startEvent.payload ?? {}).prompts.map(
            (prompt) => ({
              question: prompt.question,
              options: prompt.options,
            }),
          )
        : [];
      placement.push({
        index,
        step: {
          ...base(event),
          kind: "tool-result",
          payload: event.payload ?? {},
          eventName: event.eventName,
          toolName: event.toolName ?? stringValue(event.payload?.tool_name),
          command: getToolCallCommand(event, startEvent),
          invocation: getToolCallInvocation(event, startEvent),
          answers,
          answerQuestions,
          durationMs: pairDurations.get(event.id) ?? null,
          pairLink,
        },
      });
      return;
    }
    placement.push({
      index,
      step: {
        ...base(event),
        kind: "event",
        eventName: event.eventName,
        key: getTraceEventKey(event),
        summary: getEventSummary(event),
        payload: event.payload ?? {},
      },
    });
  });

  placement.sort((left, right) => left.index - right.index);
  const steps = placement.map((entry) => entry.step);
  return {
    steps,
    stats: {
      thinking: steps.filter((step) => step.kind === "thinking").length,
      replies: steps.filter((step) => step.kind === "reply").length,
      questions: steps.filter((step) => step.kind === "question").length,
      snapshotsMerged,
    },
    diagnostics,
  };
}
