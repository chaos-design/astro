import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSessions,
  createSessionProjection,
  normalizeTraceEvent,
} from "../src/lib/trace-model.ts";
import type { TraceEvent } from "../src/types/trace.ts";

function makeEvent(
  id: string,
  sessionId: string,
  eventName: string,
  offsetMs: number,
): TraceEvent {
  return normalizeTraceEvent({
    capturedAt: new Date(1_800_000_000_000 + offsetMs).toISOString(),
    cwd: "/tmp/workspace",
    eventName,
    id,
    payload: { prompt: "do the thing" },
    sessionId,
    source: "codex",
    workspaceId: "workspace",
  });
}

test("reuses untouched sessions when the list is appended to", () => {
  const runA = [
    makeEvent("a1", "a", "UserPromptSubmit", 0),
    makeEvent("a2", "a", "PreToolUse", 10),
  ];
  const runB = [
    makeEvent("b1", "b", "UserPromptSubmit", -1000),
    makeEvent("b2", "b", "Stop", -900),
  ];
  const projection = createSessionProjection();
  const first = projection([...runA, ...runB]);
  assert.equal(first.length, 2);

  const sessionA = first.find((session) => session.id === "a");
  const sessionB = first.find((session) => session.id === "b");
  assert.ok(sessionA && sessionB);

  const second = projection([...runA, ...runB, makeEvent("a3", "a", "Stop", 20)]);
  const nextA = second.find((session) => session.id === "a");
  const nextB = second.find((session) => session.id === "b");

  // The untouched run keeps its object identity (and therefore its memoized
  // Prompt runs and RUN HISTORY row render).
  assert.equal(nextB, sessionB);
  assert.notEqual(nextA, sessionA);
  assert.equal(nextA?.status, "complete");
  assert.equal(nextA?.events.length, 3);
});

test("matches a full rebuild when events arrive in bursts", () => {
  const events = [
    makeEvent("a1", "a", "UserPromptSubmit", 0),
    makeEvent("b1", "b", "UserPromptSubmit", 5),
  ];
  const projection = createSessionProjection();
  projection(events);

  const appended = [...events];
  for (let index = 0; index < 6; index += 1) {
    appended.push(
      makeEvent(
        `a-extra-${index}`,
        index % 2 === 0 ? "a" : "b",
        index === 5 ? "Stop" : "PostToolUse",
        30 + index,
      ),
    );
    const projected = projection([...appended]);
    const expected = buildSessions([...appended]);
    assert.deepEqual(
      projected.map((session) => [session.id, session.status, session.events.length]),
      expected.map((session) => [session.id, session.status, session.events.length]),
    );
  }
});

test("falls back to a full rebuild when the list is replaced instead of extended", () => {
  const events = [
    makeEvent("a1", "a", "UserPromptSubmit", 0),
    makeEvent("a2", "a", "PostToolUse", 10),
  ];
  const projection = createSessionProjection();
  const first = projection(events);

  // An import inserts an event *before* the existing ones: the boundary check
  // rejects the prefix and every session is rebuilt.
  const replaced = [makeEvent("z1", "z", "SessionStart", -50), ...events];
  const second = projection(replaced);

  assert.notEqual(second, first);
  assert.deepEqual(
    second.map((session) => session.id).sort(),
    ["a", "z"],
  );
});

test("keeps a canonical event instead of cloning it", () => {
  const event = makeEvent("a1", "a", "UserPromptSubmit", 0);
  assert.equal(normalizeTraceEvent(event), event);
});
