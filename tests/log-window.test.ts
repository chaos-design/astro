import assert from "node:assert/strict";
import test from "node:test";
import {
  LOG_OVERSCAN,
  LOG_ROW_ESTIMATE,
  LOG_TURN_ESTIMATE,
  buildLogLayout,
  findVisibleRange,
  lowerBound,
  resolveScrollTopForRow,
} from "../src/lib/log-window.ts";

const metrics = { gap: 6, row: 50, turn: 30 };

test("layout offsets stay ascending and cover every entry", () => {
  const entries = [
    { turn: 3 },
    { turn: 3 },
    { turn: 2 },
    { turn: 1 },
  ];
  const layout = buildLogLayout(entries, metrics);

  assert.equal(layout.rowTops.length, entries.length);
  assert.equal(layout.items.length, entries.length + 3);
  for (let index = 1; index < layout.offsets.length; index += 1) {
    assert.equal(layout.offsets[index] > layout.offsets[index - 1], true);
  }
  assert.equal(
    layout.total,
    4 * metrics.row + 3 * metrics.turn + 6 * metrics.gap,
  );
  assert.equal(layout.items[0].kind, "turn");
  assert.equal(layout.items[1].kind, "row");
  assert.deepEqual(layout.rowTops, [36, 92, 184, 276]);
});

test("layout handles an empty log", () => {
  const layout = buildLogLayout([], metrics);
  assert.deepEqual(layout.items, []);
  assert.equal(layout.total, 0);
});

test("lower bound finds the first offset at or above a value", () => {
  assert.equal(lowerBound([0, 10, 20, 30], 10), 1);
  assert.equal(lowerBound([0, 10, 20, 30], 11), 2);
  assert.equal(lowerBound([0, 10, 20, 30], 100), 4);
  assert.equal(lowerBound([], 5), 0);
});

test("the visible range covers the viewport plus overscan", () => {
  const entries = Array.from({ length: 200 }, () => ({ turn: 1 }));
  const layout = buildLogLayout(entries, metrics);
  const range = findVisibleRange(layout.offsets, 1000, 400);

  assert.equal(range.start, 19 - LOG_OVERSCAN);
  assert.equal(range.end, 26 + LOG_OVERSCAN);
  assert.equal(range.end - range.start < entries.length, true);
});

test("the visible range stays empty without offsets", () => {
  assert.deepEqual(findVisibleRange([], 0, 400), { end: 0, start: 0 });
});

test("scroll math only moves when the row is out of view", () => {
  assert.equal(
    resolveScrollTopForRow({
      rowHeight: 50,
      scrollTop: 100,
      top: 400,
      viewportHeight: 500,
    }),
    null,
  );
  assert.equal(
    resolveScrollTopForRow({
      rowHeight: 50,
      scrollTop: 500,
      top: 400,
      viewportHeight: 500,
    }),
    400,
  );
  assert.equal(
    resolveScrollTopForRow({
      rowHeight: 50,
      scrollTop: 0,
      top: 900,
      viewportHeight: 500,
    }),
    450,
  );
  assert.equal(
    resolveScrollTopForRow({
      center: true,
      rowHeight: 50,
      scrollTop: 0,
      top: 900,
      viewportHeight: 500,
    }),
    675,
  );
  assert.equal(
    resolveScrollTopForRow({
      rowHeight: 50,
      scrollTop: 0,
      top: 0,
      viewportHeight: 0,
    }),
    null,
  );
});

test("fallback heights are usable before measurement", () => {
  assert.ok(LOG_ROW_ESTIMATE > 0);
  assert.ok(LOG_TURN_ESTIMATE > 0);
});
