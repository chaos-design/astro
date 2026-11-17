#!/usr/bin/env node
/**
 * Standalone local-service CLI.
 *
 * `astrox start/restart` works against the installed runtime, but a console
 * whose local service is down has no HTTP endpoint to call. This CLI is the
 * out-of-band control surface: `up` starts the service when it is down and
 * restarts it when it is up, on the same port the console is using. The restart
 * button in the console copies this command when the service is unreachable.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, closeSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import storagePaths from "../plugin/storage-paths.cjs";

const { resolveAstroHome } = storagePaths;
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_DIR = resolve(SCRIPT_DIR, "..");
const DEFAULT_PORT = 5678;

export const SERVICE_COMMANDS = new Set([
  "start",
  "restart",
  "up",
  "stop",
  "status",
]);

/** Parse the small command surface without pulling in the full CLI runtime. */
export function parseServiceArgs(argv = []) {
  const command = SERVICE_COMMANDS.has(argv[0]) ? argv[0] : "up";
  const options = {
    command,
    port: DEFAULT_PORT,
    home: "",
    foreground: false,
    open: false,
    timeoutMs: 15_000,
  };
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument.startsWith("--port=")) {
      options.port = Number(argument.slice("--port=".length));
    } else if (argument === "--port" && argv[index + 1]) {
      index += 1;
      options.port = Number(argv[index]);
    } else if (argument.startsWith("--home=")) {
      options.home = argument.slice("--home=".length);
    } else if (argument === "--foreground") {
      options.foreground = true;
    } else if (argument === "--open") {
      options.open = true;
    }
  }
  if (!Number.isFinite(options.port) || options.port <= 0) {
    options.port = DEFAULT_PORT;
  }
  return options;
}

/** Installed runtime wins; a checkout falls back to its own server. */
export function resolveServiceFile(home, env = process.env) {
  const installed = join(home, "plugins", "astro", "server", "server.mjs");
  if (existsSync(installed)) {
    return installed;
  }
  return join(REPO_DIR, "server", "server.mjs");
}

export function resolveServiceHome(options, env = process.env) {
  return options.home
    ? resolveAstroHome({ ...env, ASTRO_HOME: options.home })
    : resolveAstroHome(env);
}

export function buildServiceEnv(env, { home, port, open }) {
  return {
    ...env,
    ASTRO_HOME: home,
    ASTRO_PORT: String(port),
    ASTRO_OPEN_BROWSER: open ? "1" : "0",
  };
}

export function serviceUrl(port) {
  return `http://127.0.0.1:${port}`;
}

export async function probeHealth(url, fetchImpl = fetch, timeoutMs = 2000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${url}/api/health`, {
      signal: controller.signal,
    });
    if (!response.ok) {
      return null;
    }
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function waitForHealth(url, timeoutMs, fetchImpl) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const health = await probeHealth(url, fetchImpl, Math.min(1000, timeoutMs));
    if (health) {
      return health;
    }
    await new Promise((done) => setTimeout(done, 200));
  }
  return null;
}

function launch(serverFile, options, env, home) {
  const logFile = join(home, "service-cli.log");
  mkdirSync(home, { recursive: true });
  const logFd = openSync(logFile, "a");
  const child = spawn(process.execPath, [serverFile], {
    cwd: dirname(serverFile),
    env: buildServiceEnv(env, options),
    stdio: options.foreground ? "inherit" : ["ignore", logFd, logFd],
    detached: !options.foreground,
  });
  if (!options.foreground) {
    closeSync(logFd);
    child.unref();
  }
  return child;
}

async function restartThroughHttp(url, fetchImpl) {
  const response = await fetchImpl(`${url}/api/restart`, { method: "POST" });
  if (!response.ok) {
    throw new Error(`restart endpoint returned ${response.status}`);
  }
}

function stopRecordedPid(health) {
  if (!health?.pid || !Number.isFinite(Number(health.pid))) {
    return false;
  }
  try {
    process.kill(Number(health.pid), "SIGTERM");
    return true;
  } catch (error) {
    if (error.code === "ESRCH") {
      return false;
    }
    throw error;
  }
}

export async function runServiceCli(argv, dependencies = {}) {
  const options = parseServiceArgs(argv);
  const env = dependencies.env || process.env;
  const fetchImpl = dependencies.fetchImpl || fetch;
  const launchImpl = dependencies.launchImpl || launch;
  const home = resolveServiceHome(options, env);
  const url = serviceUrl(options.port);
  const serverFile = resolveServiceFile(home, env);
  const health = await probeHealth(url, fetchImpl);

  if (options.command === "status") {
    console.log(
      health
        ? `Local service running: ${url} (pid ${health.pid ?? "unknown"})`
        : `Local service offline: ${url}`,
    );
    return { options, health };
  }
  if (options.command === "stop") {
    if (!health) {
      console.log(`Local service is already offline: ${url}`);
      return { options, health: null };
    }
    stopRecordedPid(health);
    console.log(`Local service stopping: ${url}`);
    return { options, health: null };
  }
  if (health && (options.command === "restart" || options.command === "up")) {
    await restartThroughHttp(url, fetchImpl);
  } else if (options.command === "start" || options.command === "up") {
    if (!existsSync(serverFile)) {
      throw new Error(`Service entry not found: ${serverFile}`);
    }
    launchImpl(serverFile, options, env, home);
  }
  const ready = await waitForHealth(url, options.timeoutMs, fetchImpl);
  if (!ready) {
    throw new Error(
      `Local service did not become healthy on ${url}. Check ${join(home, "service-cli.log")}.`,
    );
  }
  console.log(`Local service ready: ${url} (pid ${ready.pid ?? "unknown"})`);
  return { options, health: ready };
}

export function isMain() {
  const entry = process.argv[1];
  return Boolean(entry) && import.meta.url === pathToFileURL(entry).href;
}

if (isMain()) {
  try {
    await runServiceCli(process.argv.slice(2));
  } catch (error) {
    console.error(
      `[astro:service] ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
