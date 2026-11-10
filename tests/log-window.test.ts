import assert from "node:assert/strict";
import test from "node:test";
import {
  LOG_OVERSCAN,
  LOG_ROW_ESTIMATE,
  LOG_TURN_ESTIMATE,
  buildLogLayout,
  findVisibleRange,
  includeTurnRow,
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

test("turn separators keep a unique position even when a number repeats", () => {
  // A source that restarts its counter can hand two groups the same number.
  // The separator's React key comes from `entryIndex`, not from the value: a
  // value-based key produced duplicate keys, and React left the stale chips in
  // the DOM after the next agent switch.
  const entries = [{ turn: 1 }, { turn: 1 }, { turn: 2 }, { turn: 1 }];
  const layout = buildLogLayout(entries, metrics);

  const keys = layout.items.map((item) => `${item.kind}-${item.entryIndex}`);
  assert.equal(new Set(keys).size, layout.items.length);
  assert.deepEqual(
    layout.items
      .filter((item) => item.kind === "turn")
      .map((item) => [item.turn, item.entryIndex]),
    [
      [1, 0],
      [2, 2],
      [1, 3],
    ],
  );
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

test("a mounted window never ends on a turn separator", () => {
  // The chip introduces the row below it; a window that stops on the chip
  // paints a `TURN n` label over an empty slot at the bottom edge.
  const items = [
    { kind: "turn" as const },
    { kind: "row" as const },
    { kind: "row" as const },
    { kind: "turn" as const },
    { kind: "row" as const },
  ];

  assert.deepEqual(includeTurnRow(items, { start: 0, end: 4 }), {
    start: 0,
    end: 5,
  });
  // A window that already ends on a row is untouched.
  assert.deepEqual(includeTurnRow(items, { start: 1, end: 3 }), {
    start: 1,
    end: 3,
  });
  // The end clamps to the list length when the separator is the last item.
  const trailing = [...items, { kind: "turn" as const }];
  assert.deepEqual(includeTurnRow(trailing, { start: 0, end: 6 }), {
    start: 0,
    end: 6,
  });
});

test("fallback heights are usable before measurement", () => {
  assert.ok(LOG_ROW_ESTIMATE > 0);
  assert.ok(LOG_TURN_ESTIMATE > 0);
});
