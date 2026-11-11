import assert from "node:assert/strict";
import test from "node:test";

import {
  trajectoryKeyLabels,
  trajectoryKindLabels,
} from "../src/config/app-config.ts";
import { projectTraceEvents } from "../src/lib/atomic-projection.ts";
import {
  atomTypeLabel,
  eventAtomType,
} from "../src/lib/atom-types.ts";
import { createDemoEvents } from "./helpers/demo-fixture.ts";

const events = createDemoEvents(2_000_000_000_000);

test("TYPE reads the atom's key/kind, never the event name", () => {
  // Key-level overrides win, then the normalised kind label, then the raw
  // kind. The values are a closed set of short uppercase labels, not payload.
  assert.equal(atomTypeLabel("prompt.input", "input"), "SYSTEM");
  assert.equal(atomTypeLabel("run", "loop"), "SYSTEM");
  assert.equal(atomTypeLabel("tool.call", "tool"), "TOOL");
  assert.equal(atomTypeLabel("model.invoke", "model"), "MODEL");
  assert.equal(atomTypeLabel("tool.result", "context"), "MEMORY");
  assert.equal(atomTypeLabel("unknown.key", "model"), "MODEL");
  assert.equal(atomTypeLabel("unknown.key", "unmapped"), "unmapped");
});

test("every LOG row names the TYPE of its primary projected atom", () => {
  const projection = projectTraceEvents(events, "codex");
  const atomBySequence = new Map(
    projection.events.map((entry) => [entry.sequence, entry.atom]),
  );
  const allowed = new Set([
    ...Object.values(trajectoryKeyLabels),
    ...Object.values(trajectoryKindLabels),
  ]);

  for (const event of events) {
    const type = eventAtomType(event, "codex");
    assert.ok(type, `${event.eventName} has no atom type`);
    assert.ok(allowed.has(type.label), `${type.label} is not a known TYPE`);
    assert.notEqual(type.label, event.eventName);

    // The LOG badge must agree with the *atom data* in the projection, so it
    // can never drift into a second "event type" taxonomy.
    const primary = atomBySequence.get(
      projection.primarySequenceByTraceId.get(event.id) ?? -1,
    );
    assert.ok(primary, `${event.eventName} has no primary atom`);
    assert.equal(type.key, primary.key);
    assert.equal(type.kind, primary.kind);
    assert.equal(type.label, atomTypeLabel(primary.key, primary.kind));
  }
});

test("known events resolve through the atom map with normalised kinds", () => {
  const typeFor = (eventName: string) =>
    eventAtomType(
      events.find((event) => event.eventName === eventName)!,
      "codex",
    );

  // `observation` / `question` / `telemetry` are projection-layer aliases;
  // the badge reports the normalised kind so it matches the trajectory row.
  assert.deepEqual(typeFor("PreToolUse"), {
    key: "tool.call",
    kind: "tool",
    label: "TOOL",
  });
  assert.deepEqual(typeFor("PostToolUse"), {
    key: "tool.result",
    kind: "context",
    label: "MEMORY",
  });
  assert.deepEqual(typeFor("Reasoning"), {
    key: "model.invoke",
    kind: "model",
    label: "MODEL",
  });
  assert.deepEqual(typeFor("UserPromptSubmit"), {
    key: "run",
    kind: "loop",
    label: "SYSTEM",
  });
  assert.deepEqual(typeFor("Stop"), {
    key: "output.commit",
    kind: "reply",
    label: "RESPONSE",
  });
});

test("atom lookups are cached per platform, not rebuilt per row", () => {
  const first = eventAtomType(events[0], "codex");
  assert.equal(eventAtomType(events[0], "codex"), first);
  // All platforms share the same atom definition table in this build.
  assert.deepEqual(eventAtomType(events[0], "claude"), first);
  assert.equal(eventAtomType(events[0], "claude")?.label, first?.label);
});
