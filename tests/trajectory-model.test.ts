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
import {
  buildHarnessFlow,
  buildPairDurations,
  buildPairLinks,
} from "../src/lib/trace-model.ts";
import { createDemoEvents } from "./helpers/demo-fixture.ts";

test("carries closed-pair durations on atoms and turns", () => {
  const events = createDemoEvents(2_000_000_000_000);
  const projection = projectTraceEvents(events, "codex");
  const topology = buildHarnessFlow(events, "codex");
  const model = buildTrajectoryModel(
    events,
    projection.events,
    topology.nodes,
  );
  const pairDurations = buildPairDurations(events);
  const pairLinks = buildPairLinks(events);

  // Every atom reports a `pairDuration`; when set, it equals the single
  // pairing truth for its trace event, and when the event is unpaired it is
  // null so the UI omits the badge instead of printing 0. The link marker
  // comes from the same pairing truth, so it never appears without the badge.
  for (const atom of model.turns.flatMap((turn) => turn.atoms)) {
    const expected = pairDurations.get(atom.event.id) ?? null;
    assert.equal(atom.pairDuration, expected);
    assert.deepEqual(
      atom.pairLink,
      pairLinks.get(atom.event.id) ?? null,
    );
    assert.equal(atom.pairLink !== null, expected !== null);
  }

  // A turn's total is the sum of its closed-pair spans only.
  for (const turn of model.turns) {
    const expected = turn.atoms.reduce(
      (total, atom) => total + (atom.pairDuration ?? 0),
      0,
    );
    assert.equal(turn.totalPairDuration, expected);
  }
});

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
 * contiguous across turns (a resumed session can start at 5). Such a batch must
 * group purely by that identity and keep the number the source prints, so a
 * step/loop inside one turn never opens a second LOG separator and the label
 * agrees with what the harness and the canvas already show.
 */
function deepseekEvent(
  id: string,
  eventName: TraceEvent["eventName"],
  turnId: string | null,
  turn?: number,
): TraceEvent {
  return {
    capturedAt: new Date(0).toISOString(),
    id,
    payload: turn === undefined ? {} : { turn },
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
    deepseekEvent("t1", "PreToolUse", "2", 2),
    deepseekEvent("r1", "PostToolUse", "2", 2),
    // Loop back inside the same native turn 2: a message after a closed loop
    // used to increment a side counter and bounce the LOG back to turn 1.
    deepseekEvent("a2", "AgentMessage", "2"),
    deepseekEvent("t2", "PreToolUse", "2", 2),
    deepseekEvent("r2", "PostToolUse", "2", 2),
    deepseekEvent("p2", "UserPromptSubmit", null),
    deepseekEvent("a3", "AgentMessage", "5", 5),
    deepseekEvent("stop", "Stop", "5", 5),
    deepseekEvent("e", "SessionEnd", null),
  ];

  const index = buildTraceTurnIndex(events);

  assert.deepEqual(
    events.map((event) => index.get(event.id)),
    // The harness's own numbers, not renumbered ordinals: the resumed session
    // really is on turn 2 and then turn 5. Identity-less events stay in the
    // turn that was executing; the leading preamble belongs to the first turn
    // it introduces instead of opening a stray "TURN 01" group.
    [2, 2, 2, 2, 2, 2, 2, 2, 2, 5, 5, 5],
  );
});

test("reads the envelope turn id and the payload turn as one identity", () => {
  // The recorder writes DeepSeek's `data.turn` to the envelope as the string
  // "5" and to the payload as the number 5. Treating those spellings as two
  // identities is what split one loop into "TURN 05" and "TURN 06" groups.
  const events = [
    deepseekEvent("a", "AgentMessage", "5"),
    deepseekEvent("t", "PreToolUse", "5", 5),
    deepseekEvent("r", "PostToolUse", "5", 5),
  ];

  const index = buildTraceTurnIndex(events);

  assert.deepEqual(
    events.map((event) => index.get(event.id)),
    [5, 5, 5],
  );
});

test("numbers opaque turn identities in order and keeps regressions distinct", () => {
  const hook = (
    id: string,
    turnId: string | null,
  ): TraceEvent => ({
    capturedAt: new Date(0).toISOString(),
    id,
    payload: {},
    source: "codex",
    eventName: "AgentMessage",
    turnId,
  });
  const events = [
    // Codex reports opaque ids (`turn_1`), so they get ordinals …
    hook("a", "turn_1"),
    hook("b", "turn_2"),
    // … and after a numeric identity, a lower one is a *new* group rather than
    // a jump backwards: the LOG must never number a later turn below an
    // earlier one.
    hook("c", "7"),
    hook("d", "1"),
    hook("e", "7"),
  ];

  const index = buildTraceTurnIndex(events);

  assert.deepEqual(
    events.map((event) => index.get(event.id)),
    [1, 2, 7, 8, 7],
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
