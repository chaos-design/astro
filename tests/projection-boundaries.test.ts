import assert from "node:assert/strict";
import test from "node:test";
import { projectTraceEvents } from "../src/lib/atomic-projection.ts";
import { buildHarnessFlow, normalizeTraceEvent } from "../src/lib/trace-model.ts";
import { buildTrajectoryModel } from "../src/lib/trajectory-model.ts";

test("completes inferred model invocations without native turn IDs", () => {
  const events = [
    "UserPromptSubmit", "Reasoning", "AgentMessage", "Stop",
  ].map((eventName, index) => normalizeTraceEvent({
    id: `event-${index}`, eventName, source: "codex", sessionId: "session",
    capturedAt: new Date(1_000 + index * 100).toISOString(), payload: {},
  }));
  const projection = projectTraceEvents(events, "codex");
  const models = projection.events.filter((event) => event.atom.key === "model.invoke");
  assert.equal(new Set(models.map((event) => event.instance.id)).size, 1);
  const trajectory = buildTrajectoryModel(events, projection.events, buildHarnessFlow(events).nodes);
  assert.ok(trajectory.turns.every((turn) => turn.status === "complete"));
  const prefix = projectTraceEvents(events.slice(0, 2), "codex");
  assert.equal(prefix.events.find((event) => event.atom.key === "model.invoke")?.instance.id,
    models[0].instance.id);
});

test("keeps successive model calls distinct inside the same explicit turn", () => {
  const events = ["Reasoning", "PreToolUse", "PostToolUse", "Reasoning", "AgentMessage"]
    .map((eventName, index) => normalizeTraceEvent({
      id: `event-${index}`, eventName, source: "codex", sessionId: "session",
      turnId: "turn", toolUseId: index === 1 || index === 2 ? "tool" : null,
      capturedAt: new Date(1_000 + index * 100).toISOString(), payload: {},
    }));
  const models = projectTraceEvents(events, "codex").events
    .filter((event) => event.atom.key === "model.invoke");
  assert.equal(models[0].instance.id, models[1].instance.id);
  assert.equal(models[2].instance.id, models[3].instance.id);
  assert.notEqual(models[0].instance.id, models[2].instance.id);
});
