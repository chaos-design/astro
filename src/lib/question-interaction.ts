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
import { parseUserQuestionContent } from "./user-question-content.ts";

export interface MatchedQuestionInteraction {
  draft: InteractionDraft;
  question: QuestionDescriptor;
}

/**
 * Question texts carried by one start event, in capture order. Structured
 * prompts win over the free-form message; a plan approval has no answerable
 * question text and is matched by tool id instead.
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
 */
export function matchQuestionInteraction(
  drafts: Record<string, InteractionDraft>,
  event: TraceEvent | null,
): MatchedQuestionInteraction | null {
  if (!event) {
    return null;
  }
  const open = Object.values(drafts).filter((draft) => !draft.result);
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
  const bySessionText = open.find(
    (draft) =>
      (!event.sessionId || draft.request.sessionId === event.sessionId) &&
      draft.request.questions.some((question) => texts.includes(question.question)),
  );
  const byText = bySessionText ??
    open.find((draft) =>
      draft.request.questions.some((question) => texts.includes(question.question)),
    );
  if (byText) {
    const question = pick(byText);
    return question ? { draft: byText, question } : null;
  }
  return null;
}
