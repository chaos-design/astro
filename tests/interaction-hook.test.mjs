import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  buildHookOutput,
  buildRequest,
  notificationFor,
  optionsFromArgv,
  optionsFromEnvironment,
  parseHostPayload,
  runInteractionHook,
} from "../scripts/interaction-hook.mjs";

const projectDir = resolve(import.meta.dirname, "..");
const hookPath = join(projectDir, "scripts", "interaction-hook.mjs");

function questionPayload(eventName = "PermissionRequest", overrides = {}) {
  return {
    hook_event_name: eventName,
    session_id: "session-1",
    tool_name: "AskUserQuestion",
    tool_use_id: "call_001",
    cwd: "/workspace/demo",
    tool_input: {
      questions: [
        {
          question: "Which framework?",
          header: "Framework",
          options: [{ label: "React" }, { label: "Vue" }],
          multiSelect: false,
        },
        {
          question: "Deploy tonight?",
          header: "Deploy",
          options: [{ label: "Yes" }, { label: "No" }],
        },
      ],
    },
    ...overrides,
  };
}

function planPayload(overrides = {}) {
  return {
    hook_event_name: "PermissionRequest",
    session_id: "session-1",
    tool_name: "ExitPlanMode",
    tool_use_id: "call_plan",
    tool_input: {
      plan: "# Plan\n\nRun the tests.",
      planFilePath: "/workspace/plan.md",
      allowedPrompts: [{ tool: "Bash", prompt: "run tests" }],
    },
    ...overrides,
  };
}

function answeredResult(request, answers) {
  return {
    requestId: request.requestId,
    status: "answered",
    answers: {
      "Which framework?": "React",
      "Deploy tonight?": "No",
      ...answers,
    },
    answeredBy: "console",
    answeredAt: new Date().toISOString(),
    elapsedMs: 10,
  };
}

test("B1: unrelated tools and malformed input produce no output", async () => {
  assert.equal(parseHostPayload(questionPayload("PermissionRequest", { tool_name: "Bash" })), null);
  assert.equal(parseHostPayload({ hook_event_name: "PermissionRequest" }), null);
  assert.equal(parseHostPayload(null), null);

  const broken = await runInteractionHook("{not json", {
    env: {},
    fetchImpl: async () => {
      throw new Error("must not be called");
    },
  });
  assert.equal(broken.stdout, "");
  assert.equal(broken.reason, "invalid JSON");
});

test("B2: the hook registers the request and leaves the trace row to the recorder", async () => {
  const env = { ASTRO_INTERACTION_TIMEOUT_MS: "600", ASTRO_INTERACTION_SOURCE: "zcode" };
  const posts = [];
  const fetchImpl = async (url, init) => {
    posts.push({ url, body: JSON.parse(init.body) });
    return { ok: true, status: 201 };
  };
  const result = await runInteractionHook(JSON.stringify(questionPayload()), {
    env,
    fetchImpl,
    readResult: () => null,
  });
  assert.equal(result.stdout, "");

  // The recorder's PermissionRequest hook runs for the same host event. Writing
  // a second row here put two identical question rows in the LOG, so the
  // interaction hook only registers the request.
  assert.equal(
    posts.filter((post) => post.url.endsWith("/api/events")).length,
    0,
    "the recorder owns TraceEvent writes",
  );

  const registration = posts.find((post) => post.url.endsWith("/api/interactions"));
  assert.ok(registration, "request registered");
  assert.equal(registration.body.sessionId, "session-1");
  assert.equal(registration.body.toolUseId, "call_001");
  assert.equal(registration.body.questions[0].question, "Which framework?");
  assert.equal(registration.body.ttlMs, 100);
  assert.equal(registration.body.source, "zcode");
});

test("B3: a hit returns allow plus answers, a miss and a timeout stay silent", async () => {
  const env = { ASTRO_INTERACTION_TIMEOUT_MS: "1000" };
  const settings = optionsFromEnvironment(env);
  const built = buildRequest(questionPayload(), settings);
  const hit = await runInteractionHook(JSON.stringify(questionPayload()), {
    env,
    fetchImpl: async () => ({ ok: true, status: 201 }),
    readResult: () => answeredResult(built.request, { "Which framework?": "Vue" }),
  });
  const decision = JSON.parse(hit.stdout).hookSpecificOutput.decision;
  assert.equal(decision.behavior, "allow");
  assert.equal(decision.updatedInput.answers["Which framework?"], "Vue");

  const miss = await runInteractionHook(JSON.stringify(questionPayload()), {
    env,
    fetchImpl: async () => ({ ok: true, status: 201 }),
    readResult: () => null,
  });
  assert.equal(miss.stdout, "");
  assert.match(miss.reason, /no answer within the hook window/);

  let clock = 0;
  const timeout = await runInteractionHook(JSON.stringify(questionPayload()), {
    env,
    now: () => clock,
    sleep: async () => {
      clock += 200;
    },
    fetchImpl: async () => ({ ok: true, status: 201 }),
    readResult: () => null,
  });
  assert.equal(timeout.stdout, "");
  assert.ok(clock >= 500, `waited past the 500 ms window, saw ${clock}`);
});

test("B4: PreToolUse and PermissionRequest use their own stdout shapes", () => {
  const settings = { ...optionsFromEnvironment({}), events: ["PreToolUse", "PermissionRequest"] };
  const preBuilt = buildRequest(questionPayload("PreToolUse"), settings);
  const preResult = answeredResult(preBuilt.request, { "Which framework?": "React" });
  const pre = buildHookOutput(preBuilt.host, preBuilt.request, preResult)
    .hookSpecificOutput;
  assert.equal(pre.hookEventName, "PreToolUse");
  assert.equal(pre.permissionDecision, "allow");
  assert.equal(pre.updatedInput.answers["Which framework?"], "React");
  assert.equal(pre.decision, undefined);

  const permissionBuilt = buildRequest(questionPayload(), settings);
  const permission = buildHookOutput(
    permissionBuilt.host,
    permissionBuilt.request,
    answeredResult(permissionBuilt.request, { "Which framework?": "React" }),
  ).hookSpecificOutput;
  // PermissionRequest always nests the decision; the input-field switch is a
  // PreToolUse/CodeBuddy concern and must not leak into this shape.
  assert.equal(permission.hookEventName, "PermissionRequest");
  assert.equal(permission.decision.behavior, "allow");
  assert.equal(permission.updatedInput, undefined);
  assert.equal(permission.modifiedInput, undefined);
});

test("B4: CodeBuddy's modifiedInput is used for PreToolUse", () => {
  const settings = { ...optionsFromEnvironment({}), events: ["PreToolUse"] };
  const built = buildRequest(questionPayload("PreToolUse"), settings);
  const out = buildHookOutput(
    built.host,
    built.request,
    answeredResult(built.request, { "Which framework?": "React" }),
    { inputField: "modifiedInput" },
  ).hookSpecificOutput;
  assert.equal(out.modifiedInput.answers["Which framework?"], "React");
  assert.equal(out.updatedInput, undefined);
});

test("B5: ExitPlanMode echoes the plan and never injects answers", () => {
  const built = buildRequest(planPayload(), optionsFromEnvironment({}));
  const payload = planPayload().tool_input;
  const approved = buildHookOutput(
    built.host,
    built.request,
    answeredResult(built.request, { "Approve this plan?": "Approve" }),
  );
  const input = approved.hookSpecificOutput.decision.updatedInput;
  assert.equal(input.plan, payload.plan);
  assert.equal(input.planFilePath, payload.planFilePath);
  assert.deepEqual(input.allowedPrompts, payload.allowedPrompts);
  assert.equal(input.answers, undefined);

  const rejected = buildHookOutput(
    built.host,
    built.request,
    answeredResult(built.request, { "Approve this plan?": "Reject" }),
  );
  assert.equal(rejected, null);
});

test("B5: PreToolUse plan approval uses permissionDecision and echoes fields", () => {
  const settings = { ...optionsFromEnvironment({}), events: ["PreToolUse"] };
  const built = buildRequest(planPayload({ hook_event_name: "PreToolUse" }), settings);
  const out = buildHookOutput(
    built.host,
    built.request,
    answeredResult(built.request, { "Approve this plan?": "Approve" }),
  ).hookSpecificOutput;
  assert.equal(out.permissionDecision, "allow");
  assert.equal(out.updatedInput.plan, planPayload().tool_input.plan);
  assert.equal(out.updatedInput.answers, undefined);
});

test("E2: PreToolUse carries bounded suggestion channels and a decision reason", () => {
  const settings = { ...optionsFromEnvironment({}), events: ["PreToolUse"] };
  const built = buildRequest(questionPayload("PreToolUse"), settings);
  const result = answeredResult(built.request, {});
  const notification = notificationFor(built.host, built.request, result);
  assert.doesNotMatch(notification.summary, /React|No\b|Vue/);
  assert.match(notification.summary, /answered 2 questions/);
  assert.ok(notification.summary.length <= 500);

  const output = buildHookOutput(built.host, built.request, result, {
    notification,
  });
  const out = output.hookSpecificOutput;
  assert.equal(out.permissionDecisionReason, "Answered in the ASTRO console");
  assert.equal(out.additionalContext, notification.summary);
  assert.equal(output.systemMessage, notification.systemMessage);
  assert.ok(out.additionalContext.length <= 10000);
  assert.ok(output.systemMessage.length <= 10000);
  assert.equal(out.updatedInput.answers["Which framework?"], "React");
});

test("E2: host strings are clamped to the 10,000 character limit", () => {
  const settings = { ...optionsFromEnvironment({}), events: ["PreToolUse"] };
  const built = buildRequest(questionPayload("PreToolUse"), settings);
  const output = buildHookOutput(
    built.host,
    built.request,
    answeredResult(built.request, {}),
    {
      notification: {
        summary: "x".repeat(12000),
        systemMessage: "y".repeat(12000),
      },
    },
  );
  assert.equal(output.hookSpecificOutput.additionalContext.length, 10000);
  assert.equal(output.systemMessage.length, 10000);
});

test("F2: --source and --input-field override the environment", async () => {
  assert.deepEqual(
    optionsFromArgv(["--source=zcode", "--input-field=modifiedInput"]),
    { source: "zcode", inputField: "modifiedInput" },
  );
  assert.deepEqual(optionsFromArgv(["--input-field=bogus"]), {});
  const posts = [];
  const env = {
    ASTRO_INTERACTION_SOURCE: "claude",
    ASTRO_INTERACTION_INPUT_FIELD: "updatedInput",
    ASTRO_INTERACTION_TIMEOUT_MS: "600",
  };
  await runInteractionHook(JSON.stringify(questionPayload("PreToolUse")), {
    env,
    settings: optionsFromArgv([
      "--source=workbuddy",
      "--input-field=modifiedInput",
    ]),
    fetchImpl: async (url, init) => {
      posts.push({ url, body: JSON.parse(init.body) });
      return { ok: true, status: 201 };
    },
    readResult: () => null,
  });
  const request = posts.find((post) => post.url.endsWith("/api/interactions"));
  assert.equal(request.body.source, "workbuddy");
});

test("F2: --timeout seconds widen the answer window on the registered request", async () => {
  assert.deepEqual(optionsFromArgv(["--timeout=600"]), { timeoutMs: 600000 });
  assert.deepEqual(optionsFromArgv(["--timeout=bogus"]), {});
  assert.deepEqual(optionsFromArgv(["--timeout=0"]), {});
  const posts = [];
  let clock = 0;
  await runInteractionHook(JSON.stringify(questionPayload()), {
    env: {},
    settings: optionsFromArgv(["--timeout=30"]),
    now: () => clock,
    sleep: async () => {
      clock += 1000;
    },
    fetchImpl: async (url, init) => {
      posts.push({ url, body: JSON.parse(init.body) });
      return { ok: true, status: 201 };
    },
    readResult: () => null,
  });
  const request = posts.find((post) => post.url.endsWith("/api/interactions"));
  assert.equal(request.body.ttlMs, 29500, "30 s minus the 500 ms margin");
});

function zcodePlanPayload(overrides = {}) {
  // ZCode payloads are Claude-compatible camelCase JSON on stdin.
  return {
    hookEventName: "PermissionRequest",
    sessionId: "session-zcode",
    toolName: "ExitPlanMode",
    toolCallId: "call_zcode_plan",
    toolInput: {
      plan: "# Plan\n\nShip the console.",
    },
    ...overrides,
  };
}

test("B2: ZCode's camelCase toolCallId reaches the request as toolUseId", () => {
  const built = buildRequest(zcodePlanPayload(), optionsFromEnvironment({}));
  assert.ok(built, "a ZCode plan approval parses");
  assert.equal(built.host.toolUseId, "call_zcode_plan");
  assert.equal(built.request.toolUseId, "call_zcode_plan");
  assert.equal(built.request.questions[0].question, "Approve this plan?");

  const question = buildRequest(
    zcodePlanPayload({
      toolName: "AskUserQuestion",
      toolInput: {
        questions: [
          {
            question: "Which framework?",
            header: "Framework",
            options: [{ label: "React" }, { label: "Vue" }],
          },
        ],
      },
    }),
    optionsFromEnvironment({}),
  );
  assert.equal(question.request.toolUseId, "call_zcode_plan");
  assert.equal(question.request.questions[0].question, "Which framework?");
});

async function runHookCli(payload, env = {}) {
  const child = spawn(process.execPath, [hookPath], {
    env: { ...process.env, ASTRO_INTERACTION_SERVICE: "http://127.0.0.1:1", ...env },
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
  child.stdin.end(typeof payload === "string" ? payload : JSON.stringify(payload));
  const [status] = await once(child, "exit");
  return { status, stdout, stderr };
}

test("B6: four fail-open scenarios exit 0 with empty stdout", async () => {
  const home = mkdtempSync(join(tmpdir(), "astro-interaction-"));
  const probe = createServer((request, response) => {
    request.resume();
    request.on("end", () => {
      response.writeHead(201, { "Content-Type": "application/json" });
      response.end("{}");
    });
  });
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const port = probe.address().port;
  try {
    const env = { ASTRO_HOME: home, ASTRO_INTERACTION_TIMEOUT_MS: "600" };
    const cases = [
      ["invalid JSON", "{not json"],
      ["Bash", { hook_event_name: "PermissionRequest", tool_name: "Bash", tool_input: {} }],
      [
        "missing questions",
        {
          hook_event_name: "PermissionRequest",
          tool_name: "AskUserQuestion",
          tool_input: {},
        },
      ],
    ];
    for (const [label, input] of cases) {
      const result = await runHookCli(input, env);
      assert.equal(result.status, 0, `${label}: ${result.stderr}`);
      assert.equal(result.stdout, "", label);
    }
    // TTL expiry: the service accepts the registration but never writes a
    // result, so the hook must return empty stdout inside the hook window.
    const expired = await runHookCli(questionPayload(), {
      ...env,
      ASTRO_INTERACTION_SERVICE: `http://127.0.0.1:${port}`,
    });
    assert.equal(expired.status, 0);
    assert.equal(expired.stdout, "");
    assert.match(expired.stderr, /no answer within the hook window/);
  } finally {
    await new Promise((done) => probe.close(done));
    rmSync(home, { recursive: true, force: true });
  }
});

test("B6: a service that is down still yields the fail-open outcome", async () => {
  const home = mkdtempSync(join(tmpdir(), "astro-interaction-"));
  try {
    const result = await runHookCli(questionPayload(), {
      ASTRO_HOME: home,
      ASTRO_INTERACTION_TIMEOUT_MS: "600",
    });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /register:/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
