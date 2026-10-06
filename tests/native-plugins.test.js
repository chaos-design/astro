import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const projectDir = resolve(import.meta.dirname, "..");

function readJson(path) {
  return JSON.parse(readFileSync(join(projectDir, path), "utf8"));
}

function getHandlers(hooks) {
  return Object.values(hooks).flatMap((groups) =>
    groups.flatMap((group) => group.hooks || []),
  );
}

test("native plugin manifests and marketplaces reference local packages", () => {
  const packageMetadata = readJson("package.json");
  const codexManifest = readJson(
    "codex-plugin/.codex-plugin/plugin.json",
  );
  const claudeManifest = readJson(
    "claude-plugin/.claude-plugin/plugin.json",
  );
  const workbuddyManifest = readJson(
    "workbuddy-plugin/.codebuddy-plugin/plugin.json",
  );
  const zcodeManifest = readJson(
    "zcode-plugin/.zcode-plugin/plugin.json",
  );
  const deepseekManifest = readJson("deepseek-plugin/package.json");
  const codexMarketplace = readJson(".agents/plugins/marketplace.json");
  const claudeMarketplace = readJson(".claude-plugin/marketplace.json");
  const workbuddyMarketplace = readJson(
    ".codebuddy-plugin/marketplace.json",
  );
  const zcodeMarketplace = readJson("zcode-plugin/marketplace.json");

  assert.equal(codexManifest.name, "astro");
  assert.equal(claudeManifest.name, "astro");
  assert.equal(workbuddyManifest.name, "astro");
  assert.equal(zcodeManifest.name, "astro");
  assert.equal(deepseekManifest.name, "dsh-astro-plugin");
  assert.equal(codexManifest.version, packageMetadata.version);
  assert.equal(claudeManifest.version, packageMetadata.version);
  assert.equal(workbuddyManifest.version, packageMetadata.version);
  assert.equal(zcodeManifest.version, packageMetadata.version);
  assert.equal(deepseekManifest.version, packageMetadata.version);
  assert.equal(codexManifest.hooks, "./hooks/hooks.json");
  assert.equal(claudeManifest.hooks, "./hooks/hooks.json");
  assert.equal(workbuddyManifest.hooks, "./hooks/hooks.json");
  assert.equal(zcodeManifest.hooks, "./hooks/hooks.json");
  assert.equal(codexMarketplace.name, "astro-local");
  assert.equal(claudeMarketplace.name, "astro-local");
  assert.equal(workbuddyMarketplace.name, "astro-local");
  assert.equal(zcodeMarketplace.name, "astro-zcode-local");
  assert.equal(codexMarketplace.plugins[0].name, "astro");
  assert.equal(claudeMarketplace.plugins[0].name, "astro");
  assert.equal(workbuddyMarketplace.plugins[0].name, "astro");
  assert.equal(zcodeMarketplace.plugins[0].name, "astro");
  assert.equal(
    codexMarketplace.plugins[0].source.path,
    "./codex-plugin",
  );
  assert.equal(claudeMarketplace.plugins[0].source, "./claude-plugin");
  assert.equal(
    workbuddyMarketplace.plugins[0].source,
    "./workbuddy-plugin",
  );
  assert.equal(zcodeMarketplace.plugins[0].source, ".");
});

test("DeepSeek plugin declares an installable Harness bundle", () => {
  const manifest = readJson("deepseek-plugin/package.json");
  const patch = readFileSync(
    join(projectDir, "deepseek-plugin", "cordis.patch.yml"),
    "utf8",
  );

  assert.equal(manifest.dsh.bundle.patch, "./cordis.patch.yml");
  assert.match(patch, /name: dsh-astro-plugin/);
});

test("native plugin hooks use portable plugin-root paths", () => {
  const codexHooks = readJson("codex-plugin/hooks/hooks.json").hooks;
  const claudeHooks = readJson("claude-plugin/hooks/hooks.json").hooks;
  const workbuddyHooks = readJson("workbuddy-plugin/hooks/hooks.json").hooks;
  const codexHandlers = getHandlers(codexHooks);
  const claudeHandlers = getHandlers(claudeHooks);
  const workbuddyHandlers = getHandlers(workbuddyHooks);

  assert.deepEqual(
    Object.keys(codexHooks),
    [
      "SessionStart",
      "SessionEnd",
      "UserPromptSubmit",
      "PreToolUse",
      "PostToolUse",
      "PermissionRequest",
      "PreCompact",
      "PostCompact",
      "SubagentStart",
      "SubagentStop",
      "Stop",
      "Interrupt",
    ],
  );
  assert.ok(
    codexHandlers.every(
      (handler) =>
        handler.command.includes("${PLUGIN_ROOT}") &&
        handler.command.includes("--source=codex") &&
        handler.command.includes("--quiet"),
    ),
  );
  assert.ok(
    claudeHandlers.every(
      (handler) =>
        handler.command.includes("${CLAUDE_PLUGIN_ROOT}") &&
        handler.command.includes("--source=claude") &&
        !handler.command.includes("--quiet"),
    ),
  );
  assert.ok(workbuddyHooks.StopFailure);
  assert.ok(workbuddyHooks.PermissionRequest);
  assert.ok(workbuddyHooks.Elicitation);
  assert.ok(
    workbuddyHandlers.every(
      (handler) =>
        handler.command.includes("${CODEBUDDY_PLUGIN_ROOT}") &&
        handler.command.includes("--source=workbuddy") &&
        !handler.command.includes("--quiet"),
    ),
  );
});

test("ZCode plugin registers only the events ZCode supports", () => {
  const hooks = readJson("zcode-plugin/hooks/hooks.json").hooks;
  const zcode = readJson("zcode-plugin/.zcode-plugin/plugin.json");

  // ZCode fires exactly seven hook events; anything else never triggers.
  assert.deepEqual(Object.keys(hooks).sort(), [
    "PermissionRequest",
    "PostToolUse",
    "PostToolUseFailure",
    "PreToolUse",
    "SessionStart",
    "Stop",
    "UserPromptSubmit",
  ]);
  const handlers = getHandlers(hooks);
  assert.equal(handlers.length, 7);
  for (const groups of Object.values(hooks)) {
    for (const group of groups) {
      // A "*" matcher is an invalid regular expression in ZCode and never
      // matches; an omitted matcher matches everything instead.
      assert.equal(group.matcher, undefined);
    }
  }
  assert.ok(
    handlers.every(
      (handler) =>
        handler.command.includes("${CLAUDE_PLUGIN_ROOT}") &&
        handler.command.includes("zcode-adapter.cjs") &&
        handler.command.includes("--source=zcode") &&
        // ZCode validates hook stdout against a strict JSON schema, so the
        // adapter must not print hook control output.
        handler.command.includes("--quiet"),
    ),
  );
  assert.equal(zcode.hooks, "./hooks/hooks.json");
});

test("native plugin recorders stay synchronized with the shared runtime", () => {
  for (const directory of [
    "codex-plugin",
    "claude-plugin",
    "workbuddy-plugin",
    "zcode-plugin",
    "deepseek-plugin",
  ]) {
    for (const file of [
      "runtime-config.cjs",
      "storage-paths.cjs",
      "trace-recorder.cjs",
    ]) {
      assert.equal(
        readFileSync(join(projectDir, directory, "plugin", file), "utf8"),
        readFileSync(join(projectDir, "plugin", file), "utf8"),
      );
    }
    assert.equal(
      readFileSync(
        join(projectDir, directory, "config.example.yaml"),
        "utf8",
      ),
      readFileSync(join(projectDir, "config.example.yaml"), "utf8"),
    );
    assert.equal(
      readFileSync(join(projectDir, directory, ".env.example"), "utf8"),
      readFileSync(join(projectDir, ".env.example"), "utf8"),
    );
    assert.equal(
      existsSync(
        join(projectDir, directory, "plugin", "vendor", "yaml", "dist"),
      ),
      true,
    );
    assert.equal(
      existsSync(
        join(projectDir, directory, "plugin", "vendor", "dotenv", "lib"),
      ),
      true,
    );
  }
});

test("Codex quiet mode records without emitting hook control output", () => {
  const astroHome = mkdtempSync(join(tmpdir(), "astro-plugin-"));
  const result = spawnSync(
    process.execPath,
    [
      join(projectDir, "codex-plugin", "plugin", "trace-recorder.cjs"),
      "--source=codex",
      "--quiet",
    ],
    {
      encoding: "utf8",
      env: { ...process.env, ASTRO_HOME: astroHome },
      input: JSON.stringify({
        session_id: "native-plugin-session",
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        tool_input: { command: "pwd" },
        cwd: projectDir,
      }),
    },
  );

  assert.equal(result.status, 0);
  assert.equal(result.stdout, "");
  const traceRoot = join(astroHome, "codex");
  const traceFile = readdirSync(traceRoot, {
    recursive: true,
  })
    .map((entry) => join(traceRoot, entry))
    .find((entry) => entry.endsWith("events.jsonl"));
  const trace = readFileSync(
    traceFile,
    "utf8",
  ).trim();
  assert.equal(JSON.parse(trace).sessionId, "native-plugin-session");
  rmSync(astroHome, { recursive: true, force: true });
});

test("WorkBuddy plugin records CodeBuddy hook input under its own source", () => {
  const astroHome = mkdtempSync(join(tmpdir(), "astro-workbuddy-plugin-"));
  const result = spawnSync(
    process.execPath,
    [
      join(
        projectDir,
        "workbuddy-plugin",
        "plugin",
        "trace-recorder.cjs",
      ),
      "--source=workbuddy",
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        ASTRO_AUTO_OPEN: "0",
        ASTRO_HOME: astroHome,
      },
      input: JSON.stringify({
        session_id: "workbuddy-plugin-session",
        hook_event_name: "PermissionRequest",
        tool_name: "Bash",
        cwd: projectDir,
      }),
    },
  );

  assert.equal(result.status, 0);
  assert.deepEqual(JSON.parse(result.stdout), { continue: true });
  const traceRoot = join(astroHome, "workbuddy");
  const traceFile = readdirSync(traceRoot, {
    recursive: true,
  })
    .map((entry) => join(traceRoot, entry))
    .find((entry) => entry.endsWith("events.jsonl"));
  const event = JSON.parse(readFileSync(traceFile, "utf8").trim());
  assert.equal(event.source, "workbuddy");
  assert.equal(event.eventName, "PermissionRequest");
  rmSync(astroHome, { recursive: true, force: true });
});
