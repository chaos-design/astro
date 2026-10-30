import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_RUN_HISTORY_HOURS,
  OTHERS_AGENT_ID,
  canLoadMoreRunHistory,
  filterSessionsByAgent,
  getRunHistoryAnchorTime,
  getRunHistoryWindowStart,
  nextRunHistoryVisibleHours,
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

// A fixed "now" on 2026-10-09 14:00 local; the window is measured in hours.
const NOW = Date.parse("2026-10-09T14:00:00");
const HOUR = 3_600_000;

test("exposes stable window constants", () => {
  assert.equal(DEFAULT_RUN_HISTORY_HOURS, 3);
  assert.equal(OTHERS_AGENT_ID, "others");
});

test("anchors the window on the newest message, else on now", () => {
  const sessions = [
    session(Date.parse("2026-10-06T08:00:00")),
    session(Date.parse("2026-10-08T21:00:00")),
  ];
  assert.equal(
    getRunHistoryAnchorTime(sessions, NOW),
    Date.parse("2026-10-08T21:00:00"),
  );
  // Nothing recorded yet: the window follows the wall clock.
  assert.equal(getRunHistoryAnchorTime([], NOW), NOW);
});

test("window start counts back from the anchor, not from midnight", () => {
  const sessions = [
    session(Date.parse("2026-10-08T21:00:00")),
    session(Date.parse("2026-10-05T08:00:00")),
  ];
  const anchor = Date.parse("2026-10-08T21:00:00");

  assert.equal(getRunHistoryWindowStart(sessions, NOW, 3), anchor - 3 * HOUR);
  assert.equal(
    getRunHistoryWindowStart(sessions, NOW, 168),
    anchor - 168 * HOUR,
  );
});

test("shows the default range even when the newest message is old", () => {
  // The message arrived 14 hours ago; a wall-clock anchored 3h window would be
  // empty, which is exactly the "opened it in the morning and saw nothing"
  // failure the anchor exists to prevent.
  const lastNight = session(Date.parse("2026-10-09T00:00:00"));
  assert.deepEqual(
    selectVisibleRunHistory([lastNight], NOW, 3).map((entry) => entry.key),
    [lastNight.key],
  );
});

test("selects only sessions inside the visible window", () => {
  const sessions = [
    session(NOW - 1 * HOUR),
    session(NOW - 5 * HOUR),
    session(NOW - 30 * HOUR),
  ];
  // The anchor is the newest message, so a 3-hour window reaches back to
  // four hours ago here; the older runs stay outside it.
  const visible = selectVisibleRunHistory(sessions, NOW, 3);
  assert.deepEqual(
    visible.map((entry) => entry.start),
    [NOW - 1 * HOUR],
  );
  const wider = selectVisibleRunHistory(sessions, NOW, 6);
  assert.deepEqual(
    wider.map((entry) => entry.start),
    [NOW - 1 * HOUR, NOW - 5 * HOUR],
  );
});

test("keeps an executing run visible outside the window", () => {
  const recent = session(NOW - 1 * HOUR);
  // A resumed session keeps the start of its first prompt, so the window
  // would drop the run that is executing right now.
  const resumed = session(NOW - 72 * HOUR);
  resumed.status = "active";

  assert.deepEqual(
    selectVisibleRunHistory([recent, resumed], NOW, 3).map(
      (entry) => entry.key,
    ),
    [recent.key],
  );
  assert.deepEqual(
    selectVisibleRunHistory(
      [recent, resumed],
      NOW,
      3,
      new Set([resumed.key]),
    ).map((entry) => entry.key),
    [recent.key, resumed.key],
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

test("a full-history listing needs no window at all", () => {
  // The Live view renders the agent's sessions as they are; the only ordering
  // rule it applies is the live pin.
  const ancient = session(Date.parse("2026-09-01T08:00:00"));
  const recent = session(NOW - HOUR);
  ancient.status = "active";
  ancient.end = NOW;

  assert.deepEqual(
    pinLiveRunHistory([recent, ancient], new Set([ancient.key])).map(
      (entry) => entry.key,
    ),
    [ancient.key, recent.key],
  );
});

test("reports whether earlier messages remain", () => {
  const sessions = [
    session(NOW - 1 * HOUR),
    session(NOW - 10 * HOUR),
  ];
  assert.equal(canLoadMoreRunHistory(sessions, NOW, 3), true);
  // 12 hours reaches the 10-hour-old run -> nothing older left.
  assert.equal(canLoadMoreRunHistory(sessions, NOW, 12), false);
});

test("widens the window by doubling and clamps when exhausted", () => {
  const sessions = [
    session(NOW - 1 * HOUR),
    session(NOW - 10 * HOUR),
  ];
  assert.equal(nextRunHistoryVisibleHours(sessions, NOW, 3), 6);
  assert.equal(nextRunHistoryVisibleHours(sessions, NOW, 6), 12);
  // Everything is inside 12 hours -> stays put.
  assert.equal(nextRunHistoryVisibleHours(sessions, NOW, 12), 12);
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
