import assert from "node:assert/strict";
import test from "node:test";
import { createFlowLayoutKey, refreshFlowLayout } from "../src/lib/flow-layout-cache.ts";
import { createFlowLayout, type FlowLayout } from "../src/lib/flow-layout.ts";
import { buildHarnessFlow, createDemoEvents } from "../src/lib/trace-model.ts";

const events = createDemoEvents(2_000_000_000_000);

test("keeps base atoms and routes stable as runtime conditions change", () => {
  const initial = buildHarnessFlow(events.slice(0, 2), "trae");
  const tool = buildHarnessFlow(events.slice(0, 4), "trae");
  const question = buildHarnessFlow([
    ...events.slice(0, 4),
    { ...events[3], id: "permission", eventName: "PermissionRequest" },
  ], "trae");
  const complete = buildHarnessFlow(events, "trae");

  for (const topology of [tool, question, complete]) {
    assert.deepEqual(
      topology.edges.map((edge) => edge.id),
      initial.edges.map((edge) => edge.id),
    );
    assert.deepEqual(
      topology.nodes.map((node) => node.id),
      initial.nodes.map((node) => node.id),
    );
    assert.ok(topology.edges.every((edge) => edge.hidden !== true));
  }
  assert.equal(
    new Set([initial, tool, question, complete].map(createFlowLayoutKey)).size,
    1,
  );
});

test("keeps the routing key stable for runtime-only updates and identical sessions", () => {
  const before = buildHarnessFlow(events.slice(0, 4), "trae");
  const after = buildHarnessFlow(events.slice(0, 8), "trae");
  const anotherSession = buildHarnessFlow(
    events.slice(0, 8).map((event) => ({ ...event, sessionId: "another-session" })),
    "claude",
  );

  assert.equal(createFlowLayoutKey(before), createFlowLayoutKey(after));
  assert.equal(createFlowLayoutKey(after), createFlowLayoutKey(anotherSession));
  assert.notEqual(before.meta.toolCount, after.meta.toolCount);
});

test("invalidates routes for geometry, endpoints, ports, and domain membership changes", () => {
  const topology = buildHarnessFlow(events, "trae");
  const key = createFlowLayoutKey(topology);
  const changes = [
    (next: typeof topology) => { next.nodes[0].position.x += 10; },
    (next: typeof topology) => { next.meta.nodeWidth += 10; },
    (next: typeof topology) => { next.edges[0].source = next.nodes[2].id; },
    (next: typeof topology) => { next.edges[0].target = next.nodes[3].id; },
    (next: typeof topology) => { next.edges[0].sourceHandle = "source-left"; },
    (next: typeof topology) => { next.edges[0].targetHandle = "target-right"; },
    (next: typeof topology) => { next.layers[0].width += 10; },
    (next: typeof topology) => { next.layers[0].height += 10; },
    (next: typeof topology) => { next.layers[0].position.y += 10; },
    (next: typeof topology) => { next.layers[0].atomIds.pop(); },
    (next: typeof topology) => { next.nodes.pop(); },
  ];
  for (const change of changes) {
    const next = structuredClone(topology);
    change(next);
    assert.notEqual(createFlowLayoutKey(next), key);
  }
});

test("live updates and backward replay use the same complete routes as a fresh load", () => {
  const cache = new Map<string, FlowLayout>();
  const stages = [2, 4, 8, events.length, 2, events.length, 4];
  let previousPaths: string[] = [];
  for (const count of stages) {
    const topology = buildHarnessFlow(events.slice(0, count), "trae");
    const key = createFlowLayoutKey(topology);
    const cached = cache.get(key) ?? createFlowLayout(topology);
    cache.set(key, cached);
    const layout = refreshFlowLayout(cached, topology);

    assert.deepEqual(
      layout.edges.map((edge) => edge.id),
      topology.edges.map((edge) => edge.id),
    );
    assert.ok(layout.edges.every((edge) => edge.path && edge.points.length >= 2));
    assert.deepEqual(
      layout.nodes.map((node) => node.data),
      topology.nodes.map((node) => node.data),
    );
    if (count === 8) {
      assert.deepEqual(layout.edges.map((edge) => edge.path), previousPaths);
    }
    previousPaths = layout.edges.map((edge) => edge.path);
  }
  assert.equal(cache.size, 1);
});

test("refreshes session data while preserving stable routes", () => {
  const complete = buildHarnessFlow(events, "trae");
  const cached = createFlowLayout(complete);
  const next = buildHarnessFlow(
    events.slice(0, 2).map((event) => ({ ...event, sessionId: "new-session" })),
    "trae",
  );
  next.layers[0].description = "Current session";
  const layout = refreshFlowLayout(cached, next);
  const prompt = layout.nodes.find((node) => node.id === "harness-prompt-input");

  assert.equal(prompt?.data.event?.sessionId, "new-session");
  assert.equal(prompt?.data.iterations, 0);
  assert.equal(layout.layers[0].description, "Current session");
  assert.deepEqual(
    layout.edges.map((edge) => edge.id),
    next.edges.map((edge) => edge.id),
  );
  assert.equal(cached.nodes[0].data.event?.sessionId, events[0].sessionId);
  assert.equal(cached.layers[0].description, complete.layers[0].description);
});
