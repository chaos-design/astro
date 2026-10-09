#!/usr/bin/env node

import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  migrateLegacyAotHome,
  migrateSessionPathLayout,
  migrateTraceData,
} from "./migrate-data.mjs";
import recorder from "../plugin/trace-recorder.cjs";
import runtimeConfig from "../plugin/runtime-config.cjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageDir = resolve(scriptDir, "..");
const require = createRequire(import.meta.url);
const recorderFile = join(packageDir, "plugin", "trace-recorder.cjs");
const runtimeConfigFile = join(packageDir, "plugin", "runtime-config.cjs");
const storagePathsFile = join(packageDir, "plugin", "storage-paths.cjs");
const deepseekPluginSource = join(packageDir, "deepseek-plugin");
const packageMetadata = JSON.parse(
  readFileSync(join(packageDir, "package.json"), "utf8"),
);
const { launchDashboardForEvents, resolveAstroHome } = recorder;
const {
  formatRuntimeConfigDiagnostic,
  initializeRuntimeConfig,
  loadRuntimeConfig,
} = runtimeConfig;
const runtimeDependencies = ["dotenv", "yaml"];

const eventDefinitions = {
  trae: [
    ["SessionStart"],
    ["UserPromptSubmit"],
    ["PreToolUse", "*"],
    ["PostToolUse", "*"],
    ["PermissionRequest", "*"],
    ["PermissionDenied", "*"],
    ["Elicitation", "*"],
    ["ElicitationResult", "*"],
    ["Stop"],
    ["StopFailure"],
    ["Interrupt"],
    ["SessionEnd"],
    ["Notification", "*"],
  ],
  claude: [
    ["SessionStart"],
    ["UserPromptSubmit"],
    ["PreToolUse", "*"],
    ["PostToolUse", "*"],
    ["PostToolUseFailure", "*"],
    ["PermissionRequest", "*"],
    ["Notification", "*"],
    ["SubagentStart", "*"],
    ["SubagentStop", "*"],
    ["Elicitation", "*"],
    ["ElicitationResult", "*"],
    ["PreCompact", "*"],
    ["Stop"],
    ["StopFailure"],
    ["SessionEnd"],
  ],
  // WorkBuddy validates hook matchers as regular expressions; a "*" matcher
  // is an invalid regular expression that never matches. An omitted matcher
  // matches every tool instead.
  workbuddy: [
    ["SessionStart"],
    ["UserPromptSubmit"],
    ["PreToolUse"],
    ["PermissionRequest"],
    ["PermissionDenied"],
    ["PostToolUse"],
    ["PostToolUseFailure"],
    ["Notification"],
    ["SubagentStart"],
    ["SubagentStop"],
    ["TaskCreated"],
    ["TaskCompleted"],
    ["Stop"],
    ["StopFailure"],
    ["TeammateIdle"],
    ["InstructionsLoaded"],
    ["ConfigChange"],
    ["CwdChanged"],
    ["WorktreeCreate"],
    ["WorktreeRemove"],
    ["PreCompact"],
    ["PostCompact"],
    ["Elicitation"],
    ["ElicitationResult"],
    ["SessionEnd"],
  ],
  codex: [
    ["SessionStart"],
    ["SessionEnd"],
    ["UserPromptSubmit"],
    ["PreToolUse", ".*"],
    ["PostToolUse", ".*"],
    ["PermissionRequest", ".*"],
    ["PreCompact", ".*"],
    ["PostCompact", ".*"],
    ["SubagentStart", ".*"],
    ["SubagentStop"],
    ["Stop"],
    ["Interrupt"],
  ],
};
const supportedClients = new Set([
  ...Object.keys(eventDefinitions),
  "deepseek",
]);

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function shellPath(value) {
  const absolutePath = resolve(value);
  const relativeHomePath = relative(homedir(), absolutePath);
  const isHomePath =
    relativeHomePath === "" ||
    (!relativeHomePath.startsWith(`..${sep}`) &&
      relativeHomePath !== ".." &&
      !isAbsolute(relativeHomePath));
  if (!isHomePath) {
    return shellQuote(absolutePath);
  }

  const portablePath = relativeHomePath
    ? `~/${relativeHomePath.split(sep).join("/")}`
    : "~";
  return /^[A-Za-z0-9_./~-]+$/.test(portablePath)
    ? portablePath
    : `"$HOME/${relativeHomePath
        .split(sep)
        .join("/")
        .replaceAll("\\", "\\\\")
        .replaceAll('"', '\\"')
        .replaceAll("$", "\\$")
        .replaceAll("`", "\\`")}"`;
}

export function getHookCommand(source, installedRecorderFile, astroHome) {
  const parts = [
    `ASTRO_HOME=${shellPath(astroHome)}`,
    "node",
    shellPath(installedRecorderFile),
    `--source=${source}`,
  ];
  if (source === "codex") {
    parts.push("--quiet");
  }
  return parts.join(" ");
}

function readConfig(configFile) {
  if (!existsSync(configFile)) {
    return { hooks: {} };
  }
  const parsed = JSON.parse(readFileSync(configFile, "utf8"));
  return {
    ...parsed,
    hooks: parsed.hooks || {},
  };
}

function isInstalled(group, source) {
  return group.hooks?.some(
    (hook) =>
      (hook.command?.includes("trace-recorder.cjs") ||
        hook.command?.includes("hook-recorder.cjs")) &&
      hook.command?.includes(`--source=${source}`),
  );
}

function installHookConfig(configFile, source, hookCommand) {
  const config = readConfig(configFile);
  if (source === "trae") {
    config.version ||= 1;
  }

  for (const [name, matcher] of eventDefinitions[source]) {
    const groups = config.hooks[name] || [];
    const installedGroup = groups.find((group) => isInstalled(group, source));
    if (installedGroup) {
      const installedHook = installedGroup.hooks.find(
        (hook) =>
          (hook.command?.includes("trace-recorder.cjs") ||
            hook.command?.includes("hook-recorder.cjs")) &&
          hook.command?.includes(`--source=${source}`),
      );
      installedHook.command = hookCommand;
      installedHook.timeout = 5;
    } else {
      const group = {
        hooks: [
          {
            type: "command",
            command: hookCommand,
            timeout: 5,
          },
        ],
      };
      if (matcher) {
        group.matcher = matcher;
      }
      groups.push(group);
      config.hooks[name] = groups;
    }
  }

  mkdirSync(dirname(configFile), { recursive: true });
  writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return configFile;
}

export function getInstalledRuntimePaths(astroHome) {
  const pluginDir = join(astroHome, "plugins", "astro");
  return {
    configFile: join(pluginDir, "config.yaml"),
    dashboardFile: join(pluginDir, "server", "server.mjs"),
    envFile: join(pluginDir, ".env"),
    pluginDir,
    recorderFile: join(pluginDir, "plugin", "trace-recorder.cjs"),
  };
}

function copyRuntimeDependencies(runtimePluginDir) {
  const vendorDir = join(runtimePluginDir, "vendor");
  rmSync(vendorDir, { recursive: true, force: true });
  mkdirSync(vendorDir, { recursive: true });
  for (const dependency of runtimeDependencies) {
    const source = dirname(require.resolve(`${dependency}/package.json`));
    cpSync(source, join(vendorDir, dependency), {
      filter: (candidate) => {
        const name = relative(source, candidate);
        if (!name) {
          return true;
        }
        if (statSync(candidate).isDirectory()) {
          return dependency === "yaml"
            ? name === "dist" || name.startsWith(`dist${sep}`)
            : name === "lib";
        }
        if (name === "package.json" || name === "LICENSE") {
          return true;
        }
        return dependency === "yaml"
          ? name.startsWith(`dist${sep}`) && name.endsWith(".js")
          : name === join("lib", "main.js");
      },
      recursive: true,
    });
  }
}

function installDeepseekPluginRuntime(runtime, astroHome) {
  const destination = join(runtime.pluginDir, "deepseek-plugin");
  rmSync(destination, { recursive: true, force: true });
  mkdirSync(destination, { recursive: true });
  for (const file of [
    "index.js",
    "cordis.patch.yml",
    "package.json",
    "README.md",
  ]) {
    copyFileSync(join(deepseekPluginSource, file), join(destination, file));
  }
  const manifestFile = join(destination, "package.json");
  const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
  manifest.version = packageMetadata.version;
  writeFileSync(
    manifestFile,
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  writeFileSync(
    join(destination, "cordis.patch.yml"),
    `- insert:\n    - id: astro-trace\n      name: dsh-astro-plugin\n      config:\n        astroHome: ${JSON.stringify(astroHome)}\n`,
    "utf8",
  );
  for (const directory of ["plugin", "dist", "server"]) {
    const source = join(packageDir, directory);
    if (existsSync(source)) {
      cpSync(source, join(destination, directory), { recursive: true });
    }
  }
  for (const file of ["config.example.yaml", ".env.example"]) {
    copyFileSync(join(packageDir, file), join(destination, file));
  }
  copyRuntimeDependencies(join(destination, "plugin"));
  return destination;
}

export function installPluginRuntime(astroHome) {
  const runtime = getInstalledRuntimePaths(astroHome);
  const runtimePluginDir = join(runtime.pluginDir, "plugin");
  mkdirSync(runtimePluginDir, { recursive: true });
  initializeRuntimeConfig({
    astroHome,
    environment: { ASTRO_HOME: astroHome },
    pluginDir: runtime.pluginDir,
    templateDir: packageDir,
  });
  copyFileSync(recorderFile, runtime.recorderFile);
  copyFileSync(runtimeConfigFile, join(runtimePluginDir, "runtime-config.cjs"));
  copyFileSync(storagePathsFile, join(runtimePluginDir, "storage-paths.cjs"));
  copyRuntimeDependencies(runtimePluginDir);
  for (const directory of ["dist", "server"]) {
    const source = join(packageDir, directory);
    if (!existsSync(source)) {
      continue;
    }
    const destination = join(runtime.pluginDir, directory);
    rmSync(destination, { recursive: true, force: true });
    cpSync(source, destination, { recursive: true });
  }
  writeFileSync(
    join(runtime.pluginDir, "plugin.json"),
    `${JSON.stringify(
      {
        id: "astro",
        name: "ASTRO",
        fullName: "Agent State Trace & Runtime Observations",
        version: packageMetadata.version,
        config: runtime.configFile,
        entry: runtime.recorderFile,
        environment: runtime.envFile,
        dashboard: existsSync(runtime.dashboardFile)
          ? runtime.dashboardFile
          : null,
        dataRoot: astroHome,
        clients: [...supportedClients],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  installDeepseekPluginRuntime(runtime, astroHome);
  return runtime;
}

/**
 * Refresh already-installed plugin content in place. Re-copies the runtime
 * recorder, vendor dependencies, dist/server bundles and the DeepSeek plugin
 * into the existing ASTRO_HOME, preserving user hook configs and trace data.
 * Intended for "update plugin content" after pulling a newer build: it does
 * NOT re-create hook integrations or migrate data (that is `installClients`).
 */
export function updateInstalledPlugins({
  astroHome,
  environment = process.env,
  refreshDeepseek = true,
} = {}) {
  const resolvedAstroHome = resolveAstroHome({
    ...environment,
    ASTRO_HOME: astroHome || environment.ASTRO_HOME,
  });
  const runtime = getInstalledRuntimePaths(resolvedAstroHome);
  if (!existsSync(runtime.pluginDir)) {
    throw new Error(
      `No installed ASTRO plugin found under ${runtime.pluginDir}. Run "astro-trace install" first.`,
    );
  }
  const runtimePluginDir = join(runtime.pluginDir, "plugin");
  mkdirSync(runtimePluginDir, { recursive: true });
  initializeRuntimeConfig({
    astroHome: resolvedAstroHome,
    environment: { ASTRO_HOME: resolvedAstroHome },
    pluginDir: runtime.pluginDir,
    templateDir: packageDir,
  });
  copyFileSync(recorderFile, runtime.recorderFile);
  copyFileSync(runtimeConfigFile, join(runtimePluginDir, "runtime-config.cjs"));
  copyFileSync(storagePathsFile, join(runtimePluginDir, "storage-paths.cjs"));
  copyRuntimeDependencies(runtimePluginDir);
  for (const directory of ["dist", "server"]) {
    const source = join(packageDir, directory);
    if (!existsSync(source)) {
      continue;
    }
    const destination = join(runtime.pluginDir, directory);
    rmSync(destination, { recursive: true, force: true });
    cpSync(source, destination, { recursive: true });
  }
  writeFileSync(
    join(runtime.pluginDir, "plugin.json"),
    `${JSON.stringify(
      {
        id: "astro",
        name: "ASTRO",
        fullName: "Agent State Trace & Runtime Observations",
        version: packageMetadata.version,
        config: runtime.configFile,
        entry: runtime.recorderFile,
        environment: runtime.envFile,
        dashboard: existsSync(runtime.dashboardFile)
          ? runtime.dashboardFile
          : null,
        dataRoot: resolvedAstroHome,
        clients: [...supportedClients],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  if (refreshDeepseek) {
    installDeepseekPluginRuntime(runtime, resolvedAstroHome);
  }
  return runtime;
}

export function resolveHomePath(value, fallback) {
  const selected = value || fallback;
  if (selected === "~") {
    return homedir();
  }
  if (selected.startsWith("~/")) {
    return resolve(homedir(), selected.slice(2));
  }
  return resolve(selected);
}

export function installDeepseekPlugin({
  runtime,
  profile = "web",
  dshHome,
  command = process.env.DSH_COMMAND || "dsh",
  environment = process.env,
  run = spawnSync,
  cwd = process.cwd(),
}) {
  const pluginDirectory = join(runtime.pluginDir, "deepseek-plugin");
  const resolvedDshHome = resolveHomePath(
    dshHome || environment.DSH_HOME,
    join(homedir(), ".dsh"),
  );
  const pluginArguments = [
    "plugin",
    "--profile",
    profile,
    "add",
    `file:${pluginDirectory}`,
  ];
  const runOptions = {
    cwd,
    encoding: "utf8",
    env: {
      ...environment,
      DSH_HOME: resolvedDshHome,
    },
    stdio: "inherit",
  };
  let invokedCommand = command;
  let result = run(invokedCommand, pluginArguments, runOptions);
  if (result.error?.code === "ENOENT" && command === "dsh") {
    invokedCommand = "npx";
    result = run(
      invokedCommand,
      ["--yes", "@deepseek-ai/dsh", ...pluginArguments],
      runOptions,
    );
  }
  if (result.error?.code === "ENOENT") {
    throw new Error(
      `DeepSeek Harness launcher "${invokedCommand}" was not found. Install @deepseek-ai/dsh or pass --deepseek-command.`,
    );
  }
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `DeepSeek Harness plugin installation failed with exit code ${result.status}.`,
    );
  }
  return join(resolvedDshHome, "profiles", profile, "package.json");
}

export function installClients({
  targetDir = process.cwd(),
  clients = ["trae", "claude", "codex"],
  codexHome,
  claudeHome,
  workbuddyHome,
  dshHome,
  deepseekProfile = "web",
  deepseekCommand,
  deepseekRun = spawnSync,
  environment = process.env,
  astroHome,
  aotHome,
  scope = "project",
} = {}) {
  const unsupportedClients = clients.filter(
    (client) => !supportedClients.has(client),
  );
  if (unsupportedClients.length) {
    throw new Error(
      `Unsupported ASTRO client(s): ${unsupportedClients.join(", ")}. Supported clients: ${[...supportedClients].join(", ")}.`,
    );
  }
  const target = resolve(targetDir);
  const resolvedAstroHome = resolveAstroHome({
    ...environment,
    ASTRO_HOME:
      astroHome ||
      aotHome ||
      environment.ASTRO_HOME,
  });
  const sharedRuntime = installPluginRuntime(resolvedAstroHome);
  const loadedConfig = loadRuntimeConfig({
    astroHome: resolvedAstroHome,
    environment: {
      ...environment,
      ASTRO_HOME: resolvedAstroHome,
    },
  });
  const effectiveEnvironment = loadedConfig.environment;
  const resolvedCodexHome =
    codexHome || effectiveEnvironment.CODEX_HOME || join(homedir(), ".codex");
  const resolvedClaudeHome =
    claudeHome ||
    effectiveEnvironment.CLAUDE_HOME ||
    join(homedir(), ".claude");
  const resolvedWorkbuddyHome =
    workbuddyHome ||
    effectiveEnvironment.CODEBUDDY_HOME ||
    join(homedir(), ".codebuddy");
  const resolvedDshHome =
    dshHome || effectiveEnvironment.DSH_HOME || join(homedir(), ".dsh");
  const resolvedDeepseekCommand =
    deepseekCommand || effectiveEnvironment.DSH_COMMAND || "dsh";
  const installed = [];

  if (clients.includes("trae")) {
    installed.push(
      installHookConfig(
        join(target, ".trae", "hooks.json"),
        "trae",
        getHookCommand(
          "trae",
          sharedRuntime.recorderFile,
          resolvedAstroHome,
        ),
      ),
    );
  }
  if (clients.includes("claude")) {
    const claudeConfig =
      scope === "user"
        ? join(
            resolveHomePath(resolvedClaudeHome, join(homedir(), ".claude")),
            "settings.json",
          )
        : join(target, ".claude", "settings.local.json");
    installed.push(
      installHookConfig(
        claudeConfig,
        "claude",
        getHookCommand(
          "claude",
          sharedRuntime.recorderFile,
          resolvedAstroHome,
        ),
      ),
    );
  }
  if (clients.includes("workbuddy")) {
    const workbuddyConfig =
      scope === "user"
        ? join(
            resolveHomePath(
              resolvedWorkbuddyHome,
              join(homedir(), ".codebuddy"),
            ),
            "settings.json",
          )
        : join(target, ".codebuddy", "settings.json");
    installed.push(
      installHookConfig(
        workbuddyConfig,
        "workbuddy",
        getHookCommand(
          "workbuddy",
          sharedRuntime.recorderFile,
          resolvedAstroHome,
        ),
      ),
    );
  }
  if (clients.includes("codex")) {
    installed.push(
      installHookConfig(
        join(
          resolveHomePath(resolvedCodexHome, join(homedir(), ".codex")),
          "hooks.json",
        ),
        "codex",
        getHookCommand("codex", sharedRuntime.recorderFile, resolvedAstroHome),
      ),
    );
  }
  if (clients.includes("deepseek")) {
    installed.push(
      installDeepseekPlugin({
        runtime: sharedRuntime,
        profile: deepseekProfile,
        dshHome: resolvedDshHome,
        command: resolvedDeepseekCommand,
        environment: effectiveEnvironment,
        run: deepseekRun,
        cwd: target,
      }),
    );
  }

  return installed;
}

export function openInstalledDashboard({
  clients,
  targetDir = process.cwd(),
  astroHome,
  environment = process.env,
  dependencies = {},
}) {
  const source = clients.includes("trae")
    ? "trae"
    : clients.includes("codex")
      ? "codex"
      : clients[0] || "generic";
  const sharedRuntimeHome = resolveAstroHome({
    ...environment,
    ASTRO_HOME:
      astroHome ||
      environment.ASTRO_HOME,
  });
  const runtime = getInstalledRuntimePaths(sharedRuntimeHome);
  if (!existsSync(runtime.dashboardFile)) {
    return false;
  }
  const effectiveEnvironment = loadRuntimeConfig({
    astroHome: sharedRuntimeHome,
    environment: {
      ...environment,
      ASTRO_HOME: sharedRuntimeHome,
    },
  }).environment;

  return launchDashboardForEvents(
    [{
      eventName: "UserPromptSubmit",
      source,
      sessionId: "unknown-session",
    }],
    {
      ...effectiveEnvironment,
      ASTRO_HOME: sharedRuntimeHome,
    },
    {
      ...dependencies,
      dashboardFile: runtime.dashboardFile,
      reopenExisting: true,
    },
  );
}

function getOption(name) {
  const inline = process.argv.find((argument) =>
    argument.startsWith(`--${name}=`),
  );
  if (inline) {
    return inline.slice(name.length + 3);
  }
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : null;
}

const invokedFile = process.argv[1] ? realpathSync(process.argv[1]) : "";
if (invokedFile === realpathSync(fileURLToPath(import.meta.url))) {
  const targetDir = getOption("target") || process.cwd();
  const clients = (getOption("clients") || "trae,claude,codex")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const codexHome = getOption("codex-home") || undefined;
  const claudeHome = getOption("claude-home") || undefined;
  const workbuddyHome = getOption("workbuddy-home") || undefined;
  const dshHome = getOption("dsh-home") || undefined;
  const deepseekProfile = getOption("deepseek-profile") || undefined;
  const deepseekCommand = getOption("deepseek-command") || undefined;
  const astroHome =
    getOption("astro-home") || getOption("aot-home") || undefined;
  const scope = getOption("scope") === "user" ? "user" : "project";
  const installed = installClients({
    targetDir,
    clients,
    codexHome,
    claudeHome,
    workbuddyHome,
    dshHome,
    deepseekProfile,
    deepseekCommand,
    astroHome,
    environment: process.env,
    scope,
  });
  const loadedConfig = loadRuntimeConfig({
    astroHome,
    environment: process.env,
  });
  for (const diagnostic of loadedConfig.diagnostics) {
    console.error(formatRuntimeConfigDiagnostic(diagnostic));
  }
  console.log(`ASTRO configuration: ${loadedConfig.files.config.path}`);
  console.log(`ASTRO environment: ${loadedConfig.files.env.path}`);
  for (const file of installed) {
    console.log(`Installed ASTRO integration in ${file}`);
  }
  if (!process.argv.includes("--no-migrate")) {
    const sharedMigrationEnvironment = {
      ...loadedConfig.environment,
    };
    const layoutResult = migrateSessionPathLayout(
      resolveAstroHome(sharedMigrationEnvironment),
    );
    if (layoutResult.migratedDirectories) {
      console.log(
        `Migrated ${layoutResult.migratedDirectories} session directories to the HH_mm_ss layout.`,
      );
    }
    const result = migrateTraceData(
      join(resolve(targetDir), ".agent-trace"),
      sharedMigrationEnvironment,
    );
    if (result.migrated) {
      console.log(
        `Migrated ${result.migrated} events into ${result.outputs.join(", ")}`,
      );
    }
    const legacyAotResult = migrateLegacyAotHome(
      join(homedir(), ".aot"),
      sharedMigrationEnvironment,
    );
    if (legacyAotResult.migrated) {
      console.log(
        `Migrated ${legacyAotResult.migrated} legacy ~/.astrox events into ${legacyAotResult.outputs.join(", ")}`,
      );
    }
    const flatAstroResult = migrateLegacyAotHome(
      resolveAstroHome(sharedMigrationEnvironment),
      sharedMigrationEnvironment,
    );
    if (flatAstroResult.migrated) {
      console.log(
        `Split ${flatAstroResult.migrated} existing ASTRO events into ${flatAstroResult.outputs.join(", ")}`,
      );
    }
    const projectAstroResult = migrateLegacyAotHome(
      join(resolve(targetDir), ".astrox"),
      sharedMigrationEnvironment,
    );
    if (projectAstroResult.migrated) {
      console.log(
        `Migrated ${projectAstroResult.migrated} project ASTRO events into ${projectAstroResult.outputs.join(", ")}`,
      );
    }
  }
  const runtime = getInstalledRuntimePaths(
    resolveAstroHome(loadedConfig.environment),
  );
  if (existsSync(runtime.dashboardFile)) {
    const opened = openInstalledDashboard({
      clients,
      targetDir,
      astroHome,
      environment: loadedConfig.environment,
    });
    console.log(
      opened
        ? "Started or opened the ASTRO dashboard."
        : "The ASTRO dashboard is installed; automatic opening is disabled.",
    );
    console.log(`Manual start: node ${runtime.dashboardFile}`);
  }
}
