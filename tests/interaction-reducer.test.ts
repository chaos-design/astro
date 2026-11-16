import assert from "node:assert/strict";
import test from "node:test";

import {
  buildInteractionRequest,
  buildInteractionResult,
  type InteractionEvent,
  type InteractionRequest,
  type QuestionDescriptor,
} from "../src/lib/interaction-contract.ts";
import {
  buildInteractionAnswers,
  initialInteractionState,
  interactionReducer,
  isInteractionSubmittable,
  type InteractionDraft,
} from "../src/lib/interaction-reducer.ts";

const NOW = Date.UTC(2026, 10, 15, 10, 0, 0);

function question(
  overrides: Partial<QuestionDescriptor> = {},
): QuestionDescriptor {
  return {
    question: "Which framework?",
    header: "Framework",
    options: [{ label: "React" }, { label: "Vue" }],
    ...overrides,
  };
}

function request(
  questions: QuestionDescriptor[] = [question()],
): InteractionRequest {
  return buildInteractionRequest(
    {
      hookEventName: "PermissionRequest",
      toolName: "AskUserQuestion",
      toolUseId: "call-1",
      sessionId: "sess-1",
      source: "claude",
      cwd: "/repo",
      questions,
    },
    { now: NOW, timeoutMs: 5000 },
  );
}

function event(
  requestId: string,
  seq: number,
  action: InteractionEvent["action"],
  extra: Partial<InteractionEvent> = {},
): InteractionEvent {
  return {
    requestId,
    eventId: `iev-${seq}`,
    seq,
    action,
    deviceId: "console",
    at: new Date(NOW + seq * 100).toISOString(),
    question: "Which framework?",
    ...extra,
  };
}

function opened(requestValue = request()) {
  const state = interactionReducer(initialInteractionState, {
    type: "open",
    request: requestValue,
  });
  return { state, request: requestValue, draft: state.requests[requestValue.requestId] };
}

function apply(
  draft: InteractionDraft,
  next: InteractionEvent,
) {
  const state = { requests: { [draft.request.requestId]: draft } };
  return interactionReducer(state, { type: "update", event: next });
}

function select(requestId: string, seq: number, label: string) {
  return event(requestId, seq, "select", { optionLabel: label });
}

function step(draft: InteractionDraft, next: InteractionEvent): InteractionDraft {
  return apply(draft, next).requests[draft.request.requestId];
}

test("open seeds a draft and never replaces an existing one", () => {
  const { state, request: req, draft } = opened();
  assert.equal(draft.request, req);
  assert.equal(draft.seq, 0);
  assert.equal(draft.revision, req.revision);
  assert.deepEqual(draft.selections, {});
  assert.equal(draft.result, null);
  assert.equal(draft.pending, null);

  const reopened = interactionReducer(state, {
    type: "open",
    request: { ...req, revision: 9 },
  });
  assert.equal(
    reopened.requests[req.requestId].request.revision,
    req.revision,
    "a duplicate open frame must not rewrite the request",
  );
});

test("update advances seq and derives selections from the events", () => {
  const { request: req, draft } = opened();
  const afterSelect = apply(draft, select(req.requestId, 1, "React"));
  const next = afterSelect.requests[req.requestId];
  assert.equal(next.seq, 1);
  assert.equal(next.events.length, 1);
  assert.deepEqual(next.selections, { "Which framework?": ["React"] });

  const replaced = apply(next, select(req.requestId, 2, "Vue"));
  assert.deepEqual(
    replaced.requests[req.requestId].selections,
    { "Which framework?": ["Vue"] },
    "a single-select click replaces the previous answer",
  );
});

test("a stale or post-close update is ignored", () => {
  const { request: req, draft } = opened();
  const once = apply(draft, select(req.requestId, 2, "React"));
  const replay = interactionReducer(once, {
    type: "update",
    event: select(req.requestId, 1, "Vue"),
  });
  assert.equal(replay, once, "a replayed seq returns the same state object");

  const closed = interactionReducer(once, {
    type: "close",
    result: buildInteractionResult(req, "answered", { "Which framework?": "React" }, { now: NOW + 500 }),
  });
  const late = interactionReducer(closed, {
    type: "update",
    event: select(req.requestId, 3, "Vue"),
  });
  assert.equal(late, closed, "events after the result cannot rewrite the answer");
});

test("close re-derives the persisted answers and stays idempotent", () => {
  const { request: req, draft } = opened();
  const selected = apply(draft, select(req.requestId, 1, "React"));
  const first = buildInteractionResult(
    req,
    "answered",
    { "Which framework?": "React, Vue" },
    { now: NOW + 500 },
  );
  const state = interactionReducer(selected, { type: "close", result: first });
  assert.equal(state.requests[req.requestId].result, first);
  assert.equal(state.requests[req.requestId].pending, null);
  assert.deepEqual(state.requests[req.requestId].selections, {
    "Which framework?": ["React", "Vue"],
  });

  const second = buildInteractionResult(
    req,
    "cancelled",
    {},
    { now: NOW + 900 },
  );
  const duplicate = interactionReducer(state, { type: "close", result: second });
  assert.equal(
    duplicate.requests[req.requestId].result,
    first,
    "the first close is the answer of record",
  );
});

test("reset drops every request and does not replay history", () => {
  const { state } = opened();
  const reset = interactionReducer(state, { type: "reset" });
  assert.deepEqual(reset, { requests: {} });
});

test("multi-select collects labels and buildInteractionAnswers sorts by option order", () => {
  const req = request([question({ multiSelect: true })]);
  const { draft } = opened(req);
  const both = step(
    step(draft, select(req.requestId, 1, "Vue")),
    select(req.requestId, 2, "React"),
  );
  assert.deepEqual(both.selections["Which framework?"], ["Vue", "React"]);
  assert.deepEqual(buildInteractionAnswers(both), {
    "Which framework?": "React, Vue",
  });

  const deselected = step(both, event(req.requestId, 3, "deselect", {
    optionLabel: "Vue",
  }));
  assert.deepEqual(deselected.selections["Which framework?"], ["React"]);

  const empty = step(deselected, event(req.requestId, 4, "deselect", {
    optionLabel: "React",
  }));
  assert.equal(
    "Which framework?" in empty.selections,
    false,
    "de-selecting the last label removes the question",
  );
  assert.deepEqual(buildInteractionAnswers(empty), {});
});

test("text, edit and skip are plain event transitions", () => {
  const req = request([
    question({ options: [{ label: "React" }, { label: "Vue" }] }),
  ]);
  const { draft } = opened(req);

  const typed = apply(draft, event(req.requestId, 1, "text", {
    text: "  Svelte  ",
  })).requests[req.requestId];
  assert.deepEqual(typed.selections, { "Which framework?": ["Svelte"] });
  assert.deepEqual(buildInteractionAnswers(typed), {
    "Which framework?": "Svelte",
  });

  const edited = apply(typed, event(req.requestId, 2, "edit", {
    previous: "Svelte",
    next: "Solid",
  })).requests[req.requestId];
  assert.deepEqual(edited.selections, { "Which framework?": ["Solid"] });

  const skipped = apply(edited, event(req.requestId, 3, "skip")).requests[
    req.requestId
  ];
  assert.equal("Which framework?" in skipped.selections, false);
  assert.deepEqual(buildInteractionAnswers(skipped), {});
});

test("pending blocks the second submit and revert rolls the optimistic event back", () => {
  const { request: req, draft } = opened();
  const optimistic = event(req.requestId, 1, "select", {
    optionLabel: "Vue",
    eventId: "iev-pending",
  });
  const selected = apply(draft, optimistic).requests[req.requestId];
  const pendingState = interactionReducer(
    { requests: { [req.requestId]: selected } },
    { type: "pending", requestId: req.requestId, eventId: "iev-pending" },
  );
  assert.equal(pendingState.requests[req.requestId].pending, "iev-pending");

  const reverted = interactionReducer(pendingState, {
    type: "revert",
    requestId: req.requestId,
    seq: 0,
  });
  const after = reverted.requests[req.requestId];
  assert.equal(after.events.length, 0, "the unconfirmed event is dropped");
  assert.equal(after.seq, 0);
  assert.equal(after.pending, null, "the submit lock is released");
  assert.deepEqual(after.selections, {}, "the clicked card is no longer lit");
});

test("revert to a confirmed seq keeps the events the service accepted", () => {
  const { request: req, draft } = opened();
  let state = { requests: { [req.requestId]: draft } };
  for (const [seq, label] of [[1, "React"], [2, "Vue"]] as const) {
    state = interactionReducer(state, {
      type: "update",
      event: select(req.requestId, seq, label),
    });
  }
  state = interactionReducer(state, {
    type: "pending",
    requestId: req.requestId,
    eventId: "iev-3",
  });
  const reverted = interactionReducer(state, {
    type: "revert",
    requestId: req.requestId,
    seq: 1,
  });
  const after = reverted.requests[req.requestId];
  assert.equal(after.seq, 1);
  assert.deepEqual(after.selections, { "Which framework?": ["React"] });
});

test("submit requires an answer to every required question", () => {
  const req = request([
    question(),
    question({
      question: "Deploy target?",
      header: "Target",
      options: [{ label: "Edge" }, { label: "Cloud" }],
      required: false,
    }),
  ]);
  const { draft } = opened(req);
  assert.equal(isInteractionSubmittable(draft), false);

  const first = apply(draft, select(req.requestId, 1, "React")).requests[
    req.requestId
  ];
  assert.equal(
    isInteractionSubmittable(first),
    true,
    "an optional question may be skipped",
  );

  const optionalOnly = apply(
    apply(draft, select(req.requestId, 1, "React")).requests[req.requestId],
    event(req.requestId, 2, "skip", {
      question: "Deploy target?",
    }),
  ).requests[req.requestId];
  assert.equal(isInteractionSubmittable(optionalOnly), true);
});

test("replace swaps the questions and bumps the revision", () => {
  const { request: req, draft } = opened();
  const replacement = [
    question({
      question: "Which bundler?",
      header: "Bundler",
      options: [{ label: "Vite" }, { label: "Webpack" }],
    }),
  ];
  const next = step(draft, event(req.requestId, 1, "replace", {
    questions: replacement,
    revision: 2,
  }));
  assert.equal(next.revision, 2);
  assert.deepEqual(
    next.request.questions.map((item) => [item.question, item.header]),
    [["Which bundler?", "Bundler"]],
  );
});
