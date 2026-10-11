#!/usr/bin/env node

/**
 * astrox - plugin control CLI.
 *
 * A thin command surface over the ASTRO plugin runtime: start or stop the
 * dashboard daemon, refresh installed plugins, and inspect plugin status and
 * ASTROX data. `astrox start` also registers this entry as a global `astrox`
 * command; `astrox stop` terminates the daemon without extra cleanup.
 */

import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import runtimeConfigLoader from "../plugin/runtime-config.cjs";
import storagePaths from "../plugin/storage-paths.cjs";
import {
  getTraceStats,
  hasDeepseekPlugin,
  hasInstalledHook,
} from "../plugin/client-status.mjs";
import {
  getInstalledRuntimePaths,
  updateInstalledPlugins,
} from "../scripts/install-plugins.mjs";

const { expandHome, resolveAstroHome } = storagePaths;
const { formatRuntimeConfigDiagnostic, loadRuntimeConfig } =
  runtimeConfigLoader;

const CLI_NAME = "astrox";
const ENTRY_FILE = fileURLToPath(import.meta.url);
const PACKAGE_DIR = resolve(dirname(ENTRY_FILE), "..");
const ASTRO_CLI_FILE = join(PACKAGE_DIR, "bin", "astro.mjs");
const IS_WINDOWS = platform() === "win32";
/** Sources inspected by `status` and `info`. */
const TRACE_SOURCES = [
  "claude",
  "codex",
  "copilot",
  "cursor",
  "deepseek",
  "gemini",
  "iflow",
  "llama",
  "opencode",
  "pi",
  "qwen",
  "trae",
  "workbuddy",
  "zcode",
];

function getOption(name, argv = process.argv) {
  const inline = argv.find((argument) => argument.startsWith(`--${name}=`));
  if (inline) {
    return inline.slice(name.length + 3);
  }
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : null;
}

function hasFlag(name, argv = process.argv) {
  return argv.includes(`--${name}`);
}

function getPackageVersion() {
  try {
    return JSON.parse(
      readFileSync(join(PACKAGE_DIR, "package.json"), "utf8"),
    ).version;
  } catch {
    return "unknown";
  }
}

function loadConfig({ initialize = false } = {}) {
  const astroHome =
    getOption("astro-home") || getOption("aot-home") || undefined;
  const config = loadRuntimeConfig({
    astroHome,
    environment: process.env,
    initialize,
    overrides: astroHome ? { ASTRO_HOME: astroHome } : {},
  });
  for (const diagnostic of config.diagnostics) {
    console.error(formatRuntimeConfigDiagnostic(diagnostic));
  }
  return config;
}

/* ------------------------------------------------------------------ *
 * Global CLI registration
 * ------------------------------------------------------------------ */

/** Directories checked when registering the global `astrox` command. */
export function getGlobalBinDirs() {
  if (IS_WINDOWS) {
    return [join(homedir(), ".astrox", "bin")];
  }
  return [
    "/usr/local/bin",
    join(homedir(), ".local", "bin"),
    join(homedir(), "bin"),
  ];
}

function globalCliTarget(dir) {
  return join(dir, IS_WINDOWS ? `${CLI_NAME}.cmd` : CLI_NAME);
}

/**
 * Expose this entry file as a global `astrox` command. The first writable
 * candidate directory wins; a foreign file already holding the name is left
 * untouched. Registration is best effort and never fatal.
 */
export function registerGlobalCli({
  binDirs = getGlobalBinDirs(),
  entryFile = ENTRY_FILE,
} = {}) {
  const failures = [];
  for (const dir of binDirs) {
    const target = globalCliTarget(dir);
    try {
      mkdirSync(dir, { recursive: true });
      if (existsSync(target) || isSymlink(target)) {
        if (resolveCliEntry(target) === resolve(entryFile)) {
          return { action: "exists", dir, failures, path: target };
        }
        failures.push(`${target} already exists and points elsewhere`);
        continue;
      }
      if (IS_WINDOWS) {
        writeFileSync(
          target,
          `@echo off\r\nnode "${entryFile}" %*\r\n`,
          "utf8",
        );
      } else {
        try {
          chmodSync(entryFile, 0o755);
        } catch {
          // A read-only source tree still links; node runs the file directly.
        }
        symlinkSync(entryFile, target);
      }
      return { action: "created", dir, failures, path: target };
    } catch (error) {
      failures.push(`${target}: ${error.message}`);
    }
  }
  return { action: "failed", dir: "", failures, path: "" };
}

function isSymlink(target) {
  try {
    return lstatSync(target).isSymbolicLink();
  } catch {
    return false;
  }
}

function resolveCliEntry(target) {
  try {
    if (isSymlink(target)) {
      return resolve(dirname(target), readlinkSync(target));
    }
    const shim = readFileSync(target, "utf8");
    const match = shim.match(/node "([^"]+)"/);
    return match ? resolve(match[1]) : "";
  } catch {
    return "";
  }
}

/** Locate an already registered global `astrox` command. */
export function findGlobalCli({
  binDirs = getGlobalBinDirs(),
  entryFile = ENTRY_FILE,
} = {}) {
  for (const dir of binDirs) {
    const target = globalCliTarget(dir);
    if (!existsSync(target) && !isSymlink(target)) {
      continue;
    }
    const entry = resolveCliEntry(target);
    return {
      dir,
      path: target,
      matchesEntry: entry === resolve(entryFile),
    };
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Dashboard daemon state
 * ------------------------------------------------------------------ */

/**
 * Dashboard PID records live in `<ASTRO_HOME>/dashboard-<port>.pid` and are
 * written by the server itself, so any launcher can discover a running daemon.
 */
export function readDashboardState(astroHome) {
  if (!existsSync(astroHome)) {
    return null;
  }
  const records = readdirSync(astroHome)
    .filter((name) => /^dashboard-.*\.pid$/.test(name))
    .map((name) => {
      const file = join(astroHome, name);
      try {
        return { file, record: JSON.parse(readFileSync(file, "utf8")) };
      } catch {
        return { file, record: null };
      }
    })
    .filter(({ record }) => record && Number(record.pid) > 0);
  if (!records.length) {
    return null;
  }
  const states = records.map(({ file, record }) => ({
    file,
    pid: Number(record.pid),
    url: typeof record.url === "string" ? record.url : "",
    running: isProcessAlive(Number(record.pid)),
  }));
  return states.find((state) => state.running) ?? states[0];
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms));
}

async function waitForDashboard(astroHome, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = readDashboardState(astroHome);
    if (state?.running) {
      return state;
    }
    await sleep(200);
  }
  return null;
}

function openUrl(url) {
  const command = IS_WINDOWS
    ? { file: "cmd", args: ["/c", "start", "", url] }
    : platform() === "darwin"
      ? { file: "open", args: [url] }
      : { file: "xdg-open", args: [url] };
  try {
    const child = spawn(command.file, command.args, {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ *
 * Commands
 * ------------------------------------------------------------------ */

function buildStartEnvironment(environment, astroHome) {
  const port = getOption("port");
  const host = getOption("host");
  return {
    ...environment,
    ASTRO_HOME: astroHome,
    // The daemon is launched detached; the browser opens only when asked.
    ASTRO_OPEN_BROWSER: hasFlag("open") ? "1" : "0",
    ASTRO_AUTO_OPEN: "0",
    ...(port ? { ASTRO_PORT: port } : {}),
    ...(host ? { ASTRO_HOST: host } : {}),
  };
}

async function startCommand() {
  const { environment } = loadConfig();
  const astroHome = resolveAstroHome(environment);
  const runtime = getInstalledRuntimePaths(astroHome);
  if (!existsSync(runtime.dashboardFile)) {
    throw new Error(
      `No installed ASTRO plugin found under ${runtime.pluginDir}. Run "astrox install" first.`,
    );
  }

  if (!hasFlag("no-global")) {
    const registered = registerGlobalCli({
      binDirs: getBinDirOption() ?? getGlobalBinDirs(),
    });
    printGlobalCli(registered);
  }

  const existing = readDashboardState(astroHome);
  if (existing?.running) {
    console.log(`Dashboard already running: ${existing.url || "unknown"}`);
    if (hasFlag("open") && existing.url) {
      openUrl(existing.url);
    }
    return;
  }

  const logFile = getOption("log-file") || join(astroHome, "dashboard.log");
  mkdirSync(dirname(logFile), { recursive: true });
  const logFd = openSync(logFile, "a");
  const child = spawn(process.execPath, [runtime.dashboardFile], {
    cwd: dirname(runtime.dashboardFile),
    detached: true,
    env: buildStartEnvironment(environment, astroHome),
    stdio: ["ignore", logFd, logFd],
  });
  closeSync(logFd);
  child.unref();

  const state = await waitForDashboard(astroHome);
  if (!state) {
    throw new Error(
      `The dashboard did not report a PID within 15s. Check ${logFile}.`,
    );
  }
  console.log(`Dashboard started: ${state.url || "unknown"} (pid ${state.pid})`);
  console.log(`Log file: ${logFile}`);
  if (hasFlag("open") && state.url) {
    openUrl(state.url);
  }
}

function getBinDirOption() {
  const binDir = getOption("bin-dir");
  return binDir ? [resolve(expandHome(binDir))] : null;
}

function printGlobalCli(registered) {
  if (registered.path) {
    console.log(
      `Global ${CLI_NAME} CLI ${registered.action}: ${registered.path}`,
    );
    return;
  }
  console.log(`Global ${CLI_NAME} CLI: not registered`);
  for (const failure of registered.failures) {
    console.log(`  ${failure}`);
  }
}

async function stopCommand() {
  const { environment } = loadConfig();
  const astroHome = resolveAstroHome(environment);
  const state = readDashboardState(astroHome);
  if (!state) {
    console.log("Dashboard is not running.");
    return;
  }
  if (!state.running) {
    console.log(`Dashboard is not running (stale pid file ${state.file}).`);
    return;
  }
  try {
    process.kill(state.pid, "SIGTERM");
  } catch (error) {
    if (error.code !== "ESRCH") {
      throw error;
    }
  }
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline && isProcessAlive(state.pid)) {
    await sleep(100);
  }
  if (isProcessAlive(state.pid)) {
    try {
      process.kill(state.pid, "SIGKILL");
    } catch {
      // The process exited between the check and the signal.
    }
  }
  console.log(`Dashboard stopped (pid ${state.pid}).`);
}

async function restartCommand() {
  await stopCommand();
  // Give the previous listener a moment to release the port.
  await sleep(500);
  await startCommand();
}

function statusCommand() {
  const config = loadConfig();
  const environment = config.environment;
  const astroHome = resolveAstroHome(environment);
  const runtime = getInstalledRuntimePaths(astroHome);
  const globalCli = findGlobalCli({
    binDirs: getBinDirOption() ?? getGlobalBinDirs(),
  });
  const dashboard = readDashboardState(astroHome);
  const codexHome = resolve(
    expandHome(
      getOption("codex-home") || environment.CODEX_HOME || join(homedir(), ".codex"),
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
      getOption("dsh-home") || environment.DSH_HOME || join(homedir(), ".dsh"),
    ),
  );
  const integrations = [
    ["codex", hasInstalledHook(join(codexHome, "hooks.json"), "codex")],
    [
      "claude",
      hasInstalledHook(join(claudeHome, "settings.json"), "claude"),
    ],
    [
      "workbuddy",
      hasInstalledHook(join(workbuddyHome, "settings.json"), "workbuddy"),
    ],
    ["trae", hasInstalledHook(join(process.cwd(), ".trae", "hooks.json"), "trae")],
    [
      "deepseek",
      hasDeepseekPlugin(dshHome, getOption("deepseek-profile") || "web")
        .installed,
    ],
  ];
  const report = {
    astroHome,
    plugin: {
      config: config.files.config.exists
        ? config.files.config.valid
          ? "OK"
          : "WARN"
        : "MISSING",
      env: config.files.env.exists
        ? config.files.env.valid
          ? "OK"
          : "WARN"
        : "MISSING",
      installed: existsSync(runtime.pluginDir),
      recorder: existsSync(runtime.recorderFile),
      dashboardFile: existsSync(runtime.dashboardFile),
      pluginDir: runtime.pluginDir,
      configPath: config.files.config.path,
      envPath: config.files.env.path,
    },
    globalCli: globalCli
      ? {
          path: globalCli.path,
          state: globalCli.matchesEntry ? "OK" : "FOREIGN",
        }
      : { path: "", state: "MISSING" },
    dashboard: {
      running: Boolean(dashboard?.running),
      pid: dashboard?.pid ?? 0,
      url: dashboard?.url || "",
    },
    integrations: integrations.map(([id, installed]) => ({
      id,
      state: installed ? "OK" : "MISSING",
    })),
    version: getPackageVersion(),
  };

  if (hasFlag("json")) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`ASTROX STATUS · v${report.version}`);
  console.log(`  home           ${report.astroHome}`);
  console.log(
    `  plugin         ${report.plugin.installed ? "INSTALLED" : "MISSING"} ${report.plugin.pluginDir}`,
  );
  console.log(
    `  recorder       ${report.plugin.recorder ? "OK" : "MISSING"} ${runtime.recorderFile}`,
  );
  console.log(
    `  dashboard file ${report.plugin.dashboardFile ? "OK" : "MISSING"} ${runtime.dashboardFile}`,
  );
  console.log(`  config.yaml    ${report.plugin.config} ${report.plugin.configPath}`);
  console.log(`  .env           ${report.plugin.env} ${report.plugin.envPath}`);
  console.log(
    `  global cli     ${report.globalCli.state}${report.globalCli.path ? ` ${report.globalCli.path}` : ""}`,
  );
  console.log(
    `  dashboard      ${
      report.dashboard.running
        ? `RUNNING ${report.dashboard.url || ""} (pid ${report.dashboard.pid})`
        : "STOPPED"
    }`,
  );
  console.log(
    `  integrations   ${report.integrations
      .map(({ id, state }) => `${id}=${state}`)
      .join(" ")}`,
  );
}

function infoCommand() {
  const config = loadConfig();
  const environment = config.environment;
  const astroHome = resolveAstroHome(environment);
  const runtime = getInstalledRuntimePaths(astroHome);
  const dashboard = readDashboardState(astroHome);
  const traceRoot =
    environment.ASTRO_TRACE_DIR ||
    environment.AGENT_TRACE_DIR ||
    environment.TRAE_TRACE_DIR ||
    astroHome;
  const sources = TRACE_SOURCES.map((source) => {
    const stats = getTraceStats(astroHome, source);
    return {
      bytes: stats.bytes,
      files: stats.files.length,
      root: stats.root,
      source,
    };
  });
  const totals = sources.reduce(
    (accumulator, item) => ({
      bytes: accumulator.bytes + item.bytes,
      files: accumulator.files + item.files,
    }),
    { bytes: 0, files: 0 },
  );
  const report = {
    astroHome,
    configPath: config.files.config.path,
    dashboardUrl: dashboard?.running ? dashboard.url || "" : "",
    envPath: config.files.env.path,
    globalCli: findGlobalCli({
      binDirs: getBinDirOption() ?? getGlobalBinDirs(),
    })?.path || "",
    pluginDir: runtime.pluginDir,
    sources,
    totals,
    traceRoot,
    version: getPackageVersion(),
  };

  if (hasFlag("json")) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`ASTROX INFO · v${report.version}`);
  console.log(`  astro home     ${report.astroHome}`);
  console.log(`  trace root     ${report.traceRoot}`);
  console.log(`  plugin dir     ${report.pluginDir}`);
  console.log(`  config file    ${report.configPath}`);
  console.log(`  env file       ${report.envPath}`);
  console.log(`  global cli     ${report.globalCli || "not registered"}`);
  console.log(
    `  dashboard      ${report.dashboardUrl || (dashboard ? "stale pid file" : "stopped")}`,
  );
  for (const { source, files, bytes, root } of report.sources) {
    if (!files) {
      continue;
    }
    console.log(
      `  ${source.padEnd(12)} ${String(files).padStart(4)} files ${String(bytes).padStart(10)} bytes  ${root}`,
    );
  }
  console.log(`  total          ${totals.files} files ${totals.bytes} bytes`);
}

function updateCommand() {
  const astroHome =
    getOption("astro-home") ||
    getOption("aot-home") ||
    process.env.ASTRO_HOME ||
    process.env.AOT_HOME;
  const runtime = updateInstalledPlugins({
    astroHome,
    environment: process.env,
    refreshDeepseek: !hasFlag("no-deepseek"),
  });
  console.log(`Updated ASTRO plugin runtime in ${runtime.pluginDir}`);
  console.log(`Manual start: astrox start (or node ${runtime.dashboardFile})`);
}

function delegateCommand(command) {
  const args = process.argv.slice(3);
  const astroHome =
    getOption("astro-home") ||
    getOption("aot-home") ||
    process.env.ASTRO_HOME ||
    process.env.AOT_HOME;
  const result = spawnSync(process.execPath, [ASTRO_CLI_FILE, command, ...args], {
    encoding: "utf8",
    env: astroHome
      ? { ...process.env, ASTRO_HOME: astroHome }
      : process.env,
    stdio: ["inherit", "inherit", "inherit"],
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
  }
}

function openCommand() {
  const { environment } = loadConfig();
  const astroHome = resolveAstroHome(environment);
  const state = readDashboardState(astroHome);
  if (!state?.running) {
    console.log('Dashboard is not running. Start it with "astrox start".');
    return;
  }
  const url = state.url || "";
  if (!url || !openUrl(url)) {
    console.log(`Open the dashboard manually: ${url || "unknown"}`);
    return;
  }
  console.log(`Opened ${url}`);
}

function logsCommand() {
  const { environment } = loadConfig();
  const astroHome = resolveAstroHome(environment);
  const logFile = getOption("log-file") || join(astroHome, "dashboard.log");
  if (!existsSync(logFile)) {
    console.log(`No dashboard log at ${logFile}.`);
    return;
  }
  const limit = Number(getOption("lines") || getOption("tail") || 40);
  const lines = readFileSync(logFile, "utf8").split(/\r?\n/).filter(Boolean);
  for (const line of lines.slice(-Math.max(1, limit))) {
    console.log(line);
  }
}

function pathCommand() {
  const { environment } = loadConfig();
  const astroHome = resolveAstroHome(environment);
  const runtime = getInstalledRuntimePaths(astroHome);
  console.log(astroHome);
  console.log(runtime.pluginDir);
  console.log(ENTRY_FILE);
}

function printHelp() {
  console.log(`astrox - ASTRO plugin control CLI

Usage:
  astrox start [--port N] [--host H] [--open] [--no-global] [--bin-dir DIR]
  astrox stop
  astrox restart
  astrox status [--json] [--deepseek-profile web]
  astrox info [--json]
  astrox update [--no-deepseek]
  astrox doctor [options]        Run the full astro-trace diagnostics
  astrox install [options]       Install or refresh hook integrations
  astrox migrate [FILE_OR_DIR]   Migrate legacy trace data
  astrox open                    Open the running dashboard in a browser
  astrox logs [--lines N]        Tail the dashboard log
  astrox path                    Print ASTRO home, plugin dir, and CLI entry

Notes:
  astrox start registers this entry as a global "astrox" command
  (${getGlobalBinDirs().join(", ")}).
  astrox stop terminates the dashboard process; no extra cleanup is performed.

Environment:
  ASTRO_HOME   Bootstrap runtime and trace root (default ~/.astrox)
  ASTRO_PORT   Dashboard port (default 4318)
  ASTRO_HOST   Dashboard host (default 127.0.0.1)`);
}

const commands = {
  doctor: () => delegateCommand("doctor"),
  help: printHelp,
  info: infoCommand,
  install: () => delegateCommand("install"),
  logs: logsCommand,
  migrate: () => delegateCommand("migrate"),
  open: openCommand,
  path: pathCommand,
  restart: restartCommand,
  start: startCommand,
  status: statusCommand,
  stop: stopCommand,
  update: updateCommand,
};

export async function run(argv = process.argv) {
  const command = argv[2] || "help";
  const handler = commands[command];
  if (!handler) {
    console.error(`Unknown astrox command: ${command}`);
    printHelp();
    process.exitCode = 1;
    return;
  }
  await handler();
}

// The registered global command is a symlink to this file, so compare
// realpaths instead of the raw argv entry.
function isInvokedAsEntry() {
  const [mainFile] = process.argv.slice(1);
  if (!mainFile) {
    return false;
  }
  if (import.meta.url === pathToFileURL(mainFile).href) {
    return true;
  }
  try {
    return realpathSync(mainFile) === ENTRY_FILE;
  } catch {
    return false;
  }
}

if (isInvokedAsEntry()) {
  try {
    await run(process.argv);
  } catch (error) {
    console.error(`astrox: ${error.message}`);
    process.exitCode = 1;
  }
}
