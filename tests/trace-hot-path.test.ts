import assert from "node:assert/strict";
import test from "node:test";
import {
  getEventTimestamp,
  normalizeTraceEvent,
} from "../src/lib/trace-model.ts";
import type { TraceEvent } from "../src/types/trace.ts";

function rawEvent(overrides: Record<string, unknown> = {}) {
  return {
    capturedAt: "2026-11-01T08:00:00.000Z",
    cwd: "/tmp/workspace",
    eventName: "PreToolUse",
    id: "event-1",
    payload: { tool_name: "Read" },
    sessionId: "session-1",
    source: "claude",
    workspaceId: "workspace",
    ...overrides,
  };
}

test("normalizes both camel and snake spellings of a canonical name", () => {
  assert.equal(
    normalizeTraceEvent(rawEvent({ eventName: "PreToolUse" })).eventName,
    "PreToolUse",
  );
  assert.equal(
    normalizeTraceEvent(rawEvent({ eventName: "pre_tool_use" })).eventName,
    "PreToolUse",
  );
  assert.equal(
    normalizeTraceEvent(rawEvent({ eventName: "pretooluse" })).eventName,
    "PreToolUse",
  );
  assert.equal(
    normalizeTraceEvent(rawEvent({ eventName: "StopFailure" })).eventName,
    "StopFailure",
  );
  assert.equal(
    normalizeTraceEvent(rawEvent({ eventName: "stop_failure" })).eventName,
    "StopFailure",
  );
});

test("keeps the user-question aliases mapped onto PermissionRequest", () => {
  for (const eventName of [
    "AskUserQuestion",
    "ask_user_question",
    "RequestUserInput",
    "UserQuestion",
  ]) {
    assert.equal(
      normalizeTraceEvent(rawEvent({ eventName })).eventName,
      "PermissionRequest",
      `${eventName} should canonicalize to PermissionRequest`,
    );
  }
});

test("leaves an unknown name untouched and does not invent one", () => {
  assert.equal(
    normalizeTraceEvent(rawEvent({ eventName: "session.custom" })).eventName,
    "session.custom",
  );
  assert.equal(
    normalizeTraceEvent(rawEvent({ eventName: undefined, payload: {} })).eventName,
    "Unknown",
  );
});

test("returns an already canonical event unchanged", () => {
  const canonical: TraceEvent = {
    capturedAt: "2026-11-01T08:00:00.000Z",
    cwd: "/tmp/workspace",
    eventName: "PreToolUse",
    id: "event-1",
    locator: "trace://claude/session-1/event-1",
    nativeEventName: "PreToolUse",
    parentId: null,
    payload: {},
    schemaVersion: 2,
    sequence: null,
    sessionId: "session-1",
    source: "claude",
    sourceVersion: null,
    status: null,
    toolName: "Read",
    toolUseId: "tool-1",
    turnId: "turn-1",
    workspaceId: "workspace",
  };
  // Identity, not equality: re-normalizing a canonical event would copy it and
  // defeat the session projection's identity-based caching.
  assert.equal(normalizeTraceEvent(canonical), canonical);
});

test("caches the parsed timestamp per event and never returns NaN", () => {
  const event = normalizeTraceEvent(rawEvent());
  const first = getEventTimestamp(event);
  const second = getEventTimestamp(event);

  assert.equal(first, Date.parse("2026-11-01T08:00:00.000Z"));
  assert.equal(second, first);

  const broken = normalizeTraceEvent(
    rawEvent({ capturedAt: "not-a-timestamp", id: "event-2" }),
  );
  assert.equal(getEventTimestamp(broken), 0);
});

test("a timestamp read is not affected by a later copy of the event", () => {
  const event = normalizeTraceEvent(rawEvent());
  const cached = getEventTimestamp(event);
  const copy = { ...event, capturedAt: "2027-01-01T00:00:00.000Z" };

  assert.equal(getEventTimestamp(copy), Date.parse("2027-01-01T00:00:00.000Z"));
  assert.equal(getEventTimestamp(event), cached);
});
