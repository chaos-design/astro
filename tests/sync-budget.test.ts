import assert from "node:assert/strict";
import test from "node:test";

import { getSyncStopDelay } from "../src/lib/sync-budget.ts";

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
