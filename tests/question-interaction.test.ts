import assert from "node:assert/strict";
import test from "node:test";

import { buildRequest as buildHostRequest } from "../scripts/interaction-hook.mjs";
import { buildInteractionRequest } from "../src/lib/interaction-contract.ts";
import {
  isQuestionActionable,
  matchQuestionInteraction,
  questionMatchesCurrentView,
  questionTextsFromEvent,
  shouldLocateInteractionRequest,
} from "../src/lib/question-interaction.ts";
import {
  initialInteractionState,
  interactionReducer,
  type InteractionDraft,
  type InteractionState,
} from "../src/lib/interaction-reducer.ts";
import { normalizeTraceEvent } from "../src/lib/trace-model.ts";
import { getAtomIdForEvent } from "../src/config/atom-platforms.ts";
import type { TraceEvent } from "../src/types/trace.ts";

const NOW = Date.UTC(2026, 10, 16, 10, 0, 0);
const QUESTION = "Which framework should we use?";
const PLAN_QUESTION = "Approve this plan?";

function openRequest(
  overrides: Partial<Parameters<typeof buildInteractionRequest>[0]> = {},
): InteractionDraft {
  const request = buildInteractionRequest(
    {
      hookEventName: "PermissionRequest",
      toolName: "AskUserQuestion",
      toolUseId: "call-1",
      sessionId: "sess-1",
      source: "zcode",
      questions: [
        {
          question: QUESTION,
          header: "Framework",
          options: [{ label: "React" }, { label: "Vue" }],
        },
      ],
      ...overrides,
    },
    { now: NOW, timeoutMs: 5000 },
  );
  const state = interactionReducer(initialInteractionState, {
    type: "open",
    request,
  });
  return state.requests[request.requestId];
}

function planRequest(
  overrides: Partial<Parameters<typeof buildInteractionRequest>[0]> = {},
): InteractionDraft {
  const request = buildInteractionRequest(
    {
      hookEventName: "PermissionRequest",
      toolName: "ExitPlanMode",
      toolUseId: "call-plan",
      sessionId: "sess-1",
      source: "zcode",
      questions: [
        {
          question: PLAN_QUESTION,
          header: "Plan",
          options: [{ label: "Approve" }, { label: "Reject" }],
          required: true,
        },
      ],
      ...overrides,
    },
    { now: NOW, timeoutMs: 5000 },
  );
  const state = interactionReducer(initialInteractionState, {
    type: "open",
    request,
  });
  return state.requests[request.requestId];
}

function questionEvent(
  overrides: Partial<Parameters<typeof normalizeTraceEvent>[0]> = {},
): TraceEvent {
  return normalizeTraceEvent({
    capturedAt: "2026-11-16T10:00:00.000Z",
    eventName: "PermissionRequest",
    id: "event-1",
    payload: {
      tool_use_id: "call-1",
      questions: [{ question: QUESTION, options: [{ label: "React" }] }],
    },
    sessionId: "sess-1",
    source: "zcode",
    toolName: "AskUserQuestion",
    toolUseId: "call-1",
    workspaceId: "workspace",
    ...overrides,
  });
}

function stateWith(...drafts: InteractionDraft[]): InteractionState {
  return drafts.reduce(
    (state, draft) =>
      interactionReducer(state, { type: "open", request: draft.request }),
    initialInteractionState,
  );
}

test("a Flow question binds to the open request by tool id", () => {
  const draft = openRequest();
  const matched = matchQuestionInteraction(
    stateWith(draft).requests,
    questionEvent(),
  );
  assert.equal(matched?.draft.request.requestId, draft.request.requestId);
  assert.equal(matched?.question.question, QUESTION);
});

test("a question without ids binds by session and verbatim question text", () => {
  const draft = openRequest();
  const event = questionEvent({
    payload: { questions: [{ question: QUESTION }] },
    toolUseId: null,
  });
  const matched = matchQuestionInteraction(stateWith(draft).requests, event);
  assert.equal(matched?.draft.request.requestId, draft.request.requestId);
  assert.equal(matched?.question.question, QUESTION);
});

test("a different question never binds to another request", () => {
  const draft = openRequest();
  const event = questionEvent({
    payload: { questions: [{ question: "Different question?" }] },
    toolUseId: null,
  });
  assert.deepEqual(questionTextsFromEvent(event), ["Different question?"]);
  assert.equal(matchQuestionInteraction(stateWith(draft).requests, event), null);
});

test("a plan approval binds by tool id and answers the first descriptor", () => {
  const draft = openRequest();
  const event = questionEvent({ payload: { tool_input: { plan: "# Plan" } } });
  assert.deepEqual(questionTextsFromEvent(event), []);
  const matched = matchQuestionInteraction(stateWith(draft).requests, event);
  assert.equal(matched?.draft.request.requestId, draft.request.requestId);
  assert.equal(matched?.question.question, QUESTION);
});

function planEvent(
  overrides: Partial<Parameters<typeof normalizeTraceEvent>[0]> = {},
): TraceEvent {
  return questionEvent({
    toolName: "ExitPlanMode",
    payload: { tool_input: { plan: "# Plan\n\nRun the tests." } },
    ...overrides,
  });
}

test("a plan approval without ids binds to the session's open ExitPlanMode request", () => {
  const draft = planRequest({ toolUseId: null });
  const event = planEvent({ toolUseId: null });
  assert.deepEqual(questionTextsFromEvent(event), []);
  const matched = matchQuestionInteraction(stateWith(draft).requests, event);
  assert.equal(matched?.draft.request.requestId, draft.request.requestId);
  assert.equal(matched?.question.question, PLAN_QUESTION);
});

test("an unknown session on either side still binds the plan approval", () => {
  const draft = planRequest({ sessionId: "unknown-session" });
  const event = planEvent({ toolUseId: null, sessionId: "unknown-session" });
  const matched = matchQuestionInteraction(stateWith(draft).requests, event);
  assert.equal(matched?.question.question, PLAN_QUESTION);
});

test("another session's plan approval never binds", () => {
  const draft = planRequest();
  const event = planEvent({ toolUseId: null, sessionId: "sess-2" });
  assert.equal(matchQuestionInteraction(stateWith(draft).requests, event), null);
});

test("a textless event never binds to an AskUserQuestion request", () => {
  const draft = openRequest();
  const event = planEvent({ toolUseId: null });
  assert.equal(matchQuestionInteraction(stateWith(draft).requests, event), null);
});

test("a closed request cannot be answered from the inspector", () => {
  const draft = openRequest();
  const state = stateWith(draft);
  const closed = interactionReducer(state, {
    type: "close",
    result: {
      requestId: draft.request.requestId,
      status: "answered",
      answers: { [QUESTION]: "React" },
      answeredBy: "console",
      answeredAt: new Date(NOW).toISOString(),
      elapsedMs: 0,
    },
  });
  assert.equal(matchQuestionInteraction(closed.requests, questionEvent()), null);
});

test("no selected question means no answer target", () => {
  const draft = openRequest();
  assert.equal(matchQuestionInteraction(stateWith(draft).requests, null), null);
  assert.equal(matchQuestionInteraction({}, questionEvent()), null);
});

test("a question from another message never binds even with the same tool id", () => {
  const draft = openRequest();
  const event = questionEvent();
  const otherMessageEvent = normalizeTraceEvent({
    ...event,
    id: "event-other-message",
    sequence: event.sequence + 1,
  });
  assert.equal(
    matchQuestionInteraction(stateWith(draft).requests, event, {
      promptRunEvents: [otherMessageEvent],
      atomId: "agent-step:0:0",
      platformId: "zcode",
    }),
    null,
  );
});

test("a request only shows while the event resolves to the selected atom", () => {
  const draft = openRequest();
  const event = questionEvent();
  const atomId = getAtomIdForEvent(event, "zcode");
  assert.match(atomId, /.+/);
  assert.equal(
    questionMatchesCurrentView({
      draft,
      event,
      promptRunEvents: [event],
      atomId,
      platformId: "zcode",
    }),
    true,
  );
  assert.equal(
    questionMatchesCurrentView({
      draft,
      event,
      promptRunEvents: [event],
      atomId,
      selectedAtomId: "another-atom",
      platformId: "zcode",
    }),
    false,
  );
});

test("switching agent source hides the request on the new message", () => {
  const draft = openRequest();
  const event = questionEvent({ source: "claude" });
  assert.equal(
    questionMatchesCurrentView({
      draft,
      event,
      promptRunEvents: [event],
      atomId: getAtomIdForEvent(event, "claude"),
      platformId: "claude",
    }),
    false,
  );
});

test("only the open run's live interaction pulls the canvas to the question", () => {
  const active = { sessionId: "wb-session", source: "workbuddy" };
  assert.equal(
    shouldLocateInteractionRequest(
      { sessionId: "wb-session", source: "workbuddy" },
      active,
      true,
    ),
    true,
  );
  assert.equal(
    shouldLocateInteractionRequest(
      { sessionId: "wb-session" },
      active,
      true,
    ),
    true,
  );
  assert.equal(
    shouldLocateInteractionRequest(
      { sessionId: "other-session", source: "workbuddy" },
      active,
      true,
    ),
    false,
  );
  assert.equal(
    shouldLocateInteractionRequest(
      { sessionId: "wb-session", source: "zcode" },
      active,
      true,
    ),
    false,
  );
  assert.equal(
    shouldLocateInteractionRequest(
      { sessionId: "wb-session", source: "workbuddy" },
      active,
      false,
    ),
    false,
  );
  assert.equal(
    shouldLocateInteractionRequest(null, active, true),
    false,
  );
});

test("a WorkBuddy PreToolUse can be answered from the console", () => {
  // The host hook receives the inner payload on stdin, while the recorder
  // normalizes the same fields onto the TraceEvent. Both must resolve to the
  // same tool id so the inspector's answer box targets this exact question.
  const hostPayload = {
    hook_event_name: "PreToolUse",
    session_id: "wb-session",
    tool_name: "AskUserQuestion",
    tool_use_id: "call_wb_1",
    call_id: "call_wb_1",
    cwd: "/workspace/demo",
    tool_input: {
      questions: [
        {
          header: "Language",
          question: "Which language?",
          options: [{ label: "Python" }, { label: "Go" }],
        },
      ],
    },
  };
  const built = buildHostRequest(hostPayload, {
    source: "workbuddy",
    inputField: "modifiedInput",
    events: ["PreToolUse"],
  });
  assert.ok(built);

  const event = normalizeTraceEvent({
    capturedAt: "2026-11-17T04:01:43.000Z",
    eventName: "PreToolUse",
    id: "wb-question",
    payload: hostPayload,
    sessionId: "wb-session",
    source: "workbuddy",
    toolName: "AskUserQuestion",
    toolUseId: "call_wb_1",
    workspaceId: "workspace",
  });
  const state = interactionReducer(initialInteractionState, {
    type: "open",
    request: built!.request,
  });
  const matched = matchQuestionInteraction(state.requests, event);
  assert.equal(matched?.question.question, "Which language?");
  assert.equal(matched?.draft.request.source, "workbuddy");
  assert.equal(matched?.draft.request.toolUseId, "call_wb_1");
});

test("floating question is actionable only while the task is executing and not replayed", () => {
  // Both live states count: a running turn and a turn paused on this very
  // question. These are the states RUN HISTORY and the Live button call live.
  assert.equal(
    isQuestionActionable({ status: "active", replayMode: false, isDemo: false }),
    true,
  );
  assert.equal(
    isQuestionActionable({ status: "waiting", replayMode: false, isDemo: false }),
    true,
  );
  // A finished, failed or interrupted run is a history preview: the question
  // stays readable, but no card floats and the answer controls go read-only.
  for (const status of ["complete", "failed", "terminated", undefined]) {
    assert.equal(
      isQuestionActionable({ status, replayMode: false, isDemo: false }),
      false,
      `status ${String(status)} must not float a question card`,
    );
  }
  // Replaying a captured snapshot is historical even while the run is live.
  assert.equal(
    isQuestionActionable({ status: "active", replayMode: true, isDemo: false }),
    false,
  );
  assert.equal(
    isQuestionActionable({ status: "waiting", replayMode: true, isDemo: false }),
    false,
  );
  // The sample dataset carries no live interaction requests to answer.
  assert.equal(
    isQuestionActionable({ status: "active", replayMode: false, isDemo: true }),
    false,
  );
});
