#!/usr/bin/env node
/**
 * Repeatable equivalence check for the real-host acceptance item (plan F3).
 *
 * This script feeds real captured hook payloads to the real hook processes and
 * checks the generated host configuration against Claude Code / ZCode /
 * CodeBuddy Code schemas. It does NOT replace launching a host: `/hooks`
 * visibility, transcript wording and the ZCode session log still need a host
 * binary. Run it on a machine with those binaries for the remaining F3 steps.
 */

import { spawnSync } from "node:child_process";
import { existsSync, globSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseHostPayload, buildRequest, buildHookOutput } from "./interaction-hook.mjs";
import { buildInteractionResult } from "../plugin/interaction-contract.mjs";

const root = resolve(import.meta.dirname, "..");
const checks = [];

function check(name, fn) {
  try {
    const detail = fn();
    checks.push({ name, status: "pass", detail: detail || "" });
  } catch (error) {
    checks.push({ name, status: "fail", detail: error.message });
  }
}

function realPayload() {
  const traces = globSync(join(homedir(), ".astrox", "zcode", "**", "events.jsonl"));
  for (const file of traces) {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (!line.trim()) continue;
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      const payload = event?.payload;
      if (
        event?.eventName === "PermissionRequest" &&
        (payload?.toolName === "AskUserQuestion" || payload?.tool_name === "AskUserQuestion") &&
        Array.isArray(payload?.tool_input?.questions)
      ) {
        return { payload, path: file };
      }
    }
  }
  return null;
}

const captured = realPayload();
const payload = captured?.payload ?? {
  hook_event_name: "PermissionRequest",
  tool_name: "AskUserQuestion",
  tool_use_id: "call_fixture",
  tool_input: {
    questions: [
      {
        question: "Which framework?",
        header: "Framework",
        options: [{ label: "React" }, { label: "Vue" }],
        multiSelect: false,
      },
    ],
  },
};

check("captured payload source", () => {
  if (!captured) {
    return "no local ZCode trace; inline fixture used";
  }
  return `${captured.path} (${payload.tool_input.questions.length} questions)`;
});

function spawnHook(script, input) {
  return spawnSync(process.execPath, [join(root, "scripts", script)], {
    input: JSON.stringify(input),
    encoding: "utf8",
    cwd: root,
    env: { ...process.env, ASTRO_AUTO_APPROVE_REQUEST_TIMEOUT_MS: "600" },
  });
}

check("auto-approve hook emits a real-host PermissionRequest decision", () => {
  const result = spawnHook("auto-approve-question-hook.mjs", payload);
  if (result.status !== 0) {
    throw new Error(`exit ${result.status}: ${result.stderr.trim()}`);
  }
  const output = JSON.parse(result.stdout);
  const decision = output.hookSpecificOutput?.decision;
  if (decision?.behavior !== "allow" || !decision.updatedInput?.answers) {
    throw new Error("missing decision.behavior allow or updatedInput.answers");
  }
  const answers = decision.updatedInput.answers;
  for (const question of payload.tool_input.questions) {
    if (!(question.question in answers)) {
      throw new Error(`answer key does not match question text: ${question.question}`);
    }
  }
  return `${Object.keys(answers).length} answers, keys match question text`;
});

check("interaction hook fails open with no host service", () => {
  const result = spawnHook("interaction-hook.mjs", payload);
  if (result.status !== 0) {
    throw new Error(`exit ${result.status}: ${result.stderr.trim()}`);
  }
  if (result.stdout !== "") {
    throw new Error(`expected empty stdout, got: ${result.stdout.slice(0, 120)}`);
  }
  return "empty stdout, exit 0 (host prompt remains)";
});

check("interaction decision matches Claude PreToolUse schema", () => {
  const host = parseHostPayload({ ...payload, hook_event_name: "PreToolUse" });
  const { request } = buildRequest({ ...payload, hook_event_name: "PreToolUse" });
  const answers = Object.fromEntries(
    payload.tool_input.questions.map((q) => [q.question, q.options[0].label ?? q.options[0]]),
  );
  const result = buildInteractionResult(request, "answered", answers, { answeredBy: "console" });
  const output = buildHookOutput(host, request, result);
  if (output?.hookSpecificOutput?.permissionDecision !== "allow") {
    throw new Error("missing permissionDecision allow");
  }
  if (!output.hookSpecificOutput.updatedInput?.answers) {
    throw new Error("missing updatedInput.answers");
  }
  return "permissionDecision + updatedInput.answers";
});

check("interaction decision matches ZCode strict PermissionRequest schema", () => {
  const host = parseHostPayload(payload);
  const { request } = buildRequest(payload);
  const answers = Object.fromEntries(
    payload.tool_input.questions.map((q) => [q.question, q.options[0].label ?? q.options[0]]),
  );
  const result = buildInteractionResult(request, "answered", answers, { answeredBy: "console" });
  const output = buildHookOutput(host, request, result);
  const decision = output?.hookSpecificOutput?.decision;
  if (decision?.behavior !== "allow" || !decision.updatedInput?.answers) {
    throw new Error("missing decision.behavior allow or updatedInput.answers");
  }
  const keys = Object.keys(output);
  const nested = Object.keys(output.hookSpecificOutput);
  if (keys.join() !== "hookSpecificOutput" || nested.join() !== "hookEventName,decision") {
    throw new Error(`unexpected ZCode stdout keys: ${keys}/${nested}`);
  }
  return "hookSpecificOutput.decision.behavior, strict key set";
});

check("installer generates valid Claude / ZCode / CodeBuddy configurations", () => {
  const home = mkdtempSync(join(tmpdir(), "astro-host-acceptance-"));
  try {
    const generated = {};
    for (const client of ["claude", "zcode", "codebuddy"]) {
      const result = spawnSync(
        process.execPath,
        [
          join(root, "scripts", "install-interaction-hook.mjs"),
          `--client=${client}`,
          `--home=${home}`,
        ],
        { encoding: "utf8", cwd: root },
      );
      if (result.status !== 0) {
        throw new Error(`${client} installer exit ${result.status}: ${result.stderr.trim()}`);
      }
      if (!result.stdout.includes("dry run: no file written")) {
        throw new Error(`${client} installer is not dry-run by default`);
      }
      generated[client] = JSON.parse(result.stdout.split("\n#")[0]);
    }
    const claudeGroup = generated.claude.hooks.PermissionRequest?.[0];
    if (!claudeGroup?.hooks?.[0]?.command?.includes("interaction-hook.mjs")) {
      throw new Error("Claude config lacks a command handler");
    }
    const zcode = generated.zcode.hooks;
    if (zcode.enabled !== true || zcode.events?.PermissionRequest?.[0]?.hooks?.[0]?.type !== "process") {
      throw new Error("ZCode config lacks enabled/events process handler");
    }
    const codebuddy = generated.codebuddy.hooks.PreToolUse?.[0]?.hooks?.[0];
    if (
      codebuddy?.type !== "command" ||
      !codebuddy.command?.includes("--input-field=modifiedInput") ||
      generated.codebuddy.hooks.PermissionRequest
    ) {
      throw new Error(
        "CodeBuddy must register PreToolUse with a modifiedInput command",
      );
    }
    return "claude command / zcode events+enabled / codebuddy PreToolUse modifiedInput";
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

const failed = checks.filter((c) => c.status === "fail");
const lines = [
  "# Host integration equivalence acceptance (plan F3)",
  "",
  `Generated: ${new Date().toISOString()}`,
  "",
  "This record covers protocol-level acceptance using captured payloads and real",
  "hook processes. It does **not** replace launching Claude Code or ZCode:",
  "`/hooks` visibility, transcript wording and `hook.run.failed` in a fresh session",
  "remain unverified on this machine because no host binary is installed.",
  "",
  "| Check | Result | Detail |",
  "| --- | --- | --- |",
  ...checks.map((c) => `| ${c.name} | ${c.status} | ${c.detail.replace(/\|/g, "\\|")} |`),
  "",
  `Summary: ${checks.length - failed.length}/${checks.length} passed.`,
];
const report = lines.join("\n") + "\n";
const outIndex = process.argv.indexOf("--out");
if (outIndex >= 0 && process.argv[outIndex + 1]) {
  writeFileSync(process.argv[outIndex + 1], report);
}
process.stdout.write(report);
process.exitCode = failed.length ? 1 : 0;
