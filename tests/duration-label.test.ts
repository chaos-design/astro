import assert from "node:assert/strict";
import test from "node:test";

import { formatDurationMs } from "../src/lib/duration-label.ts";

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
