import assert from "node:assert/strict";
import test from "node:test";

import {
  apiBaseStorageKey,
  defaultLocalApiBase,
  isLocalOrigin,
  joinApi,
  normalizeApiBase,
  resolveApiBase,
} from "../src/lib/api-base.ts";

test("same-origin is the default for a page the local service serves", () => {
  for (const origin of [
    "http://127.0.0.1:5678",
    "http://localhost:5173",
    "http://[::1]:5678",
  ]) {
    assert.deepEqual(resolveApiBase({ origin }), {
      base: "",
      source: "same-origin",
    });
  }
});

test("a deployed page defaults to the service on the reader's machine", () => {
  // Vercel and GitHub Pages origins are never local, so the console looks for
  // the local service on the loopback — the machine that has the traces.
  for (const origin of [
    "https://astro-xxx.vercel.app",
    "https://chaos-design.github.io",
  ]) {
    assert.deepEqual(resolveApiBase({ origin }), {
      base: defaultLocalApiBase,
      source: "heuristic",
    });
  }
});

test("an explicit ?api= wins and normalizes", () => {
  assert.deepEqual(resolveApiBase({ search: "?api=http://127.0.0.1:4399", origin: "https://a.vercel.app" }), {
    base: "http://127.0.0.1:4399",
    source: "param",
  });
  // A path prefix survives, for consoles behind a reverse proxy.
  assert.deepEqual(resolveApiBase({ search: "?api=https://gw.corp.dev/astro", origin: "http://127.0.0.1:5678" }), {
    base: "https://gw.corp.dev/astro",
    source: "param",
  });
  // A trailing slash must not double up when paths are joined.
  assert.equal(resolveApiBase({ search: "?api=http://127.0.0.1:4399/", origin: "http://127.0.0.1:5678" }).base, "http://127.0.0.1:4399");
  // An explicit empty value resets to same-origin and clears the override.
  assert.deepEqual(resolveApiBase({ search: "?api=", origin: "https://a.vercel.app", stored: defaultLocalApiBase }), {
    base: "",
    source: "param",
  });
});

test("an unusable ?api= falls through instead of breaking the console", () => {
  for (const bad of ["?api=ftp://x", "?api=not a url", "?api=http://x/y?z=1"]) {
    assert.equal(resolveApiBase({ search: bad, origin: "https://a.vercel.app" }).source, "heuristic");
  }
});

test("the stored override applies when no param is present", () => {
  assert.deepEqual(
    resolveApiBase({
      search: "",
      origin: "http://127.0.0.1:5678",
      stored: "http://127.0.0.1:4399",
    }),
    { base: "http://127.0.0.1:4399", source: "stored" },
  );
  // A URLSearchParams instance is accepted as-is (the app parses once).
  assert.deepEqual(
    resolveApiBase({
      search: new URLSearchParams({ api: "http://127.0.0.1:4399" }),
      origin: "https://a.vercel.app",
      stored: "http://127.0.0.1:4000",
    }).source,
    "param",
  );
});

test("normalization rejects what fetch cannot use", () => {
  assert.equal(normalizeApiBase(""), "");
  assert.equal(normalizeApiBase("http://127.0.0.1:5678"), "http://127.0.0.1:5678");
  assert.equal(normalizeApiBase("  http://127.0.0.1:5678/  "), "http://127.0.0.1:5678");
  for (const bad of ["notaurl", "ftp://127.0.0.1", "javascript:alert(1)", "http://x/#frag", "http://x/?q=1"]) {
    assert.equal(normalizeApiBase(bad), null, bad);
  }
});

test("joinApi keeps the base path and the leading slash of the route", () => {
  assert.equal(joinApi("", "/api/health"), "/api/health");
  assert.equal(joinApi("http://127.0.0.1:5678", "/api/stream"), "http://127.0.0.1:5678/api/stream");
  assert.equal(
    joinApi("https://gw.corp.dev/astro", "/api/stream"),
    "https://gw.corp.dev/astro/api/stream",
  );
});

test("local-origin detection and the storage key stay stable", () => {
  assert.equal(isLocalOrigin("http://localhost:3000"), true);
  assert.equal(isLocalOrigin("https://a.vercel.app"), false);
  assert.equal(isLocalOrigin(""), false);
  // The persisted key is part of the deployed-page contract: renaming it
  // silently drops every reader's saved service address.
  assert.equal(apiBaseStorageKey, "ASTROX_API_BASE");
});
