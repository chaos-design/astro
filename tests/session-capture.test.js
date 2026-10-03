import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import recorder from "../plugin/trace-recorder.cjs";
import { TraceRepository } from "../server/trace-repository.mjs";

const projectDir = resolve(import.meta.dirname, "..");
const recorderFile = join(projectDir, "plugin", "trace-recorder.cjs");

function captureHook(environment, eventName, source = "trae") {
  return spawnSync(process.execPath, [recorderFile, `--source=${source}`], {
    input: JSON.stringify({
      session_id: "followup-session",
      hook_event_name: eventName,
      cwd: projectDir,
      ...(eventName === "UserPromptSubmit" ? { prompt: "Continue" } : {}),
      ...(eventName === "Stop" ? { last_assistant_message: "Done" } : {}),
    }),
    encoding: "utf8",
    env: { ...process.env, ...environment, ASTRO_AUTO_OPEN: "0" },
    timeout: 5000,
  });
}

function createEnvironment(t) {
  const root = mkdtempSync(join(tmpdir(), "astro-followup-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return {
    ASTRO_HOME: root,
    ASTRO_TRACE_DIR: "",
    AGENT_TRACE_DIR: "",
    TRAE_TRACE_DIR: "",
  };
}

async function startServer(t, environment) {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const port = probe.address().port;
  await new Promise((resolveClose) => probe.close(resolveClose));
  const child = spawn(process.execPath, [join(projectDir, "server", "server.mjs")], {
    env: {
      ...process.env,
      ...environment,
      ASTRO_PORT: String(port),
      ASTRO_HOST: "127.0.0.1",
      ASTRO_OPEN_BROWSER: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exited = once(child, "exit");
  t.after(async () => {
    child.kill("SIGTERM");
    await exited;
  });
  let output = "";
  for await (const chunk of child.stdout) {
    output += chunk;
    if (output.includes("ASTRO:")) break;
  }
  assert.match(output, /ASTRO:/);
  return `http://127.0.0.1:${port}`;
}

async function readHandshake(url, { onReady, traceCount = 0 } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  const messages = [];
  try {
    const response = await fetch(`${url}/api/stream`, { signal: controller.signal });
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let text = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      text += value;
      let boundary;
      while ((boundary = text.indexOf("\n\n")) >= 0) {
        const block = text.slice(0, boundary);
        text = text.slice(boundary + 2);
        const lines = block.split("\n");
        const name = lines.find((line) => line.startsWith("event: "))?.slice(7);
        const data = lines.find((line) => line.startsWith("data: "))?.slice(6);
        if (!name || !data) continue;
        messages.push({ name, data: JSON.parse(data) });
        if (name === "ready") {
          await onReady?.();
          if (!traceCount) return messages;
        }
        if (traceCount && messages.filter((message) => message.name === "trace").length === traceCount) {
          return messages;
        }
      }
    }
    return messages;
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}

test("records repeated identical questions and answers after Stop in every hook client", async (t) => {
  const environment = createEnvironment(t);
  const repository = new TraceRepository(environment, { pollInterval: 10 });
  t.after(() => repository.stop());
  await repository.initialize();
  repository.start();

  for (const source of ["trae", "claude", "codex", "workbuddy"]) {
    for (const eventName of ["UserPromptSubmit", "Stop", "UserPromptSubmit", "Stop"]) {
      assert.equal(captureHook(environment, eventName, source).status, 0);
      await repository.discover();
    }
  }
  await t.waitFor(() => assert.equal(repository.getEvents().length, 16));
  for (const source of ["trae", "claude", "codex", "workbuddy"]) {
    const events = repository.getEvents().filter((event) => event.source === source);
    assert.deepEqual(events.map((event) => event.eventName), [
      "UserPromptSubmit", "Stop", "UserPromptSubmit", "Stop",
    ]);
    assert.equal(new Set(events.map((event) => event.id)).size, 4);
    assert.equal(new Set(events.map((event) => event.sessionId)).size, 1);
  }
});

test("reports failed persistence without blocking the agent", (t) => {
  const environment = createEnvironment(t);
  const blockedPath = join(environment.ASTRO_HOME, "not-a-directory");
  writeFileSync(blockedPath, "");
  const result = captureHook({ ...environment, ASTRO_HOME: blockedPath }, "UserPromptSubmit");
  assert.equal(result.status, 0);
  assert.equal(JSON.parse(result.stdout).continue, true);
  assert.match(JSON.parse(result.stdout).systemMessage, /not recorded/i);
  assert.match(result.stderr, /ASTRO.*not recorded/i);
  assert.doesNotMatch(result.stderr, /Continue/);
});

test("keeps quiet hooks silent on stdout while reporting persistence errors", (t) => {
  const environment = createEnvironment(t);
  const blockedPath = join(environment.ASTRO_HOME, "not-a-directory");
  writeFileSync(blockedPath, "");
  const result = spawnSync(process.execPath, [recorderFile, "--source=codex", "--quiet"], {
    input: JSON.stringify({ session_id: "followup-session", hook_event_name: "Stop" }),
    encoding: "utf8",
    env: { ...process.env, ...environment, ASTRO_HOME: blockedPath, ASTRO_AUTO_OPEN: "0" },
    timeout: 5000,
  });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /ASTRO.*not recorded/i);
  assert.equal(result.stderr.trim().split("\n").length, 1);
});

test("streams every followup prompt and answer on the same open connection", async (t) => {
  const environment = createEnvironment(t);
  captureHook(environment, "SessionStart");
  const url = await startServer(t, environment);
  const names = ["UserPromptSubmit", "Stop", "UserPromptSubmit", "Stop"];
  const messages = await readHandshake(url, {
    traceCount: names.length,
    onReady: () => {
      for (const name of names) {
        assert.equal(captureHook(environment, name).status, 0);
      }
    },
  });
  const events = messages.filter((message) => message.name === "trace").map((message) => message.data);
  assert.deepEqual(events.map((event) => event.eventName), names);
  assert.equal(new Set(events.map((event) => event.id)).size, names.length);
});

test("sends a complete snapshot on first connection and after a missed followup turn", async (t) => {
  const environment = createEnvironment(t);
  const firstTurn = ["UserPromptSubmit", "Stop"].map((eventName) =>
    recorder.appendTraceEvent({
      session_id: "followup-session",
      hook_event_name: eventName,
    }, environment, { source: "trae" }),
  );
  const url = await startServer(t, environment);
  const first = await readHandshake(url);
  assert.deepEqual(first.map((message) => message.name), ["reset", "ready"]);
  assert.deepEqual(first[0].data.map((event) => event.id).sort(), firstTurn.map((event) => event.id).sort());

  const nextTurn = ["UserPromptSubmit", "Stop"].map((eventName) =>
    recorder.appendTraceEvent({
      session_id: "followup-session",
      hook_event_name: eventName,
    }, environment, { source: "trae" }),
  );
  await t.waitFor(async () => {
    const response = await fetch(`${url}/api/health`);
    assert.equal((await response.json()).eventCount, 4);
  });
  const second = await readHandshake(url);
  assert.deepEqual(second.map((message) => message.name), ["reset", "ready"]);
  assert.equal(second[1].data.eventCount, 4);
  assert.deepEqual(
    second[0].data.map((event) => event.id).sort(),
    [...firstTurn, ...nextTurn].map((event) => event.id).sort(),
  );
  const traceFile = recorder.resolveTraceFile(firstTurn[0], environment, { source: "trae" });
  assert.equal(readFileSync(traceFile, "utf8").trim().split("\n").length, 4);
});
