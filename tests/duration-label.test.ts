import assert from "node:assert/strict";
import test from "node:test";

import {
  formatDurationClock,
  formatDurationMs,
} from "../src/lib/duration-label.ts";

// The LOG badge and the global overlay's rail badge share this one ladder, so
// the same closed pair reads with the same unit in both surfaces. Each tier
// resolves to its dominant unit — no compounding — and a long history stays
// scannable instead of printing a wall of digits.

test("short spans keep millisecond precision below ten seconds", () => {
  assert.equal(formatDurationMs(0), "0ms");
  assert.equal(formatDurationMs(1250), "1250ms");
  assert.equal(formatDurationMs(9999), "9999ms");
  assert.equal(formatDurationMs(9500), "9500ms");
});

test("seconds, minutes, hours and days each own one tier", () => {
  assert.equal(formatDurationMs(10_000), "10s");
  assert.equal(formatDurationMs(12_340), "12s");
  assert.equal(formatDurationMs(59_000), "59s");
  assert.equal(formatDurationMs(60_000), "1m");
  assert.equal(formatDurationMs(90_000), "2m");
  assert.equal(formatDurationMs(3_600_000), "1h");
  assert.equal(formatDurationMs(5_130_000), "1h");
  assert.equal(formatDurationMs(86_400_000), "1d");
  assert.equal(formatDurationMs(172_800_000), "2d");
});

test("invalid spans are not reported as zero", () => {
  assert.equal(formatDurationMs(Number.NaN), "--");
  assert.equal(formatDurationMs(Number.POSITIVE_INFINITY), "--");
  assert.equal(formatDurationMs(-1), "--");
});

// The Agent header's execution clock: a fine reading for *this one* message.
// Under a minute it keeps a tenth of a second, then the wall-clock form.

test("the clock keeps a tenth of a second under a minute", () => {
  assert.equal(formatDurationClock(0), "0:00.0");
  assert.equal(formatDurationClock(400), "0:00.4");
  assert.equal(formatDurationClock(940), "0:00.9");
  assert.equal(formatDurationClock(59_400), "0:59.4");
});

test("the clock reads HH:MM:SS once a minute passes", () => {
  assert.equal(formatDurationClock(60_000), "01:00");
  assert.equal(formatDurationClock(90_000), "01:30");
  assert.equal(formatDurationClock(3_600_000), "01:00:00");
  assert.equal(formatDurationClock(3_723_000), "01:02:03");
});

test("the clock reports invalid spans as a dash, not zero", () => {
  assert.equal(formatDurationClock(Number.NaN), "--");
  assert.equal(formatDurationClock(-1), "--");
});
