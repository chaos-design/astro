import assert from "node:assert/strict";
import test from "node:test";
import { formatOverlayDuration } from "../src/lib/duration-label.ts";

test("below 10s the badge keeps the exact milliseconds", () => {
  assert.equal(formatOverlayDuration(0), "0ms");
  assert.equal(formatOverlayDuration(1250), "1250ms");
  assert.equal(formatOverlayDuration(9500), "9500ms");
  // The tier boundary itself steps up to seconds.
  assert.equal(formatOverlayDuration(10_000), "10s");
  assert.equal(formatOverlayDuration(9_999), "9999ms");
});

test("10s to 60s reads in seconds, one decimal when it carries information", () => {
  assert.equal(formatOverlayDuration(12_500), "12.5s");
  assert.equal(formatOverlayDuration(12_000), "12s");
  assert.equal(formatOverlayDuration(12_340), "12.3s");
  assert.equal(formatOverlayDuration(59_000), "59s");
  // A span that rounds up to a whole minute belongs to the minute tier.
  assert.equal(formatOverlayDuration(59_999), "1M");
});

test("60s to 60min compounds minutes and seconds, dropping zero parts", () => {
  assert.equal(formatOverlayDuration(60_000), "1M");
  assert.equal(formatOverlayDuration(61_000), "1M1s");
  assert.equal(formatOverlayDuration(90_000), "1M30s");
  assert.equal(formatOverlayDuration(150_500), "2M31s");
  assert.equal(formatOverlayDuration(119_900), "2M");
  assert.equal(formatOverlayDuration(3_599_000), "59M59s");
  // The hour tier takes over at 60 minutes.
  assert.equal(formatOverlayDuration(3_600_000), "1H");
});

test("above 60min compounds hours, minutes and seconds", () => {
  assert.equal(formatOverlayDuration(3_660_000), "1H1M");
  assert.equal(formatOverlayDuration(3_661_000), "1H1M1s");
  assert.equal(formatOverlayDuration(5_130_000), "1H25M30s");
  assert.equal(formatOverlayDuration(7_200_000), "2H");
});

test("a non-finite or negative span has no honest reading", () => {
  assert.equal(formatOverlayDuration(Number.NaN), "--");
  assert.equal(formatOverlayDuration(Number.POSITIVE_INFINITY), "--");
  assert.equal(formatOverlayDuration(-1), "--");
});
