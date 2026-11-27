import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import plugin from "../opencode-plugin/index.ts";

const location = "/tmp/astro-opencode-index";

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

async function runEvents(events: any[]) {
  const astroHome = mkdtempSync(join(tmpdir(), "astro-opencode-index-home-"));
  const previousHome = process.env.ASTRO_HOME;
  const previousAutoOpen = process.env.ASTRO_AUTO_OPEN;
  process.env.ASTRO_HOME = astroHome;
  process.env.ASTRO_AUTO_OPEN = "0";

  let signalDone!: () => void;
  const done = new Promise<void>((resolve) => {
    signalDone = resolve;
  });
  async function* stream() {
    for (const event of events) {
      yield event;
    }
    signalDone();
  }
  const ctx = {
    location: { directory: location },
    event: { subscribe: () => stream() },
  };

  try {
    const cleanup = await plugin.setup(ctx);
    // Every yield drives emit synchronously; the generator finishing means all
    // events were processed. The 150ms write timer is still armed — cleanup
    // flushes it synchronously so the trace file is deterministic.
    await done;
    await cleanup();

    const eventsFile = collectFiles(astroHome).find((file) =>
      file.endsWith("events.jsonl"),
    );
    if (!eventsFile) {
      return [];
    }
    return readFileSync(eventsFile, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
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
}

const located = (type: string, data: Record<string, unknown>) => ({
  type,
  data: { sessionID: "ses_index", location: { directory: location }, ...data },
});

/**
 * `session.text.delta` is the only live carrier of assistant text. Without a
 * throttled streamed AgentMessage the console shows nothing until the step
 * ends — exactly the "messages not loading / not syncing live" symptom. This
 * is the regression guard for that carrier: the first delta snapshots now,
 * a burst inside the throttle window does not duplicate it, and the payload
 * is a `streamed` AgentMessage with the accumulated text.
 */
test("session.text.delta emits a throttled streamed AgentMessage snapshot", async () => {
  const events = await runEvents([
    located("session.created", {}),
    located("session.text.delta", { assistantMessageID: "m1", ordinal: 0, delta: "Hel" }),
    located("session.text.delta", { assistantMessageID: "m1", ordinal: 0, delta: "Hello" }),
  ]);
  const streamed = events.filter(
    (event) =>
      event.eventName === "AgentMessage" && event.payload.streamed === true,
  );
  assert.equal(streamed.length, 1, "one in-flight snapshot inside the window");
  assert.equal(streamed[0].payload.message, "Hel");
  // The snapshot shares its final message's reply id (message + text part).
  assert.equal(streamed[0].payload.messageId, "m1:0");
  assert.equal(streamed[0].sessionId, "ses_index");
  // Every event carries the installed adapter's own version, making a stale
  // (reinstalled but not restarted) process observable in /api/health.
  for (const event of events) {
    assert.equal(event.payload.captureVersion, "0.0.9", event.eventName);
  }
});

test("a streamed snapshot and its final message share one reply id", async () => {
  const events = await runEvents([
    located("session.created", {}),
    located("session.text.delta", {
      assistantMessageID: "m2",
      ordinal: 0,
      delta: "Hi",
    }),
    located("session.text.ended", {
      assistantMessageID: "m2",
      ordinal: 0,
      text: "Hi there",
    }),
  ]);
  const messages = events.filter((event) => event.eventName === "AgentMessage");
  assert.equal(messages.length, 2);
  // The whole point of messageId: the console folds these into one reply.
  assert.equal(messages[0].payload.messageId, "m2:0");
  assert.equal(messages[0].payload.messageId, messages[1].payload.messageId);
});

test("a delta without a host id does not persist a default messageId", async () => {
  const events = await runEvents([
    located("session.created", {}),
    located("session.text.delta", { delta: "Hel" }),
  ]);
  const streamed = events.filter(
    (event) =>
      event.eventName === "AgentMessage" && event.payload.streamed === true,
  );
  assert.equal(streamed.length, 1);
  assert.equal("messageId" in streamed[0].payload, false);
});

test("durable events without a location envelope use the remembered directory", async () => {
  // A main session created before the plugin loaded has text deltas with no
  // location. They must inherit the directory learned from session.created;
  // otherwise the location gate drops every message of that session.
  const events = await runEvents([
    located("session.created", {}),
    {
      type: "session.text.delta",
      data: { sessionID: "ses_index", messageID: "m2", delta: "live" },
    },
  ]);
  const streamed = events.filter(
    (event) =>
      event.eventName === "AgentMessage" && event.payload.streamed === true,
  );
  assert.equal(streamed.length, 1);
  assert.equal(streamed[0].payload.message, "live");
  assert.equal(streamed[0].cwd, location);
});

test("a foreign location never claims this instance's session", async () => {
  const events = await runEvents([
    located("session.created", {}),
    {
      type: "session.text.delta",
      data: {
        sessionID: "ses_index",
        messageID: "m3",
        delta: "foreign",
        location: { directory: "/some/other/project" },
      },
    },
  ]);
  assert.equal(
    events.length,
    1,
    "only SessionStart from the matching event; the foreign delta is dropped",
  );
  assert.equal(events[0].eventName, "SessionStart");
});
