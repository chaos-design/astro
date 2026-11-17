import assert from "node:assert/strict";
import test from "node:test";
import type { TraceRunStatus } from "../src/types/trace.ts";
import { chimeStyleOptions } from "../src/config/app-config.ts";
import {
  collectTerminalTransitions,
  getChimeTone,
  resolveChimeStatus,
} from "../src/lib/task-completion-chime.ts";

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
  // The transition carries the recorded status so the effect can pick the
  // tone for that state without deriving it a second time.
  assert.deepEqual(result.newlyTerminal, [{ key: "new", status: "complete" }]);
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
  assert.deepEqual(completed.newlyTerminal, [
    { key: "s", status: "complete" },
  ]);

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
  assert.deepEqual(finishedAgain.newlyTerminal, [{ key: "s", status: "failed" }]);
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

test("a mixed batch resolves to the most important outcome", () => {
  // A failure is the one the reader must not miss, so it outranks a plain
  // stop and a success; the batch plays exactly one sound.
  assert.equal(
    resolveChimeStatus(["complete", "failed", "terminated"]),
    "failed",
  );
  assert.equal(resolveChimeStatus(["complete", "terminated"]), "terminated");
  assert.equal(resolveChimeStatus(["terminated", "complete"]), "terminated");
  assert.equal(resolveChimeStatus(["complete"]), "complete");
  assert.equal(resolveChimeStatus(["failed"]), "failed");
  assert.equal(resolveChimeStatus([]), "terminated");
});

test("each terminal state has its own tone", () => {
  const complete = getChimeTone("complete");
  const failed = getChimeTone("failed");
  const terminated = getChimeTone("terminated");
  // Distinct contours: success ascends, failure descends, termination is flat.
  assert.notDeepEqual(complete, failed);
  assert.notDeepEqual(failed, terminated);
  assert.notDeepEqual(complete, terminated);
  const [completeFirst, completeSecond] = complete.notes;
  assert.ok(completeFirst.frequency < completeSecond.frequency);
  const [failedFirst, failedSecond] = failed.notes;
  assert.ok(failedFirst.frequency > failedSecond.frequency);
  assert.equal(terminated.notes[0].frequency, terminated.notes[1].frequency);
  // A live status never reaches the player, but an unforeseen value must not
  // be announced as a success either — it gets the neutral tone.
  assert.deepEqual(getChimeTone("active"), terminated);
});

test("every style keeps the status contour rule", () => {
  // A style changes the voice (waveform, loudness, note patterns), never the
  // meaning: within every style a completion ascends, a failure descends and
  // a termination is a flat double tap, so the sound alone still tells a
  // success from a failure from a plain stop.
  for (const style of chimeStyleOptions) {
    const complete = getChimeTone("complete", style.id);
    const failed = getChimeTone("failed", style.id);
    const terminated = getChimeTone("terminated", style.id);
    assert.ok(complete.notes.length >= 2, `${style.id}: complete has notes`);
    const [completeFirst, completeSecond] = complete.notes;
    assert.ok(
      completeFirst.frequency < completeSecond.frequency,
      `${style.id}: complete ascends`,
    );
    const [failedFirst, failedSecond] = failed.notes;
    assert.ok(
      failedFirst.frequency > failedSecond.frequency,
      `${style.id}: failed descends`,
    );
    assert.equal(
      terminated.notes[0].frequency,
      terminated.notes[1].frequency,
      `${style.id}: terminated is flat`,
    );
    assert.notDeepEqual(complete, failed, `${style.id}: tones differ`);
  }
});

test("styles sound different from one another for the same status", () => {
  const [first, second, third] = chimeStyleOptions;
  const toneOf = (style: typeof first.id) => getChimeTone("complete", style);
  assert.notDeepEqual(toneOf(first.id), toneOf(second.id));
  assert.notDeepEqual(toneOf(second.id), toneOf(third.id));
  assert.notDeepEqual(toneOf(first.id), toneOf(third.id));
});

test("an unforeseen status gets the style's own neutral tone", () => {
  for (const style of chimeStyleOptions) {
    assert.deepEqual(
      getChimeTone("active", style.id),
      getChimeTone("terminated", style.id),
      `${style.id}: live status falls back to the neutral tone`,
    );
  }
});
