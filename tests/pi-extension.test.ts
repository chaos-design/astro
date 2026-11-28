import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import extension from "../pi-plugin/index.ts";

type Handler = (event: any, ctx: any) => void | Promise<void>;

function loadExtension() {
  const handlers = new Map<string, Handler>();
  extension({
    on: (event: string, handler: Handler) => {
      handlers.set(event, handler);
    },
  });
  return handlers;
}

function createContext() {
  return {
    cwd: "/tmp/astro-pi-smoke",
    sessionManager: {
      getSessionId: () => "session-1",
      getCwd: () => "/tmp/astro-pi-smoke",
    },
  };
}

function collectFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(full, out);
    } else {
      out.push(full);
    }
  }
  return out;
}

test("observes the expected Pi lifecycle events", () => {
  const handlers = loadExtension();
  for (const event of [
    "session_start",
    "input",
    "before_agent_start",
    "message_start",
    "message_update",
    "message_end",
    "tool_call",
    "tool_result",
    "user_bash",
    "model_select",
    "session_before_compact",
    "session_compact",
    "session_shutdown",
  ]) {
    assert.equal(handlers.has(event), true, event);
  }
});

test("records a session into the pi trace root and claims it", async () => {
  const astroHome = mkdtempSync(join(tmpdir(), "astro-pi-smoke-home-"));
  const previousHome = process.env.ASTRO_HOME;
  const previousAutoOpen = process.env.ASTRO_AUTO_OPEN;
  process.env.ASTRO_HOME = astroHome;
  process.env.ASTRO_AUTO_OPEN = "0";
  const handlers = loadExtension();
  const ctx = createContext();
  try {
    await handlers.get("session_start")!({ reason: "startup" }, ctx);
    await handlers.get("input")!({ text: "hello" }, ctx);
    await handlers.get("before_agent_start")!({ prompt: "hello" }, ctx);
    await handlers.get("message_end")!(
      {
        message: {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "hmm" },
            { type: "text", text: "hi" },
          ],
          model: "model-1",
          provider: "provider-1",
          stopReason: "stop",
        },
      },
      ctx,
    );
    // A second prompt opens a new run. Its Stop is a distinct terminal event
    // and must not be deduped against the first turn's Stop.
    await handlers.get("input")!({ text: "again" }, ctx);
    await handlers.get("before_agent_start")!({ prompt: "again" }, ctx);
    await handlers.get("message_end")!(
      {
        message: {
          role: "assistant",
          content: [{ type: "text", text: "again" }],
          stopReason: "stop",
        },
      },
      ctx,
    );
    await handlers.get("tool_call")!(
      { toolCallId: "t1", toolName: "read", input: { path: "/x" } },
      ctx,
    );
    await handlers.get("tool_result")!(
      { toolCallId: "t1", toolName: "read", isError: false, content: [] },
      ctx,
    );
    await handlers.get("session_shutdown")!({ reason: "quit" }, ctx);

    const claimFile = join(astroHome, "pi", ".claims", "session-1.claim");
    assert.equal(existsSync(claimFile), true, "claim file");
    const eventsFile = collectFiles(astroHome).find(
      (file) => file.endsWith("events.jsonl"),
    );
    assert.ok(eventsFile, "events.jsonl under the pi trace root");

    const events = readFileSync(eventsFile, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.deepEqual(
      events.map((event) => event.eventName),
      [
        "SessionStart",
        "UserPromptSubmit",
        "Reasoning",
        "AgentMessage",
        "Stop",
        "UserPromptSubmit",
        "AgentMessage",
        "Stop",
        "PreToolUse",
        "PostToolUse",
        "SessionEnd",
      ],
    );
    const prompt = events.find(
      (event) => event.eventName === "UserPromptSubmit",
    );
    assert.equal(prompt.payload.prompt, "hello");
    for (const event of events) {
      assert.equal(event.sessionId, "session-1");
      assert.equal(event.source, "pi");
      assert.equal(event.cwd, "/tmp/astro-pi-smoke");
    }
  } finally {
    if (previousHome === undefined) {
      delete process.env.ASTRO_HOME;
    } else {
      process.env.ASTRO_HOME = previousHome;
    }
    if (previousAutoOpen === undefined) {
      delete process.env.ASTRO_AUTO_OPEN;
    } else {
      process.env.ASTRO_AUTO_OPEN = previousAutoOpen;
    }
    rmSync(astroHome, { recursive: true, force: true });
  }
});

test("records the main agent when the host context has no session manager", async () => {
  const astroHome = mkdtempSync(join(tmpdir(), "astro-pi-main-home-"));
  const previousHome = process.env.ASTRO_HOME;
  const previousAutoOpen = process.env.ASTRO_AUTO_OPEN;
  process.env.ASTRO_HOME = astroHome;
  process.env.ASTRO_AUTO_OPEN = "0";
  const handlers = loadExtension();
  // Pi Web / SDK hosts may not expose `ctx.sessionManager` at all.
  const ctx = { cwd: "/tmp/astro-pi-web" };
  try {
    await handlers.get("session_start")!({}, ctx);
    await handlers.get("input")!({ text: "main prompt" }, ctx);
    await handlers.get("before_agent_start")!({}, ctx);
    await handlers.get("message_end")!(
      {
        message: {
          role: "assistant",
          content: [{ type: "text", text: "main answer" }],
          stopReason: "stop",
        },
      },
      ctx,
    );
    await handlers.get("session_shutdown")!({}, ctx);

    const eventsFile = collectFiles(astroHome).find((file) =>
      file.endsWith("events.jsonl"),
    );
    assert.ok(eventsFile, "the main session is no longer silently dropped");
    const events = readFileSync(eventsFile, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.deepEqual(
      events.map((event) => event.eventName),
      ["SessionStart", "UserPromptSubmit", "AgentMessage", "Stop", "SessionEnd"],
    );
    assert.match(events[0].sessionId, /^pi-process-\d+/);
    assert.equal(
      events.find((event) => event.eventName === "UserPromptSubmit")?.payload.prompt,
      "main prompt",
    );
  } finally {
    if (previousHome === undefined) {
      delete process.env.ASTRO_HOME;
    } else {
      process.env.ASTRO_HOME = previousHome;
    }
    if (previousAutoOpen === undefined) {
      delete process.env.ASTRO_AUTO_OPEN;
    } else {
      process.env.ASTRO_AUTO_OPEN = previousAutoOpen;
    }
    rmSync(astroHome, { recursive: true, force: true });
  }
});

test("attributes a named subagent's messages to the parent session", async () => {
  const astroHome = mkdtempSync(join(tmpdir(), "astro-pi-subagent-home-"));
  const previous = {
    home: process.env.ASTRO_HOME,
    autoOpen: process.env.ASTRO_AUTO_OPEN,
    depth: process.env.PI_SUBAGENT_DEPTH,
    stack: process.env.PI_SUBAGENT_STACK,
    delegation: process.env.PI_SUBAGENT_DELEGATION,
  };
  process.env.ASTRO_HOME = astroHome;
  process.env.ASTRO_AUTO_OPEN = "0";
  process.env.PI_SUBAGENT_DEPTH = "1";
  process.env.PI_SUBAGENT_STACK = '["main","explore"]';
  process.env.PI_SUBAGENT_DELEGATION = JSON.stringify({
    version: 1,
    childSessionId: "subagent.child",
    parentSessionId: "main-parent",
    agent: "explore",
    handle: "auth",
  });
  const handlers = loadExtension();
  const ctx = createContext();
  ctx.sessionManager.getSessionId = () => "subagent.child";
  try {
    await handlers.get("session_start")!({}, ctx);
    await handlers.get("input")!({ text: "explore auth" }, ctx);
    await handlers.get("before_agent_start")!({}, ctx);
    await handlers.get("message_end")!(
      {
        message: {
          role: "assistant",
          content: [{ type: "text", text: "findings" }],
          stopReason: "stop",
        },
      },
      ctx,
    );
    await handlers.get("session_shutdown")!({}, ctx);

    const eventsFile = collectFiles(astroHome).find((file) =>
      file.endsWith("events.jsonl"),
    );
    assert.ok(eventsFile);
    const events = readFileSync(eventsFile, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    for (const event of events) {
      assert.equal(event.sessionId, "main-parent");
      assert.equal(event.payload.parentSessionId, "main-parent");
      assert.equal(event.payload.subagentAgent, "explore");
      assert.equal(event.payload.subagentSessionId, "subagent.child");
    }
    assert.equal(
      events.find((event) => event.eventName === "UserPromptSubmit")?.payload.prompt,
      "explore auth",
    );
    const claimFile = join(astroHome, "pi", ".claims", "subagent.child.claim");
    assert.equal(existsSync(claimFile), true, "the child session keeps its own claim");
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    rmSync(astroHome, { recursive: true, force: true });
  }
});

test("a non-assistant message_start cannot wipe a streaming assistant buffer", async () => {
  const astroHome = mkdtempSync(join(tmpdir(), "astro-pi-roles-home-"));
  const previousHome = process.env.ASTRO_HOME;
  const previousAutoOpen = process.env.ASTRO_AUTO_OPEN;
  process.env.ASTRO_HOME = astroHome;
  process.env.ASTRO_AUTO_OPEN = "0";
  const handlers = loadExtension();
  const ctx = createContext();
  ctx.sessionManager.getSessionId = () => "session-roles";
  try {
    await handlers.get("session_start")!({}, ctx);
    await handlers.get("input")!({ text: "prompt" }, ctx);
    await handlers.get("before_agent_start")!({}, ctx);
    await handlers.get("message_start")!(
      { message: { id: "m1", role: "assistant" } },
      ctx,
    );
    await handlers.get("message_update")!(
      { message: { id: "m1", role: "assistant", content: [{ type: "text", text: "Hel" }] } },
      ctx,
    );
    await handlers.get("message_start")!(
      { message: { id: "t1", role: "toolResult", content: [] } },
      ctx,
    );
    await new Promise((resolve) => setTimeout(resolve, 850));
    await handlers.get("message_update")!(
      { message: { id: "m1", role: "assistant", content: [{ type: "text", text: "Hello" }] } },
      ctx,
    );
    await handlers.get("message_end")!(
      {
        message: {
          id: "m1",
          role: "assistant",
          content: [{ type: "text", text: "Hello world" }],
          stopReason: "stop",
        },
      },
      ctx,
    );
    await handlers.get("session_shutdown")!({}, ctx);

    const eventsFile = collectFiles(astroHome).find((file) =>
      file.endsWith("events.jsonl"),
    );
    assert.ok(eventsFile);
    const events = readFileSync(eventsFile, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const streamed = events.filter(
      (event) => event.eventName === "AgentMessage" && event.payload.streamed,
    );
    assert.ok(streamed.length >= 2, "both updates survive the tool-result message");
    assert.deepEqual(
      streamed.map((event) => event.payload.message),
      ["Hel", "Hello"],
    );
  } finally {
    if (previousHome === undefined) {
      delete process.env.ASTRO_HOME;
    } else {
      process.env.ASTRO_HOME = previousHome;
    }
    if (previousAutoOpen === undefined) {
      delete process.env.ASTRO_AUTO_OPEN;
    } else {
      process.env.ASTRO_AUTO_OPEN = previousAutoOpen;
    }
    rmSync(astroHome, { recursive: true, force: true });
  }
});

test("streams accumulated text while the agent is still executing", async () => {
  const astroHome = mkdtempSync(join(tmpdir(), "astro-pi-live-home-"));
  const previousHome = process.env.ASTRO_HOME;
  const previousAutoOpen = process.env.ASTRO_AUTO_OPEN;
  process.env.ASTRO_HOME = astroHome;
  process.env.ASTRO_AUTO_OPEN = "0";
  const handlers = loadExtension();
  const ctx = createContext();
  const update = (text: string) =>
    handlers.get("message_update")!(
      {
        message: {
          id: "msg-live",
          role: "assistant",
          content: [{ type: "text", text }],
        },
      },
      ctx,
    );
  try {
    await handlers.get("session_start")!({}, ctx);
    await handlers.get("input")!({ text: "write code" }, ctx);
    await handlers.get("before_agent_start")!({ prompt: "write code" }, ctx);
    // Real Pi assistant messages carry no id — the recorder synthesizes one.
    await handlers.get("message_start")!(
      { message: { role: "assistant" } },
      ctx,
    );
    // First update emits immediately; the next one lands inside the throttle
    // window, so only one in-flight snapshot is written.
    await update("Hel");
    await update("Hello");
    await handlers.get("message_end")!(
      {
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Hello world" }],
          stopReason: "stop",
        },
      },
      ctx,
    );
    await handlers.get("session_shutdown")!({}, ctx);

    const eventsFile = collectFiles(astroHome).find((file) =>
      file.endsWith("events.jsonl"),
    );
    assert.ok(eventsFile, "events.jsonl under the pi trace root");
    const events = readFileSync(eventsFile, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.deepEqual(
      events.map((event) => event.eventName),
      [
        "SessionStart",
        "UserPromptSubmit",
        "AgentMessage",
        "AgentMessage",
        "Stop",
        "SessionEnd",
      ],
    );
    const streamed = events.filter((event) => event.payload.streamed === true);
    assert.equal(streamed.length, 1, "one throttled in-flight snapshot");
    assert.equal(streamed[0].payload.message, "Hel");
    const final = events.filter(
      (event) =>
        event.eventName === "AgentMessage" &&
        event.payload.streamed === undefined,
    );
    assert.equal(final.length, 1, "one final complete message");
    assert.equal(final[0].payload.message, "Hello world");
    // The snapshot and final message share the recorder-synthesized id even
    // though Pi's own message carried none.
    assert.match(streamed[0].payload.messageId, /^pi-/);
    assert.equal(streamed[0].payload.messageId, final[0].payload.messageId);
    // Every in-flight snapshot must be a prefix of the final text: that is
    // what "consistent" means here — no drift between live and recorded.
    assert.ok("Hello world".startsWith(streamed[0].payload.message));
  } finally {
    if (previousHome === undefined) {
      delete process.env.ASTRO_HOME;
    } else {
      process.env.ASTRO_HOME = previousHome;
    }
    if (previousAutoOpen === undefined) {
      delete process.env.ASTRO_AUTO_OPEN;
    } else {
      process.env.ASTRO_AUTO_OPEN = previousAutoOpen;
    }
    rmSync(astroHome, { recursive: true, force: true });
  }
});

test("a resumed session in a fresh extension instance gets new reply ids", async () => {
  const previousHome = process.env.ASTRO_HOME;
  const previousAutoOpen = process.env.ASTRO_AUTO_OPEN;
  // Each call simulates a separate Pi process: a fresh extension instance with
  // an empty per-session counter, writing into its own trace root.
  const replyIdOfFreshInstance = async (): Promise<string | undefined> => {
    const astroHome = mkdtempSync(join(tmpdir(), "astro-pi-resume-"));
    process.env.ASTRO_HOME = astroHome;
    process.env.ASTRO_AUTO_OPEN = "0";
    try {
      const handlers = loadExtension();
      const ctx = createContext();
      await handlers.get("session_start")!({}, ctx);
      await handlers.get("input")!({ text: "hello" }, ctx);
      await handlers.get("before_agent_start")!({ prompt: "hello" }, ctx);
      await handlers.get("message_start")!(
        { message: { role: "assistant" } },
        ctx,
      );
      await handlers.get("message_end")!(
        {
          message: {
            role: "assistant",
            content: [{ type: "text", text: "hi" }],
            stopReason: "stop",
          },
        },
        ctx,
      );
      await handlers.get("session_shutdown")!({}, ctx);
      const file = collectFiles(astroHome).find((entry) =>
        entry.endsWith("events.jsonl"),
      );
      assert.ok(file, "events.jsonl under the pi trace root");
      const events = readFileSync(file, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      return events.find((event) => event.eventName === "AgentMessage")?.payload
        .messageId;
    } finally {
      rmSync(astroHome, { recursive: true, force: true });
    }
  };
  try {
    const first = await replyIdOfFreshInstance();
    const second = await replyIdOfFreshInstance();
    assert.match(first ?? "", /^pi-/);
    assert.notEqual(
      first,
      second,
      "a new process must not reuse a previous process's reply id",
    );
  } finally {
    if (previousHome === undefined) {
      delete process.env.ASTRO_HOME;
    } else {
      process.env.ASTRO_HOME = previousHome;
    }
    if (previousAutoOpen === undefined) {
      delete process.env.ASTRO_AUTO_OPEN;
    } else {
      process.env.ASTRO_AUTO_OPEN = previousAutoOpen;
    }
  }
});

test("a live foreign owner keeps the session until it exits", async () => {
  const astroHome = mkdtempSync(join(tmpdir(), "astro-pi-smoke-claim-"));
  const previousHome = process.env.ASTRO_HOME;
  const previousAutoOpen = process.env.ASTRO_AUTO_OPEN;
  process.env.ASTRO_HOME = astroHome;
  process.env.ASTRO_AUTO_OPEN = "0";
  try {
    // Seed a claim owned by a live process (pid 1) so this instance loses
    // the race: the session stays foreign and nothing is recorded.
    const claimsDir = join(astroHome, "pi", ".claims");
    mkdirSync(claimsDir, { recursive: true });
    writeFileSync(
      join(claimsDir, "session-1.claim"),
      `${JSON.stringify({ pid: 1, claimedAt: new Date().toISOString() })}\n`,
      "utf8",
    );
    const handlers = loadExtension();
    const ctx = createContext();
    await handlers.get("session_start")!({ reason: "startup" }, ctx);
    await handlers.get("session_shutdown")!({ reason: "quit" }, ctx);
    assert.equal(
      collectFiles(astroHome).find((file) => file.endsWith("events.jsonl")),
      undefined,
    );

    // A resumed session is only taken over once the owning pid is gone.
    writeFileSync(
      join(claimsDir, "session-1.claim"),
      `${JSON.stringify({ pid: -1, claimedAt: new Date().toISOString() })}\n`,
      "utf8",
    );
    const resumed = loadExtension();
    await resumed.get("session_start")!({ reason: "startup" }, ctx);
    await resumed.get("session_shutdown")!({ reason: "quit" }, ctx);
    const recorded = collectFiles(astroHome).find(
      (file) => file.endsWith("events.jsonl"),
    );
    assert.ok(recorded, "a dead owner hands the session over");
  } finally {
    if (previousHome === undefined) {
      delete process.env.ASTRO_HOME;
    } else {
      process.env.ASTRO_HOME = previousHome;
    }
    if (previousAutoOpen === undefined) {
      delete process.env.ASTRO_AUTO_OPEN;
    } else {
      process.env.ASTRO_AUTO_OPEN = previousAutoOpen;
    }
    rmSync(astroHome, { recursive: true, force: true });
  }
});
