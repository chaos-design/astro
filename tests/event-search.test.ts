import assert from "node:assert/strict";
import test from "node:test";
import { getEventSearchText, matchesEventQuery } from "../src/lib/event-search.ts";
import type { TraceEvent } from "../src/types/trace.ts";

function event(overrides: Partial<TraceEvent> = {}): TraceEvent {
  return {
    capturedAt: "2026-10-10T00:00:00Z",
    eventName: "PreToolUse",
    id: "event-1",
    payload: { tool_input: { command: "ls -la" } },
    sequence: 1,
    sessionId: "session",
    source: "claude",
    ...overrides,
  } as TraceEvent;
}

test("an empty needle matches every event", () => {
  assert.equal(matchesEventQuery(event(), ""), true);
});

test("matching ignores case and searches the whole event", () => {
  const target = event({ toolName: "Bash" });
  assert.equal(matchesEventQuery(target, "bash"), true);
  assert.equal(matchesEventQuery(target, "ls -la"), true);
  assert.equal(matchesEventQuery(target, "missing"), false);
});

test("the haystack is built once per event", () => {
  const target = event();
  const first = getEventSearchText(target);
  assert.equal(getEventSearchText(target), first);
  assert.equal(first, JSON.stringify(target).toLowerCase());
});
