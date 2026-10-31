import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

async function startServer(t) {
  const root = mkdtempSync(join(tmpdir(), "astro-http-boundary-"));
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const child = spawn(process.execPath, ["server/server.mjs"], {
    env: {
      ...process.env, ASTRO_HOME: root, ASTRO_PORT: String(port),
      ASTRO_HOST: "127.0.0.1", ASTRO_MAX_BODY_BYTES: "256",
      ASTRO_OPEN_BROWSER: "0", ASTRO_TRACE_DIR: "", AGENT_TRACE_DIR: "", TRAE_TRACE_DIR: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exited = once(child, "exit");
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  t.after(async () => {
    child.kill("SIGTERM");
    await exited;
    rmSync(root, { recursive: true, force: true });
  });
  let output = "";
  for await (const chunk of child.stdout) {
    output += chunk;
    if (output.includes("ASTRO:")) break;
  }
  assert.match(output, /ASTRO:/, stderr);
  return `http://127.0.0.1:${port}`;
}

test("health reports the release the service was started from", async (t) => {
  // The installed runtime ships `plugin.json` instead of a package manifest,
  // so `build` must never regress to "unknown" for a normal start.
  const url = await startServer(t);
  const health = await (await fetch(`${url}/api/health`)).json();
  const { version } = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.equal(health.build, version);
});

test("malformed percent encoding returns 400 without terminating the service", async (t) => {
  const url = await startServer(t);
  for (const path of ["/api/events/%ZZ", "/%ZZ"]) {
    const response = await fetch(`${url}${path}`, { signal: AbortSignal.timeout(3000) });
    assert.equal(response.status, 400);
    assert.equal((await fetch(`${url}/api/health`)).status, 200);
  }
});

test("oversized requests return 413 and later requests still succeed", async (t) => {
  const url = await startServer(t);
  const response = await fetch(`${url}/api/events`, {
    method: "POST", body: JSON.stringify({ prompt: "x".repeat(1024) }),
    headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(3000),
  });
  assert.equal(response.status, 413);
  assert.match((await response.json()).error, /too large/i);
  const malformed = await fetch(`${url}/api/events`, { method: "POST", body: "{" });
  assert.equal(malformed.status, 400);
  assert.equal((await fetch(`${url}/api/health`)).status, 200);
});

/** Reads one SSE event by name, then drops the connection. */
async function readStreamEvent(url, eventName) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      for (const block of buffer.split("\n\n")) {
        if (new RegExp(`^event: ${eventName}$`, "m").test(block)) {
          const data = /^data: (.*)$/m.exec(block)?.[1];
          return JSON.parse(data);
        }
      }
    }
    throw new Error(`stream ended before ${eventName}`);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

test("a resume cursor replays only the missed tail", async (t) => {
  const url = await startServer(t);
  const append = async (eventName) => {
    const response = await fetch(`${url}/api/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        eventName,
        source: "claude",
        sessionId: "sess-resume",
        payload: {},
      }),
    });
    assert.equal(response.status, 202);
    return (await response.json()).events[0].id;
  };

  const firstId = await append("UserPromptSubmit");
  const snapshot = await readStreamEvent(`${url}/api/stream`, "reset");
  assert.deepEqual(snapshot.events.map((event) => event.id), [firstId]);

  const secondId = await append("Stop");
  const resumed = await readStreamEvent(
    `${url}/api/stream?since=${encodeURIComponent(firstId)}`,
    "resume",
  );
  assert.deepEqual(resumed.events.map((event) => event.id), [secondId]);

  // A cursor the server cannot place falls back to the full snapshot.
  const fallback = await readStreamEvent(
    `${url}/api/stream?since=unknown-event`,
    "reset",
  );
  assert.deepEqual(
    fallback.events.map((event) => event.id),
    [firstId, secondId],
  );
});
