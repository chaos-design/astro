import assert from "node:assert/strict";
import test from "node:test";
import type { TraceRunStatus } from "../src/types/trace.ts";
import { collectTerminalTransitions } from "../src/lib/task-completion-chime.ts";

function run(key: string, status: TraceRunStatus) {
  return { key, status };
}

test("seeds already-terminal history without chiming", () => {
  // The first observation after load records the terminal runs as the baseline:
  // the console did not watch them finish, so they must not produce a chime.
  const result = collectTerminalTransitions(
    [run("a", "complete"), run("b", "failed"), run("c", "terminated")],
    new Set(),
    true,
  );
  assert.deepEqual(result.newlyTerminal, []);
  assert.deepEqual([...result.nextKnown].sort(), ["a", "b", "c"]);
});

test("chimes when a watched run enters a terminal state", () => {
  const known = new Set(["old"]);
  const result = collectTerminalTransitions(
    [run("old", "complete"), run("new", "complete"), run("live", "active")],
    known,
    false,
  );
  assert.deepEqual(result.newlyTerminal, ["new"]);
  assert.deepEqual([...result.nextKnown].sort(), ["new", "old"]);
  // The live run is not remembered, so it can chime on its own completion.
  assert.equal(result.nextKnown.has("live"), false);
});

test("a terminal run is reported once until it runs again", () => {
  const first = collectTerminalTransitions([run("s", "active")], new Set(), true);
  assert.deepEqual(first.newlyTerminal, []);
  assert.equal(first.nextKnown.has("s"), false);

  const completed = collectTerminalTransitions(
    [run("s", "complete")],
    first.nextKnown,
    false,
  );
  assert.deepEqual(completed.newlyTerminal, ["s"]);

  const repeat = collectTerminalTransitions(
    [run("s", "complete")],
    completed.nextKnown,
    false,
  );
  assert.deepEqual(repeat.newlyTerminal, []);

  // A new prompt puts the run back in a live state; finishing it again chimes.
  const resumed = collectTerminalTransitions(
    [run("s", "active")],
    repeat.nextKnown,
    false,
  );
  assert.deepEqual(resumed.newlyTerminal, []);
  assert.equal(resumed.nextKnown.has("s"), false);

  const finishedAgain = collectTerminalTransitions(
    [run("s", "failed")],
    resumed.nextKnown,
    false,
  );
  assert.deepEqual(finishedAgain.newlyTerminal, ["s"]);
});

test("waiting is live and therefore never counts as terminal", () => {
  const result = collectTerminalTransitions(
    [run("waiting", "waiting")],
    new Set(),
    false,
  );
  assert.deepEqual(result.newlyTerminal, []);
  assert.equal(result.nextKnown.size, 0);
});
