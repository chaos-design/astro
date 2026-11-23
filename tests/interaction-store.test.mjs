import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { setTimeout as sleep } from "node:timers/promises";

import { buildInteractionRequest } from "../plugin/interaction-contract.mjs";
import {
  InteractionStoreError,
  buildInteractionNotification,
  createInteractionStore,
} from "../server/interaction-store.mjs";

function makeStore(events = {}, storeOptions = {}) {
  const home = mkdtempSync(join(tmpdir(), "astro-interaction-store-"));
  const store = createInteractionStore({
    astroHome: home,
    onOpen: (request) => events.opens?.push(request),
    onUpdate: (event) => events.updates?.push(event),
    onClose: (result, request) => {
      events.closes?.push(result);
      events.closeRequests?.push(request);
    },
    ...storeOptions,
  });
  store.init();
  return { home, store, events };
}

function makeRequest(overrides = {}, timeoutMs) {
  return buildInteractionRequest(
    {
      hookEventName: "PermissionRequest",
      toolName: "AskUserQuestion",
      toolUseId: "call_001",
      sessionId: "session-1",
      source: "claude",
      questions: [
        {
          question: "Which framework?",
          header: "Framework",
          options: [{ label: "React" }, { label: "Vue" }],
        },
      ],
      ...overrides,
    },
    timeoutMs ? { timeoutMs } : {},
  );
}

function event(request, overrides = {}) {
  return {
    requestId: request.requestId,
    eventId: `iev-${overrides.seq || 1}`,
    seq: 1,
    action: "select",
    deviceId: "console",
    at: new Date().toISOString(),
    question: "Which framework?",
    optionLabel: "React",
    ...overrides,
  };
}

test("C1: requests and results are written atomically and parse as JSON", () => {
  const opens = [];
  const closes = [];
  const { home, store } = makeStore({ opens, closes });
  try {
    const request = makeRequest();
    const created = store.create(request);
    assert.equal(created.created, true);
    assert.equal(opens.length, 1);

    const requestFile = join(home, "interactions", `${request.requestId}.request.json`);
    assert.deepEqual(JSON.parse(readFileSync(requestFile, "utf8")), request);
    const result = store.append(request.requestId, {
      ...event(request),
      action: "submit",
      final: true,
      answers: { "Which framework?": "Vue" },
    }).result;
    assert.equal(result.status, "answered");
    const resultFile = join(home, "interactions", `${request.requestId}.json`);
    assert.deepEqual(JSON.parse(readFileSync(resultFile, "utf8")), result);
    assert.equal(closes.length, 1);
    assert.equal(
      readdirSync(join(home, "interactions")).some((name) => name.endsWith(".tmp")),
      false,
    );
  } finally {
    store.stop();
    rmSync(home, { recursive: true, force: true });
  }
});

test("C3: losing the last console cancels open requests so the host falls back at once", () => {
  const closes = [];
  const { home, store } = makeStore({ closes });
  try {
    const first = makeRequest({}, 10_000);
    const second = makeRequest({ sessionId: "session-2", toolUseId: "call_002" }, 10_000);
    store.create(first);
    store.create(second);
    const answered = makeRequest({ sessionId: "session-3", toolUseId: "call_003" }, 10_000);
    store.create(answered);
    store.append(answered.requestId, {
      ...event(answered),
      action: "submit",
      final: true,
      answers: { "Which framework?": "React" },
    });

    const cancelled = store.cancelOrphaned();
    assert.equal(cancelled.length, 2);
    assert.deepEqual(
      cancelled.map((result) => result.status),
      ["cancelled", "cancelled"],
    );
    assert.deepEqual(
      cancelled.map((result) => result.answeredBy),
      ["service", "service"],
    );
    assert.equal(store.get(first.requestId).result.status, "cancelled");
    assert.equal(store.get(second.requestId).result.status, "cancelled");
    assert.equal(store.get(answered.requestId).result.status, "answered");
    assert.equal(closes.length, 3, "two cancellations use the normal close path once each");
    assert.deepEqual(store.cancelOrphaned(), [], "a second disconnect is a no-op");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("C1: a new record never inherits the previous result of the same request id", () => {
  const { home, store } = makeStore();
  try {
    const request = makeRequest();
    store.create(request);
    store.append(request.requestId, {
      ...event(request),
      action: "submit",
      final: true,
      answers: { "Which framework?": "Vue" },
    });
    const resultFile = join(home, "interactions", `${request.requestId}.json`);
    assert.equal(JSON.parse(readFileSync(resultFile, "utf8")).status, "answered");

    // A host retry with the same deterministic id must start a fresh window;
    // otherwise the polling hook would read Vue without anyone answering.
    const retry = makeRequest();
    assert.equal(retry.requestId, request.requestId);
    // The in-memory record is still open, so emulate a fresh service process.
    const retryStore = createInteractionStore({ astroHome: home });
    retryStore.init();
    const created = retryStore.create(retry);
    assert.equal(created.created, true);
    assert.equal(retryStore.get(retry.requestId).result, null);
    assert.equal(
      JSON.parse(readFileSync(join(home, "interactions", `${retry.requestId}.request.json`), "utf8")).requestId,
      retry.requestId,
    );
    assert.equal(
      (() => {
        try {
          JSON.parse(readFileSync(resultFile, "utf8"));
          return true;
        } catch {
          return false;
        }
      })(),
      false,
      "the stale result file is removed before the hook can poll it",
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("C1: a request opened with no console attached closes at once", () => {
  const closes = [];
  const { home, store } = makeStore(
    { closes },
    { hasStreamClients: () => false },
  );
  try {
    const request = makeRequest();
    const created = store.create(request);
    assert.equal(created.created, true);
    const record = store.get(request.requestId);
    assert.equal(record.result.status, "cancelled");
    assert.equal(record.result.answeredBy, "service");
    assert.equal(closes.length, 1);
    // `cancelled` is in the hook's poll break set, so the result file the hook
    // reads is already on disk — the host's native prompt returns immediately.
    const resultFile = join(home, "interactions", `${request.requestId}.json`);
    assert.equal(JSON.parse(readFileSync(resultFile, "utf8")).status, "cancelled");
    const notification = buildInteractionNotification(request, record.result);
    assert.match(notification.summary, /No console page was attached/);
  } finally {
    store.stop();
    rmSync(home, { recursive: true, force: true });
  }
});

test("C1: with a console attached the request stays open for the window", () => {
  const closes = [];
  const { home, store } = makeStore({ closes }, { hasStreamClients: () => true });
  try {
    const request = makeRequest();
    store.create(request);
    assert.equal(store.get(request.requestId).result, null);
    assert.equal(closes.length, 0);
  } finally {
    store.stop();
    rmSync(home, { recursive: true, force: true });
  }
});

test("C1: duplicate create is idempotent and invalid input is a 400", () => {
  const { home, store } = makeStore();
  try {
    const request = makeRequest();
    assert.equal(store.create(request).created, true);
    assert.equal(store.create(request).created, false);
    assert.equal(store.size(), 1);
    assert.throws(
      () => store.create({ ...request, questions: [] }),
      (error) => error instanceof InteractionStoreError && error.status === 400,
    );
  } finally {
    store.stop();
    rmSync(home, { recursive: true, force: true });
  }
});

test("C1: duplicate eventId replays the stored outcome, a backward seq is rejected", () => {
  const updates = [];
  const { home, store } = makeStore({ updates });
  try {
    const request = makeRequest();
    store.create(request);
    const first = event(request, { seq: 1 });
    store.append(request.requestId, first);
    const replay = store.append(request.requestId, first);
    assert.equal(replay.duplicate, true);
    assert.equal(store.get(request.requestId).events.length, 1);
    assert.equal(updates.length, 1);

    assert.throws(
      () => store.append(request.requestId, event(request, { seq: 1, eventId: "iev-x" })),
      (error) => error instanceof InteractionStoreError && error.status === 400,
    );
    assert.throws(
      () => store.append("irq-unknown", first),
      (error) => error instanceof InteractionStoreError && error.status === 404,
    );
  } finally {
    store.stop();
    rmSync(home, { recursive: true, force: true });
  }
});

test("C4: a submit answers once and a repeat close cannot change it", () => {
  const closes = [];
  const { home, store } = makeStore({ closes });
  try {
    const request = makeRequest();
    store.create(request);
    const submitted = store.append(request.requestId, {
      ...event(request, { seq: 1 }),
      action: "submit",
      final: true,
      answers: { "Which framework?": "Vue" },
    });
    assert.equal(submitted.result.status, "answered");
    assert.deepEqual(submitted.result.answers, { "Which framework?": "Vue" });

    const closed = store.close(request.requestId, { status: "cancelled" });
    assert.equal(closed.duplicate, true);
    assert.equal(closed.result.status, "answered");
    assert.equal(closes.length, 1);

    assert.throws(
      () => store.append(request.requestId, event(request, { seq: 2, eventId: "iev-2" })),
      (error) => error instanceof InteractionStoreError && error.status === 409,
    );
  } finally {
    store.stop();
    rmSync(home, { recursive: true, force: true });
  }
});

test("C6: one timer closes the request with timeout and never fires twice", async () => {
  const closes = [];
  const { home, store } = makeStore({ closes });
  try {
    // 600 ms host timeout becomes a 100 ms TTL, the same rule the hook uses.
    const request = makeRequest({}, 600);
    store.create(request);
    await sleep(160);
    const record = store.get(request.requestId);
    assert.equal(record.result.status, "timeout");
    assert.deepEqual(record.result.answers, {});
    assert.equal(closes.length, 1);
    const again = store.close(request.requestId);
    assert.equal(again.duplicate, true);
    assert.equal(closes.length, 1);
  } finally {
    store.stop();
    rmSync(home, { recursive: true, force: true });
  }
});

test("E3: a close yields one notification with counts and the device, never answers", () => {
  const request = makeRequest();
  const result = {
    requestId: request.requestId,
    status: "answered",
    answers: { "Which framework?": "Vue" },
    answeredBy: "laptop",
    answeredAt: new Date().toISOString(),
    elapsedMs: 1200,
  };
  const notification = buildInteractionNotification(request, result);
  assert.equal(notification.kind, "answer_applied");
  assert.equal(notification.channel, "trace");
  assert.equal(notification.target, "user");
  assert.equal(notification.requestId, request.requestId);
  assert.equal(notification.sessionId, request.sessionId);
  assert.equal(notification.detail.answered, 1);
  assert.equal(notification.detail.answeredBy, "laptop");
  assert.match(notification.summary, /answered 1 question via laptop/);
  // A Reject is recorded as answered but the hook falls open; claiming the
  // answers were injected would be false. The notification only reports the
  // count, device and elapsed time.
  assert.doesNotMatch(notification.summary, /inject/);
  assert.doesNotMatch(JSON.stringify(notification), /Vue/);

  const cancelled = buildInteractionNotification(request, {
    ...result,
    status: "cancelled",
    answers: {},
  });
  assert.equal(cancelled.kind, "answer_cancelled");
  const timedOut = buildInteractionNotification(request, {
    ...result,
    status: "timeout",
    answers: {},
  });
  assert.equal(timedOut.kind, "interaction_timeout");
  assert.match(timedOut.summary, /expired without an answer/);
  const expired = buildInteractionNotification(request, {
    ...result,
    status: "expired",
    answers: {},
  });
  assert.equal(expired.kind, "fallback_prompt");
});

test("findOpen recovers an open request by session and tool identity after a refresh", () => {
  const { home, store } = makeStore();
  try {
    const first = makeRequest({ toolUseId: "call_refresh", sessionId: "session-refresh" });
    const other = makeRequest({ toolUseId: "call_other", sessionId: "session-refresh" });
    store.create(first);
    store.create(other);

    const byTool = store.findOpen({ sessionId: "session-refresh", toolUseId: "call_refresh" });
    assert.equal(byTool.length, 1);
    assert.equal(byTool[0].request.requestId, first.requestId);
    assert.equal(byTool[0].request.questions[0].question, first.questions[0].question);

    const bySession = store.findOpen({ sessionId: "session-refresh" });
    assert.equal(bySession.length, 2);

    const noMatch = store.findOpen({ sessionId: "session-refresh", toolUseId: "call_missing" });
    assert.equal(noMatch.length, 0);

    const noIdentity = store.findOpen({});
    assert.equal(noIdentity.length, 0);
  } finally {
    store.stop();
    rmSync(home, { recursive: true, force: true });
  }
});

test("findOpen never returns a closed request", () => {
  const { home, store } = makeStore();
  try {
    const request = makeRequest({ toolUseId: "call_closed", sessionId: "session-closed" });
    store.create(request);
    store.close(request.requestId, {
      answers: { "Which framework?": "React" },
      answeredBy: "console",
    });
    const found = store.findOpen({ sessionId: "session-closed", toolUseId: "call_closed" });
    assert.equal(found.length, 0);
  } finally {
    store.stop();
    rmSync(home, { recursive: true, force: true });
  }
});
