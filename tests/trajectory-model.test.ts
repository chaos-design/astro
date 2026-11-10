import assert from "node:assert/strict";
import test from "node:test";
import { projectTraceEvents } from "../src/lib/atomic-projection.ts";
import {
  buildTraceTurnIndex,
  buildTrajectoryMapSlots,
  buildTrajectoryModel,
  getTrajectorySegmentPosition,
  orderTrajectoryNewestFirst,
} from "../src/lib/trajectory-model.ts";
import type { TraceEvent } from "../src/types/trace.ts";
import { buildHarnessFlow } from "../src/lib/trace-model.ts";
import { createDemoEvents } from "./helpers/demo-fixture.ts";

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

test("orders the rendered trajectory newest first without touching the model", () => {
  const events = createDemoEvents(2_000_000_000_000);
  const projection = projectTraceEvents(events, "codex");
  const topology = buildHarnessFlow(events, "codex");
  const model = buildTrajectoryModel(events, projection.events, topology.nodes);

  const display = orderTrajectoryNewestFirst(model);

  // The newest turn leads, and its newest atom is the first row of the block:
  // the executing atom is reachable without scrolling through the run.
  assert.deepEqual(
    display.turns.map((turn) => turn.turn),
    [...model.turns].map((turn) => turn.turn).reverse(),
  );
  const newestTurn = model.turns.at(-1)!;
  assert.deepEqual(
    display.turns[0].atoms.map((atom) => atom.id),
    [...newestTurn.atoms].map((atom) => atom.id).reverse(),
  );
  // The run preamble renders last, newest first.
  assert.deepEqual(
    display.context.map((atom) => atom.id),
    [...model.context].map((atom) => atom.id).reverse(),
  );
  // The chronological model is what selection and "latest atom" lookups read.
  assert.deepEqual(
    model.turns.map((turn) => turn.turn),
    [...model.turns.map((turn) => turn.turn)].sort((left, right) => left - right),
  );
  assert.deepEqual(
    model.turns[0].atoms.map((atom) => atom.sequence),
    [...model.turns[0].atoms.map((atom) => atom.sequence)].sort(
      (left, right) => left - right,
    ),
  );
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

/**
 * DeepSeek Harness names its turns with a stable native id (its `data.turn`)
 * that every event inside one loop shares, and that number is not 1-based nor
 * contiguous across turns (a resumed session can jump 2 -> 5 -> 9). Such a batch
 * must group purely by that identity, in first-seen order, so a step/loop inside
 * one turn never opens a new LOG separator and the sequence stays monotonic.
 */
function deepseekEvent(
  id: string,
  eventName: TraceEvent["eventName"],
  turnId: string | null,
): TraceEvent {
  return {
    capturedAt: new Date(0).toISOString(),
    id,
    payload: {},
    source: "deepseek",
    eventName,
    turnId,
  };
}

test("groups a native-identified DeepSeek loop as a single monotonic turn", () => {
  const events = [
    deepseekEvent("s", "SessionStart", null),
    deepseekEvent("p", "UserPromptSubmit", null),
    deepseekEvent("a1", "AgentMessage", "2"),
    deepseekEvent("t1", "PreToolUse", "2"),
    deepseekEvent("r1", "PostToolUse", "2"),
    // Loop back inside the same native turn 2: a message after a closed loop
    // used to increment a side counter and bounce the LOG back to turn 1.
    deepseekEvent("a2", "AgentMessage", "2"),
    deepseekEvent("t2", "PreToolUse", "2"),
    deepseekEvent("r2", "PostToolUse", "2"),
    deepseekEvent("p2", "UserPromptSubmit", null),
    deepseekEvent("a3", "AgentMessage", "5"),
    deepseekEvent("stop", "Stop", "5"),
    deepseekEvent("e", "SessionEnd", null),
  ];

  const index = buildTraceTurnIndex(events);

  assert.deepEqual(
    events.map((event) => index.get(event.id)),
    // One ordinal per distinct native turn (2 -> 1st, 5 -> 2nd); identity-less
    // events inherit the most recent one, so the whole sequence is monotonic.
    [1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2],
  );
});

test("still infers turns from prompt/loop structure when no source names turns", () => {
  const hook = (
    id: string,
    eventName: TraceEvent["eventName"],
  ): TraceEvent => ({
    capturedAt: new Date(0).toISOString(),
    id,
    payload: {},
    source: "claude",
    eventName,
    turnId: null,
  });
  const events = [
    hook("s", "SessionStart"),
    hook("p1", "UserPromptSubmit"),
    hook("t1", "PreToolUse"),
    hook("r1", "PostToolUse"),
    hook("m1", "AgentMessage"),
    hook("p2", "UserPromptSubmit"),
    hook("m2", "AgentMessage"),
  ];

  const index = buildTraceTurnIndex(events);

  assert.deepEqual(
    events.map((event) => index.get(event.id)),
    [1, 1, 1, 1, 2, 3, 3],
  );
});
