#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectDir = resolve(scriptDir, "..");
const defaultPluginRoot = join(projectDir, "claude-plugin");

const lifecycleOrder = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PermissionRequest",
  "Notification",
  "PostToolUse",
  "PostToolUseFailure",
  "SubagentStart",
  "SubagentStop",
  "Elicitation",
  "ElicitationResult",
  "PreCompact",
  "PostCompact",
  "Stop",
  "StopFailure",
  "SessionEnd",
];

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function findTraceFile(root) {
  const files = readdirSync(root, { recursive: true })
    .map((entry) => join(root, String(entry)))
    .filter((entry) => entry.endsWith("events.jsonl"));
  assert.equal(files.length, 1, "Claude validation must produce one trace file");
  return files[0];
}

function hookPayload(eventName, index) {
  const payload = {
    session_id: "claude-hook-validation",
    hook_event_name: eventName,
    cwd: projectDir,
    timestamp: new Date(Date.UTC(2026, 8, 10, 8, 0, index)).toISOString(),
  };
  if (eventName === "UserPromptSubmit") {
    payload.prompt = "Validate every Claude plugin hook.";
  }
  if (eventName.includes("ToolUse") || eventName === "PermissionRequest") {
    payload.tool_name = "Bash";
    payload.tool_use_id = "claude-validation-tool";
    payload.tool_input = { command: "printf validation" };
  }
  if (eventName === "PostToolUse") {
    payload.tool_response = { exitCode: 0, stdout: "validation" };
  }
  if (eventName === "PostToolUseFailure") {
    payload.tool_response = { error: "expected validation failure" };
  }
  if (eventName === "Notification") {
    payload.notification_type = "idle_prompt";
    payload.message = "Waiting for user input";
  }
  if (eventName === "Elicitation") {
    payload.message = "Choose a validation option";
  }
  if (eventName === "ElicitationResult") {
    payload.message = "Validation option accepted";
  }
  if (eventName === "StopFailure") {
    payload.reason = "rate_limit";
    payload.error = "Too many requests; retry_after=1";
  }
  return payload;
}

export function validateClaudeHooks({
  pluginRoot = defaultPluginRoot,
  run = spawnSync,
} = {}) {
  const manifest = readJson(
    join(pluginRoot, ".claude-plugin", "plugin.json"),
  );
  assert.equal(manifest.name, "astro");
  assert.equal(manifest.hooks, "./hooks/hooks.json");

  const hookConfig = readJson(join(pluginRoot, "hooks", "hooks.json"));
  const eventNames = lifecycleOrder.filter((eventName) =>
    Object.hasOwn(hookConfig.hooks, eventName),
  );
  assert.deepEqual(eventNames, lifecycleOrder);

  const astroHome = mkdtempSync(join(tmpdir(), "astro-claude-hooks-"));
  try {
    eventNames.forEach((eventName, index) => {
      const groups = hookConfig.hooks[eventName];
      assert.ok(Array.isArray(groups) && groups.length > 0);
      const command = groups[0]?.hooks?.[0]?.command;
      assert.equal(typeof command, "string");
      assert.match(command, /\$\{CLAUDE_PLUGIN_ROOT\}/);
      assert.match(command, /--source=claude/);

      const result = run("/bin/sh", ["-c", command], {
        cwd: projectDir,
        encoding: "utf8",
        env: {
          ...process.env,
          ASTRO_AUTO_OPEN: "0",
          ASTRO_HOME: astroHome,
          CLAUDE_PLUGIN_ROOT: pluginRoot,
        },
        input: JSON.stringify(hookPayload(eventName, index)),
      });
      assert.equal(
        result.status,
        0,
        `${eventName} failed: ${result.stderr || result.error || ""}`,
      );
      assert.deepEqual(JSON.parse(result.stdout), { continue: true });
    });

    const traceFile = findTraceFile(join(astroHome, "claude"));
    const events = readFileSync(traceFile, "utf8")
      .trim()
      .split(/\r?\n/)
      .map(JSON.parse);
    assert.deepEqual(
      events.map((event) => event.eventName),
      lifecycleOrder,
    );
    assert.ok(events.every((event) => event.source === "claude"));
    assert.equal(
      events.find((event) => event.eventName === "StopFailure")?.status,
      "failed",
    );
    return { eventCount: events.length, traceFile };
  } finally {
    rmSync(astroHome, { recursive: true, force: true });
  }
}

if (resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  const result = validateClaudeHooks();
  console.log(`Claude hooks validation passed (${result.eventCount} events).`);
}
