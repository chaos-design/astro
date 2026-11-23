import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

const projectDir = resolve(import.meta.dirname, "..");
const hookPath = join(projectDir, "scripts", "auto-approve-question-hook.mjs");
const installerPath = join(
  projectDir,
  "scripts",
  "install-auto-approve-hook.mjs",
);
const {
  buildDecision,
  optionsFromEnvironment,
} = await import("../scripts/auto-approve-question-hook.mjs");
const { mergeHookConfig, removeHookConfig, validateHookConfig } = await import(
  "../scripts/install-auto-approve-hook.mjs"
);

function questionPayload(eventName = "PermissionRequest", overrides = {}) {
  return {
    hook_event_name: eventName,
    session_id: "session-1",
    tool_name: "AskUserQuestion",
    tool_input: {
      questions: [
        {
          question: "Which framework?",
          header: "Framework",
          options: [
            { label: "React", description: "Component library" },
            { label: "Vue", description: "Progressive framework" },
          ],
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
    tool_name: "ExitPlanMode",
    tool_input: {
      plan: "# Plan\n\n## Step 1\n\nRun the test suite.",
      allowedPrompts: [{ tool: "Bash", prompt: "run tests" }],
    },
    reason: "Tool ExitPlanMode requires user interaction",
    ...overrides,
  };
}

test("PreToolUse answers AskUserQuestion and echoes the original questions", () => {
  const decision = buildDecision(questionPayload("PreToolUse"));
  const out = decision.hookSpecificOutput;
  assert.equal(out.hookEventName, "PreToolUse");
  assert.equal(out.permissionDecision, "allow");
  assert.deepEqual(out.updatedInput.answers, {
    "Which framework?": "React",
    "Deploy tonight?": "Yes",
  });
  assert.equal(out.updatedInput.questions.length, 2);
  assert.equal(out.updatedInput.questions[0].header, "Framework");
});

test("PermissionRequest carries the allow decision inside decision.behavior", () => {
  const out = buildDecision(questionPayload()).hookSpecificOutput;
  assert.equal(out.hookEventName, "PermissionRequest");
  assert.equal(out.decision.behavior, "allow");
  assert.equal(out.decision.updatedInput.answers["Which framework?"], "React");
  assert.equal(out.permissionDecision, undefined);
});

test("ExitPlanMode echoes the Markdown plan unchanged", () => {
  const out = buildDecision(planPayload()).hookSpecificOutput;
  assert.equal(out.decision.behavior, "allow");
  assert.equal(out.decision.updatedInput.plan, planPayload().tool_input.plan);
  assert.deepEqual(
    out.decision.updatedInput.allowedPrompts,
    planPayload().tool_input.allowedPrompts,
  );
});

test("ZCode camelCase fields resolve the same way", () => {
  const out = buildDecision({
    hookEventName: "PermissionRequest",
    toolName: "ExitPlanMode",
    toolInput: { plan: "## Ship it" },
  }).hookSpecificOutput;
  assert.equal(out.decision.updatedInput.plan, "## Ship it");
});

test("environment options choose the answer, tools and input field", () => {
  const options = optionsFromEnvironment({
    ASTRO_AUTO_APPROVE_ANSWER: "last",
    ASTRO_AUTO_APPROVE_INPUT_FIELD: "modifiedInput",
    ASTRO_AUTO_APPROVE_TOOLS: "AskUserQuestion,ExitPlanMode",
    ASTRO_AUTO_APPROVE_EVENTS: "PreToolUse|PermissionRequest",
  });
  assert.equal(options.answer, "last");
  assert.equal(options.inputField, "modifiedInput");
  assert.deepEqual(options.tools, ["AskUserQuestion", "ExitPlanMode"]);
  assert.deepEqual(options.events, ["PreToolUse", "PermissionRequest"]);
  const out = buildDecision(questionPayload("PreToolUse"), options)
    .hookSpecificOutput;
  assert.equal(out.updatedInput, undefined);
  assert.equal(out.modifiedInput.answers["Which framework?"], "Vue");
});

test("answer=all joins option labels with commas for multi-select", () => {
  const payload = {
    hook_event_name: "PermissionRequest",
    tool_name: "AskUserQuestion",
    tool_input: {
      questions: [
        {
          question: "Pick tools",
          options: [{ label: "A" }, { label: "B" }, { label: "C" }],
          multiSelect: true,
        },
      ],
    },
  };
  const all = buildDecision(payload, { answer: "all" }).hookSpecificOutput;
  assert.equal(all.decision.updatedInput.answers["Pick tools"], "A, B, C");
  const first = buildDecision(payload, { answer: "first" }).hookSpecificOutput;
  assert.equal(first.decision.updatedInput.answers["Pick tools"], "A");
});

test("a configured answer map overrides automatic selection", () => {
  const options = optionsFromEnvironment({
    ASTRO_AUTO_APPROVE_ANSWER: "last",
    ASTRO_AUTO_APPROVE_ANSWERS: JSON.stringify({
      "Which framework?": "Vue",
      "Deploy tonight?": ["Yes", "No"],
    }),
  });
  assert.equal(options.answer, "last");
  assert.deepEqual(options.answerMap["Deploy tonight?"], ["Yes", "No"]);
  const out = buildDecision(questionPayload(), options).hookSpecificOutput;
  assert.equal(out.decision.updatedInput.answers["Which framework?"], "Vue");
  assert.equal(out.decision.updatedInput.answers["Deploy tonight?"], "Yes, No");
  // A question missing from the map still uses the configured fallback.
  const partial = buildDecision(questionPayload(), {
    answer: "last",
    answerMap: { "Which framework?": "React" },
  }).hookSpecificOutput;
  assert.equal(partial.decision.updatedInput.answers["Deploy tonight?"], "No");
});

test("a malformed answer map falls back to automatic selection", () => {
  const options = optionsFromEnvironment({
    ASTRO_AUTO_APPROVE_ANSWERS: "{not json",
    ASTRO_AUTO_APPROVE_ANSWER: "all",
  });
  assert.equal(options.answerMap, null);
  assert.equal(options.answer, "all");
  const out = buildDecision(questionPayload(), options).hookSpecificOutput;
  assert.equal(
    out.decision.updatedInput.answers["Which framework?"],
    "React, Vue",
  );
});

// The host owns hook aggregation; this mirrors the documented precedence
// (deny > ask > allow) to show that a neutral recorder output cannot dilute
// the decision hook's allow, and that a real deny still wins.
function aggregate(outputs) {
  const decisions = outputs
    .map((output) => {
      const specific = output?.hookSpecificOutput;
      return specific?.permissionDecision ?? specific?.decision?.behavior ?? "";
    })
    .filter(Boolean);
  if (decisions.includes("deny")) return "deny";
  if (decisions.includes("ask")) return "ask";
  if (decisions.includes("allow")) return "allow";
  return "none";
}

test("aggregation keeps allow with a neutral recorder and honours deny > ask", () => {
  const recorder = { continue: true };
  const allow = buildDecision(questionPayload());
  const deny = {
    hookSpecificOutput: {
      hookEventName: "PermissionRequest",
      decision: { behavior: "deny" },
    },
  };
  const ask = {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "ask",
    },
  };
  assert.equal(aggregate([recorder, allow]), "allow");
  assert.equal(aggregate([recorder, allow, ask]), "ask");
  assert.equal(aggregate([recorder, allow, ask, deny]), "deny");
});

test("unmatched events, tools and incomplete payloads produce no decision", () => {
  assert.equal(buildDecision(questionPayload("PostToolUse")), null);
  assert.equal(
    buildDecision(questionPayload("PermissionRequest", { tool_name: "Bash" })),
    null,
  );
  assert.equal(buildDecision({ ...questionPayload(), tool_input: {} }), null);
  assert.equal(
    buildDecision({
      ...questionPayload(),
      tool_input: { questions: [{ question: "Pick one", options: [] }] },
    }),
    null,
  );
  assert.equal(buildDecision(null), null);
  assert.equal(buildDecision(planPayload({ tool_input: undefined })), null);
});

function runHook(payload, env = {}) {
  return spawnSync(process.execPath, [hookPath], {
    input: typeof payload === "string" ? payload : JSON.stringify(payload),
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

test("the hook command writes a JSON decision and exits 0", () => {
  const result = runHook(questionPayload());
  assert.equal(result.status, 0);
  const out = JSON.parse(result.stdout).hookSpecificOutput;
  assert.equal(out.decision.behavior, "allow");
  assert.equal(out.decision.updatedInput.answers["Which framework?"], "React");
});

test("CodeBuddy modifiedInput works through the CLI", () => {
  const result = runHook(questionPayload("PreToolUse"), {
    ASTRO_AUTO_APPROVE_INPUT_FIELD: "modifiedInput",
  });
  assert.equal(result.status, 0);
  const out = JSON.parse(result.stdout).hookSpecificOutput;
  assert.equal(out.modifiedInput.answers["Which framework?"], "React");
  assert.equal(out.updatedInput, undefined);
});

test("the hook stays silent for unrelated events and on malformed input", () => {
  const unrelated = runHook({ hook_event_name: "PostToolUse", tool_name: "Bash" });
  assert.equal(unrelated.status, 0);
  assert.equal(unrelated.stdout, "");
  const broken = runHook("{not json");
  assert.equal(broken.status, 0);
  assert.equal(broken.stdout, "");
  assert.match(broken.stderr, /no decision/);
});

test("the hook never emits ASTRO recorder output", () => {
  // The recorder owns {continue:true}; the decision hook must stay a separate
  // handler so multiple hooks on one event do not fight over stdout.
  const out = runHook(questionPayload()).stdout;
  assert.equal(out.includes('"continue"'), false);
});

test("merging preserves existing hooks and is idempotent", () => {
  const existing = {
    permissions: { defaultMode: "default" },
    hooks: {
      PermissionRequest: [
        { matcher: "Bash", hooks: [{ type: "command", command: "echo keep" }] },
      ],
      PostToolUse: [{ hooks: [{ type: "command", command: "echo format" }] }],
    },
  };
  const first = mergeHookConfig(existing, "claude", { hookPath });
  assert.equal(first.added, true);
  assert.equal(first.config.hooks.PermissionRequest.length, 2);
  assert.equal(first.config.hooks.PermissionRequest[0].hooks[0].command, "echo keep");
  assert.deepEqual(first.config.hooks.PostToolUse, existing.hooks.PostToolUse);
  assert.equal(first.config.permissions.defaultMode, "default");
  assert.match(
    first.config.hooks.PermissionRequest[1].hooks[0].command,
    /auto-approve-question-hook\.mjs/,
  );
  const second = mergeHookConfig(first.config, "claude", { hookPath });
  assert.equal(second.added, false);
  assert.equal(second.config.hooks.PermissionRequest.length, 2);
});

test("ZCode config uses hooks.events and enables hooks at the user level", () => {
  const existing = { theme: "dark", hooks: { timeoutMs: 60000 } };
  const result = mergeHookConfig(existing, "zcode", { hookPath });
  assert.equal(result.config.hooks.enabled, true);
  assert.equal(result.config.hooks.timeoutMs, 60000);
  assert.equal(result.config.hooks.events.PermissionRequest.length, 1);
  assert.equal(result.config.theme, "dark");
  const handler = result.config.hooks.events.PermissionRequest[0].hooks[0];
  assert.equal(handler.type, "process");
  assert.equal(handler.command, "node");
  assert.deepEqual(handler.args, [hookPath]);
  assert.equal(
    mergeHookConfig(result.config, "zcode", { hookPath }).added,
    false,
  );
});

test("validateHookConfig accepts merged Claude and ZCode configs", () => {
  const claude = mergeHookConfig({}, "claude", { hookPath }).config;
  assert.deepEqual(validateHookConfig(claude, "claude"), {
    valid: true,
    errors: [],
  });
  const zcode = mergeHookConfig({}, "zcode", { hookPath }).config;
  assert.deepEqual(validateHookConfig(zcode, "zcode"), {
    valid: true,
    errors: [],
  });
});

test("validateHookConfig rejects a disabled ZCode config, '*' matcher and missing group", () => {
  const zcode = mergeHookConfig({}, "zcode", { hookPath }).config;
  zcode.hooks.enabled = false;
  assert.match(validateHookConfig(zcode, "zcode").errors.join(), /hooks\.enabled/);
  zcode.hooks.enabled = true;
  zcode.hooks.events.PermissionRequest[0].matcher = "*";
  assert.match(validateHookConfig(zcode, "zcode").errors.join(), /matcher/);
  assert.match(
    validateHookConfig({}, "zcode").errors.join(),
    /hooks must be an object/,
  );
  assert.match(
    validateHookConfig({ hooks: { PermissionRequest: [] } }, "claude").errors.join(),
    /decision-hook group is missing/,
  );
});

test("removeHookConfig keeps unrelated hooks and is idempotent", () => {
  const existing = {
    permissions: { defaultMode: "default" },
    hooks: {
      PermissionRequest: [
        { matcher: "Bash", hooks: [{ type: "command", command: "echo keep" }] },
      ],
      PostToolUse: [{ hooks: [{ type: "command", command: "echo format" }] }],
    },
  };
  const installed = mergeHookConfig(existing, "claude", { hookPath }).config;
  const removed = removeHookConfig(installed, "claude", { hookPath });
  assert.equal(removed.removed, 1);
  assert.equal(removed.config.hooks.PermissionRequest.length, 1);
  assert.equal(
    removed.config.hooks.PermissionRequest[0].hooks[0].command,
    "echo keep",
  );
  assert.deepEqual(
    removed.config.hooks.PostToolUse,
    existing.hooks.PostToolUse,
  );
  assert.equal(removed.config.permissions.defaultMode, "default");
  const again = removeHookConfig(removed.config, "claude", { hookPath });
  assert.equal(again.removed, 0);
  assert.deepEqual(again.config, removed.config);
});

test("ZCode removal drops only the owned event group", () => {
  const config = {
    hooks: {
      enabled: true,
      events: {
        PreToolUse: [
          { hooks: [{ type: "process", command: "node", args: ["other.mjs"] }] },
        ],
      },
    },
  };
  const installed = mergeHookConfig(config, "zcode", { hookPath }).config;
  const removed = removeHookConfig(installed, "zcode", { hookPath });
  assert.equal(removed.removed, 1);
  assert.equal(removed.config.hooks.events.PermissionRequest, undefined);
  assert.equal(removed.config.hooks.events.PreToolUse.length, 1);
  assert.equal(removed.config.hooks.enabled, true);
});

test("unsupported clients are rejected", () => {
  assert.throws(() => mergeHookConfig({}, "unknown"), /unsupported client/);
  assert.throws(() => removeHookConfig({}, "unknown"), /unsupported client/);
  assert.equal(validateHookConfig({}, "unknown").valid, false);
});

test("the installer is dry-run by default and backs up on --apply", () => {
  const home = mkdtempSync(join(tmpdir(), "astro-auto-approve-"));
  try {
    const target = join(home, ".claude", "settings.json");
    const args = ["--client=claude", `--home=${home}`, "--settings=" + target];
    const dry = spawnSync(process.execPath, [installerPath, ...args], {
      encoding: "utf8",
    });
    assert.equal(dry.status, 0);
    assert.match(dry.stdout, /dry run: no file written/);
    assert.equal(existsSync(target), false);

    const applied = spawnSync(
      process.execPath,
      [installerPath, ...args, "--apply"],
      { encoding: "utf8" },
    );
    assert.equal(applied.status, 0);
    const saved = JSON.parse(readFileSync(target, "utf8"));
    assert.equal(saved.hooks.PermissionRequest.length, 1);

    const again = spawnSync(
      process.execPath,
      [installerPath, ...args, "--apply"],
      { encoding: "utf8" },
    );
    assert.equal(again.status, 0);
    assert.match(again.stdout, /already installed/);
    assert.equal(
      JSON.parse(readFileSync(target, "utf8")).hooks.PermissionRequest.length,
      1,
    );
    assert.equal(
      readdirSync(dirname(target)).filter((name) =>
        name.startsWith("settings.json.astro-backup-"),
      ).length,
      1,
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("the installer --remove --apply strips only its own handler", () => {
  const home = mkdtempSync(join(tmpdir(), "astro-auto-approve-"));
  try {
    const target = join(home, ".claude", "settings.json");
    const args = ["--client=claude", `--home=${home}`, "--settings=" + target];
    const applied = spawnSync(
      process.execPath,
      [installerPath, ...args, "--apply"],
      { encoding: "utf8" },
    );
    assert.equal(applied.status, 0);

    const dryRemove = spawnSync(
      process.execPath,
      [installerPath, ...args, "--remove"],
      { encoding: "utf8" },
    );
    assert.equal(dryRemove.status, 0);
    assert.match(dryRemove.stdout, /dry run: no file written/);
    assert.equal(
      JSON.parse(readFileSync(target, "utf8")).hooks.PermissionRequest.length,
      1,
    );

    const removed = spawnSync(
      process.execPath,
      [installerPath, ...args, "--remove", "--apply"],
      { encoding: "utf8" },
    );
    assert.equal(removed.status, 0);
    assert.match(removed.stdout, /1 decision-hook handler\(s\) removed/);
    const saved = JSON.parse(readFileSync(target, "utf8"));
    assert.equal(saved.hooks.PermissionRequest, undefined);
    assert.equal(
      readdirSync(dirname(target)).filter((name) =>
        name.startsWith("settings.json.astro-backup-"),
      ).length,
      1,
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
