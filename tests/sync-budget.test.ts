import assert from "node:assert/strict";
import test from "node:test";

import {
  applyUptimePause,
  capChangeResumesSync,
  getSyncStopDelay,
  resetUptimePause,
  resolveDisplayedUptime,
} from "../src/lib/sync-budget.ts";

const HOUR = 3_600_000;
const NOW = Date.parse("2026-11-01T10:00:00");

test("returns the remaining time so the caller can arm one timeout", () => {
  // Started an hour ago with an eight-hour budget: seven hours left, not a
  // boolean — the console schedules a single timeout and sleeps.
  assert.equal(getSyncStopDelay(NOW - HOUR, 8, NOW), 7 * HOUR);
  // Just started: the whole budget.
  assert.equal(getSyncStopDelay(NOW, 8, NOW), 8 * HOUR);
});

test("returns zero once the budget is spent instead of going negative", () => {
  // An expired window (a tab restored days later, a clock jump) must stop
  // immediately rather than produce a negative delay.
  assert.equal(getSyncStopDelay(NOW - 9 * HOUR, 8, NOW), 0);
  assert.equal(getSyncStopDelay(NOW - 400 * HOUR, 8, NOW), 0);
});

test("returns null when the console is configured never to stop", () => {
  // `off` is a real choice in Settings: no timer at all, not a zero delay.
  assert.equal(getSyncStopDelay(NOW - 100 * HOUR, 0, NOW), null);
  assert.equal(getSyncStopDelay(NOW, -1, NOW), null);
  assert.equal(getSyncStopDelay(NOW, Number.NaN, NOW), null);
});

test("treats a missing start time as a fresh window", () => {
  // Persisted state can arrive as 0 after a bad restore; the budget starts
  // counting from now instead of stopping the console on sight.
  assert.equal(getSyncStopDelay(0, 8, NOW), 8 * HOUR);
  assert.equal(getSyncStopDelay(Number.NaN, 4, NOW), 4 * HOUR);
});

test("a cap change resumes a budget-stopped stream when time is still left", () => {
  // The cap is the only reason a budget pause exists: moving it so that time
  // is left — or to `off` — must lift the pause at once, with the resume
  // path's fresh snapshot.
  assert.equal(capChangeResumesSync(true, 4 * HOUR), true);
  assert.equal(capChangeResumesSync(true, 0.5 * HOUR), true);
  assert.equal(capChangeResumesSync(true, null), true);
});

test("a cap change keeps a stopped stream stopped when its time is spent", () => {
  // Lowering the cap below what already elapsed, or re-arming an already
  // spent one, must not silently reopen the capped array.
  assert.equal(capChangeResumesSync(true, 0), false);
  // An open stream is untouched by the predicate: the caller re-arms the
  // timer for the remaining time, or stops it when the cap is spent.
  assert.equal(capChangeResumesSync(false, 0), false);
  assert.equal(capChangeResumesSync(false, 4 * HOUR), false);
  assert.equal(capChangeResumesSync(false, null), false);
});

test("pausing the sync freezes the service clock at its displayed value", () => {
  // The clock stops counting with the pause: the value it held when the pause
  // began is what the card keeps showing while the stream is stopped.
  const paused = applyUptimePause(resetUptimePause(), 8 * HOUR + 1_000, true);
  assert.equal(paused.frozenMs, 8 * HOUR + 1_000);
  assert.equal(resolveDisplayedUptime(paused, 8 * HOUR + 60_000), 8 * HOUR + 1_000);
  // Re-observing the pause never re-arms the freeze — the snapshot stays.
  assert.equal(applyUptimePause(paused, 9 * HOUR, true), paused);
});

test("resuming the sync continues from the frozen value, never the pause", () => {
  // The uptime the service accrued while the stream was paused is ignored:
  // resuming shows the frozen value again and counts forward from there.
  let state = applyUptimePause(resetUptimePause(), 8 * HOUR, true);
  state = applyUptimePause(state, 8 * HOUR + 25 * 60_000, false);
  assert.equal(state.frozenMs, null);
  assert.equal(state.ignoredMs, 25 * 60_000);
  assert.equal(resolveDisplayedUptime(state, 8 * HOUR + 25 * 60_000), 8 * HOUR);
  assert.equal(resolveDisplayedUptime(state, 8 * HOUR + 26 * 60_000), 8 * HOUR + 60_000);
});

test("a second pause freezes where the running clock was, not the raw uptime", () => {
  // The ignore from past pauses carries into the next freeze baseline, so
  // each pause holds the value the running clock actually showed.
  let state = applyUptimePause(resetUptimePause(), 8 * HOUR, true);
  state = applyUptimePause(state, 8 * HOUR + 30 * 60_000, false);
  state = applyUptimePause(state, 9 * HOUR, true);
  assert.equal(state.frozenMs, 8 * HOUR + 30 * 60_000);
  state = applyUptimePause(state, 10 * HOUR, false);
  assert.equal(state.ignoredMs, 90 * 60_000);
  assert.equal(resolveDisplayedUptime(state, 10 * HOUR), 8 * HOUR + 30 * 60_000);
});

test("a new service process recounts from its own start", () => {
  // Restarting the service is the documented way out of a spent budget: the
  // new process owns a fresh clock with no pause history.
  const state = resetUptimePause();
  assert.deepEqual(state, { frozenMs: null, ignoredMs: 0 });
  assert.equal(resolveDisplayedUptime(state, 42_000), 42_000);
});
