import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

import { runInstaller, hookArgsFor, parseArgs } from "../scripts/install-interaction-hook.mjs";
import { validateHookConfig } from "../scripts/install-auto-approve-hook.mjs";

const projectDir = resolve(import.meta.dirname, "..");
const hookPath = join(projectDir, "scripts", "interaction-hook.mjs");

function tempSettings(initial) {
  const home = mkdtempSync(join(tmpdir(), "astro-interaction-install-"));
  const target = join(home, ".claude", "settings.json");
  if (initial) {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, `${JSON.stringify(initial, null, 2)}\n`);
  }
  return { home, target };
}

function quietSink() {
  const lines = [];
  return { lines, log: (line) => lines.push(String(line)) };
}

test("F1: dry run is the default and --apply writes a backup", () => {
  const { home, target } = tempSettings({
    hooks: {
      PostToolUse: [{ hooks: [{ type: "command", command: "echo format" }] }],
    },
  });
  try {
    const dry = runInstaller({
      client: "claude",
      home,
      settings: target,
      hookPath,
    }, quietSink());
    assert.equal(dry.written, false);
    assert.match(readFileSync(target, "utf8"), /echo format/);
    assert.equal(
      JSON.parse(readFileSync(target, "utf8")).hooks.PermissionRequest,
      undefined,
    );

    const applied = runInstaller({
      client: "claude",
      home,
      settings: target,
      hookPath,
      apply: true,
    }, quietSink());
    assert.equal(applied.written, true);
    assert.ok(existsSync(applied.backup), "the previous file is backed up");
    const saved = JSON.parse(readFileSync(target, "utf8"));
    assert.equal(saved.hooks.PermissionRequest.length, 1);
    assert.equal(
      saved.hooks.PermissionRequest[0].hooks[0].command,
      `node "${hookPath}" --source=claude`,
    );
    assert.deepEqual(saved.hooks.PostToolUse, [
      { hooks: [{ type: "command", command: "echo format" }] },
    ]);
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

test("F1: installing twice is idempotent and remove keeps ASTRO recorder groups", () => {
  const recorderGroup = {
    matcher: "AskUserQuestion|ExitPlanMode",
    hooks: [
      { type: "command", command: `node "${join(projectDir, "plugin", "trace-recorder.cjs")}"` },
    ],
  };
  const decisionGroup = {
    matcher: "AskUserQuestion|ExitPlanMode",
    hooks: [
      { type: "command", command: `node "${join(projectDir, "scripts", "auto-approve-question-hook.mjs")}"` },
    ],
  };
  const { home, target } = tempSettings({
    hooks: { PermissionRequest: [recorderGroup, decisionGroup] },
  });
  try {
    const options = {
      client: "claude",
      home,
      settings: target,
      hookPath,
      apply: true,
    };
    const first = runInstaller(options, quietSink());
    assert.equal(first.written, true);
    const second = runInstaller(options, quietSink());
    assert.equal(second.written, true, "an apply still writes the same file");
    const installed = JSON.parse(readFileSync(target, "utf8"));
    assert.equal(installed.hooks.PermissionRequest.length, 3);

    const removed = runInstaller(
      { ...options, remove: true },
      quietSink(),
    );
    assert.equal(removed.removed, 1);
    const after = JSON.parse(readFileSync(target, "utf8"));
    assert.equal(after.hooks.PermissionRequest.length, 2);
    assert.equal(after.hooks.PermissionRequest[0].hooks[0].command, recorderGroup.hooks[0].command);
    assert.equal(after.hooks.PermissionRequest[1].hooks[0].command, decisionGroup.hooks[0].command);

    const again = runInstaller({ ...options, remove: true }, quietSink());
    assert.equal(again.removed, 0);
    assert.deepEqual(
      JSON.parse(readFileSync(target, "utf8")),
      after,
      "a second remove is a no-op",
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("F2: ZCode gets hooks.enabled, its own events map and a 5000 ms timeout", () => {
  const { home, target } = tempSettings({ hooks: { timeoutMs: 60000 } });
  try {
    const events = ["PreToolUse", "PermissionRequest"];
    const result = runInstaller({
      client: "zcode",
      home,
      settings: target,
      hookPath,
      events,
      apply: true,
    }, quietSink());
    assert.equal(result.validation.valid, true, result.validation.errors.join("; "));
    const saved = JSON.parse(readFileSync(target, "utf8"));
    assert.equal(saved.hooks.enabled, true);
    assert.equal(saved.hooks.timeoutMs, 60000);
    for (const event of events) {
      const handler = saved.hooks.events[event][0].hooks[0];
      assert.equal(handler.type, "process");
      assert.equal(handler.command, "node");
      assert.deepEqual(handler.args, [hookPath, "--source=zcode"]);
      assert.equal(handler.timeoutMs, 5000);
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("F2: CodeBuddy uses modifiedInput and ZCode validation needs every event", () => {
  assert.deepEqual(hookArgsFor("codebuddy"), [
    "--source=workbuddy",
    "--input-field=modifiedInput",
  ]);
  const { home, target } = tempSettings();
  try {
    runInstaller({
      client: "codebuddy",
      home,
      settings: target,
      hookPath,
      apply: true,
    }, quietSink());
    const saved = JSON.parse(readFileSync(target, "utf8"));
    // CodeBuddy reads `modifiedInput` only on PreToolUse; registering the
    // handler under PermissionRequest would produce a decision the host
    // ignores.
    assert.equal(saved.hooks.PermissionRequest, undefined);
    assert.match(
      saved.hooks.PreToolUse[0].hooks[0].command,
      /--input-field=modifiedInput/,
    );

    const codebuddyEvents = {
      events: ["PreToolUse"],
      hookMarker: "interaction-hook.mjs",
      label: "interaction-hook",
    };
    assert.equal(
      validateHookConfig(saved, "codebuddy", codebuddyEvents).valid,
      true,
    );
    const shared = {
      events: ["PreToolUse", "PermissionRequest"],
      hookMarker: "interaction-hook.mjs",
      label: "interaction-hook",
    };

    const zcode = {
      hooks: {
        enabled: false,
        events: {
          PermissionRequest: [
            {
              matcher: "AskUserQuestion|ExitPlanMode",
              hooks: [
                {
                  type: "process",
                  command: "node",
                  args: [hookPath, "--source=zcode"],
                },
              ],
            },
          ],
        },
      },
    };
    const invalid = validateHookConfig(zcode, "zcode", shared);
    assert.match(invalid.errors.join(), /hooks\.enabled/);
    zcode.hooks.enabled = true;
    assert.equal(
      validateHookConfig(zcode, "zcode", shared).valid,
      false,
      "PreToolUse is still missing",
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("F2: the installer explains that a new session is required", () => {
  const { home, target } = tempSettings();
  try {
    const sink = quietSink();
    runInstaller(
      { client: "claude", home, settings: target, hookPath, apply: true },
      sink,
    );
    assert.match(sink.lines.join("\n"), /open a new Claude Code session/);
    const zcodeSink = quietSink();
    runInstaller(
      { client: "zcode", home, settings: target, hookPath, apply: true },
      zcodeSink,
    );
    assert.match(zcodeSink.lines.join("\n"), /open a new ZCode session/);
    assert.match(zcodeSink.lines.join("\n"), /hooks\.enabled=true/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("F1: parseArgs defaults to a dry-run PermissionRequest install", () => {
  const options = parseArgs(["--client=claude"]);
  assert.equal(options.apply, false);
  assert.equal(options.remove, false);
  assert.deepEqual(options.events, ["PermissionRequest"]);
  assert.deepEqual(parseArgs(["--client=zcode", "--events=PreToolUse,PermissionRequest"]).events, [
    "PreToolUse",
    "PermissionRequest",
  ]);
  assert.throws(() => parseArgs(["--client=nope"]), /unsupported client/);
});
