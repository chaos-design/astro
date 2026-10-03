import assert from "node:assert/strict";
import test from "node:test";
import { foldAtomicEvents } from "../src/vendor/atomic-flow/browser.ts";
import { isOrthogonalRoute } from "../src/vendor/flow-graph/index.ts";
import { getAtomIdForEvent } from "../src/config/atom-platforms.ts";
import {
  atomLevel,
  projectTraceEvents,
} from "../src/lib/atomic-projection.ts";
import { createFlowLayout } from "../src/lib/flow-layout.ts";
import { buildHarnessFlow, createDemoEvents } from "../src/lib/trace-model.ts";

test("projects trace events into a strictly ordered atomic flow", () => {
  const events = createDemoEvents(2_000_000_000_000);
  const projection = projectTraceEvents(events, "codex");
  const sequences = projection.events.map((event) => event.sequence);
  const folded = foldAtomicEvents(projection.events);

  assert.ok(projection.events.length > events.length);
  assert.deepEqual(
    sequences,
    sequences.map((_, index) => index + 1),
  );
  assert.equal(folded.runId, events[0].sessionId);
  assert.equal(folded.instances.get(`${events[0].sessionId}:run:${events[0].sessionId}`)?.status, "completed");
});

test("pairs tool start and end events into completed atomic instances", () => {
  const events = createDemoEvents(2_000_000_000_000);
  const projection = projectTraceEvents(events, "codex");
  const folded = foldAtomicEvents(projection.events);
  const toolInstances = [...folded.instances.values()].filter(
    (instance) => instance.atom.key === "tool.call",
  );
  const resultInstances = [...folded.instances.values()].filter(
    (instance) => instance.atom.key === "tool.result",
  );

  assert.equal(toolInstances.length, 4);
  assert.ok(toolInstances.every((instance) => instance.status === "completed"));
  assert.equal(resultInstances.length, 4);
  assert.ok(resultInstances.every((instance) => instance.status === "completed"));
});

test("keeps the complete tool pipeline visible at runtime level", () => {
  assert.equal(atomLevel("tool.resolve"), "runtime");
  assert.equal(atomLevel("tool.execute"), "runtime");
  assert.equal(atomLevel("tool.result"), "runtime");
});

test("folds active Prompt atoms from their own execution events", () => {
  const events = createDemoEvents(2_000_000_000_000);
  const prompt = events.find((event) => event.eventName === "UserPromptSubmit");
  const toolStart = events.find((event) => event.eventName === "PreToolUse");
  const toolEnd = events.find(
    (event) =>
      event.eventName === "PostToolUse" &&
      event.toolUseId === toolStart?.toolUseId,
  );
  assert.ok(prompt);
  assert.ok(toolStart);
  assert.ok(toolEnd);

  const active = foldAtomicEvents(
    projectTraceEvents([prompt, toolStart], "trae").events,
  );
  assert.equal(
    active.instances.get(`${prompt.sessionId}:run:${prompt.sessionId}`)?.status,
    "running",
  );
  assert.equal(
    active.instances.get(
      `${prompt.sessionId}:tool:${toolStart.toolUseId}`,
    )?.status,
    "running",
  );
  assert.equal(
    active.instances.get(
      `${prompt.sessionId}:tool-execute:${toolStart.toolUseId}`,
    )?.status,
    "running",
  );

  const completedProjection = projectTraceEvents(
    [prompt, toolStart, toolEnd],
    "trae",
  );
  const completed = foldAtomicEvents(completedProjection.events);
  assert.equal(
    completed.instances.get(
      `${prompt.sessionId}:tool:${toolStart.toolUseId}`,
    )?.status,
    "completed",
  );
  assert.equal(
    completed.instances.get(
      `${prompt.sessionId}:tool-execute:${toolStart.toolUseId}`,
    )?.status,
    "completed",
  );
  assert.equal(
    completed.instances.get(
      `${prompt.sessionId}:tool-result:${toolStart.toolUseId}`,
    )?.status,
    "completed",
  );
  assert.deepEqual(
    completedProjection.events
      .filter((event) => event.eventId.startsWith(`${toolEnd.id}:`))
      .map((event) => event.atom.key),
    [
      "tool.execute",
      "tool.call",
      "tool.result",
      "observation",
      "stage.checkpoint",
      "memory.capture",
    ],
  );
  assert.equal(getAtomIdForEvent(toolEnd, "trae"), "harness-tool-result");
});

test("folds failed tool atoms without affecting another Prompt run", () => {
  const events = createDemoEvents(2_000_000_000_000);
  const prompt = events.find((event) => event.eventName === "UserPromptSubmit");
  const toolStart = events.find((event) => event.eventName === "PreToolUse");
  const toolEnd = events.find(
    (event) =>
      event.eventName === "PostToolUse" &&
      event.toolUseId === toolStart?.toolUseId,
  );
  assert.ok(prompt);
  assert.ok(toolStart);
  assert.ok(toolEnd);
  const failedToolEnd = {
    ...toolEnd,
    id: "failed-tool-end",
    eventName: "PostToolUseFailure",
    status: "failed",
  };

  const folded = foldAtomicEvents(
    projectTraceEvents([prompt, toolStart, failedToolEnd], "trae").events,
  );
  assert.equal(
    folded.instances.get(
      `${prompt.sessionId}:tool:${toolStart.toolUseId}`,
    )?.status,
    "failed",
  );
  assert.equal(
    folded.instances.get(
      `${prompt.sessionId}:tool-execute:${toolStart.toolUseId}`,
    )?.status,
    "failed",
  );
  assert.equal(
    folded.instances.get(
      `${prompt.sessionId}:tool-result:${toolStart.toolUseId}`,
    )?.status,
    "failed",
  );
});

test("keeps rate-limited model atoms waiting instead of failed", () => {
  const events = createDemoEvents(2_000_000_000_000);
  const prompt = events.find((event) => event.eventName === "UserPromptSubmit");
  assert.ok(prompt);
  const rateLimit = {
    ...prompt,
    id: "rate-limit",
    capturedAt: new Date(Date.parse(prompt.capturedAt) + 1_000).toISOString(),
    eventName: "StopFailure",
    nativeEventName: "StopFailure",
    status: "failed",
    payload: {
      reason: "rate_limit",
      error: "Too many requests; retry_after=3",
    },
  };

  const projection = projectTraceEvents([prompt, rateLimit], "workbuddy");
  const folded = foldAtomicEvents(projection.events);
  const model = [...folded.instances.values()].find(
    (instance) => instance.atom.key === "model.invoke",
  );
  const topology = buildHarnessFlow([prompt, rateLimit], "workbuddy");

  assert.equal(model?.status, "waiting");
  assert.equal(
    topology.nodes.find((node) => node.data.id === "model-invoke")?.data.status,
    "waiting",
  );
});

test("routes visible topology edges as orthogonal graph paths", () => {
  const topology = buildHarnessFlow(createDemoEvents(2_000_000_000_000), "codex");
  const layout = createFlowLayout(topology);

  assert.equal(layout.edges.length, topology.edges.length);
  assert.ok(layout.edges.length > 0);
  assert.ok(layout.edges.every((edge) => isOrthogonalRoute(edge.points)));
  assert.equal(layout.metrics.routeCount, layout.edges.length);
});

test("routes tool results into the observation side without shared segments", () => {
  const topology = buildHarnessFlow(createDemoEvents(2_000_000_000_000), "codex");
  const layout = createFlowLayout(topology);
  const observation = layout.nodes.find((node) => node.id === "harness-observation");
  const edge = layout.edges.find(
    (candidate) =>
      candidate.source === "harness-tool-result" &&
      candidate.target === "harness-observation",
  );

  assert.ok(observation);
  assert.ok(edge);
  assert.equal(edge.targetHandle, "target-right");
  assert.equal(edge.endPoint.x, observation.position.x + topology.meta.nodeWidth);
  assert.ok(
    layout.diagnostics.every(
      (diagnostic) =>
        diagnostic.edgeId !== edge.id ||
        diagnostic.code !== "ROUTE_OVERLAP_REMAINS",
    ),
  );
});

test("routes agent results above the shared section border", () => {
  const topology = buildHarnessFlow(createDemoEvents(2_000_000_000_000), "codex");
  const layout = createFlowLayout(topology);
  const capabilityLayer = layout.layers.find(
    (layer) => layer.id === "capability-runtime",
  );
  const edge = layout.edges.find(
    (candidate) =>
      candidate.source === "harness-agent-result" &&
      candidate.target === "harness-final-reply",
  );

  assert.ok(capabilityLayer);
  assert.ok(edge);
  assert.equal(edge.sourceHandle, "source-top");
  assert.ok(
    Math.max(...edge.points.map((point) => point.x)) <=
      capabilityLayer.position.x + capabilityLayer.width - 12,
  );
});

test("keeps the final quality path inside the visible canvas", () => {
  const topology = buildHarnessFlow(createDemoEvents(2_000_000_000_000), "codex");
  const layout = createFlowLayout(topology);
  const edge = layout.edges.find(
    (candidate) =>
      candidate.source === "harness-final-reply" &&
      candidate.target === "harness-quality-gate",
  );

  assert.ok(edge);
  assert.ok(
    edge.points.every(
      (point) =>
        point.x >= 0 &&
        point.y >= 0 &&
        point.x <= layout.width &&
        point.y <= layout.height,
    ),
  );
});

test("classifies topology paths with the shared route semantics", () => {
  const topology = buildHarnessFlow(
    createDemoEvents(2_000_000_000_000),
    "codex",
  );
  const routeKinds = new Set(
    topology.edges.map((edge) => edge.data?.routeKind),
  );
  const edge = (source: string, target: string) =>
    topology.edges.find(
      (candidate) =>
        candidate.source === `harness-${source}` &&
        candidate.target === `harness-${target}`,
    );

  assert.deepEqual(routeKinds, new Set([
    "data",
    "execution",
    "feedback",
    "persistence",
  ]));
  assert.equal(edge("observation", "loop-turn")?.data?.routeKind, "feedback");
  assert.equal(edge("tool-execute", "tool-result")?.data?.routeKind, "data");
  assert.equal(edge("tool-result", "observation")?.data?.routeKind, "data");
  assert.equal(edge("tool-call", "observation"), undefined);
  assert.equal(
    edge("trace-append", "trajectory-project")?.data?.routeKind,
    "persistence",
  );
  assert.equal(edge("model-invoke", "usage")?.data?.routeKind, "data");
});
