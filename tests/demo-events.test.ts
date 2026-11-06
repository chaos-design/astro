import assert from "node:assert/strict";
import test from "node:test";

import {
  DemoDatasetError,
  buildDemoEvents,
  demoDatasetEndpoints,
  isDemoPreviewEnabled,
  loadDemoEvents,
  parseDemoDataset,
  staticDemoDatasetEndpoint,
  type DemoDataset,
} from "../src/lib/demo-events.ts";
import { createDemoEvents, readDemoDataset } from "./helpers/demo-fixture.ts";

const NOW = Date.parse("2026-11-02T10:00:00.000Z");

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Minimal fetch double: answers per URL and records the call order. */
function fakeFetch(
  routes: Record<string, () => Response | Promise<Response>>,
): { impl: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const impl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const handler = routes[url];
    return handler ? await handler() : new Response("not found", { status: 404 });
  }) as typeof fetch;
  return { impl, calls };
}

test("ships one multi-turn sample run as a local dataset document", () => {
  // The dataset is the Demo's only source now: if it loses its shape the
  // console has nothing to fall back to, so the file itself is under test.
  const dataset = readDemoDataset();
  assert.equal(dataset.session.id, "demo-runtime-7f31");
  assert.equal(dataset.session.source, "codex");
  assert.equal(dataset.session.cwd, "/workspace/astro");
  assert.equal(dataset.events.length, 16);

  const events = createDemoEvents(NOW);
  assert.equal(events.length, 16);
  assert.equal(events[0].eventName, "SessionStart");
  assert.equal(events.at(-1)?.eventName, "Stop");
  assert.equal(events[0].sessionId, "demo-runtime-7f31");
  assert.equal(events[0].source, "codex");
  assert.equal(events[0].workspaceId, "demo-workspace");
  // 9.2s from SessionStart to Stop, the span the old hardcoded run asserted.
  assert.equal(
    Date.parse(events.at(-1)!.capturedAt) - Date.parse(events[0].capturedAt),
    9200,
  );
});

test("anchors offsets at load time so the sample stays inside the window", () => {
  const events = createDemoEvents(NOW);
  assert.equal(events[0].capturedAt, new Date(NOW - 9200).toISOString());
  assert.equal(events.at(-1)?.capturedAt, new Date(NOW).toISOString());
  // A day later the run is written relative to that day, not to when the file
  // was authored — otherwise RUN HISTORY's hours window would hide it.
  const tomorrow = createDemoEvents(NOW + 24 * 3_600_000);
  assert.equal(tomorrow.at(-1)?.capturedAt, new Date(NOW + 24 * 3_600_000).toISOString());
});

test("orders events by offset so a hand-edited file still runs chronologically", () => {
  const dataset: DemoDataset = {
    session: { id: "s", source: "codex", workspaceId: "w", cwd: null },
    events: [
      { offsetMs: 1_000, eventName: "Stop", payload: {} },
      { offsetMs: -1_000, eventName: "SessionStart", payload: {} },
      { offsetMs: 0, eventName: "Reasoning", payload: {} },
    ],
  };
  const events = buildDemoEvents(dataset, NOW);
  assert.deepEqual(
    events.map((event) => event.eventName),
    ["SessionStart", "Reasoning", "Stop"],
  );
  // Ids follow the displayed order, so a selected atom keeps a stable id.
  assert.deepEqual(
    events.map((event) => event.id),
    ["demo-0", "demo-1", "demo-2"],
  );
});

test("carries the session identity into every event payload", () => {
  const [first] = buildDemoEvents(
    {
      session: { id: "session-1", source: "claude", workspaceId: "ws", cwd: "/repo" },
      events: [
        {
          offsetMs: 0,
          eventName: "PreToolUse",
          payload: { tool_use_id: "t1", tool_name: "Read", tool_input: { path: "a.ts" } },
        },
      ],
    },
    NOW,
  );
  assert.equal(first.sessionId, "session-1");
  assert.equal(first.source, "claude");
  assert.equal(first.toolUseId, "t1");
  assert.equal(first.toolName, "Read");
  assert.equal(first.cwd, "/repo");
  assert.equal(first.payload.session_id, "session-1");
  assert.equal(first.payload.event_name, "PreToolUse");
  assert.equal(first.payload.cwd, "/repo");
  assert.deepEqual(first.payload.tool_input, { path: "a.ts" });
});

test("reads the service envelope and the bare static document alike", () => {
  const document = {
    schemaVersion: 1,
    session: { id: "s", source: "codex" },
    events: [{ offsetMs: 0, eventName: "SessionStart", payload: {} }],
  };
  const fromFile = parseDemoDataset(document);
  const fromService = parseDemoDataset({ dataset: document, eventCount: 1 });
  assert.deepEqual(fromService, fromFile);
  // Optional session fields have documented defaults instead of `undefined`.
  assert.equal(fromFile.session.workspaceId, "demo-workspace");
  assert.equal(fromFile.session.cwd, null);
});

test("rejects a malformed dataset by naming the field at fault", () => {
  const cases: Array<[unknown, RegExp]> = [
    [null, /JSON 对象/],
    [{}, /session/],
    [{ session: { id: "", source: "codex" }, events: [] }, /session\.id/],
    [{ session: { id: "s", source: " " }, events: [] }, /session\.source/],
    [{ session: { id: "s", source: "codex" } }, /events/],
    [
      { session: { id: "s", source: "codex" }, events: [{ eventName: "Stop" }] },
      /events\[0\]\.offsetMs/,
    ],
    [
      { session: { id: "s", source: "codex" }, events: [{ offsetMs: 0 }] },
      /events\[0\]\.eventName/,
    ],
    [
      {
        session: { id: "s", source: "codex" },
        events: [{ offsetMs: 0, eventName: "Stop", payload: [] }],
      },
      /events\[0\]\.payload/,
    ],
  ];
  for (const [value, expected] of cases) {
    assert.throws(
      () => parseDemoDataset(value),
      (error: unknown) =>
        error instanceof DemoDatasetError && expected.test(error.message),
      `expected ${JSON.stringify(value)} to be rejected`,
    );
  }
});

test("loads the dataset from the local service and reports where it came from", async () => {
  const { impl, calls } = fakeFetch({
    "/api/demo-events": () =>
      jsonResponse({ dataset: fixtureDocument(), eventCount: 16, path: "data/demo-events.json" }),
  });
  const result = await loadDemoEvents({ fetchImpl: impl, now: NOW });
  assert.equal(result.status, "ready");
  assert.deepEqual(calls, ["/api/demo-events"]);
  if (result.status !== "ready") return;
  assert.equal(result.sessionId, "demo-runtime-7f31");
  assert.equal(result.events.length, 16);
  assert.equal(result.events[0].capturedAt, new Date(NOW - 9200).toISOString());
});

test("falls back to the built static copy when the service is unavailable", async () => {
  // A page served by a static host has no /api; the build ships the same
  // document at /data/demo-events.json.
  const { impl, calls } = fakeFetch({
    "/data/demo-events.json": () => jsonResponse(fixtureDocument()),
  });
  const result = await loadDemoEvents({ fetchImpl: impl, now: NOW });
  assert.equal(result.status, "ready");
  assert.deepEqual(calls, [...demoDatasetEndpoints]);
  if (result.status !== "ready") return;
  assert.equal(result.endpoint, "/data/demo-events.json");
});

test("treats an empty dataset as empty instead of an error", async () => {
  const { impl } = fakeFetch({
    "/api/demo-events": () =>
      jsonResponse({
        dataset: { schemaVersion: 1, session: { id: "s", source: "codex" }, events: [] },
      }),
  });
  const result = await loadDemoEvents({ fetchImpl: impl, now: NOW });
  assert.equal(result.status, "empty");
  assert.deepEqual(result.events, []);
});

test("reports both endpoints when neither one yields a dataset", async () => {
  const { impl, calls } = fakeFetch({});
  const result = await loadDemoEvents({ fetchImpl: impl, now: NOW });
  assert.equal(result.status, "error");
  assert.deepEqual(calls, [...demoDatasetEndpoints]);
  if (result.status !== "error") return;
  // The service answered 404 and the static copy was missing; the message has
  // to say which endpoint failed last, or the console notice is useless.
  assert.match(result.error, /\/data\/demo-events\.json: HTTP 404/);
});

test("explains an HTML answer instead of reporting a JSON syntax error", async () => {
  // Static hosts often rewrite unknown paths to index.html and answer 200.
  const { impl } = fakeFetch({
    "/api/demo-events": () =>
      new Response("<!doctype html><title>app</title>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
  });
  const result = await loadDemoEvents({
    fetchImpl: impl,
    endpoints: ["/api/demo-events"],
    now: NOW,
  });
  assert.equal(result.status, "error");
  if (result.status !== "error") return;
  assert.match(result.error, /响应不是 JSON/);
});

test("gives up on a stalled service instead of waiting forever", async () => {
  const stalled = ((_: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      });
    })) as typeof fetch;
  const result = await loadDemoEvents({
    fetchImpl: stalled,
    endpoints: ["/api/demo-events"],
    now: NOW,
    timeoutMs: 10,
  });
  assert.equal(result.status, "error");
  if (result.status !== "error") return;
  assert.match(result.error, /请求超时（10ms）/);
});

test("reports a canceled load without fetching", async () => {
  // Unmounting aborts the request; that is not a failure to announce.
  const { impl, calls } = fakeFetch({});
  const controller = new AbortController();
  controller.abort();
  const result = await loadDemoEvents({
    fetchImpl: impl,
    now: NOW,
    signal: controller.signal,
  });
  assert.equal(result.status, "canceled");
  assert.deepEqual(calls, []);
});

test("the ?demo=1 preview flag is recognised, case-insensitively, on both input shapes", () => {
  // Accepted spellings all turn the sample on.
  for (const on of ["?demo=1", "?demo=true", "?demo=ON", "?demo=yes"]) {
    assert.equal(isDemoPreviewEnabled(on), true, on);
  }
  // Anything else — absent, empty, or an unrecognised value — stays off, so a
  // typo never silently turns the sample on.
  for (const off of ["", "?api=http://127.0.0.1:5678", "?demo=", "?demo=0", "?demo=nope"]) {
    assert.equal(isDemoPreviewEnabled(off), false, off);
  }
  // A URLSearchParams instance is accepted as-is (the app parses once).
  assert.equal(
    isDemoPreviewEnabled(new URLSearchParams({ demo: "1" })),
    true,
  );
});

test("staticDemoDatasetEndpoint resolves the copy next to the page, not the host root", () => {
  // No document (Node) falls back to the root-relative path.
  assert.equal(
    withGlobalDocument(undefined, () => staticDemoDatasetEndpoint()),
    "/data/demo-events.json",
  );
  // A page served from /console/ finds its own copy.
  assert.equal(
    withGlobalDocument("https://x.vercel.app/console/", () =>
      staticDemoDatasetEndpoint(),
    ),
    "/console/data/demo-events.json",
  );
  // Vercel rewrites /console → /console/ but the address bar may stay slash-less;
  // the path must still resolve inside the mount, not drop the segment.
  assert.equal(
    withGlobalDocument("https://x.vercel.app/console", () =>
      staticDemoDatasetEndpoint(),
    ),
    "/console/data/demo-events.json",
  );
  // An explicit index.html names the document inside its directory.
  assert.equal(
    withGlobalDocument("https://x.vercel.app/console/index.html", () =>
      staticDemoDatasetEndpoint(),
    ),
    "/console/data/demo-events.json",
  );
  // A root mount (the local service) lands the copy at /data/.
  assert.equal(
    withGlobalDocument("http://127.0.0.1:5678/index.html", () =>
      staticDemoDatasetEndpoint(),
    ),
    "/data/demo-events.json",
  );
});

/**
 * `staticDemoDatasetEndpoint` reads `document.baseURI`; Node has no document, so
 * temporarily install a stub carrying only that property, then restore the
 * global so other tests are unaffected.
 */
function withGlobalDocument(baseUri: string | undefined, fn: () => unknown) {
  const original = (globalThis as { document?: unknown }).document;
  try {
    (globalThis as { document?: unknown }).document =
      baseUri === undefined ? undefined : { baseURI: baseUri };
    return fn();
  } finally {
    (globalThis as { document?: unknown }).document = original;
  }
}

function fixtureDocument() {
  const dataset = readDemoDataset();
  return {
    schemaVersion: 1,
    session: dataset.session,
    events: dataset.events,
  };
}
