import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  adaptDeepseekEvent,
  apply,
} from "../deepseek-plugin/index.js";

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
