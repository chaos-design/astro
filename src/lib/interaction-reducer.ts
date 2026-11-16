/**
 * Console-side state for one interaction request.
 *
 * The reducer is deliberately replayable: `open` holds the request, every
 * `update` applies one InteractionEvent, `revert` drops the optimistic events
 * above a confirmed seq and re-derives the selections. That is what makes a
 * failed POST roll back to the last answer the service actually accepted
 * instead of leaving the clicked card lit.
 *
 * The reducer never invents an answer. It only mirrors events; the submit
 * snapshot is built from `selections` by `buildInteractionAnswers`, and the
 * service validates it again.
 */

import type {
  InteractionEvent,
  InteractionRequest,
  InteractionResult,
  QuestionDescriptor,
} from "./interaction-contract";

export interface InteractionDraft {
  request: InteractionRequest;
  events: InteractionEvent[];
  result: InteractionResult | null;
  revision: number;
  /** Highest applied seq; a lower event is a stale replay and is ignored. */
  seq: number;
  /** question text -> selected labels (or one free-text value) */
  selections: Record<string, string[]>;
  /** Device that answered first; every other device is read-only. */
  lockedBy: string | null;
  /** eventId of an in-flight POST, for duplicate-submit blocking. */
  pending: string | null;
}

export type InteractionState = {
  requests: Record<string, InteractionDraft>;
};

export type InteractionAction =
  | { type: "open"; request: InteractionRequest }
  | { type: "update"; event: InteractionEvent }
  | { type: "close"; result: InteractionResult }
  | { type: "revert"; requestId: string; seq: number }
  | { type: "pending"; requestId: string; eventId: string | null }
  | { type: "reset" };

export const initialInteractionState: InteractionState = { requests: {} };

function optionLabels(questions: QuestionDescriptor[], question: string): string[] {
  const descriptor = questions.find((item) => item.question === question);
  return descriptor
    ? descriptor.options.map((option) =>
        typeof option === "string" ? option : option.label,
      )
    : [];
}

function applyEvent(
  selections: Record<string, string[]>,
  event: InteractionEvent,
  questions: QuestionDescriptor[],
): Record<string, string[]> {
  const next = { ...selections };
  const question = event.question || "";
  if (!question) {
    return next;
  }
  const labels = optionLabels(questions, question);
  switch (event.action) {
    case "select": {
      const label = event.optionLabel || "";
      if (!label) {
        break;
      }
      const descriptor = questions.find((item) => item.question === question);
      if (descriptor?.multiSelect) {
        next[question] = [...new Set([...(next[question] || []), label])];
      } else {
        next[question] = [label];
      }
      break;
    }
    case "deselect": {
      const label = event.optionLabel || "";
      const kept = (next[question] || []).filter((item) => item !== label);
      if (kept.length) {
        next[question] = kept;
      } else {
        delete next[question];
      }
      break;
    }
    case "text": {
      const text = (event.text || "").trim();
      if (text) {
        next[question] = [text];
      }
      break;
    }
    case "edit": {
      const previous = (event.previous || "").trim();
      const value = (event.next || "").trim();
      const current = (next[question] || []).filter((item) => item !== previous);
      next[question] = value ? [...current, value] : current;
      if (!next[question].length) {
        delete next[question];
      }
      break;
    }
    case "skip": {
      delete next[question];
      break;
    }
    default:
      break;
  }
  // Keep a selection only when it is still a declared label; free text is
  // accepted as-is because it came from a `text`/`edit` event.
  if (next[question]?.length) {
    next[question] = next[question].filter(
      (value) => !labels.length || labels.includes(value) || value.length > 0,
    );
  }
  return next;
}

function replaySelections(
  request: InteractionRequest,
  events: InteractionEvent[],
): Record<string, string[]> {
  return events.reduce(
    (selections, event) => applyEvent(selections, event, request.questions),
    {} as Record<string, string[]>,
  );
}

export function interactionReducer(
  state: InteractionState,
  action: InteractionAction,
): InteractionState {
  if (action.type === "reset") {
    // A reconnect rebuilds from fresh frames; replaying history here would
    // resurrect requests the service already closed.
    return { requests: {} };
  }
  if (action.type === "open") {
    if (state.requests[action.request.requestId]) {
      return state;
    }
    return {
      requests: {
        ...state.requests,
        [action.request.requestId]: {
          request: action.request,
          events: [],
          result: null,
          revision: action.request.revision,
          seq: 0,
          selections: {},
          lockedBy: null,
          pending: null,
        },
      },
    };
  }
  if (action.type === "update") {
    const requestId = action.event.requestId;
    const draft = state.requests[requestId];
    if (!draft || draft.result) {
      return state;
    }
    if (action.event.seq <= draft.seq) {
      return state;
    }
    const events = [...draft.events, action.event];
    let request = draft.request;
    let revision = draft.revision;
    if (action.event.action === "replace" && action.event.questions?.length) {
      request = {
        ...request,
        questions: action.event.questions,
        revision: action.event.revision || revision + 1,
      };
      revision = request.revision;
    }
    return {
      requests: {
        ...state.requests,
        [requestId]: {
          ...draft,
          request,
          revision,
          events,
          seq: action.event.seq,
          lockedBy:
            action.event.action === "takeover"
              ? action.event.deviceId
              : draft.lockedBy,
          selections: replaySelections(request, events),
        },
      },
    };
  }
  if (action.type === "close") {
    const draft = state.requests[action.result.requestId];
    if (!draft) {
      return state;
    }
    if (draft.result) {
      // `interaction.close` is sent once, but a reconnected tab may still see
      // a duplicate frame; the first result is the answer of record.
      return state;
    }
    const selections =
      action.result.status === "answered"
        ? Object.fromEntries(
            Object.entries(action.result.answers).map(([question, answer]) => [
              question,
              answer.split(",").map((value) => value.trim()).filter(Boolean),
            ]),
          )
        : draft.selections;
    return {
      requests: {
        ...state.requests,
        [action.result.requestId]: {
          ...draft,
          result: action.result,
          pending: null,
          selections,
        },
      },
    };
  }
  if (action.type === "revert") {
    const draft = state.requests[action.requestId];
    if (!draft) {
      return state;
    }
    const events = draft.events.filter((event) => event.seq <= action.seq);
    return {
      requests: {
        ...state.requests,
        [action.requestId]: {
          ...draft,
          events,
          seq: events.at(-1)?.seq ?? 0,
          selections: replaySelections(draft.request, events),
          pending: null,
        },
      },
    };
  }
  if (action.type === "pending") {
    const draft = state.requests[action.requestId];
    if (!draft) {
      return state;
    }
    return {
      requests: {
        ...state.requests,
        [action.requestId]: { ...draft, pending: action.eventId },
      },
    };
  }
  return state;
}

/** Comma-joined answers in the declared option order, ready for `submit`. */
export function buildInteractionAnswers(
  draft: InteractionDraft,
): Record<string, string> {
  const answers: Record<string, string> = {};
  for (const question of draft.request.questions) {
    const selected = draft.selections[question.question] || [];
    if (!selected.length) {
      continue;
    }
    const labels = optionLabels(draft.request.questions, question.question);
    const ordered = [...selected].sort((left, right) => {
      const leftIndex = labels.indexOf(left);
      const rightIndex = labels.indexOf(right);
      if (leftIndex === -1 && rightIndex === -1) {
        return 0;
      }
      if (leftIndex === -1) {
        return 1;
      }
      if (rightIndex === -1) {
        return -1;
      }
      return leftIndex - rightIndex;
    });
    answers[question.question] = ordered.join(", ");
  }
  return answers;
}

/** Submit is allowed only when every required question has an answer. */
export function isInteractionSubmittable(draft: InteractionDraft): boolean {
  return draft.request.questions
    .filter((question) => question.required !== false)
    .every((question) => (draft.selections[question.question] || []).length > 0);
}

export function selectInteractionQuestion(
  draft: InteractionDraft,
  question: string,
): (string | undefined) {
  return draft.selections[question]?.[0];
}
