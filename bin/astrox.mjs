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
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
/**
 * The plugin runtime modules are heavyweight (config loader, installed-plugin
 * inspector, recorder installer). They are loaded lazily so `help`, the
 * delegation commands (doctor/install/migrate), and any direct import of this
 * module's pure helpers (e.g. `registerGlobalCli` in tests) stay fast. Only
 * commands that actually touch runtime config or the installed plugin pay the
 * import cost — and the result is cached after the first load.
 */
let loadedDependencies = null;
async function loadDependencies() {
  if (!loadedDependencies) {
    const [runtimeConfig, storagePaths, clientStatus, installPlugins] =
      await Promise.all([
        import("../plugin/runtime-config.cjs"),
        import("../plugin/storage-paths.cjs"),
        import("../plugin/client-status.mjs"),
        import("../scripts/install-plugins.mjs"),
      ]);
    const runtimeConfigLoader = runtimeConfig.default;
    const storagePathsModule = storagePaths.default;
    loadedDependencies = {
      expandHome: storagePathsModule.expandHome,
      formatRuntimeConfigDiagnostic:
        runtimeConfigLoader.formatRuntimeConfigDiagnostic,
      getInstalledRuntimePaths: installPlugins.getInstalledRuntimePaths,
      getTraceStats: clientStatus.getTraceStats,
      hasDeepseekPlugin: clientStatus.hasDeepseekPlugin,
      hasInstalledHook: clientStatus.hasInstalledHook,
      loadRuntimeConfig: runtimeConfigLoader.loadRuntimeConfig,
      resolveAstroHome: storagePathsModule.resolveAstroHome,
      updateInstalledPlugins: installPlugins.updateInstalledPlugins,
    };
  }
  return loadedDependencies;
}

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

async function loadConfig({ initialize = false } = {}) {
  const { loadRuntimeConfig, formatRuntimeConfigDiagnostic } =
    await loadDependencies();
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
 * Every record is returned (not just the first) because several ASTRO builds
 * can serve from the same home on different ports — a stale record left behind
 * by another checkout must never make `stop` kill the wrong process, nor make
 * `start` believe the configured port is already taken.
 */
export function readDashboardStates(astroHome) {
  if (!existsSync(astroHome)) {
    return [];
  }
  return readdirSync(astroHome)
    .filter((name) => /^dashboard-.*\.pid$/.test(name))
    .map((name) => {
      const file = join(astroHome, name);
      try {
        return { file, record: JSON.parse(readFileSync(file, "utf8")) };
      } catch {
        return { file, record: null };
      }
    })
    .filter(({ record }) => record && Number(record.pid) > 0)
    .map(({ file, record }) => {
      const filePort = Number(/^dashboard-(.*)\.pid$/.exec(basename(file))?.[1]);
      const urlPort = Number(
        typeof record.url === "string"
          ? /:(\d+)(?:\/|$)/.exec(record.url)?.[1]
          : Number.NaN,
      );
      return {
        file,
        pid: Number(record.pid),
        url: typeof record.url === "string" ? record.url : "",
        port: Number.isFinite(filePort) ? filePort : urlPort,
        // Which bundle the daemon was launched from: the fastest way to see
        // that an old copy is still serving a port.
        server: typeof record.server === "string" ? record.server : "",
        running: isProcessAlive(Number(record.pid)),
      };
    });
}

/**
 * The dashboard record to act on. With a `port`, only that port's record
 * counts — a daemon on another port belongs to a different bundle and must not
 * be reported, stopped, or treated as "already started". Without a port the
 * first running record is returned, which keeps the older call pattern working.
 */
export function readDashboardState(astroHome, port) {
  const states = readDashboardStates(astroHome);
  if (port) {
    const requested = Number(port);
    return states.find((state) => state.port === requested) ?? null;
  }
  return states.find((state) => state.running) ?? states[0] ?? null;
}

/**
 * Version stamped into an installed runtime bundle by `astrox install` /
 * `astrox update`. An empty string means the bundle predates the stamp.
 */
export function readInstalledBundleVersion(pluginDir) {
  try {
    const record = JSON.parse(
      readFileSync(join(pluginDir, "plugin.json"), "utf8"),
    );
    return typeof record.version === "string" ? record.version : "";
  } catch {
    return "";
  }
}

/** Bundle version of a running daemon, derived from its recorded server path. */
function readBundleVersionForServer(serverFile) {
  if (!serverFile) {
    return "";
  }
  return readInstalledBundleVersion(resolve(dirname(serverFile), ".."));
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

async function waitForDashboard(astroHome, timeoutMs = 15_000, port) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = readDashboardState(astroHome, port);
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

/** Port the dashboard binds: CLI flag first, then the resolved config/env. */
function resolveDashboardPort(environment) {
  const port = Number(getOption("port") || environment?.ASTRO_PORT || 5_678);
  return Number.isFinite(port) && port > 0 ? port : 5_678;
}

async function startCommand() {
  const deps = await loadDependencies();
  const { environment } = await loadConfig();
  const astroHome = deps.resolveAstroHome(environment);
  const runtime = deps.getInstalledRuntimePaths(astroHome);
  if (!existsSync(runtime.dashboardFile)) {
    throw new Error(
      `No installed ASTRO plugin found under ${runtime.pluginDir}. Run "astrox install" first.`,
    );
  }
  const port = resolveDashboardPort(environment);
  // The installed runtime is a *copy* of this package made by `astrox install`
  // / `astrox update`. When the CLI moved on and the copy did not, the daemon
  // serves the older UI no matter how new the checkout is — the exact case
  // where a shipped feature looks "lost". Comparing the stamped versions makes
  // the mismatch visible, and refreshing before start keeps it from lingering.
  const cliVersion = getPackageVersion();
  const bundleVersion = readInstalledBundleVersion(runtime.pluginDir);
  const bundleStale = bundleVersion !== cliVersion;

  if (!hasFlag("no-global")) {
    const registered = registerGlobalCli({
      binDirs: (await getBinDirOption()) ?? getGlobalBinDirs(),
    });
    printGlobalCli(registered);
  }

  const existing = readDashboardState(astroHome, port);
  if (existing?.running) {
    if (bundleStale) {
      console.log(
        `Installed bundle is ${bundleVersion ? `v${bundleVersion}` : "unstamped"} but this CLI is v${cliVersion}.`,
      );
      console.log('Run "astrox restart" to serve the current build.');
    }
    console.log(`Dashboard already running: ${existing.url || "unknown"}`);
    if (hasFlag("open") && existing.url) {
      openUrl(existing.url);
    }
    return;
  }

  if (bundleStale) {
    console.log(
      `Refreshing installed bundle ${bundleVersion ? `v${bundleVersion}` : "(unstamped)"} → v${cliVersion}…`,
    );
    deps.updateInstalledPlugins({
      astroHome,
      environment,
      refreshDeepseek: false,
    });
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

  const state = await waitForDashboard(astroHome, 15_000, port);
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

async function getBinDirOption() {
  const binDir = getOption("bin-dir");
  if (!binDir) {
    return null;
  }
  const deps = await loadDependencies();
  return [resolve(deps.expandHome(binDir))];
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
  const deps = await loadDependencies();
  const { environment } = await loadConfig();
  const astroHome = deps.resolveAstroHome(environment);
  // Scoped to the configured port: a daemon on another port serves a different
  // bundle and is not this command's business.
  const port = resolveDashboardPort(environment);
  const state = readDashboardState(astroHome, port);
  if (!state) {
    const others = readDashboardStates(astroHome).filter(
      (candidate) => candidate.running && candidate.port !== port,
    );
    console.log("Dashboard is not running.");
    for (const other of others) {
      console.log(
        `Another dashboard is running on port ${other.port}: ${other.url} (stop it with --port ${other.port}).`,
      );
    }
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

async function statusCommand() {
  const deps = await loadDependencies();
  const config = await loadConfig();
  const environment = config.environment;
  const astroHome = deps.resolveAstroHome(environment);
  const runtime = deps.getInstalledRuntimePaths(astroHome);
  const globalCli = findGlobalCli({
    binDirs: (await getBinDirOption()) ?? getGlobalBinDirs(),
  });
  const dashboard = readDashboardState(astroHome, resolveDashboardPort(environment));
  const otherDashboards = readDashboardStates(astroHome).filter(
    (candidate) => candidate.running && candidate.url !== (dashboard?.url ?? ""),
  );
  const codexHome = resolve(
    deps.expandHome(
      getOption("codex-home") || environment.CODEX_HOME || join(homedir(), ".codex"),
    ),
  );
  const claudeHome = resolve(
    deps.expandHome(
      getOption("claude-home") ||
        environment.CLAUDE_HOME ||
        join(homedir(), ".claude"),
    ),
  );
  const workbuddyHome = resolve(
    deps.expandHome(
      getOption("workbuddy-home") ||
        environment.CODEBUDDY_HOME ||
        join(homedir(), ".codebuddy"),
    ),
  );
  const dshHome = resolve(
    deps.expandHome(
      getOption("dsh-home") || environment.DSH_HOME || join(homedir(), ".dsh"),
    ),
  );
  const integrations = [
    ["codex", deps.hasInstalledHook(join(codexHome, "hooks.json"), "codex")],
    [
      "claude",
      deps.hasInstalledHook(join(claudeHome, "settings.json"), "claude"),
    ],
    [
      "workbuddy",
      deps.hasInstalledHook(join(workbuddyHome, "settings.json"), "workbuddy"),
    ],
    ["trae", deps.hasInstalledHook(join(process.cwd(), ".trae", "hooks.json"), "trae")],
    [
      "deepseek",
      deps.hasDeepseekPlugin(dshHome, getOption("deepseek-profile") || "web")
        .installed,
    ],
  ];
  const cliVersion = getPackageVersion();
  const bundleVersion = existsSync(runtime.pluginDir)
    ? readInstalledBundleVersion(runtime.pluginDir)
    : "";
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
      // The copy actually served until `astrox restart`: an outdated value
      // explains a UI that is missing features the checkout already ships.
      version: bundleVersion,
      stale: existsSync(runtime.pluginDir) && bundleVersion !== cliVersion,
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
      port: dashboard?.port ?? resolveDashboardPort(environment),
      server: dashboard?.server || "",
      version: readBundleVersionForServer(dashboard?.server),
    },
    otherDashboards: otherDashboards.map(({ pid, port, url, server }) => ({
      pid,
      port,
      url,
      version: readBundleVersionForServer(server),
    })),
    integrations: integrations.map(([id, installed]) => ({
      id,
      state: installed ? "OK" : "MISSING",
    })),
    version: cliVersion,
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
    `  plugin build   ${
      !report.plugin.installed
        ? "MISSING"
        : report.plugin.stale
          ? `STALE v${report.plugin.version || "unversioned"} ≠ CLI v${report.version} — run "astrox update"`
          : `OK v${report.plugin.version}`
    }`,
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
        ? `RUNNING ${report.dashboard.url || ""} (pid ${report.dashboard.pid}${report.dashboard.version ? `, v${report.dashboard.version}` : ""})`
        : "STOPPED"
    }`,
  );
  for (const other of report.otherDashboards) {
    console.log(
      `  other          RUNNING ${other.url} (pid ${other.pid}${other.version ? `, v${other.version}` : ""}) — separate instance`,
    );
  }
  console.log(
    `  integrations   ${report.integrations
      .map(({ id, state }) => `${id}=${state}`)
      .join(" ")}`,
  );
}

async function infoCommand() {
  const deps = await loadDependencies();
  const config = await loadConfig();
  const environment = config.environment;
  const astroHome = deps.resolveAstroHome(environment);
  const runtime = deps.getInstalledRuntimePaths(astroHome);
  const dashboard = readDashboardState(astroHome);
  const traceRoot =
    environment.ASTRO_TRACE_DIR ||
    environment.AGENT_TRACE_DIR ||
    environment.TRAE_TRACE_DIR ||
    astroHome;
  const sources = TRACE_SOURCES.map((source) => {
    const stats = deps.getTraceStats(astroHome, source);
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
      binDirs: (await getBinDirOption()) ?? getGlobalBinDirs(),
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

async function updateCommand() {
  const deps = await loadDependencies();
  const astroHome =
    getOption("astro-home") ||
    getOption("aot-home") ||
    process.env.ASTRO_HOME ||
    process.env.AOT_HOME;
  const runtime = deps.updateInstalledPlugins({
    astroHome,
    environment: process.env,
    refreshDeepseek: !hasFlag("no-deepseek"),
  });
  console.log(`Updated ASTRO plugin runtime in ${runtime.pluginDir}`);
  // A running daemon keeps its already-loaded server code and only serves the
  // new files on reload, so say out loud that applying the update needs a
  // restart instead of implying the update alone is enough.
  const running = readDashboardStates(
    astroHome || deps.resolveAstroHome(process.env),
  ).filter((state) => state.running);
  if (running.length) {
    console.log(
      `Restart to apply: astrox restart (running on ${running.map((state) => state.url).join(", ")})`,
    );
    return;
  }
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

async function openCommand() {
  const deps = await loadDependencies();
  const { environment } = await loadConfig();
  const astroHome = deps.resolveAstroHome(environment);
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

async function logsCommand() {
  const deps = await loadDependencies();
  const { environment } = await loadConfig();
  const astroHome = deps.resolveAstroHome(environment);
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

async function pathCommand() {
  const deps = await loadDependencies();
  const { environment } = await loadConfig();
  const astroHome = deps.resolveAstroHome(environment);
  const runtime = deps.getInstalledRuntimePaths(astroHome);
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
  ASTRO_PORT   Dashboard port (default 5678)
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
