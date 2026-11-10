import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import * as plugin from "../deepseek-plugin/index.js";

const { adaptDeepseekEvent, apply } = plugin;

function findTraceFile(root) {
  const entries = readdirSync(root, { recursive: true });
  return entries
    .map((entry) => join(root, entry))
    .find((entry) => entry.endsWith("events.jsonl"));
}

function createSession() {
  return {
    id: "deepseek-session",
    header: {
      id: "deepseek-session",
      version: 3,
      createdAt: Date.parse("2026-09-09T08:00:00.000Z"),
      cwd: "/tmp/deepseek-project",
      isSeeded: false,
    },
  };
}

test("maps DeepSeek Harness session events to ASTRO semantics", () => {
  const session = createSession();
  const prompt = adaptDeepseekEvent(session, {
    type: "user/message",
    seq: 1,
    time: Date.parse("2026-09-09T08:00:01.000Z"),
    data: {
      content: [{ type: "text", text: "Inspect this project" }],
      source: { kind: "user" },
    },
  });
  const tool = adaptDeepseekEvent(session, {
    type: "tool/call",
    seq: 2,
    time: Date.parse("2026-09-09T08:00:02.000Z"),
    data: {
      turn: 1,
      step: 1,
      callId: "call-1",
      name: "shell",
      arguments: "{\"command\":\"pwd\"}",
    },
  });
  const failure = adaptDeepseekEvent(session, {
    type: "tool/result",
    seq: 3,
    time: Date.parse("2026-09-09T08:00:03.000Z"),
    data: {
      turn: 1,
      step: 1,
      message: {
        content: [
          {
            type: "tool-result",
            toolCallId: "call-1",
            content: [{ type: "text", text: "failed" }],
            isError: true,
          },
        ],
      },
    },
  });

  assert.equal(prompt.eventName, "UserPromptSubmit");
  assert.equal(prompt.payload.prompt, "Inspect this project");
  assert.equal(tool.eventName, "PreToolUse");
  assert.deepEqual(tool.payload.tool_input, { command: "pwd" });
  assert.equal(failure.eventName, "PostToolUseFailure");
  assert.equal(failure.toolUseId, "call-1");
});

test("captures a complete DeepSeek Harness turn in the local trace store", (t) => {
  const astroHome = mkdtempSync(join(tmpdir(), "astro-deepseek-plugin-"));
  t.after(() => rmSync(astroHome, { recursive: true, force: true }));
  const handlers = new Map();
  const warnings = [];
  const ctx = {
    logger: { warn: (message) => warnings.push(message) },
    on(name, handler) {
      handlers.set(name, handler);
    },
  };
  apply(ctx, { astroHome, autoOpen: false });

  const session = createSession();
  handlers.get("session/created")(session);
  handlers.get("session/event")(session, {
    type: "user/message",
    seq: 0,
    time: Date.parse("2026-09-09T08:00:01.000Z"),
    data: {
      turn: 1,
      content: [{ type: "text", text: "Continue" }],
      source: { kind: "user" },
    },
  });
  handlers.get("session/event")(session, {
    type: "assistant/message",
    seq: 1,
    time: Date.parse("2026-09-09T08:00:02.000Z"),
    data: {
      turn: 1,
      step: 1,
      message: {
        content: [{ type: "text", text: "Done" }],
        source: { kind: "model", provider: "deepseek", model: "v4" },
      },
    },
  });
  handlers.get("session/event")(session, {
    type: "turn/end",
    seq: 2,
    time: Date.parse("2026-09-09T08:00:03.000Z"),
    data: { turn: 1, reason: { kind: "completed" } },
  });
  handlers.get("session/disposed")(session);

  const traceFile = findTraceFile(join(astroHome, "deepseek"));
  const events = readFileSync(traceFile, "utf8")
    .trim()
    .split("\n")
    .map(JSON.parse);
  assert.deepEqual(
    events.map((event) => event.eventName),
    ["SessionStart", "UserPromptSubmit", "AgentMessage", "Stop", "SessionEnd"],
  );
  assert.ok(events.every((event) => event.source === "deepseek"));
  assert.equal(warnings.length, 0);
});

test("carries the turn identity across events that omit it", (t) => {
  // The Harness stamps `data.turn` on turn/start, step/*, tool calls and
  // turn/end only. The prompt and the inbox notifications inside the same turn
  // arrive without it, and recording them as `turnId: null` left one logical
  // turn split across two identities — the LOG then had to guess a boundary
  // from whichever neighbour happened to carry a number.
  const astroHome = mkdtempSync(join(tmpdir(), "astro-deepseek-turn-"));
  t.after(() => rmSync(astroHome, { recursive: true, force: true }));
  const handlers = new Map();
  const ctx = {
    logger: { warn() {} },
    on(name, handler) {
      handlers.set(name, handler);
    },
  };
  apply(ctx, { astroHome, autoOpen: false });

  const session = createSession();
  const send = (type, seq, data) =>
    handlers.get("session/event")(session, {
      type,
      seq,
      time: Date.parse("2026-09-09T08:00:00.000Z") + seq * 1000,
      data,
    });

  handlers.get("session/created")(session);
  send("turn/start", 0, { turn: 6 });
  // No `turn` on this one: it still belongs to turn 6.
  send("user/message", 1, {
    content: [{ type: "text", text: "继续" }],
    source: { kind: "user" },
  });
  send("agent/inbox/spliced", 2, { inserted: [] });
  send("tool/call", 3, { callId: "call-1", name: "read", arguments: "{}" });
  send("turn/end", 4, { turn: 6, reason: { kind: "completed" } });
  // Between turns the identity is gone again: do not attribute it to turn 6.
  send("agent/inbox/spliced", 5, { inserted: [] });

  const events = readFileSync(findTraceFile(join(astroHome, "deepseek")), "utf8")
    .trim()
    .split("\n")
    .map(JSON.parse)
    .filter((event) => event.eventName !== "SessionEnd");
  assert.deepEqual(
    events.map((event) => [event.nativeEventName, event.turnId]),
    [
      ["session/created", null],
      ["turn/start", "6"],
      ["user/message", "6"],
      ["agent/inbox/spliced", "6"],
      ["tool/call", "6"],
      ["turn/end", "6"],
      ["agent/inbox/spliced", null],
    ],
  );
});

test("an event's own turn number wins over the carried one", () => {
  const session = createSession();
  const event = adaptDeepseekEvent(
    session,
    {
      type: "turn/start",
      seq: 9,
      time: Date.parse("2026-09-09T08:00:09.000Z"),
      data: { turn: 7 },
    },
    "6",
  );
  assert.equal(event.turnId, "7");
  // With no number of its own the carried turn is used …
  const prompt = adaptDeepseekEvent(
    session,
    {
      type: "user/message",
      seq: 10,
      time: Date.parse("2026-09-09T08:00:10.000Z"),
      data: { content: [{ type: "text", text: "go" }], source: { kind: "user" } },
    },
    "7",
  );
  assert.equal(prompt.turnId, "7");
  // … and with neither, the event stays turn-less instead of inventing one.
  const orphan = adaptDeepseekEvent(session, {
    type: "agent/inbox/spliced",
    seq: 11,
    time: Date.parse("2026-09-09T08:00:11.000Z"),
    data: {},
  });
  assert.equal(orphan.turnId, null);
});

test("does not gate activation on the sessions service", () => {
  // dsh leaves entries whose injected services never resolve PENDING without
  // failing startup. Capture only subscribes to events, so it must not declare
  // a service dependency that can silently prevent apply() from running.
  assert.equal(plugin.inject, undefined);
});

test("keeps session listeners alive when the runtime config cannot be loaded", (t) => {
  const loader = createRequire(import.meta.url)(
    "../deepseek-plugin/plugin/runtime-config.cjs",
  );
  const original = loader.loadRuntimeConfig;
  loader.loadRuntimeConfig = () => {
    throw new Error("broken config.yaml");
  };
  t.after(() => {
    loader.loadRuntimeConfig = original;
  });

  const handlers = new Map();
  const warnings = [];
  const ctx = {
    logger: { warn: (message) => warnings.push(message) },
    on(name, handler) {
      handlers.set(name, handler);
    },
  };

  const astroHome = mkdtempSync(join(tmpdir(), "astro-dsh-config-"));
  t.after(() => rmSync(astroHome, { recursive: true, force: true }));
  apply(ctx, { astroHome, autoOpen: false });

  assert.deepEqual([...handlers.keys()].sort(), [
    "session/created",
    "session/disposed",
    "session/event",
  ]);
  assert.ok(
    warnings.some((message) => /runtime config could not be loaded/i.test(message)),
  );
});
