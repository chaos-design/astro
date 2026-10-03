import assert from "node:assert/strict";
import test from "node:test";
import { projectTraceEvents } from "../src/lib/atomic-projection.ts";
import {
  buildTraceTurnIndex,
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
