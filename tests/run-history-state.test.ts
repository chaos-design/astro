import assert from "node:assert/strict";
import test from "node:test";
import {
  collectLiveRunKeys,
  ensureExpandedRun,
  getPromptAtomSelection,
  getRunDisplayState,
  getRunFreshness,
  getRunHistoryDisplayState,
  getRunHistoryDisplayStatus,
  getRunHistoryDuration,
  getRunHistoryTerminalInfo,
  isLiveRunStatus,
  quantizeTimestamp,
  RUN_HISTORY_COARSE_REFRESH_MS,
  RUN_HISTORY_LIVE_WINDOW_MS,
  RUN_HISTORY_STALE_AFTER_MS,
  RUN_HISTORY_WAITING_LIVE_WINDOW_MS,
  RUN_HISTORY_WAITING_STALE_AFTER_MS,
  toggleExpandedRun,
} from "../src/lib/run-history-state.ts";
import type { TraceRunStatus } from "../src/types/trace.ts";

test("derives the parent row status from the last Prompt run", () => {
  const cases = [
    {
      name: "active latest Prompt overrides a waiting session",
      sessionStatus: "waiting",
      promptStatuses: ["complete", "active"],
      expected: "active",
    },
    {
      name: "completed latest Prompt overrides an active session",
      sessionStatus: "active",
      promptStatuses: ["active", "complete"],
      expected: "complete",
    },
    {
      name: "failed latest Prompt overrides a completed session",
      sessionStatus: "complete",
      promptStatuses: ["complete", "failed"],
      expected: "failed",
    },
    {
      name: "waiting latest Prompt overrides a failed session",
      sessionStatus: "failed",
      promptStatuses: ["complete", "waiting"],
      expected: "waiting",
    },
    {
      name: "session status is used when there are no Prompt runs",
      sessionStatus: "terminated",
      promptStatuses: [],
      expected: "terminated",
    },
  ] as const;

  for (const {
    name,
    sessionStatus,
    promptStatuses,
    expected,
  } of cases) {
    assert.equal(
      getRunHistoryDisplayStatus(
        sessionStatus,
        promptStatuses.map((status) => ({ status })),
      ),
      expected,
      name,
    );
  }
});

test("times the parent row on the executing Prompt, not the session", () => {
  const session = {
    duration: 4_000,
    start: 1_000,
    status: "active",
  } as const;
  const now = 11_000;
  // The newest Prompt started long after the session did: a resumed message.
  const prompts = [
    { duration: 4_000, start: 1_000, status: "complete" },
    { duration: 0, start: 10_000, status: "active" },
  ] as const;

  assert.equal(getRunHistoryDuration(session, [...prompts], now), 1_000);

  for (const status of [
    "complete",
    "failed",
    "terminated",
  ] as const) {
    assert.equal(
      getRunHistoryDuration(
        session,
        [{ duration: 0, start: 10_000, status }],
        now,
      ),
      session.duration,
      `${status} latest Prompt should freeze the parent duration`,
    );
  }

  // Without Prompt runs the session itself is the run.
  assert.equal(getRunHistoryDuration(session, [], now), 10_000);
  assert.equal(
    getRunHistoryDuration(
      { ...session, status: "waiting" },
      [],
      now,
    ),
    10_000,
  );
});

test("keeps a resumed session live on its new Prompt's clock", () => {
  const timeout = 24 * 60 * 60 * 1_000;
  const firstPromptAt = 1_000;
  // Two days later the user sends another message into the same session.
  const resumedAt = firstPromptAt + 2 * timeout;
  const session = {
    duration: 2 * timeout,
    start: firstPromptAt,
    status: "active",
  } as const;
  const resumes = [{ duration: 0, start: resumedAt, status: "active" }] as const;

  // Timing the session made this read as a 48-hour run, i.e. `terminated`
  // the moment the new prompt arrived — absent from `N LIVE` and from the top
  // of the list.
  assert.deepEqual(
    getRunHistoryDisplayState(
      session,
      [...resumes],
      resumedAt + 30_000,
      timeout,
    ),
    { duration: 30_000, status: "active" },
  );
  // The new Prompt keeps its own 24h cap.
  assert.deepEqual(
    getRunHistoryDisplayState(session, [...resumes], resumedAt + timeout, timeout),
    { duration: timeout, status: "terminated" },
  );
});

test("terminates the parent display when its active duration reaches the limit", () => {
  const timeout = 24 * 60 * 60 * 1_000;
  const session = {
    duration: 4_000,
    start: 1_000,
    status: "active",
  } as const;
  const promptStart = 5_000;
  const activePrompt = [
    { duration: 0, start: promptStart, status: "active" },
  ] as const;

  assert.deepEqual(
    getRunHistoryDisplayState(
      session,
      activePrompt,
      promptStart + timeout - 1,
      timeout,
    ),
    {
      duration: timeout - 1,
      status: "active",
    },
  );
  assert.deepEqual(
    getRunHistoryDisplayState(
      session,
      activePrompt,
      promptStart + timeout,
      timeout,
    ),
    {
      duration: timeout,
      status: "terminated",
    },
  );
  assert.deepEqual(
    getRunHistoryDisplayState(
      session,
      [{ duration: 0, start: promptStart, status: "waiting" }],
      promptStart + timeout - 1,
      timeout,
    ),
    {
      duration: timeout - 1,
      status: "waiting",
    },
  );
  // A waiting run whose message stream went silent also terminates.
  assert.deepEqual(
    getRunHistoryDisplayState(
      session,
      [{ duration: 0, start: promptStart, status: "waiting" }],
      promptStart + timeout * 2,
      timeout,
    ),
    {
      duration: timeout,
      status: "terminated",
    },
  );
});

test("a run silent past the live window no longer displays as executing", () => {
  // A historical message whose recorder died without a terminal event used to
  // wear the RUNNING capsule (and light the footer Live button) until the 24h
  // timeout — the live index refused to count it, so the two disagreed. The
  // display now applies the same freshness gate.
  const start = 1_000;
  const lastEventAt = start + 5_000;
  const run = {
    duration: 5_000,
    start,
    end: lastEventAt,
    status: "active",
  } as const;

  // Inside the window the run is still executing (and its duration advances).
  assert.deepEqual(
    getRunDisplayState(run, lastEventAt + RUN_HISTORY_LIVE_WINDOW_MS - 1, Infinity),
    { duration: lastEventAt + RUN_HISTORY_LIVE_WINDOW_MS - 1 - start, status: "active" },
  );
  // Past the window it displays as terminated on its recorded duration.
  assert.deepEqual(
    getRunDisplayState(run, lastEventAt + RUN_HISTORY_LIVE_WINDOW_MS + 1, Infinity),
    { duration: 5_000, status: "terminated" },
  );
});

test("a waiting run keeps its longer freshness rope before terminating", () => {
  const start = 1_000;
  const run = {
    duration: 60_000,
    start,
    end: start + 60_000,
    status: "waiting",
  } as const;

  assert.deepEqual(
    getRunDisplayState(
      run,
      run.end + RUN_HISTORY_WAITING_LIVE_WINDOW_MS - 1,
      Infinity,
    ),
    {
      duration: run.end + RUN_HISTORY_WAITING_LIVE_WINDOW_MS - 1 - start,
      status: "waiting",
    },
  );
  assert.deepEqual(
    getRunDisplayState(
      run,
      run.end + RUN_HISTORY_WAITING_LIVE_WINDOW_MS + 1,
      Infinity,
    ),
    { duration: 60_000, status: "terminated" },
  );
});

test("runs without an activity timestamp keep trusting their status", () => {
  // Legacy callers (and tests) pass bare {duration, start, status} records;
  // without `end` there is nothing to judge freshness against.
  const run = { duration: 30_000, start: 1_000, status: "active" } as const;
  const now = 90 * 60_000;
  assert.deepEqual(getRunDisplayState(run, now, Infinity), {
    duration: now - run.start,
    status: "active",
  });
});

test("the parent display terminates when its newest Prompt went stale", () => {
  const timeout = 24 * 60 * 60 * 1_000;
  const hour = 60 * 60 * 1_000;
  // A session whose recorder died an hour into the newest Prompt: the status
  // stayed `active`, the session row used to keep wearing it.
  const session = {
    duration: 21 * hour,
    start: 0,
    status: "active",
    end: 21 * hour,
  } as const;
  const activePrompt = [
    {
      duration: 1 * hour,
      start: 20 * hour,
      end: 21 * hour,
      status: "active",
    },
  ] as const;
  const staleAt = 21 * hour + RUN_HISTORY_LIVE_WINDOW_MS + 1;

  assert.deepEqual(
    getRunHistoryDisplayState(session, activePrompt, staleAt, timeout),
    { duration: 21 * hour, status: "terminated" },
  );
  // The terminal info explains the flip as a timeout, not a recorded reason.
  assert.deepEqual(
    getRunHistoryTerminalInfo(session, activePrompt, staleAt, timeout),
    { detail: null, reason: "timeout" },
  );
});

test("expands and collapses one run without changing other groups", () => {
  const expanded = toggleExpandedRun(new Set(["run-a"]), "run-b");
  assert.deepEqual([...expanded], ["run-a", "run-b"]);

  const collapsed = toggleExpandedRun(expanded, "run-a");
  assert.deepEqual([...collapsed], ["run-b"]);
});

test("ensures only the active run changes its automatic expansion", () => {
  const current = new Set(["run-a", "run-b"]);

  assert.deepEqual(
    [...ensureExpandedRun(current, "run-c", true)],
    ["run-a", "run-b", "run-c"],
  );
  assert.deepEqual(
    [...ensureExpandedRun(current, "run-b", false)],
    ["run-a"],
  );
  assert.deepEqual([...current], ["run-a", "run-b"]);
});

test("only a live Prompt starts in automatic atom-following mode", () => {
  assert.equal(getPromptAtomSelection("active"), undefined);
  assert.equal(getPromptAtomSelection("waiting"), undefined);
});

test("a finished Prompt leaves the topology unlocated", () => {
  for (const status of ["complete", "failed", "terminated", undefined]) {
    assert.equal(
      getPromptAtomSelection(status),
      null,
      `${status} must not locate the last atom`,
    );
  }
});

test("treats executing and waiting runs as live", () => {
  for (const status of ["active", "waiting"]) {
    assert.equal(isLiveRunStatus(status), true, status);
  }
  for (const status of ["complete", "failed", "terminated", "demo", undefined]) {
    assert.equal(isLiveRunStatus(status), false, String(status));
  }
});

test("collects the sessions whose message is executing", () => {
  const now = Date.parse("2026-10-09T13:00:00");
  const run = (key: string, status: string, startedAt: number) => ({
    key,
    status: status as TraceRunStatus,
    start: startedAt,
    end: startedAt,
    duration: 0,
  });
  const sessions = [
    run("executing", "active", now - 60_000),
    // The session closed, but its newest prompt went back to waiting: the
    // prompt status is what the row shows, so the row is live too.
    run("reopened", "complete", now - 120_000),
    // The opposite case: an active session whose latest prompt finished is a
    // finished row, not a live one.
    run("settled", "active", now - 180_000),
    run("failed", "failed", now - 240_000),
  ];
  const promptRuns = new Map([
    [
      "reopened",
      [{ duration: 0, start: now - 120_000, status: "waiting" as const }],
    ],
    [
      "settled",
      [{ duration: 0, start: now - 180_000, status: "complete" as const }],
    ],
  ]);

  assert.deepEqual(
    [...collectLiveRunKeys(sessions, promptRuns, now)],
    ["executing", "reopened"],
  );
  // A live run past the display timeout has already been reported as
  // terminated, so it must not stay pinned to the top of the list.
  assert.deepEqual(
    [...collectLiveRunKeys(sessions, promptRuns, now + 60_000 * 60, 60_000)],
    [],
  );
});

test("keeps only recently active runs in the live index", () => {
  const now = Date.parse("2026-10-30T12:00:00");
  const run = (key: string, status: string, startedAt: number, lastAt: number) => ({
    key,
    status: status as TraceRunStatus,
    start: startedAt,
    end: lastAt,
    duration: lastAt - startedAt,
  });
  const sessions = [
    // Actively producing events: live.
    run("hot", "active", now - 30 * 60_000, now - 20_000),
    // A long tool call can be silent for minutes: still live.
    run("quiet", "active", now - 30 * 60_000, now - 4 * 60_000),
    // Crashed hours ago with no terminal event: still `active`, no longer
    // running — this is what used to flood the N LIVE index.
    run("dead", "active", now - 9 * 60 * 60_000, now - 8 * 60 * 60_000),
    // Blocked on the user: a waiting run keeps its place much longer.
    run("waiting", "waiting", now - 2 * 60 * 60_000, now - 30 * 60_000),
    // …but an hour of silence means nobody is coming back.
    run("abandoned", "waiting", now - 5 * 60 * 60_000, now - 2 * 60 * 60_000),
  ];

  assert.deepEqual(
    [...collectLiveRunKeys(sessions, new Map(), now)].sort(),
    ["hot", "quiet", "waiting"],
  );
});

test("quantizes timestamps down to the start of their bucket", () => {
  assert.equal(quantizeTimestamp(1_000, 1_000), 1_000);
  assert.equal(quantizeTimestamp(1_999, 1_000), 1_000);
  assert.equal(quantizeTimestamp(59_999, 30_000), 30_000);
  assert.equal(quantizeTimestamp(0, 30_000), 0);
  // The coarse refresh bucket matches the documented 30s granularity.
  assert.equal(RUN_HISTORY_COARSE_REFRESH_MS, 30_000);
});

test("marks an executing run as stale once its stream has been silent", () => {
  const lastEventAt = 1_000_000;

  // Inside the threshold the run still reads as executing.
  assert.deepEqual(
    getRunFreshness("active", lastEventAt, lastEventAt + 30_000),
    { idleFor: 30_000, stale: false },
  );
  assert.deepEqual(
    getRunFreshness(
      "active",
      lastEventAt,
      lastEventAt + RUN_HISTORY_STALE_AFTER_MS,
    ),
    { idleFor: RUN_HISTORY_STALE_AFTER_MS, stale: true },
  );
  // A waiting run gets a longer rope, but not an infinite one: a quarter of
  // an hour without a single event is reported as idle.
  assert.equal(
    getRunFreshness("waiting", lastEventAt, lastEventAt + 300_000).stale,
    false,
  );
  assert.deepEqual(
    getRunFreshness(
      "waiting",
      lastEventAt,
      lastEventAt + RUN_HISTORY_WAITING_STALE_AFTER_MS,
    ),
    { idleFor: RUN_HISTORY_WAITING_STALE_AFTER_MS, stale: true },
  );
  // Finished runs are silent by definition.
  for (const status of ["complete", "failed", "terminated", undefined]) {
    assert.equal(
      getRunFreshness(status, lastEventAt, lastEventAt + 900_000).stale,
      false,
    );
  }
});

test("reports why a run ended, including the display-timeout case", () => {
  const session = {
    duration: 4_000,
    start: 1_000,
    status: "terminated" as const,
    statusDetail: "user abort",
    terminalReason: "interrupted" as const,
  };

  assert.deepEqual(
    getRunHistoryTerminalInfo(
      session,
      [{ duration: 4_000, start: 1_000, status: "terminated" }],
      10_000,
    ),
    { detail: "user abort", reason: "interrupted" },
  );

  // A live run that only looks terminated because the display timeout elapsed
  // must say `timeout`, not reuse a stale recorded reason.
  const timeout = 60_000;
  const live = {
    duration: 1_000,
    start: 1_000,
    status: "active" as const,
  };
  const livePrompt = [{ duration: 0, start: live.start, status: "active" }];
  assert.deepEqual(
    getRunHistoryTerminalInfo(
      live,
      livePrompt,
      live.start + timeout + 1,
      timeout,
    ),
    { detail: null, reason: "timeout" },
  );
  assert.deepEqual(
    getRunHistoryTerminalInfo(live, livePrompt, live.start + 10, timeout),
    { detail: null, reason: null },
  );
});
