import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { setTimeout as sleep } from "node:timers/promises";

import { buildInteractionRequest } from "../plugin/interaction-contract.mjs";
import { startServer } from "./helpers/interaction-server.mjs";

function makeRequest(overrides = {}) {
  return buildInteractionRequest({
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
  });
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

function interactionEvent(request, overrides = {}) {
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

async function openStream(url) {
  const controller = new AbortController();
  const response = await fetch(url, {
    headers: { Accept: "text/event-stream" },
    signal: controller.signal,
  });
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  return {
    read() {
      return reader.read();
    },
    async waitFor(pattern, timeoutMs = 4000) {
      const deadline = Date.now() + timeoutMs;
      while (!pattern.test(buffer)) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) {
          throw new Error(`timed out waiting for ${pattern}: ${buffer}`);
        }
        const result = await Promise.race([reader.read(), sleep(remaining).then(() => null)]);
        if (!result || result.done) {
          throw new Error(`stream ended waiting for ${pattern}: ${buffer}`);
        }
        buffer += decoder.decode(result.value, { stream: true });
      }
      return buffer;
    },
    text() {
      return buffer;
    },
    close() {
      controller.abort();
    },
  };
}

test("C2: creating an interaction returns 201 and invalid payloads return 400", async (t) => {
  const { url } = await startServer(t);
  const request = makeRequest();
  const created = await postJson(`${url}/api/interactions`, request);
  assert.equal(created.status, 201);
  assert.equal(created.body.requestId, request.requestId);
  assert.equal(created.body.created, true);

  const replay = await postJson(`${url}/api/interactions`, request);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.created, false);

  const invalid = await postJson(`${url}/api/interactions`, { ...request, questions: [] });
  assert.equal(invalid.status, 400);
  const badJson = await fetch(`${url}/api/interactions`, {
    method: "POST",
    body: "{not json",
  });
  assert.equal(badJson.status, 400);
});

test("C3: events are accepted once, replays are idempotent, backward seq is refused", async (t) => {
  const { url } = await startServer(t);
  const request = makeRequest();
  await postJson(`${url}/api/interactions`, request);

  const first = await postJson(
    `${url}/api/interactions/${request.requestId}/events`,
    interactionEvent(request, { seq: 1 }),
  );
  assert.equal(first.status, 202);
  assert.equal(first.body.duplicate, false);

  const replay = await postJson(
    `${url}/api/interactions/${request.requestId}/events`,
    interactionEvent(request, { seq: 1 }),
  );
  assert.equal(replay.status, 202);
  assert.equal(replay.body.duplicate, true);

  const backward = await postJson(
    `${url}/api/interactions/${request.requestId}/events`,
    interactionEvent(request, { seq: 1, eventId: "iev-other" }),
  );
  assert.equal(backward.status, 400);
  assert.match(backward.body.error, /seq must increase/);

  const unknown = await postJson(
    `${url}/api/interactions/irq-doesnotexist/events`,
    interactionEvent(request, { seq: 2, eventId: "iev-2" }),
  );
  assert.equal(unknown.status, 404);
});

test("C4: submit closes with a result and repeated closes cannot change it", async (t) => {
  const { url } = await startServer(t);
  const request = makeRequest();
  await postJson(`${url}/api/interactions`, request);

  const submitted = await postJson(
    `${url}/api/interactions/${request.requestId}/events`,
    {
      ...interactionEvent(request, { seq: 1 }),
      action: "submit",
      final: true,
      answers: { "Which framework?": "Vue" },
    },
  );
  assert.equal(submitted.status, 202);
  assert.equal(submitted.body.result.status, "answered");
  assert.deepEqual(submitted.body.result.answers, { "Which framework?": "Vue" });

  const closed = await postJson(`${url}/api/interactions/${request.requestId}/close`, {
    status: "cancelled",
  });
  assert.equal(closed.status, 200);
  assert.equal(closed.body.duplicate, true);
  assert.equal(closed.body.result.status, "answered");

  const late = await postJson(
    `${url}/api/interactions/${request.requestId}/events`,
    interactionEvent(request, { seq: 2, eventId: "iev-2" }),
  );
  assert.equal(late.status, 409);
});

test("C4: a close without a submit produces a cancelled result", async (t) => {
  const { url } = await startServer(t);
  const request = makeRequest();
  await postJson(`${url}/api/interactions`, request);
  const closed = await postJson(`${url}/api/interactions/${request.requestId}/close`, {
    answeredBy: "console",
  });
  assert.equal(closed.body.result.status, "cancelled");
  assert.deepEqual(closed.body.result.answers, {});
});

test("C5: GET returns the record and SSE carries open / update / close once", async (t) => {
  const { url } = await startServer(t);
  const stream = await openStream(`${url}/api/stream`);
  try {
    await stream.waitFor(/event: ready/);
    const request = makeRequest();
    await postJson(`${url}/api/interactions`, request);
    await stream.waitFor(/event: interaction\.open/);
    assert.match(stream.text(), new RegExp(request.requestId));

    await postJson(
      `${url}/api/interactions/${request.requestId}/events`,
      interactionEvent(request, { seq: 1 }),
    );
    await stream.waitFor(/event: interaction\.update/);

    await postJson(
      `${url}/api/interactions/${request.requestId}/events`,
      {
        ...interactionEvent(request, { seq: 2, eventId: "iev-2" }),
        action: "submit",
        final: true,
        answers: { "Which framework?": "React" },
      },
    );
    await stream.waitFor(/event: interaction\.close/);
    await sleep(100);
    assert.equal(
      (stream.text().match(/event: interaction\.close/g) || []).length,
      1,
    );

    const record = await (await fetch(`${url}/api/interactions/${request.requestId}`)).json();
    assert.equal(record.request.requestId, request.requestId);
    assert.equal(record.events.length, 2);
    assert.equal(record.result.status, "answered");
    const missing = await fetch(`${url}/api/interactions/irq-missing`);
    assert.equal(missing.status, 404);
  } finally {
    stream.close();
  }
});

function findEventsFile(root) {
  const stack = [root];
  while (stack.length) {
    const directory = stack.pop();
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        stack.push(path);
      } else if (entry.name === "events.jsonl") {
        return path;
      }
    }
  }
  return "";
}

test("E3: closing writes one Notification TraceEvent and redacts the device", async (t) => {
  const { url, home } = await startServer(t);
  const request = makeRequest({ sessionId: "session-notify" });
  await postJson(`${url}/api/interactions`, request);
  const closed = await postJson(
    `${url}/api/interactions/${request.requestId}/close`,
    { status: "cancelled", answeredBy: "sk-abcdefghijklmnop" },
  );
  assert.equal(closed.body.result.status, "cancelled");

  // The notification is appended after the close frame; poll the JSONL file
  // instead of the SSE stream so this test does not depend on client timing.
  let lines = [];
  for (let attempt = 0; attempt < 60 && !lines.length; attempt += 1) {
    const file = findEventsFile(home);
    if (file) {
      lines = readFileSync(file, "utf8").trim().split("\n").filter(Boolean);
    }
    if (!lines.length) {
      await sleep(50);
    }
  }
  const events = lines.map((line) => JSON.parse(line));
  const notification = events.find((event) => event.eventName === "Notification");
  assert.ok(notification, `notification row written: ${lines.join("\n")}`);
  assert.equal(
    events.filter((event) => event.eventName === "Notification").length,
    1,
    "one close writes exactly one notification",
  );
  assert.equal(notification.payload.notification_type, "answer_cancelled");
  assert.equal(notification.sessionId, request.sessionId);
  assert.match(notification.payload.message, /cancelled the question/);
  assert.doesNotMatch(
    JSON.stringify(notification.payload),
    /sk-abcdefghijklmnop/,
    "event-protocol §10 redaction applies before the row is written",
  );
  assert.match(notification.payload.message, /sk-\[redacted\]/);
});
