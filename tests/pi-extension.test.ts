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
    // The second closed turn reports the same terminal event; only the new
    // agent message is kept.
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
        "AgentMessage",
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
    await handlers.get("message_start")!(
      { message: { id: "msg-live", role: "assistant" } },
      ctx,
    );
    // First update emits immediately; the next one lands inside the throttle
    // window, so only one in-flight snapshot is written.
    await update("Hel");
    await update("Hello");
    await handlers.get("message_end")!(
      {
        message: {
          id: "msg-live",
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
