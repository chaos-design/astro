import assert from "node:assert/strict";
import test from "node:test";

import {
  fetchRetentionPreview,
  pruneRetention,
  type RetentionPreview,
} from "../src/lib/retention.ts";

/**
 * The settings panel asks a *local service* for a prune preview. Two very
 * different machines answer that request: a current service returns JSON, an
 * older one has no route (404), and a static host rewrites the path to
 * `index.html` (200 + HTML). The last one used to reach the panel as `null`
 * and crash on `preview.eventFiles`; these tests pin the readable error
 * instead, because "Cannot read properties of null" tells the reader nothing.
 */

const originalFetch = globalThis.fetch;

function stubFetch(response: Response | (() => Promise<Response>)) {
  globalThis.fetch = (async () =>
    typeof response === "function" ? response() : response) as typeof fetch;
}

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

const preview: RetentionPreview = {
  days: 15,
  cutoff: "2026-11-11T00:00:00.000Z",
  now: "2026-11-26T00:00:00.000Z",
  sessions: [],
  eventFiles: 0,
  bytes: 0,
};

test("a JSON preview is returned as-is", async () => {
  stubFetch(
    new Response(JSON.stringify(preview), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
  const result = await fetchRetentionPreview("", 15);
  assert.equal(result.eventFiles, 0);
  assert.equal(result.days, 15);
});

test("a static-host fallback (200 + HTML) is a named error, not null", async () => {
  stubFetch(
    new Response("<!doctype html><html></html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    }),
  );
  await assert.rejects(
    () => fetchRetentionPreview("", 15),
    (error: Error) => {
      assert.match(error.message, /没有返回 JSON/);
      assert.match(error.message, /重启本地服务/);
      return true;
    },
  );
});

test("an empty 200 body is a named error too", async () => {
  stubFetch(new Response(null, { status: 200 }));
  await assert.rejects(
    () => fetchRetentionPreview("", 15),
    /没有返回 JSON/,
  );
});

test("a 404 tells the reader to restart the local service", async () => {
  stubFetch(
    new Response(JSON.stringify({ error: "not found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    }),
  );
  await assert.rejects(
    () => fetchRetentionPreview("", 15),
    (error: Error) => {
      assert.match(error.message, /not found/);
      assert.match(error.message, /重启本地服务/);
      return true;
    },
  );
});

test("a prune that returns no body does not resolve silently", async () => {
  stubFetch(new Response("", { status: 200 }));
  await assert.rejects(() => pruneRetention("", 15), /没有返回 JSON/);
});
