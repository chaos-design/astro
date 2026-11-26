import { getAtomIdForEvent } from "../config/atom-platforms.ts";
import type {
  RunTerminalReason,
  TraceEvent,
  TracePayload,
} from "../types/trace.ts";
import {
  getExceptionOutcome,
  type ExceptionKind,
  type ExceptionScope,
} from "./exception-events.ts";
import {
  buildPairArtifacts,
  eventMeta,
  formatLogSequence,
  getEventSummary,
  getEventTimestamp,
  getToolCallInputs,
  type ToolCallInputs,
  type TracePairLink,
} from "./trace-model.ts";
import { buildTraceTurnIndex } from "./trajectory-model.ts";
import {
  getTraceEventKey,
  isBlockingUserQuestionStartEvent,
  isUserQuestionEvent,
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

/**
 * A non-normal outcome recorded for one step, read from the single exception
 * classifier (`exception-events.ts`) — never a second list of failure event
 * names. `detail` is the host's own text (error message, stderr, recorded
 * reason) so a hover card can state *what* failed instead of only *that* it
 * failed.
 */
export interface AgentStepStatus {
  readonly status: "failed" | "terminated" | "waiting";
  readonly kind: ExceptionKind;
  readonly scope: ExceptionScope;
  readonly reason: RunTerminalReason | null;
  readonly detail: string | null;
}

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
  /**
   * How long *this step* took, from the same paired-event spans the LOG
   * badges read: a streamed reply spans its first snapshot → final message, a
   * tool call its PreToolUse → result half, a closed question its two halves.
   * `null` when the capture has no measurable span — never a fabricated 0ms.
   */
  readonly durationMs: number | null;
  /** Non-normal outcome for this step's own event; `null` when it is normal. */
  readonly status: AgentStepStatus | null;
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
  /**
   * The tool's complete invocation, structured: a captured shell command or
   * the tool name plus each short input as its own field. The card renders
   * the fields as a list rather than flattening them into `key=value` text.
   */
  readonly inputs: ToolCallInputs | null;
  /**
   * The recorded answers when this result closes a user-question tool — the
   * answer-style read the card shows instead of a JSON body. Empty for
   * every other tool.
   */
  readonly answers: readonly UserQuestionAnswer[];
  /** The paired start event's question prompts, for the answer chips. */
  readonly answerQuestions: readonly QuestionDescriptor[];
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
  /**
   * For a tool-call event (PreToolUse / PostToolUse) the tool's complete
   * invocation, structured — a captured shell command or the name plus each
   * short input. `null` for every other event, so the generic body only opens
   * with a call line when a call actually exists, never invents one from an
   * event name.
   */
  readonly inputs: ToolCallInputs | null;
  /** The captured tool name when this is a tool event; `null` otherwise. */
  readonly toolName: string | null;
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
    /** Distinct turns the run spans, from the one turn index. */
    readonly turns: number;
    /** Total captured events folded into this view. */
    readonly events: number;
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
    // A `Stop`-ended run (WorkBuddy's ChatGPT-style capture) delivers the
    // assistant's final reply on `last_assistant_message`; reading it here is
    // what lets that Stop project as a reply instead of a bare tool-result.
    stringValue(payload.last_assistant_message) ||
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
  // One flow walk produces both the per-step span and the pair marker; the
  // separate helpers would rebuild the same flow twice per batch.
  const { durations: pairDurations, links: pairLinks } = buildPairArtifacts(
    events,
    turnByEventId,
  );
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
  // A batch re-derives the whole view, and one long run carries thousands of
  // AgentMessage snapshots. Reading each payload once (not once per prefix
  // comparison) is what keeps a 20k-event run from spending the batch in
  // string building; the WeakMap ties the text to the immutable event.
  const replyTextCache = new WeakMap<TraceEvent, string>();
  const replyTextOf = (event: TraceEvent): string => {
    const cached = replyTextCache.get(event);
    if (cached !== undefined) {
      return cached;
    }
    const text = replyText(event);
    replyTextCache.set(event, text);
    return text;
  };
  // A run whose host publishes its reply as an `AgentMessage` is handled by
  // the reply-group pass above. Some hosts (WorkBuddy's ChatGPT-style capture)
  // publish no `AgentMessage` at all and instead carry the assistant's final
  // text on the `Stop` event — so only when that origin published no reply,
  // the Stop's `last_assistant_message` projects as a reply and the 回复
  // counter stops reading 0. Scope the check by origin: Pi subagents share the
  // parent session, so a child's AgentMessage must not suppress the main
  // agent's own Stop reply.
  const agentMessageOrigins = new Set<string>();
  for (const event of events) {
    if (event.eventName === "AgentMessage") {
      agentMessageOrigins.add(replyScopeKey(event));
    }
  }

  /** The host's own explanation of an abnormal step, trimmed to one string. */
  const stepDetail = (event: TraceEvent): string | null => {
    const payload = event.payload ?? {};
    const response =
      payload.tool_response && typeof payload.tool_response === "object"
        ? (payload.tool_response as Record<string, unknown>)
        : {};
    const candidates = [
      payload.error_message,
      payload.error,
      payload.status_detail,
      payload.detail,
      response.error,
      response.stderr,
      // A recorded reason is only a detail when it is free text, not a code
      // the classifier already turned into a status.
      typeof payload.reason === "string" && /\s/.test(payload.reason)
        ? payload.reason
        : "",
    ];
    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.trim()) {
        return candidate.trim();
      }
    }
    return null;
  };

  const stepStatus = (event: TraceEvent): AgentStepStatus | null => {
    const outcome = getExceptionOutcome(event);
    if (!outcome) {
      return null;
    }
    return {
      status: outcome.status,
      kind: outcome.kind,
      scope: outcome.scope,
      reason: outcome.reason,
      detail: stepDetail(event),
    };
  };

  const base = (event: TraceEvent): AgentStepBase => ({
    id: `event:${event.id}`,
    eventId: event.id,
    atomId: getAtomIdForEvent(event, platformId),
    sequence: formatLogSequence((indexById.get(event.id) ?? 0) + 1),
    turn: turnByEventId.get(event.id) ?? 1,
    capturedAt: event.capturedAt,
    tone: eventMeta[event.eventName]?.tone ?? "unknown",
    // The same paired span the LOG badge and the rail tooltip read: keys cover
    // both halves of a closed pair, so a start event and its result report
    // one duration.
    durationMs: pairDurations.get(event.id) ?? null,
    status: stepStatus(event),
  });

  const singleReply = (event: TraceEvent, messageId: string | null): ReplyStep => ({
    ...base(event),
    id: messageId ? `stream:${messageId}:${event.id}` : `event:${event.id}`,
    kind: "reply",
    text: replyTextOf(event),
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
    const breakIds = new Set<string>();
    for (let position = 1; position < ordered.length; position += 1) {
      const event = ordered[position];
      if (!replyTextOf(event).startsWith(replyTextOf(ordered[position - 1]))) {
        breakIds.add(event.id);
      }
    }
    if (breakIds.size > 0) {
      // Never silently drop a snapshot whose prefix does not line up: record
      // the mismatch and keep every event as its own reply step.
      for (const event of ordered) {
        const breakHere = breakIds.has(event.id);
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
    let final: TraceEvent | undefined;
    for (let position = ordered.length - 1; position >= 0; position -= 1) {
      if (!isStreamSnapshot(ordered[position])) {
        final = ordered[position];
        break;
      }
    }
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
    const span =
      getEventTimestamp(final ?? anchor) - getEventTimestamp(firstEvent);
    placement.push({
      index: firstIndex,
      step: {
        ...base(anchor),
        eventId: firstEvent.id,
        sequence: formatLogSequence(firstIndex + 1),
        // A streamed reply's own execution time: first snapshot → final
        // message. A single (unstreamed) message keeps the paired span (or
        // null), never a fabricated zero.
        durationMs:
          span > 0 ? span : pairDurations.get(anchor.id) ?? null,
        // Two subagent origins can reuse one short message id. Their groups
        // are separate steps, so the id must name the group's own anchor too —
        // otherwise React sees duplicate keys and stepRefs overwrite each
        // other, pointing locate/scroll at the wrong card.
        id: messageId ? `stream:${messageId}:${anchor.id}` : `event:${anchor.id}`,
        kind: "reply",
        text: replyTextOf(final ?? anchor),
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
          const next = replyTextOf(candidate);
          if (
            replyScopeKey(candidate) !== replyScopeKey(last) ||
            !next.startsWith(replyTextOf(last)) ||
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
    if (isBlockingUserQuestionStartEvent(event)) {
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
      // A `Stop` that ends a run publishes no `AgentMessage`; when this origin
      // emitted none, its `last_assistant_message` is the assistant's final
      // reply, so project it as a `reply` step (not a tool-result) and the
      // 回复 counter reflects it. An origin that did emit AgentMessages keeps
      // the dedicated reply-group path above, and a bare Stop with no final
      // text stays a tool-result.
      if (
        event.eventName === "Stop" &&
        !agentMessageOrigins.has(replyScopeKey(event)) &&
        replyText(event).trim()
      ) {
        placement.push({ index, step: singleReply(event, null) });
        return;
      }
      // A result that closes a user-question tool carries the recorded
      // answers; the option sets that build its answer chips sit on the
      // paired start event. Only question tools get the projection — the
      // single classifier keeps every other tool's payload out of the
      // extractor on each batch.
      const startParsed =
        startEvent && isUserQuestionEvent(startEvent)
          ? parseUserQuestionContent(startEvent.payload ?? {})
          : null;
      const ownAnswers = isUserQuestionEvent(event)
        ? parseUserQuestionContent(event.payload ?? {}).answers
        : [];
      // The host can write the answers on either half of the pair — a decision
      // hook injects them into the start's tool_input, a captured run records
      // them on the result. Join both through the one rule so the result card
      // highlights the selection no matter which event carried it.
      const answers = mergeQuestionAnswers(startParsed?.answers ?? [], ownAnswers);
      const answerQuestions =
        startParsed?.prompts.map((prompt) => ({
          question: prompt.question,
          options: prompt.options,
        })) ?? [];
      placement.push({
        index,
        step: {
          ...base(event),
          kind: "tool-result",
          payload: event.payload ?? {},
          eventName: event.eventName,
          toolName: event.toolName || stringValue(event.payload?.tool_name),
          inputs: getToolCallInputs(event, startEvent),
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
        // A tool-call event (PreToolUse) opens with its structured invocation
        // — the captured shell command, else the tool name plus its short
        // inputs — instead of burying the call inside the related-fields dump.
        // Non-tool events resolve to null and keep the plain body.
        inputs: getToolCallInputs(event),
        toolName: event.toolName || stringValue(event.payload?.tool_name) || null,
      },
    });
  });

  placement.sort((left, right) => left.index - right.index);
  const steps = placement.map((entry) => entry.step);
  // One pass for the counters and the turn span: four `filter` calls over the
  // same array and a second walk of every event cost more than the counting.
  let thinking = 0;
  let replies = 0;
  let questions = 0;
  const turnValues = new Set<number>();
  for (const step of steps) {
    if (step.kind === "thinking") {
      thinking += 1;
    } else if (step.kind === "reply") {
      replies += 1;
    } else if (step.kind === "question") {
      questions += 1;
    }
  }
  for (const event of events) {
    turnValues.add(turnByEventId.get(event.id) ?? 1);
  }
  return {
    steps,
    stats: {
      thinking,
      replies,
      questions,
      snapshotsMerged,
      turns: turnValues.size,
      events: events.length,
    },
    diagnostics,
  };
}
