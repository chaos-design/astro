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

test("F4: no answer within the window falls back to the host prompt", async (t) => {
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
  assert.equal(closed.status, "timeout");
  assert.deepEqual(closed.answers, {});
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
