const assert = require("node:assert/strict");
const { mkdirSync, mkdtempSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { dirname, join } = require("node:path");
const test = require("node:test");
const {
  formatSessionPath,
  resolveAgentTraceFile,
  resolveTraceDirectory,
  sanitizeSessionId,
} = require("../plugin/storage-paths.cjs");

test("formats session directories with underscore-separated times", () => {
  assert.deepEqual(
    formatSessionPath(new Date(2026, 8, 10, 7, 8, 9), "session"),
    ["2026", "09-10", "07_08_09-session"],
  );
});

test("rejects reserved source components before resolving a trace directory", () => {
  for (const source of [".", "..", "plugins"]) {
    assert.throws(
      () => resolveTraceDirectory(source, {}, { ASTRO_HOME: "/virtual/root" }),
      /source/i,
    );
  }
  assert.equal(
    resolveTraceDirectory("custom-agent", {}, { ASTRO_HOME: "/virtual/root" }),
    "/virtual/root/custom-agent",
  );
});

test("continues an existing session stored under the legacy time format", (t) => {
  const root = mkdtempSync(join(tmpdir(), "astro-legacy-path-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const legacyFile = join(
    root,
    "custom",
    "2026",
    "09-10",
    "07:08:09-legacy-session",
    "events.jsonl",
  );
  mkdirSync(dirname(legacyFile), { recursive: true });
  writeFileSync(legacyFile, "{}\n");

  assert.equal(
    resolveAgentTraceFile(
      "custom",
      {
        capturedAt: "2026-09-11T00:00:00Z",
        sessionId: "legacy-session",
      },
      { ASTRO_HOME: root },
    ),
    legacyFile,
  );
});

test("prefers the canonical session directory when both layouts exist", (t) => {
  const root = mkdtempSync(join(tmpdir(), "astro-layout-priority-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dateDirectory = join(root, "custom", "2026", "09-10");
  const legacyFile = join(
    dateDirectory,
    "07:08:09-session",
    "events.jsonl",
  );
  const canonicalFile = join(
    dateDirectory,
    "07_08_09-session",
    "events.jsonl",
  );
  for (const traceFile of [legacyFile, canonicalFile]) {
    mkdirSync(dirname(traceFile), { recursive: true });
    writeFileSync(traceFile, "{}\n");
  }

  assert.equal(
    resolveAgentTraceFile(
      "custom",
      { capturedAt: "2026-09-11T00:00:00Z", sessionId: "session" },
      { ASTRO_HOME: root },
    ),
    canonicalFile,
  );
});

test("matches the complete session ID rather than a shared suffix", (t) => {
  const root = mkdtempSync(join(tmpdir(), "astro-path-boundary-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const environment = { ASTRO_HOME: root };
  const payload = { capturedAt: "2026-09-10T00:00:00Z" };
  const parentFile = resolveAgentTraceFile(
    "custom", { ...payload, sessionId: "parent-child" }, environment,
  );
  mkdirSync(dirname(parentFile), { recursive: true });
  writeFileSync(parentFile, "{}\n");
  const childFile = resolveAgentTraceFile(
    "custom", { ...payload, sessionId: "child" }, environment,
  );
  assert.notEqual(childFile, parentFile);
  assert.equal(
    resolveAgentTraceFile("custom", {
      ...payload, sessionId: "parent-child", capturedAt: "2026-09-11T00:00:00Z",
    }, environment),
    parentFile,
  );
});

test("keeps sanitized and truncated session IDs distinct and stable", () => {
  const ids = ["a/b", "a?b", "a-b", `${"x".repeat(110)}a`, `${"x".repeat(110)}b`];
  const sanitized = ids.map(sanitizeSessionId);
  assert.equal(new Set(sanitized).size, ids.length);
  assert.deepEqual(ids.map(sanitizeSessionId), sanitized);
  assert.ok(sanitized.every((id) => /^[a-zA-Z0-9._-]+$/.test(id)));
  assert.equal(sanitizeSessionId("normal-session"), "normal-session");
});
