import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_RUN_HISTORY_DAYS,
  OTHERS_AGENT_ID,
  canLoadMoreRunHistoryDays,
  filterSessionsByAgent,
  getRunHistoryAnchorDayStart,
  getRunHistoryWindowStart,
  nextRunHistoryVisibleDays,
  pinLiveRunHistory,
  selectVisibleRunHistory,
} from "../src/lib/run-history-window.ts";
import type { TraceSession } from "../src/types/trace.ts";

function session(start: number, source = "codex"): TraceSession {
  return {
    key: `${source}::ws::${start}`,
    id: String(start),
    source,
    workspaceId: "ws",
    cwd: null,
    events: [],
    title: "run",
    start,
    end: start,
    duration: 0,
    status: "complete",
    toolCount: 0,
  };
}

// A fixed "now" on 2026-10-09 14:00 local; window math is calendar-day based.
const NOW = Date.parse("2026-10-09T14:00:00");

test("exposes stable window constants", () => {
  assert.equal(DEFAULT_RUN_HISTORY_DAYS, 1);
  assert.equal(OTHERS_AGENT_ID, "others");
});

test("anchor day is the most recent day with data, else today", () => {
  const sessions = [
    session(Date.parse("2026-10-06T08:00:00")),
    session(Date.parse("2026-10-08T21:00:00")),
  ];
  assert.equal(
    getRunHistoryAnchorDayStart(sessions, NOW),
    Date.parse("2026-10-08T00:00:00"),
  );
  assert.equal(
    getRunHistoryAnchorDayStart([], NOW),
    Date.parse("2026-10-09T00:00:00"),
  );
});

test("window start counts back from the anchor data day", () => {
  const sessions = [
    session(Date.parse("2026-10-08T21:00:00")),
    session(Date.parse("2026-10-05T08:00:00")),
  ];
  // Default single day shows only the most recent data day, even when today
  // (2026-10-09) has no runs for this agent.
  assert.equal(
    getRunHistoryWindowStart(sessions, NOW, 1),
    Date.parse("2026-10-08T00:00:00"),
  );
  assert.equal(
    getRunHistoryWindowStart(sessions, NOW, 3),
    Date.parse("2026-10-06T00:00:00"),
  );
});

test("selects only sessions inside the visible window", () => {
  const sessions = [
    session(Date.parse("2026-10-09T08:00:00")),
    session(Date.parse("2026-10-08T08:00:00")),
    session(Date.parse("2026-10-07T08:00:00")),
  ];
  const visible = selectVisibleRunHistory(sessions, NOW, 1);
  assert.equal(visible.length, 1);
  assert.equal(visible[0].start, Date.parse("2026-10-09T08:00:00"));
  const twoDays = selectVisibleRunHistory(sessions, NOW, 2);
  assert.equal(twoDays.length, 2);
});

test("keeps an executing run visible outside the day window", () => {
  const today = session(Date.parse("2026-10-09T08:00:00"));
  // A resumed session keeps the start of its first prompt, so the day window
  // would drop the run that is executing right now.
  const resumed = session(Date.parse("2026-10-06T08:00:00"));

  assert.deepEqual(
    selectVisibleRunHistory([today, resumed], NOW, 1).map(
      (entry) => entry.key,
    ),
    [today.key],
  );
  assert.deepEqual(
    selectVisibleRunHistory(
      [today, resumed],
      NOW,
      1,
      new Set([resumed.key]),
    ).map((entry) => entry.key),
    [today.key, resumed.key],
  );
});

test("pins the executing run above runs that started later", () => {
  const resumed = session(Date.parse("2026-10-09T08:00:00"));
  const later = session(Date.parse("2026-10-09T10:00:00"));
  const newest = session(Date.parse("2026-10-09T11:30:00"));
  // The resumed session received a new prompt at 13:00, so it is live now.
  resumed.end = Date.parse("2026-10-09T13:00:00");

  assert.deepEqual(
    pinLiveRunHistory([newest, later, resumed], new Set([resumed.key])).map(
      (entry) => entry.key,
    ),
    [resumed.key, newest.key, later.key],
  );

  // Several executing runs: the one that received the latest message leads.
  const other = session(Date.parse("2026-10-05T08:00:00"));
  other.end = Date.parse("2026-10-09T14:00:00");
  assert.deepEqual(
    pinLiveRunHistory(
      [resumed, other, newest],
      new Set([resumed.key, other.key]),
    ).map((entry) => entry.key),
    [other.key, resumed.key, newest.key],
  );
});

test("keeps the newest-first order while nothing is executing", () => {
  const first = session(Date.parse("2026-10-09T11:00:00"));
  const second = session(Date.parse("2026-10-09T10:00:00"));

  assert.deepEqual(
    pinLiveRunHistory([first, second], new Set()).map((entry) => entry.key),
    [first.key, second.key],
  );
});

test("reports whether earlier days remain", () => {
  const sessions = [
    session(Date.parse("2026-10-09T08:00:00")),
    session(Date.parse("2026-10-07T08:00:00")),
  ];
  assert.equal(canLoadMoreRunHistoryDays(sessions, NOW, 1), true);
  // Two days covers Oct 8-9; the Oct 7 run is still outside the window.
  assert.equal(canLoadMoreRunHistoryDays(sessions, NOW, 2), true);
  // Three days reaches the anchor day plus the older run -> no more to load.
  assert.equal(canLoadMoreRunHistoryDays(sessions, NOW, 3), false);
});

test("advances the window by one day and clamps when exhausted", () => {
  const sessions = [
    session(Date.parse("2026-10-09T08:00:00")),
    session(Date.parse("2026-10-06T08:00:00")),
  ];
  assert.equal(nextRunHistoryVisibleDays(sessions, NOW, 1), 2);
  assert.equal(nextRunHistoryVisibleDays(sessions, NOW, 3), 4);
  // 4 days covers everything -> stays put.
  assert.equal(nextRunHistoryVisibleDays(sessions, NOW, 4), 4);
});

test("filters sessions to a configured agent source", () => {
  const configured = new Set(["codex", "claude"]);
  const sessions = [
    session(1, "codex"),
    session(2, "claude"),
    session(3, "unknown-agent"),
  ];
  assert.deepEqual(
    filterSessionsByAgent(sessions, "codex", configured).map(
      (entry) => entry.source,
    ),
    ["codex"],
  );
});

test("Others keeps only unconfigured sources", () => {
  const configured = new Set(["codex", "claude"]);
  const sessions = [
    session(1, "codex"),
    session(2, "unknown-agent"),
    session(3, "workbuddy"),
  ];
  assert.deepEqual(
    filterSessionsByAgent(sessions, OTHERS_AGENT_ID, configured).map(
      (entry) => entry.source,
    ),
    ["unknown-agent", "workbuddy"],
  );
});
