/**
 * Bind the question shown on a Flow atom to the console-side interaction that
 * can actually answer it.
 *
 * A captured question event and the host's InteractionRequest are written by
 * two different paths (the recorder and the decision hook). They describe the
 * same tool call, but their ids are not guaranteed to use the same spelling.
 * This module owns the one matching rule the inspector uses, so answering a
 * question from the canvas can never land on a different request's answer map.
 * The answer key stays the descriptor's verbatim `question` text, which is
 * what the contract validates and what the host reads back.
 */

import type { QuestionDescriptor } from "./interaction-contract.ts";
import type { InteractionDraft } from "./interaction-reducer.ts";
import type { TraceEvent } from "../types/trace.ts";
import { getAtomIdForEvent } from "../config/atom-platforms.ts";
import { isPromptExecuting } from "./atom-selection.ts";
import { parseUserQuestionContent } from "./user-question-content.ts";

export interface MatchedQuestionInteraction {
  draft: InteractionDraft;
  question: QuestionDescriptor;
}

/**
 * Question texts carried by one start event, in capture order. Structured
 * prompts win over the free-form message; a plan approval has no answerable
 * question text and is matched by tool id, falling back to the session's open
 * ExitPlanMode request.
 */
export function questionTextsFromEvent(event: TraceEvent | null): string[] {
  if (!event) {
    return [];
  }
  const content = parseUserQuestionContent(event.payload);
  const structured = content.prompts
    .map((prompt) => prompt.question.trim())
    .filter(Boolean);
  if (structured.length) {
    return structured;
  }
  return content.message.trim() ? [content.message.trim()] : [];
}

function eventToolUseId(event: TraceEvent): string {
  const payload = event.payload;
  const nested = payload.payload;
  const toolInput = payload.tool_input ?? payload.toolInput;
  for (const candidate of [
    event.toolUseId,
    payload.tool_use_id,
    payload.toolUseId,
    nested?.tool_use_id,
    toolInput && typeof toolInput === "object"
      ? (toolInput as Record<string, unknown>).tool_use_id
      : undefined,
  ]) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return "";
}

/**
 * Find the still-open request for the question event bound to the selected
 * atom. Tool id is the strongest identity; session + verbatim question text
 * is the fallback for clients that report only one of the two ids. When the
 * tool id matches but the event carries no readable text, the request's first
 * descriptor is used — the host still receives a fully keyed answer map.
 * Plan approvals carry no readable text at all, so when the tool id is
 * missing on either side the last resort is the session's newest open
 * ExitPlanMode request (the host is synchronous, so two plan approvals of
 * one session cannot compete).
 */
/**
 * Whether an incoming interaction request should flash the question atom.
 *
 * Only the open run the reader is already following is pulled into view: a
 * request from another session or agent must not hijack the canvas, and an
 * explicit atom selection outranks the live follow. The caller keeps the
 * selection untouched — a locate pulse is enough, and turning it into a
 * selection would switch Live off mid-question.
 */
export function shouldLocateInteractionRequest(
  request: { sessionId?: string; source?: string } | null,
  active: { sessionId?: string; source?: string } | null,
  followingLive: boolean,
) {
  if (!followingLive || !request || !active || !request.sessionId) {
    return false;
  }
  return (
    request.sessionId === active.sessionId &&
    (!request.source || request.source === active.source)
  );
}

/**
 * The strict View binding shared by the floating card and the inspector. A
 * request is visible only while all three identities agree:
 *  - the question event is part of the selected prompt run (message),
 *  - that event resolves to the selected atom, and
 *  - its session and source match the captured event.
 *
 * Switching agent or message changes one of those inputs, so a request from
 * the previous scope disappears instead of answering in the wrong context.
 */
export function questionMatchesCurrentView(input: {
  draft: InteractionDraft;
  event: TraceEvent | null;
  promptRunEvents: readonly TraceEvent[];
  /** Atom resolved from the message's selected question event. */
  atomId: string;
  /** An explicit atom selection, when the reader has made one. */
  selectedAtomId?: string;
  platformId: string;
}): boolean {
  const { draft, event, promptRunEvents, atomId, platformId } = input;
  if (!event || !atomId) {
    return false;
  }
  if (!promptRunEvents.some((candidate) => candidate.id === event.id)) {
    return false;
  }
  if (input.selectedAtomId && input.selectedAtomId !== atomId) {
    return false;
  }
  if (
    event.sessionId &&
    event.sessionId !== "unknown-session" &&
    draft.request.sessionId !== event.sessionId
  ) {
    return false;
  }
  return !event.source || draft.request.source === event.source;
}

/**
 * Whether the floating question card is a live answer affordance. A question
 * is actionable only while the task it belongs to is still in flight — an
 * `active` (running) turn, or a `waiting` turn paused on that very question —
 * and the reader is not replaying a captured snapshot. Once the run reaches a
 * terminal state, or history is being replayed, the event is a read-only
 * preview: the answer controls are disabled and no card floats over the
 * canvas.
 *
 * Delegates to {@link isPromptExecuting} on purpose: RUN HISTORY's live tag,
 * the footer Live button and this card must agree on one definition of
 * "executing" (active OR waiting), so a `waiting` question never falls into a
 * gap where the run is live but its question cannot be answered.
 */
export function isQuestionActionable(input: {
  status: string | undefined;
  replayMode: boolean;
  isDemo: boolean;
}): boolean {
  return isPromptExecuting(input.status, input.isDemo) && !input.replayMode;
}

export function matchQuestionInteraction(
  drafts: Record<string, InteractionDraft>,
  event: TraceEvent | null,
  scope?: {
    promptRunEvents?: readonly TraceEvent[];
    atomId?: string;
    selectedAtomId?: string;
    platformId?: string;
  },
): MatchedQuestionInteraction | null {
  if (!event) {
    return null;
  }
  const open = Object.values(drafts).filter(
    (draft) =>
      !draft.result &&
      (!scope ||
        !scope.promptRunEvents ||
        !scope.atomId ||
        !scope.platformId ||
        questionMatchesCurrentView({
          draft,
          event,
          promptRunEvents: scope.promptRunEvents,
          atomId: scope.atomId,
          selectedAtomId: scope.selectedAtomId,
          platformId: scope.platformId,
        })),
  );
  if (!open.length) {
    return null;
  }
  const toolUseId = eventToolUseId(event);
  const texts = questionTextsFromEvent(event);
  const pick = (draft: InteractionDraft): QuestionDescriptor | undefined =>
    draft.request.questions.find((question) => texts.includes(question.question)) ??
    draft.request.questions[0];

  if (toolUseId) {
    const byTool = open.find((draft) => draft.request.toolUseId === toolUseId);
    if (byTool) {
      const question = pick(byTool);
      return question ? { draft: byTool, question } : null;
    }
  }
  // The cross-session text fallback is gone on purpose: a matching question
  // string in another run must never answer the selected atom's request.
  const bySessionText = open.find(
    (draft) =>
      Boolean(event.sessionId) &&
      draft.request.sessionId === event.sessionId &&
      draft.request.questions.some((question) => texts.includes(question.question)),
  );
  if (bySessionText) {
    const question = pick(bySessionText);
    return question ? { draft: bySessionText, question } : null;
  }
  if (!texts.length) {
    const byPlan = [...open]
      .reverse()
      .find((draft) =>
        draft.request.toolName === "ExitPlanMode" &&
        (!event.sessionId ||
          event.sessionId === "unknown-session" ||
          draft.request.sessionId === event.sessionId),
      );
    if (byPlan) {
      const question = pick(byPlan);
      return question ? { draft: byPlan, question } : null;
    }
  }
  return null;
}
