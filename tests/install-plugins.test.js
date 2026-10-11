import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  getHookCommand,
  installClients,
  openInstalledDashboard,
  resolveHomePath,
  updateInstalledPlugins,
} from "../scripts/install-plugins.mjs";

test("uses portable home-relative paths in hook commands", () => {
  const astroHome = join(homedir(), ".astrox");
  const recorderFile = join(
    astroHome,
    "plugins",
    "astro",
    "plugin",
    "trace-recorder.cjs",
  );
  const command = getHookCommand("trae", recorderFile, astroHome);

  assert.equal(
    command,
    "ASTRO_HOME=~/.astrox node ~/.astrox/plugins/astro/plugin/trace-recorder.cjs --source=trae",
  );
  assert.equal(command.includes(homedir()), false);
  assert.equal(
    resolveHomePath("~/.codex", "/unused"),
    join(homedir(), ".codex"),
  );
});

test("names WorkBuddy hook events explicitly because it pipes no payload", () => {
  const astroHome = join(homedir(), ".astrox");
  const recorderFile = join(
    astroHome,
    "plugins",
    "astro",
    "plugin",
    "trace-recorder.cjs",
  );

  assert.equal(
    getHookCommand("workbuddy", recorderFile, astroHome, "PermissionRequest"),
    "ASTRO_HOME=~/.astrox node ~/.astrox/plugins/astro/plugin/trace-recorder.cjs --source=workbuddy --event=PermissionRequest",
  );
  assert.equal(
    getHookCommand("claude", recorderFile, astroHome, "PermissionRequest"),
    "ASTRO_HOME=~/.astrox node ~/.astrox/plugins/astro/plugin/trace-recorder.cjs --source=claude",
  );
});

test("rejects unsupported clients instead of silently doing nothing", () => {
  assert.throws(
    () => installClients({ clients: ["deepseak"] }),
    /Unsupported ASTRO client.*deepseak/,
  );
});

test("merges client hooks without replacing existing commands", () => {
  const root = mkdtempSync(join(tmpdir(), "astro-install-"));
  const codexHome = join(root, "codex-home");
  const workbuddyHome = join(root, "workbuddy-home");
  const astroHome = join(root, "astro-home");
  const traeDir = join(root, ".trae");
  mkdirSync(traeDir, { recursive: true });
  writeFileSync(
    join(traeDir, "hooks.json"),
    JSON.stringify({
      version: 1,
      hooks: {
        SessionStart: [
          {
            hooks: [{ type: "command", command: "node existing-hook.cjs" }],
          },
        ],
      },
    }),
  );

  installClients({
    targetDir: root,
    codexHome,
    workbuddyHome,
    astroHome,
    clients: ["trae", "claude", "codex", "workbuddy"],
  });
  const runtimeConfigFile = join(
    astroHome,
    "plugins",
    "astro",
    "config.yaml",
  );
  const runtimeEnvFile = join(astroHome, "plugins", "astro", ".env");
  assert.equal(existsSync(runtimeConfigFile), true);
  assert.equal(existsSync(runtimeEnvFile), true);
  assert.equal(
    existsSync(join(astroHome, "plugins", "astro", "config.example.yaml")),
    false,
  );
  assert.equal(
    existsSync(join(astroHome, "plugins", "astro", ".env.example")),
    false,
  );
  assert.equal(statSync(runtimeEnvFile).mode & 0o777, 0o600);
  writeFileSync(runtimeConfigFile, "version: 1\nserver:\n  port: 4550\n");
  writeFileSync(runtimeEnvFile, "PRIVATE_VALUE=preserved\n");
  installClients({
    targetDir: root,
    codexHome,
    workbuddyHome,
    astroHome,
    clients: ["trae", "claude", "codex", "workbuddy"],
  });
  assert.match(readFileSync(runtimeConfigFile, "utf8"), /port: 4550/);
  assert.equal(
    readFileSync(runtimeEnvFile, "utf8"),
    "PRIVATE_VALUE=preserved\n",
  );
  const runtimePluginDir = join(astroHome, "plugins", "astro", "plugin");
  const requireFromRuntime = createRequire(join(runtimePluginDir, "entry.cjs"));
  const installedConfigLoader = requireFromRuntime("./runtime-config.cjs");
  const loadedConfig = installedConfigLoader.loadRuntimeConfig({
    astroHome,
    environment: { ASTRO_HOME: astroHome },
  });
  assert.equal(loadedConfig.config.server.port, 4550);

  const trae = JSON.parse(readFileSync(join(traeDir, "hooks.json"), "utf8"));
  const claude = JSON.parse(
    readFileSync(join(root, ".claude", "settings.local.json"), "utf8"),
  );
  const codex = JSON.parse(
    readFileSync(join(codexHome, "hooks.json"), "utf8"),
  );
  const workbuddy = JSON.parse(
    readFileSync(join(root, ".codebuddy", "settings.json"), "utf8"),
  );

  assert.equal(trae.hooks.SessionStart.length, 2);
  assert.equal(trae.hooks.SessionStart[0].hooks[0].command, "node existing-hook.cjs");
  assert.match(trae.hooks.SessionStart[1].hooks[0].command, /--source=trae/);
  assert.ok(trae.hooks.PermissionRequest);
  assert.ok(trae.hooks.PermissionDenied);
  assert.ok(trae.hooks.Elicitation);
  assert.ok(trae.hooks.ElicitationResult);
  assert.ok(
    trae.hooks.SessionStart[1].hooks[0].command.includes(
      join(astroHome, "plugins", "astro", "plugin", "trace-recorder.cjs"),
    ),
  );
  assert.match(
    claude.hooks.PostToolUseFailure[0].hooks[0].command,
    /--source=claude/,
  );
  assert.match(
    codex.hooks.PreToolUse[0].hooks[0].command,
    /--source=codex/,
  );
  assert.match(codex.hooks.PreToolUse[0].hooks[0].command, /--quiet/);
  assert.ok(codex.hooks.SessionEnd);
  assert.ok(codex.hooks.Interrupt);
  assert.match(
    workbuddy.hooks.PermissionRequest[0].hooks[0].command,
    /--source=workbuddy/,
  );
  // WorkBuddy does not pipe hook payloads into stdin, so every command
  // names its event explicitly.
  assert.match(
    workbuddy.hooks.PermissionRequest[0].hooks[0].command,
    /--event=PermissionRequest/,
  );
  assert.ok(workbuddy.hooks.StopFailure);
  assert.ok(workbuddy.hooks.Elicitation);
  assert.equal(
    existsSync(join(astroHome, "plugins", "astro", "plugin.json")),
    true,
  );
  assert.equal(existsSync(join(root, ".astrox")), false);

  let spawnOptions;
  assert.equal(
    openInstalledDashboard({
      clients: ["trae"],
      targetDir: root,
      astroHome,
      environment: { ASTRO_PORT: "4450" },
      dependencies: {
        isProcessRunning: () => false,
        spawn: (_command, _arguments, options) => {
          spawnOptions = options;
          return { pid: 44501, unref() {} };
        },
      },
    }),
    true,
  );
  assert.equal(spawnOptions.env.ASTRO_HOME, astroHome);
  assert.equal(spawnOptions.env.ASTRO_OPEN_SOURCE, "trae");

  rmSync(root, { recursive: true, force: true });
});

test("supports user-scoped Claude Code hook installation", () => {
  const root = mkdtempSync(join(tmpdir(), "astro-claude-user-"));
  const claudeHome = join(root, "claude-home");
  const astroHome = join(root, "astro-home");

  installClients({
    targetDir: join(root, "workspace"),
    claudeHome,
    astroHome,
    scope: "user",
    clients: ["claude"],
  });

  const configFile = join(claudeHome, "settings.json");
  const config = JSON.parse(readFileSync(configFile, "utf8"));
  assert.match(
    config.hooks.UserPromptSubmit[0].hooks[0].command,
    /--source=claude/,
  );
  assert.equal(
    existsSync(
      join(
        astroHome,
        "plugins",
        "astro",
        "plugin",
        "trace-recorder.cjs",
      ),
    ),
    true,
  );

  rmSync(root, { recursive: true, force: true });
});

test("supports user-scoped WorkBuddy hook installation", () => {
  const root = mkdtempSync(join(tmpdir(), "astro-workbuddy-user-"));
  const workbuddyHome = join(root, "workbuddy-home");
  const astroHome = join(root, "astro-home");

  installClients({
    targetDir: join(root, "workspace"),
    workbuddyHome,
    astroHome,
    scope: "user",
    clients: ["workbuddy"],
  });

  const configFile = join(workbuddyHome, "settings.json");
  const config = JSON.parse(readFileSync(configFile, "utf8"));
  assert.match(
    config.hooks.UserPromptSubmit[0].hooks[0].command,
    /--source=workbuddy/,
  );
  assert.ok(config.hooks.StopFailure);
  assert.ok(config.hooks.Elicitation);
  assert.equal(
    existsSync(
      join(
        astroHome,
        "plugins",
        "astro",
        "plugin",
        "trace-recorder.cjs",
      ),
    ),
    true,
  );

  rmSync(root, { recursive: true, force: true });
});

test("installs the DeepSeek Harness bundle through its profile manager", () => {
  const root = mkdtempSync(join(tmpdir(), "astro-deepseek-install-"));
  const astroHome = join(root, "astro-home");
  const dshHome = join(root, "dsh-home");
  let invocation;

  const installed = installClients({
    targetDir: root,
    astroHome,
    dshHome,
    deepseekProfile: "headless",
    deepseekCommand: "custom-dsh",
    deepseekRun(command, arguments_, options) {
      invocation = { command, arguments_, options };
      return { status: 0 };
    },
    clients: ["deepseek"],
  });

  const pluginDirectory = join(
    astroHome,
    "plugins",
    "astro",
    "deepseek-plugin",
  );
  assert.deepEqual(installed, [
    join(dshHome, "profiles", "headless", "package.json"),
  ]);
  assert.equal(invocation.command, "custom-dsh");
  assert.deepEqual(invocation.arguments_, [
    "plugin",
    "--profile",
    "headless",
    "add",
    `file:${pluginDirectory}`,
  ]);
  assert.equal(invocation.options.env.DSH_HOME, dshHome);
  assert.equal(existsSync(join(pluginDirectory, "index.js")), true);
  assert.equal(
    existsSync(join(pluginDirectory, "plugin", "trace-recorder.cjs")),
    true,
  );

  rmSync(root, { recursive: true, force: true });
});

test("falls back to the official npx launcher when dsh is not on PATH", () => {
  const root = mkdtempSync(join(tmpdir(), "astro-deepseek-npx-"));
  const calls = [];

  installClients({
    targetDir: root,
    astroHome: join(root, "astro-home"),
    dshHome: join(root, "dsh-home"),
    deepseekRun(command, arguments_) {
      calls.push([command, arguments_]);
      return command === "dsh"
        ? { status: null, error: { code: "ENOENT" } }
        : { status: 0 };
    },
    clients: ["deepseek"],
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0][0], "dsh");
  assert.equal(calls[1][0], "npx");
  assert.deepEqual(calls[1][1].slice(0, 2), [
    "--yes",
    "@deepseek-ai/dsh",
  ]);

  rmSync(root, { recursive: true, force: true });
});

test("updates installed plugin content in place and leaves missing installs alone", () => {
  const root = mkdtempSync(join(tmpdir(), "astro-update-"));
  const astroHome = join(root, "astro-home");
  const pluginDir = join(astroHome, "plugins", "astro");
  const recorderFile = join(pluginDir, "plugin", "trace-recorder.cjs");

  // No install yet -> update refuses instead of silently creating one.
  assert.throws(
    () =>
      updateInstalledPlugins({
        astroHome,
        environment: { ASTRO_HOME: astroHome },
        refreshDeepseek: false,
      }),
    /No installed ASTRO plugin/,
  );

  // Install once, then stamp a user value and confirm an update preserves it.
  installClients({
    targetDir: root,
    astroHome,
    clients: [],
  });
  const envFile = join(pluginDir, ".env");
  writeFileSync(envFile, "PRIVATE_VALUE=preserved\n");

  updateInstalledPlugins({
    astroHome,
    environment: { ASTRO_HOME: astroHome },
    refreshDeepseek: false,
  });

  assert.equal(existsSync(recorderFile), true);
  const pluginJson = JSON.parse(
    readFileSync(join(pluginDir, "plugin.json"), "utf8"),
  );
  assert.equal(pluginJson.id, "astro");
  // User-managed files are not clobbered by a content refresh.
  assert.equal(readFileSync(envFile, "utf8"), "PRIVATE_VALUE=preserved\n");

  rmSync(root, { recursive: true, force: true });
});
