import assert from "node:assert/strict";
import test from "node:test";
import {
  ensureExpandedRun,
  filterSessionsByLiveKeys,
  getPromptAtomSelection,
  getRunHistoryDisplayState,
  getRunHistoryDisplayStatus,
  getRunHistoryDuration,
  isLiveRunStatus,
  quantizeTimestamp,
  RUN_HISTORY_COARSE_REFRESH_MS,
  toggleExpandedRun,
} from "../src/lib/run-history-state.ts";

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

test("updates the parent duration while the latest Prompt is active or waiting", () => {
  const session = {
    duration: 4_000,
    start: 1_000,
    status: "active",
  } as const;
  const now = 11_000;

  assert.equal(
    getRunHistoryDuration(
      session,
      [{ status: "complete" }, { status: "active" }],
      now,
    ),
    10_000,
  );

  for (const status of [
    "complete",
    "failed",
    "terminated",
  ] as const) {
    assert.equal(
      getRunHistoryDuration(session, [{ status }], now),
      session.duration,
      `${status} latest Prompt should freeze the parent duration`,
    );
  }

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

test("terminates the parent display when its active duration reaches the limit", () => {
  const timeout = 24 * 60 * 60 * 1_000;
  const session = {
    duration: 4_000,
    start: 1_000,
    status: "active",
  } as const;
  const activePrompt = [{ status: "active" }] as const;

  assert.deepEqual(
    getRunHistoryDisplayState(
      session,
      activePrompt,
      session.start + timeout - 1,
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
      session.start + timeout,
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
      [{ status: "waiting" }],
      session.start + timeout - 1,
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
      [{ status: "waiting" }],
      session.start + timeout * 2,
      timeout,
    ),
    {
      duration: timeout,
      status: "terminated",
    },
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

test("filters sessions down to the live ones without reordering", () => {
  const sessions = [
    { key: "run-a" },
    { key: "run-b" },
    { key: "run-c" },
    { key: "run-d" },
  ];

  // Preserves list order, keeps each session at most once even when the
  // live list is duplicated, and drops sessions the filter does not know.
  assert.deepEqual(
    filterSessionsByLiveKeys(sessions, ["run-c", "run-a", "run-a"]),
    [sessions[0], sessions[2]],
  );

  // An empty live set leaves the list empty rather than falling back to
  // "show everything" — the panel distinguishes that from no history.
  assert.deepEqual(filterSessionsByLiveKeys(sessions, []), []);
  assert.deepEqual(filterSessionsByLiveKeys([], ["run-a"]), []);
});

test("quantizes timestamps down to the start of their bucket", () => {
  assert.equal(quantizeTimestamp(1_000, 1_000), 1_000);
  assert.equal(quantizeTimestamp(1_999, 1_000), 1_000);
  assert.equal(quantizeTimestamp(59_999, 30_000), 30_000);
  assert.equal(quantizeTimestamp(0, 30_000), 0);
  // The coarse refresh bucket matches the documented 30s granularity.
  assert.equal(RUN_HISTORY_COARSE_REFRESH_MS, 30_000);
});
