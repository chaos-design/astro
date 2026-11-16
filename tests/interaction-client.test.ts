import assert from "node:assert/strict";
import test from "node:test";

import {
  buildInteractionRequest,
  type InteractionEvent,
} from "../src/lib/interaction-contract.ts";
import {
  answerInteractionQuestion,
  buildInteractionEvent,
  cancelInteraction,
  sendInteractionEvent,
  submitInteraction,
  type InteractionTransport,
} from "../src/lib/interaction-client.ts";
import {
  initialInteractionState,
  interactionReducer,
  type InteractionAction,
  type InteractionDraft,
} from "../src/lib/interaction-reducer.ts";

const NOW = Date.UTC(2026, 10, 15, 10, 0, 0);

function draft(): InteractionDraft {
  const request = buildInteractionRequest(
    {
      hookEventName: "PermissionRequest",
      toolName: "AskUserQuestion",
      toolUseId: "call-1",
      sessionId: "sess-1",
      source: "claude",
      questions: [
        {
          question: "Which framework?",
          header: "Framework",
          options: [{ label: "React" }, { label: "Vue" }],
          multiSelect: true,
        },
      ],
    },
    { now: NOW, timeoutMs: 5000 },
  );
  const state = interactionReducer(initialInteractionState, {
    type: "open",
    request,
  });
  return state.requests[request.requestId];
}

function transport(
  responses: Array<{ ok: boolean; status: number; payload?: unknown }>,
): {
  transport: InteractionTransport;
  calls: Array<{ url: string; body: unknown }>;
} {
  const calls: Array<{ url: string; body: unknown }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    const next = responses.shift() ?? { ok: true, status: 202, payload: {} };
    return {
      ok: next.ok,
      status: next.status,
      json: async () => next.payload ?? {},
    };
  }) as unknown as typeof fetch;
  return {
    transport: { apiBase: "http://127.0.0.1:5678", fetchImpl, now: () => NOW, eventId: () => "iev-1" },
    calls,
  };
}

test("a new event takes the next seq and an ISO timestamp", () => {
  const base = draft();
  const event = buildInteractionEvent(base, "select", { optionLabel: "React" }, {
    apiBase: "",
    now: () => NOW,
    eventId: () => "iev-fixed",
  });
  assert.equal(event.seq, 1);
  assert.equal(event.requestId, base.request.requestId);
  assert.equal(event.eventId, "iev-fixed");
  assert.equal(event.deviceId, "console");
  assert.equal(event.action, "select");
  assert.equal(event.optionLabel, "React");
  assert.equal(event.at, new Date(NOW).toISOString());
});

test("an event is applied optimistically before the POST", async () => {
  const base = draft();
  const dispatches: InteractionAction[] = [];
  const { transport: wire, calls } = transport([{ ok: true, status: 202 }]);
  const result = await sendInteractionEvent(
    base,
    "select",
    { question: "Which framework?", optionLabel: "React" },
    (action) => dispatches.push(action),
    wire,
  );
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    `http://127.0.0.1:5678/api/interactions/${base.request.requestId}/events`,
  );
  assert.equal((calls[0].body as InteractionEvent).seq, 1);
  assert.equal(dispatches[0].type, "update");
});

test("a rejected click rolls back to the last confirmed seq", async () => {
  const base = draft();
  const dispatches: InteractionAction[] = [];
  const { transport: wire } = transport([
    { ok: false, status: 409, payload: { error: "stale seq" } },
  ]);
  const result = await sendInteractionEvent(
    base,
    "select",
    { question: "Which framework?", optionLabel: "Vue" },
    (action) => dispatches.push(action),
    wire,
  );
  assert.equal(result.ok, false);
  assert.equal(result.error, "stale seq");
  assert.deepEqual(dispatches.map((action) => action.type), ["update", "revert"]);
  assert.equal(
    dispatches[1].type === "revert" ? dispatches[1].seq : -1,
    base.seq,
  );
});

test("submit sends the comma-joined answers and locks until the close", async () => {
  let state = { requests: {} as Record<string, InteractionDraft> };
  const base = draft();
  state = interactionReducer(state, { type: "open", request: base.request });
  const selected = interactionReducer(state, {
    type: "update",
    event: buildInteractionEvent(base, "select", {
      question: "Which framework?",
      optionLabel: "Vue",
    }, { apiBase: "", now: () => NOW, eventId: () => "iev-0" }),
  });
  const current = selected.requests[base.request.requestId];
  const dispatches: InteractionAction[] = [];
  const { transport: wire, calls } = transport([
    {
      ok: true,
      status: 200,
      payload: {
        requestId: base.request.requestId,
        status: "answered",
        answers: { "Which framework?": "Vue" },
      },
    },
  ]);
  const result = await submitInteraction(current, (action) =>
    dispatches.push(action), wire);
  assert.equal(result.ok, true);
  assert.deepEqual(dispatches.map((action) => action.type), ["pending", "update"]);
  const submitted = calls[0].body as InteractionEvent;
  assert.equal(submitted.action, "submit");
  assert.deepEqual(submitted.answers, { "Which framework?": "Vue" });
  assert.equal(submitted.seq, 2);

  const again = await submitInteraction(
    { ...current, pending: "iev-1" },
    (action) => dispatches.push(action),
    wire,
  );
  assert.equal(again.blocked, true);
  assert.equal(calls.length, 1, "the second submit never reaches the service");
});

test("submit refuses an incomplete answer map before touching the network", async () => {
  const base = draft();
  const { transport: wire, calls } = transport([]);
  const result = await submitInteraction(base, () => {}, wire);
  assert.equal(result.ok, false);
  assert.equal(result.blocked, true);
  assert.match(result.error || "", /required/);
  assert.equal(calls.length, 0);
});

test("a failed submit reverts the optimistic submit and releases the lock", async () => {
  const base = draft();
  let state = interactionReducer(initialInteractionState, {
    type: "open",
    request: base.request,
  });
  state = interactionReducer(state, {
    type: "update",
    event: buildInteractionEvent(base, "select", {
      question: "Which framework?",
      optionLabel: "React",
    }, { apiBase: "", now: () => NOW, eventId: () => "iev-0" }),
  });
  const current = state.requests[base.request.requestId];
  const dispatches: InteractionAction[] = [];
  const { transport: wire } = transport([
    { ok: false, status: 500, payload: { error: "write failed" } },
  ]);
  const result = await submitInteraction(current, (action) =>
    dispatches.push(action), wire);
  assert.equal(result.ok, false);
  assert.equal(result.error, "write failed");
  assert.deepEqual(dispatches.map((action) => action.type), [
    "pending",
    "update",
    "revert",
  ]);
  const reverted = interactionReducer(state, dispatches[2]);
  const after = reverted.requests[base.request.requestId];
  assert.equal(after.pending, null);
  assert.equal(after.seq, 1, "the confirmed selection survives");
  assert.deepEqual(after.selections, { "Which framework?": ["React"] });
});

test("inspector answer sends text and submit as one keyed chain", async () => {
  const base = draft();
  const dispatches: InteractionAction[] = [];
  const { transport: wire, calls } = transport([
    { ok: true, status: 202 },
    {
      ok: true,
      status: 200,
      payload: {
        requestId: base.request.requestId,
        status: "answered",
        answers: { "Which framework?": "Svelte" },
      },
    },
  ]);
  const result = await answerInteractionQuestion(
    base,
    "Which framework?",
    "  Svelte  ",
    (action) => dispatches.push(action),
    wire,
  );

  assert.equal(result.ok, true);
  assert.equal(result.result?.status, "answered");
  assert.equal(calls.length, 2, "one text event then one submit");
  const text = calls[0].body as InteractionEvent;
  const submit = calls[1].body as InteractionEvent;
  assert.equal(text.action, "text");
  assert.equal(text.seq, 1);
  assert.equal(text.question, "Which framework?");
  assert.equal(text.text, "Svelte");
  assert.equal(submit.action, "submit");
  assert.equal(submit.seq, 2, "submit follows the text event, no duplicate seq");
  assert.deepEqual(submit.answers, { "Which framework?": "Svelte" });
  assert.deepEqual(dispatches.map((action) => action.type), [
    "pending",
    "update",
    "update",
  ]);
});

test("inspector answer refuses a question outside the request", async () => {
  const base = draft();
  const { transport: wire, calls } = transport([]);
  const result = await answerInteractionQuestion(
    base,
    "A different question?",
    "yes",
    () => {},
    wire,
  );
  assert.equal(result.ok, false);
  assert.equal(result.blocked, true);
  assert.equal(calls.length, 0);
});

test("inspector answer rolls back both events when submit fails", async () => {
  const base = draft();
  const dispatches: InteractionAction[] = [];
  const { transport: wire } = transport([
    { ok: true, status: 202 },
    { ok: false, status: 400, payload: { error: "bad answer" } },
  ]);
  const result = await answerInteractionQuestion(
    base,
    "Which framework?",
    "Svelte",
    (action) => dispatches.push(action),
    wire,
  );
  assert.equal(result.ok, false);
  assert.equal(result.error, "bad answer");
  assert.deepEqual(dispatches.map((action) => action.type), [
    "pending",
    "update",
    "update",
    "revert",
  ]);
  const reverted = interactionReducer(initialInteractionState, {
    type: "open",
    request: base.request,
  });
  const after = interactionReducer(reverted, dispatches[3]);
  assert.equal(after.requests[base.request.requestId].seq, 0);
  assert.deepEqual(after.requests[base.request.requestId].selections, {});
});

test("cancel closes through the service, not through an event", async () => {
  const base = draft();
  const { transport: wire, calls } = transport([
    {
      ok: true,
      status: 200,
      payload: { requestId: base.request.requestId, status: "cancelled" },
    },
  ]);
  const result = await cancelInteraction(base, wire);
  assert.equal(result.ok, true);
  assert.equal(result.result?.status, "cancelled");
  assert.match(calls[0].url, /\/close$/);
  assert.deepEqual(calls[0].body, {
    status: "cancelled",
    answeredBy: "console",
  });
});
