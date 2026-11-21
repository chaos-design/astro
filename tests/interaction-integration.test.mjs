import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import test from "node:test";

import {
  aggregateDecisionOutputs,
  buildInteractionRequest,
} from "../plugin/interaction-contract.mjs";
import { startServer } from "./helpers/interaction-server.mjs";

const projectDir = new URL("..", import.meta.url).pathname;
const hookPath = join(projectDir, "scripts", "interaction-hook.mjs");

function askPayload(overrides = {}) {
  return {
    hook_event_name: "PermissionRequest",
    session_id: "session-f4",
    tool_name: "AskUserQuestion",
    tool_use_id: "call_f4",
    cwd: "/workspace/demo",
    tool_input: {
      questions: [
        {
          question: "Which framework?",
          header: "Framework",
          options: [{ label: "React" }, { label: "Vue" }],
        },
      ],
    },
    ...overrides,
  };
}

async function runHook(payload, env) {
  const child = spawn(process.execPath, [hookPath], {
    env: { ...process.env, ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  child.stdin.end(JSON.stringify(payload));
  const [status] = await once(child, "exit");
  return { status, stdout, stderr };
}

async function waitForResultFile(home, timeoutMs = 2000) {
  const directory = join(home, "interactions");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let names = [];
    try {
      names = readdirSync(directory).filter(
        (name) => name.endsWith(".json") && !name.endsWith(".request.json"),
      );
    } catch {
      // The service creates the directory on boot; keep waiting.
    }
    if (names.length) {
      return JSON.parse(readFileSync(join(directory, names[0]), "utf8"));
    }
    await sleep(50);
  }
  return null;
}

test("F4: a Bash call is never intercepted and creates no interaction", async (t) => {
  const { url, home } = await startServer(t);
  const result = await runHook(
    askPayload({ tool_name: "Bash", tool_input: { command: "ls -la" } }),
    {
      ASTRO_INTERACTION_SERVICE: url,
      ASTRO_HOME: home,
      ASTRO_INTERACTION_TIMEOUT_MS: "700",
    },
  );
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "");
  const files = readdirSync(join(home, "interactions")).filter((name) =>
    name.endsWith(".json"),
  );
  assert.deepEqual(files, [], "no request or result file was written");
});

test("F4: an explicit deny outranks an allow from the interaction hook", () => {
  assert.equal(
    aggregateDecisionOutputs([
      { hookSpecificOutput: { permissionDecision: "allow" } },
      { hookSpecificOutput: { permissionDecision: "deny" } },
    ]),
    "deny",
  );
  assert.equal(
    aggregateDecisionOutputs([
      { hookSpecificOutput: { permissionDecision: "allow" } },
      { hookSpecificOutput: { permissionDecision: "ask" } },
    ]),
    "ask",
  );
  assert.equal(
    aggregateDecisionOutputs([
      {},
      { hookSpecificOutput: { permissionDecision: "allow" } },
    ]),
    "allow",
  );
  assert.equal(aggregateDecisionOutputs([{}, {}]), "none");
});

test("F4: a Notification hook returns no decision and exits 0", async (t) => {
  const { url, home } = await startServer(t);
  const result = await runHook(
    {
      hook_event_name: "Notification",
      session_id: "session-f4",
      message: "Waiting for input",
      notification_type: "idle",
    },
    {
      ASTRO_INTERACTION_SERVICE: url,
      ASTRO_HOME: home,
      ASTRO_INTERACTION_TIMEOUT_MS: "700",
    },
  );
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "");
  assert.deepEqual(readdirSync(join(home, "interactions")), []);
});

test("F4: no console attached closes the request at once and falls back", async (t) => {
  const { url, home } = await startServer(t);
  const started = Date.now();
  const result = await runHook(askPayload(), {
    ASTRO_INTERACTION_SERVICE: url,
    ASTRO_HOME: home,
    // 700 ms host timeout becomes a 200 ms interaction TTL.
    ASTRO_INTERACTION_TIMEOUT_MS: "700",
  });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "");
  assert.ok(Date.now() - started < 2000, "the hook returns inside its budget");

  const closed = await waitForResultFile(home);
  assert.ok(closed, "the service closed the request");
  // Nobody was attached to the stream, so the service closed the request as
  // `cancelled` at registration instead of waiting out the TTL.
  assert.equal(closed.status, "cancelled");
  assert.equal(closed.answeredBy, "service");
  assert.deepEqual(closed.answers, {});
});

test("F4: an attached console sees the request live until the TTL expires", async (t) => {
  const { url, home } = await startServer(t);
  const controller = new AbortController();
  const stream = await fetch(`${url}/api/stream`, {
    headers: { Accept: "text/event-stream" },
    signal: controller.signal,
  });
  assert.equal(stream.status, 200);
  // Wait for the ready frame so the client is registered before the hook
  // registers its request — otherwise this test would race the snapshot.
  const reader = stream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const chunk = await reader.read();
    buffer += decoder.decode(chunk.value, { stream: true });
    if (/event: ready/.test(buffer) || chunk.done) {
      break;
    }
  }
  assert.match(buffer, /event: ready/);
  try {
    const result = await runHook(askPayload(), {
      ASTRO_INTERACTION_SERVICE: url,
      ASTRO_HOME: home,
      ASTRO_INTERACTION_TIMEOUT_MS: "700",
    });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, "");
    const closed = await waitForResultFile(home);
    assert.ok(closed, "the service closed the request");
    assert.equal(closed.status, "timeout", "the TTL path still times out");
    assert.deepEqual(closed.answers, {});
  } finally {
    controller.abort();
  }
});

test("F4: WorkBuddy answers a real request through PreToolUse.modifiedInput", async (t) => {
  const { url, home } = await startServer(t);
  const controller = new AbortController();
  const stream = await fetch(`${url}/api/stream`, {
    headers: { Accept: "text/event-stream" },
    signal: controller.signal,
  });
  assert.equal(stream.status, 200);
  const reader = stream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const payload = {
    hook_event_name: "PreToolUse",
    session_id: "wb-e2e",
    tool_name: "AskUserQuestion",
    tool_use_id: "call_wb_e2e",
    cwd: "/workspace/demo",
    tool_input: {
      questions: [
        {
          header: "Language",
          question: "Which language?",
          options: [{ label: "Python" }, { label: "Go" }],
        },
      ],
    },
  };
  const hook = runHook(payload, {
    ASTRO_INTERACTION_SERVICE: url,
    ASTRO_HOME: home,
    ASTRO_INTERACTION_TIMEOUT_MS: "3000",
    ASTRO_INTERACTION_INPUT_FIELD: "modifiedInput",
    ASTRO_INTERACTION_SOURCE: "workbuddy",
    ASTRO_INTERACTION_EVENTS: "PreToolUse",
    ASTRO_INTERACTION_TOOLS: "AskUserQuestion",
  });

  try {
    // The hook registers on the same stream the console is attached to; wait
    // for its open frame before answering, or the service would fast-fail it.
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) {
        throw new Error("stream ended before interaction.open");
      }
      buffer += decoder.decode(chunk.value, { stream: true });
      if (/event: interaction\.open/.test(buffer)) {
        break;
      }
    }
    const dataLine = buffer
      .split("\n")
      .find((line) => line.startsWith("data: ") && line.includes("requestId"));
    assert.ok(dataLine, "interaction.open carries the request");
    const request = JSON.parse(dataLine.slice("data: ".length));

    const answer = await fetch(
      `${url}/api/interactions/${request.requestId}/events`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId: request.requestId,
          eventId: "iev-wb-1",
          seq: 1,
          action: "submit",
          final: true,
          deviceId: "console",
          at: new Date().toISOString(),
          question: "Which language?",
          optionLabel: "Python",
          answers: { "Which language?": "Python" },
        }),
      },
    );
    assert.equal(answer.status, 202);
    assert.equal((await answer.json()).result.status, "answered");

    const result = await hook;
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.hookSpecificOutput.permissionDecision, "allow");
    assert.deepEqual(
      output.hookSpecificOutput.modifiedInput.answers,
      { "Which language?": "Python" },
    );
    assert.equal(output.hookSpecificOutput.updatedInput, undefined);
    assert.equal(output.hookSpecificOutput.additionalContext, undefined);
  } finally {
    controller.abort();
  }
});

test("F4: the last console leaving cancels an open request instead of blocking the host", async (t) => {
  const { url, home } = await startServer(t);
  const controller = new AbortController();
  const stream = await fetch(`${url}/api/stream`, {
    headers: { Accept: "text/event-stream" },
    signal: controller.signal,
  });
  assert.equal(stream.status, 200);
  const reader = stream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const hook = runHook(askPayload(), {
    ASTRO_INTERACTION_SERVICE: url,
    ASTRO_HOME: home,
    ASTRO_INTERACTION_TIMEOUT_MS: "4000",
  });
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) {
        throw new Error("stream ended before interaction.open");
      }
      buffer += decoder.decode(chunk.value, { stream: true });
      if (/event: interaction\.open/.test(buffer)) {
        break;
      }
    }

    // Closing the tab is the last thing the reader does; nobody can answer a
    // request whose open frame will never be replayed on reconnect.
    controller.abort();
    const started = Date.now();
    const result = await hook;
    assert.equal(result.status, 0);
    assert.equal(result.stdout, "", result.stderr);
    assert.ok(Date.now() - started < 2000, "the hook breaks out of its long window");

    const closed = await waitForResultFile(home);
    assert.equal(closed.status, "cancelled");
    assert.equal(closed.answeredBy, "service");
    assert.deepEqual(closed.answers, {});
  } finally {
    controller.abort();
  }
});

test("F4: reconnecting inside the grace window keeps a live question", async (t) => {
  const { url, home } = await startServer(t);
  const firstController = new AbortController();
  const first = await fetch(`${url}/api/stream`, {
    headers: { Accept: "text/event-stream" },
    signal: firstController.signal,
  });
  const reader = first.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const hook = runHook(askPayload(), {
    ASTRO_INTERACTION_SERVICE: url,
    ASTRO_HOME: home,
    ASTRO_INTERACTION_TIMEOUT_MS: "3000",
  });

  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) {
        throw new Error("stream ended before interaction.open");
      }
      buffer += decoder.decode(chunk.value, { stream: true });
      if (/event: interaction\.open/.test(buffer)) {
        break;
      }
    }
    const line = buffer
      .split("\n")
      .find((item) => item.startsWith("data: ") && item.includes("requestId"));
    const request = JSON.parse(line.slice("data: ".length));

    // A one-second blip must not cancel a question the reader can still see
    // after EventSource reconnects.
    firstController.abort();
    const secondController = new AbortController();
    const second = await fetch(`${url}/api/stream`, {
      headers: { Accept: "text/event-stream" },
      signal: secondController.signal,
    });
    assert.equal(second.status, 200);
    await second.body.cancel();

    const submitted = await fetch(
      `${url}/api/interactions/${request.requestId}/events`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId: request.requestId,
          eventId: "iev-reconnect-1",
          seq: 1,
          action: "submit",
          final: true,
          deviceId: "console",
          at: new Date().toISOString(),
          question: "Which framework?",
          optionLabel: "React",
          answers: { "Which framework?": "React" },
        }),
      },
    );
    assert.equal(submitted.status, 202, "the request survived the reconnect");
    assert.equal((await submitted.json()).result.status, "answered");
    const output = JSON.parse((await hook).stdout);
    assert.equal(
      output.hookSpecificOutput.decision.updatedInput.answers["Which framework?"],
      "React",
    );
    secondController.abort();
  } finally {
    firstController.abort();
  }
});

test("F4: a service that is down still fails open", async () => {
  const home = new URL("./__missing__", import.meta.url).pathname;
  const result = await runHook(askPayload(), {
    ASTRO_INTERACTION_SERVICE: "http://127.0.0.1:1",
    ASTRO_HOME: home,
    ASTRO_INTERACTION_TIMEOUT_MS: "700",
  });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /\[astro:interaction\] no decision/);
});

// A request id is deterministic from its host fields; the integration test
// does not need it, but pinning the shape keeps the helper honest if the
// service ever starts requiring a different id.
test("F4: the interaction request keeps its deterministic host identity", () => {
  const request = buildInteractionRequest({
    hookEventName: "PermissionRequest",
    toolName: "AskUserQuestion",
    toolUseId: "call_f4",
    sessionId: "session-f4",
    source: "claude",
    questions: askPayload().tool_input.questions,
  });
  assert.match(request.requestId, /^irq-[a-z0-9]{8,64}$/);
  assert.equal(request.toolName, "AskUserQuestion");
  assert.equal(request.questions[0].question, "Which framework?");
});
