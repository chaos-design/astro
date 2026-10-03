import assert from "node:assert/strict";
import test from "node:test";
import {
  ensureExpandedRun,
  getPromptAtomSelection,
  getRunHistoryDisplayState,
  getRunHistoryDisplayStatus,
  getRunHistoryDuration,
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

test("updates the parent duration only while the latest Prompt is active", () => {
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
    "waiting",
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
    session.duration,
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
      session.start + timeout * 2,
      timeout,
    ),
    {
      duration: session.duration,
      status: "waiting",
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

test("only an active Prompt starts in automatic atom-following mode", () => {
  assert.equal(
    getPromptAtomSelection("active", "harness-tool-call"),
    undefined,
  );
  assert.equal(
    getPromptAtomSelection("complete", "harness-output-commit"),
    "harness-output-commit",
  );
  assert.equal(getPromptAtomSelection("failed", ""), null);
});
