import assert from "node:assert/strict";
import test from "node:test";
import { projectTraceEvents } from "../src/lib/atomic-projection.ts";
import {
  buildTraceTurnIndex,
  buildTrajectoryMapSlots,
  buildTrajectoryModel,
  getTrajectorySegmentPosition,
} from "../src/lib/trajectory-model.ts";
import {
  buildHarnessFlow,
  createDemoEvents,
} from "../src/lib/trace-model.ts";

test("builds loop turns with expandable atomic children", () => {
  const events = createDemoEvents(2_000_000_000_000);
  const projection = projectTraceEvents(events, "codex");
  const topology = buildHarnessFlow(events, "codex");
  const model = buildTrajectoryModel(
    events,
    projection.events,
    topology.nodes,
  );

  assert.deepEqual(
    model.turns.map((turn) => turn.turn),
    [1, 2, 3],
  );
  assert.ok(model.context.some((atom) => atom.key === "session.resume"));
  assert.ok(model.context.some((atom) => atom.key === "memory.recall"));
  assert.ok(model.turns[0].atoms.some((atom) => atom.key === "model.invoke"));
  assert.equal(
    model.turns[1].atoms.filter((atom) => atom.key === "tool.call").length,
    2,
  );
  assert.ok(model.turns[2].atoms.some((atom) => atom.key === "gate.quality"));
});

test("uses explicit turn metadata before inferring loop boundaries", () => {
  const events = createDemoEvents(2_000_000_000_000);
  const turnByEventId = buildTraceTurnIndex(events);
  const search = events.find((event) => event.toolUseId === "tool-search");
  const testRun = events.find((event) => event.toolUseId === "tool-test");

  assert.equal(turnByEventId.get(search?.id || ""), 2);
  assert.equal(turnByEventId.get(testRun?.id || ""), 3);
});

test("positions trajectory segments on distinct node slots", () => {
  assert.deepEqual(getTrajectorySegmentPosition(0, 4), {
    left: 0,
    width: 25,
  });
  assert.deepEqual(getTrajectorySegmentPosition(1, 4), {
    left: 25,
    width: 25,
  });
  assert.deepEqual(getTrajectorySegmentPosition(99, 4), {
    left: 75,
    width: 25,
  });
});

test("aggregates a long lane overview into a bounded number of slots", () => {
  const nodes = Array.from({ length: 1_000 }, (_, index) => ({
    data: {
      index,
      meta: { lane: index % 2, tone: "tool" },
      status: index === 500 ? "failed" : "complete",
    },
    id: `node-${index}`,
  }));

  const slots = buildTrajectoryMapSlots(nodes, 50);

  // Two lanes, 50 marks each: the map stays a readable timeline instead of
  // mounting one element per node.
  assert.equal(slots.length, 100);
  assert.equal(slots.reduce((sum, slot) => sum + slot.count, 0), 1_000);
  // The failing node keeps its own slot severity instead of being averaged
  // away by its completed neighbours.
  assert.ok(slots.some((slot) => slot.status === "failed"));
  // Ranges are contiguous and cover every node exactly once.
  const laneZero = slots.filter((slot) => slot.lane === 0);
  assert.equal(laneZero[0].start, 0);
  assert.equal(laneZero.at(-1)?.end, 998);
});

test("keeps one slot per node when the lane is already short", () => {
  const nodes = Array.from({ length: 5 }, (_, index) => ({
    data: { index, meta: { lane: 0, tone: "agent" }, status: "complete" },
    id: `node-${index}`,
  }));

  const slots = buildTrajectoryMapSlots(nodes, 96);
  assert.equal(slots.length, 5);
  assert.deepEqual(
    slots.map((slot) => [slot.start, slot.end, slot.count]),
    [
      [0, 0, 1],
      [1, 1, 1],
      [2, 2, 1],
      [3, 3, 1],
      [4, 4, 1],
    ],
  );
});
