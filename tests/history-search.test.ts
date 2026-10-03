import assert from "node:assert/strict";
import test from "node:test";
import {
  buildHistorySearchIndex,
  filterHistorySearchEntries,
  getHistoryDateBounds,
} from "../src/lib/history-search.ts";
import {
  buildSessionPromptRuns,
  buildSessions,
  normalizeTraceEvent,
} from "../src/lib/trace-model.ts";
import type {
  EventTone,
  TraceEventInput,
  TraceRunStatus,
} from "../src/types/trace.ts";

function trace(
  id: string,
  source: string,
  sessionId: string,
  eventName: string,
  capturedAt: string,
  payload: Record<string, unknown> = {},
) {
  return normalizeTraceEvent({
    capturedAt,
    eventName,
    id,
    payload,
    sessionId,
    source,
    workspaceId: "workspace",
  } satisfies TraceEventInput);
}

function searchFixture() {
  const events = [
    trace(
      "session-start-a",
      "trae",
      "session-a",
      "SessionStart",
      "2026-09-10T07:59:00.000Z",
    ),
    trace(
      "prompt-a",
      "trae",
      "session-a",
      "UserPromptSubmit",
      "2026-09-10T08:00:00.000Z",
      { prompt: "Build the execution topology" },
    ),
    trace(
      "tool-a",
      "trae",
      "session-a",
      "PreToolUse",
      "2026-09-10T08:01:00.000Z",
      { tool_name: "Read", tool_input: { path: "src/app.tsx" } },
    ),
    trace(
      "stop-a",
      "trae",
      "session-a",
      "Stop",
      "2026-09-10T08:02:00.000Z",
      { last_assistant_message: "Topology completed" },
    ),
    trace(
      "prompt-b",
      "claude",
      "session-b",
      "UserPromptSubmit",
      "2026-09-08T08:00:00.000Z",
      { prompt: "Inspect runtime status" },
    ),
    trace(
      "wait-b",
      "claude",
      "session-b",
      "PermissionRequest",
      "2026-09-08T08:01:00.000Z",
      { message: "Approve the filesystem change" },
    ),
  ];
  const sessions = buildSessions(events);
  const promptRuns = new Map(
    sessions.map((session) => [session.key, buildSessionPromptRuns(session)]),
  );
  return buildHistorySearchIndex(sessions, promptRuns);
}

function filters(
  overrides: Partial<{
    categories: ReadonlySet<EventTone>;
    from: number | null;
    query: string;
    sources: ReadonlySet<string>;
    statuses: ReadonlySet<TraceRunStatus>;
    to: number | null;
  }> = {},
) {
  return {
    categories: new Set<EventTone>(),
    from: null,
    query: "",
    sources: new Set<string>(),
    statuses: new Set<TraceRunStatus>(),
    to: null,
    ...overrides,
  };
}

test("indexes events with their parent prompt and derived status", () => {
  const entries = searchFixture();
  const tool = entries.find((entry) => entry.eventId === "tool-a");
  const waiting = entries.find((entry) => entry.eventId === "wait-b");

  assert.equal(tool?.promptIndex, 0);
  assert.equal(tool?.category, "tool");
  assert.equal(tool?.sessionTitle, "Build the execution topology");
  assert.equal(tool?.status, "complete");
  assert.equal(waiting?.status, "waiting");
  assert.match(waiting?.promptRunKey ?? "", /prompt-b/);
  assert.equal(
    entries.some((entry) => entry.eventId === "session-start-a"),
    false,
  );
});

test("matches case-insensitive substrings and ordered fuzzy subsequences", () => {
  const entries = searchFixture();
  const exact = filterHistorySearchEntries(
    entries,
    filters({ query: "APP.TSX" }),
  );
  const fuzzy = filterHistorySearchEntries(
    entries,
    filters({ query: "bld tpology" }),
  );

  assert.deepEqual(exact.map((entry) => entry.eventId), ["tool-a"]);
  assert.ok(fuzzy.some((entry) => entry.eventId === "prompt-a"));
});

test("combines agent, status, and time filters", () => {
  const entries = searchFixture();
  const matches = filterHistorySearchEntries(
    entries,
    filters({
      from: Date.parse("2026-09-08T00:00:00.000Z"),
      query: "filesystem",
      sources: new Set(["claude"]),
      statuses: new Set(["waiting"]),
      to: Date.parse("2026-09-08T23:59:59.999Z"),
    }),
  );

  assert.deepEqual(matches.map((entry) => entry.eventId), ["wait-b"]);
});

test("filters by event category without fuzzy scoring", () => {
  const entries = searchFixture();
  const matches = filterHistorySearchEntries(
    entries,
    filters({ categories: new Set(["tool"]) }),
  );

  assert.deepEqual(matches.map((entry) => entry.eventId), ["tool-a"]);
});

test("returns no matches for invalid or reversed time bounds", () => {
  const entries = searchFixture();

  assert.deepEqual(
    filterHistorySearchEntries(
      entries,
      filters({ from: Number.NaN }),
    ),
    [],
  );
  assert.deepEqual(
    filterHistorySearchEntries(
      entries,
      filters({ from: 200, to: 100 }),
    ),
    [],
  );
});

test("builds inclusive preset and custom date bounds", () => {
  const now = Date.parse("2026-09-10T12:00:00.000Z");
  assert.deepEqual(getHistoryDateBounds("3h", now), {
    from: now - 3 * 60 * 60 * 1_000,
    to: now,
    valid: true,
  });
  assert.deepEqual(getHistoryDateBounds("6h", now), {
    from: now - 6 * 60 * 60 * 1_000,
    to: now,
    valid: true,
  });
  assert.deepEqual(getHistoryDateBounds("12h", now), {
    from: now - 12 * 60 * 60 * 1_000,
    to: now,
    valid: true,
  });
  assert.deepEqual(getHistoryDateBounds("24h", now), {
    from: now - 86_400_000,
    to: now,
    valid: true,
  });
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  assert.deepEqual(getHistoryDateBounds("today", now), {
    from: todayStart.getTime(),
    to: now,
    valid: true,
  });
  assert.deepEqual(getHistoryDateBounds("yesterday", now), {
    from: todayStart.getTime() - 86_400_000,
    to: todayStart.getTime() - 1,
    valid: true,
  });

  const custom = getHistoryDateBounds(
    "custom",
    now,
    "2026-09-08",
    "2026-09-10",
  );
  assert.equal(custom.valid, true);
  assert.equal(new Date(custom.from ?? 0).getDate(), 8);
  assert.equal(new Date(custom.to ?? 0).getDate(), 10);
  assert.equal(new Date(custom.to ?? 0).getHours(), 23);

  assert.equal(
    getHistoryDateBounds("custom", now, "2026-09-04", "2026-09-10").valid,
    true,
  );
  assert.equal(
    getHistoryDateBounds("custom", now, "2026-09-03", "2026-09-10").valid,
    false,
  );
  assert.equal(
    getHistoryDateBounds("custom", now, "2026-09-01").valid,
    false,
  );
  assert.equal(
    getHistoryDateBounds("custom", now, "2026-09-11", "2026-09-10").valid,
    false,
  );
  assert.equal(
    getHistoryDateBounds("custom", now, "invalid", "2026-09-10").valid,
    false,
  );
});
