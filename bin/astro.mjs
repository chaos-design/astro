#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { extname, join, resolve } from "node:path";
import chatgptAdapter from "../plugin/chatgpt-adapter.cjs";
import recorder from "../plugin/trace-recorder.cjs";
import runtimeConfigLoader from "../plugin/runtime-config.cjs";
import storagePaths from "../plugin/storage-paths.cjs";
import {
  getInstalledRuntimePaths,
  installClients,
  openInstalledDashboard,
  updateInstalledPlugins,
} from "../scripts/install-plugins.mjs";
import {
  getTraceStats,
  hasDeepseekPlugin,
  hasInstalledHook,
  inspectExecutable,
  inspectNativePlugin,
} from "../plugin/client-status.mjs";
import {
  migrateLegacyAotHome,
  migrateSessionPathLayout,
  migrateTraceData,
} from "../scripts/migrate-data.mjs";

const command = process.argv[2] || "help";

/**
 * Daemon-control commands the astrox CLI owns. `npx astro-plugin ax` runs this
 * package's own bin (the bin named after the package), so these names are
 * forwarded to bin/astrox.mjs unchanged — the same handlers `astrox` and `ax`
 * use, never a second start path or a second status collector.
 */
const ASTROX_DELEGATED_COMMANDS = new Set([
  "ax",
  "info",
  "logs",
  "open",
  "path",
  "restart",
  "status",
  "stop",
  "up",
]);

function delegateToAstrox() {
  const result = spawnSync(
    process.execPath,
    [join(import.meta.dirname, "astrox.mjs"), ...process.argv.slice(2)],
    { stdio: "inherit" },
  );
  if (result.error) {
    throw result.error;
  }
  process.exitCode = result.status ?? 1;
}

const { expandHome, resolveAstroHome } = storagePaths;
const {
  formatRuntimeConfigDiagnostic,
  loadRuntimeConfig,
} = runtimeConfigLoader;
let loadedRuntimeConfig = null;

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

function getPositionalArguments() {
  const optionsWithValues = new Set([
    "--source",
    "--target",
    "--clients",
    "--chatgpt-home",
    "--claude-home",
    "--workbuddy-home",
    "--dsh-home",
    "--deepseek-profile",
    "--deepseek-command",
    "--astro-home",
    "--aot-home",
    "--scope",
  ]);
  const values = [];
  for (let index = 3; index < process.argv.length; index += 1) {
    const argument = process.argv[index];
    if (argument.startsWith("--")) {
      if (!argument.includes("=") && optionsWithValues.has(argument)) {
        index += 1;
      }
      continue;
    }
    values.push(argument);
  }
  return values;
}

function getRuntimeConfig({ initialize = true } = {}) {
  if (loadedRuntimeConfig) {
    return loadedRuntimeConfig;
  }
  const astroHome =
    getOption("astro-home") || getOption("aot-home") || undefined;
  loadedRuntimeConfig = loadRuntimeConfig({
    astroHome,
    environment: process.env,
    initialize,
    strictInitialization: command === "install",
    overrides: astroHome ? { ASTRO_HOME: astroHome } : {},
  });
  for (const diagnostic of loadedRuntimeConfig.diagnostics) {
    console.error(formatRuntimeConfigDiagnostic(diagnostic));
  }
  return loadedRuntimeConfig;
}

function walkJsonlFiles(root, output = []) {
  if (!existsSync(root)) {
    return output;
  }
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const entryPath = join(root, entry.name);
    if (entry.isDirectory()) {
      walkJsonlFiles(entryPath, output);
    } else if (entry.isFile() && extname(entry.name) === ".jsonl") {
      output.push(entryPath);
    }
  }
  return output;
}

function getEnvironment() {
  return getRuntimeConfig().environment;
}

function readStdin() {
  return new Promise((resolveInput, reject) => {
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      input += chunk;
    });
    process.stdin.on("end", () => resolveInput(input));
    process.stdin.on("error", reject);
  });
}

async function importChatGPT() {
  const requestedFiles = getPositionalArguments().map((file) => resolve(expandHome(file)));
  const chatgptHome = resolve(
    expandHome(
      getOption("chatgpt-home") ||
        getEnvironment().CHATGPT_HOME ||
        join(homedir(), ".chatgpt"),
    ),
  );
  const files = requestedFiles.length
    ? requestedFiles
    : [
        ...walkJsonlFiles(join(chatgptHome, "sessions")),
        ...walkJsonlFiles(join(chatgptHome, "archived_sessions")),
      ];
  const readableFiles = files.filter(
    (file) => existsSync(file) && statSync(file).isFile(),
  );
  const events = chatgptAdapter.importChatGPTFiles(readableFiles, getEnvironment());
  console.log(
    `Imported ${events.length} new events from ${readableFiles.length} ChatGPT session files.`,
  );
}

async function ingest() {
  const [file] = getPositionalArguments();
  const text = file ? readFileSync(resolve(file), "utf8") : await readStdin();
  const payloads = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(JSON.parse);
  const events = recorder.appendTraceEvents(payloads, getEnvironment(), {
    source: getOption("source") || undefined,
  });
  console.log(`Ingested ${events.length} events.`);
}

function install() {
  const clients = (getOption("clients") || "trae,claude,chatgpt")
    .split(",")
    .map((client) => client.trim().toLowerCase())
    .filter(Boolean);
  const targetDir = getOption("target") || process.cwd();
  const astroHome =
    getOption("astro-home") ||
    getOption("aot-home") ||
    process.env.ASTRO_HOME ||
    process.env.AOT_HOME;
  const scope = getOption("scope") === "project" ? "project" : "user";
  const installed = installClients({
    targetDir,
    clients,
    chatgptHome: getOption("chatgpt-home") || undefined,
    claudeHome: getOption("claude-home") || undefined,
    workbuddyHome: getOption("workbuddy-home") || undefined,
    dshHome: getOption("dsh-home") || undefined,
    deepseekProfile: getOption("deepseek-profile") || undefined,
    deepseekCommand: getOption("deepseek-command") || undefined,
    astroHome,
    environment: process.env,
    scope,
  });
  loadedRuntimeConfig = null;
  const runtimeConfig = getRuntimeConfig({ initialize: false });
  console.log(`ASTRO configuration: ${runtimeConfig.files.config.path}`);
  console.log(`ASTRO environment: ${runtimeConfig.files.env.path}`);
  for (const file of installed) {
    console.log(`Installed ASTRO integration in ${file}`);
  }
  if (!process.argv.includes("--no-migrate")) {
    const sharedMigrationEnvironment = runtimeConfig.environment;
    printLayoutMigrationResult(
      migrateSessionPathLayout(resolveAstroHome(sharedMigrationEnvironment)),
    );
    printMigrationResult(
      migrateTraceData(
        join(resolve(targetDir), ".agent-trace"),
        sharedMigrationEnvironment,
      ),
    );
    printMigrationResult(
      migrateLegacyAotHome(
        join(homedir(), ".aot"),
        sharedMigrationEnvironment,
      ),
    );
    printMigrationResult(
      migrateLegacyAotHome(
        resolveAstroHome(sharedMigrationEnvironment),
        sharedMigrationEnvironment,
      ),
    );
    printMigrationResult(
      migrateLegacyAotHome(
        join(resolve(targetDir), ".astrox"),
        sharedMigrationEnvironment,
      ),
    );
  }
  const runtime = getInstalledRuntimePaths(
    resolveAstroHome(runtimeConfig.environment),
  );
  if (existsSync(runtime.dashboardFile)) {
    const opened = openInstalledDashboard({
      clients,
      targetDir,
      astroHome,
      environment: runtimeConfig.environment,
    });
    console.log(
      opened
        ? "Started or opened the ASTRO dashboard."
        : "The ASTRO dashboard is installed; automatic opening is disabled.",
    );
    console.log(`Manual start: node ${runtime.dashboardFile}`);
  }
}

function update() {
  const astroHome =
    getOption("astro-home") ||
    getOption("aot-home") ||
    process.env.ASTRO_HOME ||
    process.env.AOT_HOME;
  const refreshDeepseek = !process.argv.includes("--no-deepseek");
  const runtime = updateInstalledPlugins({
    astroHome,
    environment: process.env,
    refreshDeepseek,
  });
  loadedRuntimeConfig = null;
  const runtimeConfig = getRuntimeConfig({ initialize: false });
  console.log(`Updated ASTRO plugin runtime in ${runtime.pluginDir}`);
  console.log(`ASTRO configuration: ${runtimeConfig.files.config.path}`);
  console.log(`ASTRO environment: ${runtimeConfig.files.env.path}`);
  console.log(
    "Hook integrations and trace data were left untouched. " +
      "Re-run 'astro-trace install' to refresh hooks or migrate data.",
  );
  if (existsSync(runtime.dashboardFile)) {
    console.log(`Manual start: node ${runtime.dashboardFile}`);
  }
}

function printLayoutMigrationResult(result) {
  console.log(
    `Migrated ${result.migratedDirectories} session directories ` +
      `(${result.renamedDirectories} renamed, ${result.mergedDirectories} merged).`,
  );
  for (const output of result.outputs) {
    console.log(`Session data: ${output}`);
  }
}

function printMigrationResult(result) {
  console.log(
    `Migrated ${result.migrated} events; skipped ${result.skipped} existing events.`,
  );
  for (const output of result.outputs) {
    console.log(`Trace data: ${output}`);
  }
}

function migrate() {
  const [inputPath] = getPositionalArguments();
  const environment = getEnvironment();
  if (inputPath) {
    const resolvedInput = resolve(inputPath);
    printMigrationResult(migrateTraceData(resolvedInput, environment));
    if (existsSync(resolvedInput) && statSync(resolvedInput).isDirectory()) {
      printMigrationResult(migrateLegacyAotHome(resolvedInput, environment));
    }
    return;
  }

  printLayoutMigrationResult(
    migrateSessionPathLayout(resolveAstroHome(environment)),
  );
  printMigrationResult(
    migrateTraceData(join(process.cwd(), ".agent-trace"), environment),
  );
  printMigrationResult(
    migrateLegacyAotHome(join(homedir(), ".aot"), environment),
  );
  printMigrationResult(
    migrateLegacyAotHome(resolveAstroHome(environment), environment),
  );
  printMigrationResult(
    migrateLegacyAotHome(join(process.cwd(), ".astrox"), environment),
  );
}

function doctor() {
  const targetDir = resolve(getOption("target") || process.cwd());
  const runtimeConfig = getRuntimeConfig();
  const environment = runtimeConfig.environment;
  const astroHome = resolveAstroHome(environment);
  const scope = getOption("scope") === "project" ? "project" : "user";
  const chatgptHome = resolve(
    expandHome(
      getOption("chatgpt-home") ||
      environment.CHATGPT_HOME ||
      join(homedir(), ".chatgpt"),
    ),
  );
  const claudeHome = resolve(
    expandHome(
      getOption("claude-home") ||
      environment.CLAUDE_HOME ||
      join(homedir(), ".claude"),
    ),
  );
  const workbuddyHome = resolve(
    expandHome(
      getOption("workbuddy-home") ||
        environment.CODEBUDDY_HOME ||
        join(homedir(), ".codebuddy"),
    ),
  );
  const dshHome = resolve(
    expandHome(
      getOption("dsh-home") ||
      environment.DSH_HOME ||
      join(homedir(), ".dsh"),
    ),
  );
  const deepseekProfile = getOption("deepseek-profile") || "web";
  const deepseekCommand =
    getOption("deepseek-command") ||
    environment.DSH_COMMAND ||
    "dsh";
  const runtime = getInstalledRuntimePaths(astroHome);
  const chatgptCli = inspectExecutable("chatgpt");
  const claudeCli = inspectExecutable("claude");
  const workbuddyCli = inspectExecutable(
    environment.CODEBUDDY_COMMAND || "codebuddy",
  );
  const deepseekCli = inspectExecutable(deepseekCommand);
  const chatgptDirect = hasInstalledHook(
    join(chatgptHome, "hooks.json"),
    "chatgpt",
  );
  const claudeConfig =
    scope === "user"
      ? join(claudeHome, "settings.json")
      : join(targetDir, ".claude", "settings.local.json");
  const claudeDirect = hasInstalledHook(claudeConfig, "claude");
  const workbuddyConfig =
    scope === "user"
      ? join(workbuddyHome, "settings.json")
      : join(targetDir, ".codebuddy", "settings.json");
  const workbuddyDirect = hasInstalledHook(
    workbuddyConfig,
    "workbuddy",
  );
  const traeConfig = join(targetDir, ".trae", "hooks.json");
  const traeDirect = hasInstalledHook(traeConfig, "trae");
  const chatgptNative = chatgptCli.available
    ? inspectNativePlugin("chatgpt")
    : { installed: false, detail: "" };
  const claudeNative = claudeCli.available
    ? inspectNativePlugin("claude")
    : { installed: false, detail: "" };
  const workbuddyNative = workbuddyCli.available
    ? inspectNativePlugin(environment.CODEBUDDY_COMMAND || "codebuddy")
    : { installed: false, detail: "" };
  const deepseekPlugin = hasDeepseekPlugin(dshHome, deepseekProfile);
  const integrationCheck = (label, direct, native, configFile) => ({
    label,
    status:
      direct && native
        ? "WARN"
        : direct || native
          ? "OK"
          : "MISSING",
    path:
      direct && native
        ? `native plugin and direct hooks both enabled; remove one (${configFile})`
        : native
          ? "native plugin"
          : configFile,
  });
  const checks = [
    {
      label: "config.yaml",
      status: !runtimeConfig.files.config.exists
        ? "MISSING"
        : runtimeConfig.files.config.valid
          ? "OK"
          : "WARN",
      path: runtimeConfig.files.config.path,
    },
    {
      label: ".env",
      status: !runtimeConfig.files.env.exists
        ? "MISSING"
        : runtimeConfig.files.env.valid
          ? "OK"
          : "WARN",
      path: runtimeConfig.files.env.path,
    },
    {
      label: "runtime",
      ok: existsSync(runtime.recorderFile),
      path: runtime.recorderFile,
    },
    {
      label: "dashboard",
      ok: existsSync(runtime.dashboardFile),
      path: runtime.dashboardFile,
    },
    {
      label: "chatgpt CLI",
      ok: chatgptCli.available,
      path: chatgptCli.version || "not found on PATH",
    },
    integrationCheck(
      "chatgpt integration",
      chatgptDirect,
      chatgptNative.installed,
      join(chatgptHome, "hooks.json"),
    ),
    {
      label: "claude CLI",
      ok: claudeCli.available,
      path: claudeCli.version || "not found on PATH",
    },
    integrationCheck(
      "claude integration",
      claudeDirect,
      claudeNative.installed,
      claudeConfig,
    ),
    {
      label: "workbuddy CLI",
      ok: workbuddyCli.available,
      path: workbuddyCli.version || "codebuddy not found on PATH",
    },
    integrationCheck(
      "workbuddy integration",
      workbuddyDirect,
      workbuddyNative.installed,
      workbuddyConfig,
    ),
    {
      label: "deepseek CLI",
      ok: deepseekCli.available,
      path:
        deepseekCli.version ||
        "dsh not found on PATH (installer can use npx)",
    },
    {
      label: `deepseek integration (${deepseekProfile})`,
      ok: deepseekPlugin.installed,
      path: deepseekPlugin.profileFile,
    },
    {
      label: "trae integration",
      ok: traeDirect,
      path: traeConfig,
    },
  ];

  for (const check of checks) {
    console.log(
      `${check.status || (check.ok ? "OK" : "MISSING")}  ${check.label}: ${check.path}`,
    );
  }
  for (const source of [
    "chatgpt",
    "claude",
    "deepseek",
    "trae",
    "workbuddy",
  ]) {
    const stats = getTraceStats(astroHome, source);
    console.log(
      `${stats.bytes ? "DATA" : "EMPTY"}  ${source}: ${stats.root} (${stats.files.length} files, ${stats.bytes} bytes)`,
    );
  }
}

function printHelp() {
  console.log(`ASTRO - Agent State Trace & Runtime Observations

Usage:
  astro-trace install [--clients trae,claude,chatgpt,deepseek,workbuddy] [--scope user|project]
  astro-trace update [--no-deepseek]
  astro-trace serve
  astro-trace doctor [--scope user|project] [--deepseek-profile web]
  astro-trace migrate [FILE_OR_DIR]
  astro-trace import-chatgpt [FILE ...] [--chatgpt-home DIR]
  astro-trace ingest [FILE] [--source NAME]
  astro-trace ax [--json]        Quick start + service/integration status
  astro-trace status|stop|restart|up|open|logs|info|path
                                 Daemon control (delegates to astrox)
  astro-trace --version          Print the CLI version

Quick start without a global install:
  npx astro-plugin ax            Same flow as the "ax" command
  npx astro-plugin status        Any astrox command works the same way

Configuration:
  <ASTRO_HOME>/plugins/astro/config.yaml  Structured plugin configuration
  <ASTRO_HOME>/plugins/astro/.env         Local and sensitive variable values

Environment:
  ASTRO_HOME            Bootstrap runtime and trace root (default ~/.astrox)
  ASTRO_TRACE_DIR       Optional shared trace directory override
  ASTRO_HOST            Dashboard host (default 127.0.0.1)
  ASTRO_PORT            Dashboard port (default 5678)
  ASTRO_AUTO_OPEN       Open dashboard during install or Agent startup (default 1)
  ASTRO_MAX_BODY_BYTES  Maximum ingestion body (default 5242880)
  DSH_HOME              DeepSeek Harness home (default ~/.dsh)
  DSH_COMMAND           DeepSeek Harness executable (default dsh)
  CODEBUDDY_HOME        WorkBuddy / CodeBuddy config root (default ~/.codebuddy)
  CODEBUDDY_COMMAND     WorkBuddy / CodeBuddy executable (default codebuddy)`);
}

if (command === "help" || command === "--help" || command === "-h") {
  printHelp();
} else if (command === "--version" || command === "-v") {
  try {
    console.log(
      JSON.parse(
        readFileSync(join(import.meta.dirname, "..", "package.json"), "utf8"),
      ).version,
    );
  } catch {
    console.log("unknown");
  }
} else if (command === "serve" || command === "start") {
  await import("../server/server.mjs");
} else if (command === "install") {
  install();
} else if (command === "update") {
  update();
} else if (command === "doctor") {
  doctor();
} else if (command === "migrate") {
  migrate();
} else if (command === "import-chatgpt") {
  await importChatGPT();
} else if (command === "ingest") {
  await ingest();
} else if (ASTROX_DELEGATED_COMMANDS.has(command)) {
  delegateToAstrox();
} else {
  console.error(`Unknown astro-trace command: ${command}`);
  printHelp();
  process.exitCode = 1;
}
