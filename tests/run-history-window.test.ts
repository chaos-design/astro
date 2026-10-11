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
