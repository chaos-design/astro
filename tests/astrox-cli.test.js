import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import {
  findGlobalCli,
  readDashboardState,
  readDashboardStates,
  readInstalledBundleVersion,
  registerGlobalCli,
} from "../bin/astrox.mjs";

const cliFile = fileURLToPath(new URL("../bin/astrox.mjs", import.meta.url));
const packageVersion = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
).version;

/** A child that stays alive so its PID reads as a running daemon. */
function liveProcess(t) {
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60_000)"], {
    stdio: "ignore",
  });
  t.after(() => child.kill("SIGKILL"));
  return child;
}

function writePidRecord(astroHome, port, pid, server) {
  mkdirSync(astroHome, { recursive: true });
  writeFileSync(
    join(astroHome, `dashboard-${port}.pid`),
    `${JSON.stringify({
      pid,
      server,
      url: `http://127.0.0.1:${port}`,
    })}\n`,
  );
}

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "astrox-cli-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return {
    environment: { ...process.env, ASTRO_HOME: join(root, "home") },
    root,
  };
}

function runCli(args, environment) {
  return spawnSync(process.execPath, [cliFile, ...args], {
    encoding: "utf8",
    env: environment,
    timeout: 20_000,
  });
}

const axFile = fileURLToPath(new URL("../bin/ax.mjs", import.meta.url));

/** The ax launcher shares the fixture discipline: every run pins --bin-dir. */
function runAx(args, environment) {
  return spawnSync(process.execPath, [axFile, ...args], {
    encoding: "utf8",
    env: environment,
    timeout: 20_000,
  });
}

test("help documents the plugin command set", (t) => {
  const { environment } = fixture(t);
  const result = runCli(["help"], environment);
  assert.equal(result.status, 0, result.stderr);
  for (const command of [
    "start",
    "stop",
    "restart",
    "up",
    "status",
    "info",
    "update",
    "doctor",
    "install",
    "open",
    "logs",
    "path",
    "ax",
  ]) {
    assert.match(result.stdout, new RegExp(`astrox ${command}\\b`));
  }
});

test("unknown commands fail with usage output", (t) => {
  const { environment } = fixture(t);
  const result = runCli(["nope"], environment);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown astrox command: nope/);
});

test("up is a known start-or-restart command", (t) => {
  const { environment, root } = fixture(t);
  const result = runCli(["up", "--bin-dir", join(root, "bin")], environment);
  assert.doesNotMatch(result.stderr, /Unknown astrox command/);
  // Without an installed runtime it fails with the explicit install hint,
  // never with the "unknown command" path.
  assert.match(result.stderr, /No installed ASTRO plugin found|Dashboard/);
});

test("status reports an uninstalled plugin runtime", (t) => {
  const { environment, root } = fixture(t);
  const result = runCli(
    ["status", "--bin-dir", join(root, "bin")],
    environment,
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /plugin +MISSING/);
  assert.match(result.stdout, /dashboard +STOPPED/);
  assert.match(result.stdout, /global cli +MISSING/);
});

test("status emits machine readable json", (t) => {
  const { environment } = fixture(t);
  const result = runCli(["status", "--json"], environment);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.plugin.installed, false);
  assert.equal(report.dashboard.running, false);
  assert.equal(report.integrations.length > 0, true);
});

test("info reports the astro home and empty trace totals", (t) => {
  const { environment } = fixture(t);
  const result = runCli(["info"], environment);
  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stdout,
    new RegExp(`astro home +${environment.ASTRO_HOME}`),
  );
  assert.match(result.stdout, /total +0 files 0 bytes/);
});

test("stop is a no-op when no dashboard is running", (t) => {
  const { environment } = fixture(t);
  const result = runCli(["stop"], environment);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Dashboard is not running\./);
});

test("logs reports a missing dashboard log", (t) => {
  const { environment } = fixture(t);
  const result = runCli(["logs"], environment);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /No dashboard log at/);
});

test("start refuses to launch without an installed plugin", (t) => {
  const { environment } = fixture(t);
  const result = runCli(["start"], environment);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /No installed ASTRO plugin found/);
});

test("the global astrox command links back to this entry file", (t) => {
  const { root } = fixture(t);
  const binDir = join(root, "bin");
  const registered = registerGlobalCli({ binDirs: [binDir] });
  assert.equal(registered.action, "created");
  assert.equal(existsSync(registered.path), true);
  if (process.platform !== "win32") {
    assert.equal(readlinkSync(registered.path), cliFile);
  }

  assert.equal(registerGlobalCli({ binDirs: [binDir] }).action, "exists");

  const found = findGlobalCli({ binDirs: [binDir] });
  assert.equal(found.path, registered.path);
  assert.equal(found.matchesEntry, true);
});

test("registering over a foreign command leaves it untouched", (t) => {
  const { root } = fixture(t);
  const binDir = join(root, "bin");
  mkdirSync(binDir, { recursive: true });
  writeFileSync(join(binDir, "astrox"), "#!/bin/sh\nother\n");
  const registered = registerGlobalCli({ binDirs: [binDir] });
  assert.equal(registered.action, "failed");
  assert.equal(registered.path, "");
});

test("dashboard records are scoped to their own port", (t) => {
  const { root } = fixture(t);
  const astroHome = join(root, "home");
  const live = liveProcess(t);
  // Two instances: the configured port keeps a stale record while a daemon
  // from another bundle runs elsewhere. Neither may shadow the other.
  writePidRecord(astroHome, 4318, 2_147_483_646, "/old/server/server.mjs");
  writePidRecord(
    astroHome,
    4320,
    live.pid,
    "/Users/someone/.workbuddy/plugins/cache/astro-local/astro/0.0.3/server/server.mjs",
  );

  const states = readDashboardStates(astroHome);
  assert.deepEqual(
    states.map((state) => state.port).sort((a, b) => a - b),
    [4318, 4320],
  );

  const configured = readDashboardState(astroHome, 4318);
  assert.equal(configured.port, 4318);
  assert.equal(configured.running, false);

  const other = readDashboardState(astroHome, 4320);
  assert.equal(other.running, true);
  assert.equal(other.url, "http://127.0.0.1:4320");

  // Without a port the first running daemon wins, which keeps older callers
  // (and `status`) working.
  assert.equal(readDashboardState(astroHome).port, 4320);
  assert.equal(readDashboardState(astroHome, 5678), null);
});

test("installed bundle version is read from the stamped plugin.json", (t) => {
  const { root } = fixture(t);
  const pluginDir = join(root, "home", "plugins", "astro");
  assert.equal(readInstalledBundleVersion(pluginDir), "");
  mkdirSync(pluginDir, { recursive: true });
  writeFileSync(
    join(pluginDir, "plugin.json"),
    JSON.stringify({ id: "astro", version: "0.0.2" }),
  );
  assert.equal(readInstalledBundleVersion(pluginDir), "0.0.2");
});

test("status flags an installed bundle that lags behind the CLI", (t) => {
  const { environment, root } = fixture(t);
  const pluginDir = join(root, "home", "plugins", "astro");
  mkdirSync(pluginDir, { recursive: true });
  writeFileSync(
    join(pluginDir, "plugin.json"),
    JSON.stringify({ id: "astro", version: "0.0.1" }),
  );

  const stale = runCli(["status", "--json"], environment);
  assert.equal(stale.status, 0, stale.stderr);
  const staleReport = JSON.parse(stale.stdout);
  assert.equal(staleReport.plugin.version, "0.0.1");
  assert.equal(staleReport.plugin.stale, true);

  writeFileSync(
    join(pluginDir, "plugin.json"),
    JSON.stringify({ id: "astro", version: packageVersion }),
  );
  const current = JSON.parse(runCli(["status", "--json"], environment).stdout);
  assert.equal(current.plugin.version, packageVersion);
  assert.equal(current.plugin.stale, false);

  const text = runCli(["status", "--bin-dir", join(root, "bin")], environment);
  assert.match(text.stdout, /plugin build +OK/);
});

test("ax reports start failure and status for an uninstalled runtime", (t) => {
  const { environment, root } = fixture(t);
  // --no-install keeps the failure explicit: without it, ax would bootstrap
  // the runtime (and, with a built dist/, launch a real dashboard).
  const result = runCli(
    ["ax", "--json", "--no-install", "--bin-dir", join(root, "bin")],
    environment,
  );
  assert.equal(result.status, 1, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.start.action, "failed");
  assert.match(report.start.message, /No installed ASTRO plugin found/);
  assert.equal(report.start.healthy, false);
  assert.equal(typeof report.start.elapsedMs, "number");
  assert.equal(report.dashboard.running, false);
  assert.equal(report.plugin.installed, false);
  assert.equal(report.integrations.length > 0, true);
});

test("ax registers both the astrox and ax global shorthands", (t) => {
  const { environment, root } = fixture(t);
  const binDir = join(root, "bin");
  runCli(["ax", "--json", "--no-install", "--bin-dir", binDir], environment);
  const suffix = process.platform === "win32" ? ".cmd" : "";
  assert.equal(existsSync(join(binDir, `astrox${suffix}`)), true);
  assert.equal(existsSync(join(binDir, `ax${suffix}`)), true);
});

test("the ax launcher runs the aggregated command", (t) => {
  const { environment, root } = fixture(t);
  const result = runAx(
    ["--json", "--no-global", "--no-install", "--bin-dir", join(root, "bin")],
    environment,
  );
  assert.equal(result.status, 1, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.start.action, "failed");
  assert.match(report.start.message, /No installed ASTRO plugin found/);
});

test("the ax launcher forwards astrox commands unchanged", (t) => {
  const { environment, root } = fixture(t);
  const result = runAx(
    ["status", "--json", "--bin-dir", join(root, "bin")],
    environment,
  );
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.plugin.installed, false);
  assert.equal(report.dashboard.running, false);
});

test("ax reports unknown subcommands instead of quick-starting them", (t) => {
  const { environment, root } = fixture(t);
  const result = runAx(
    ["frobnicate", "--bin-dir", join(root, "bin")],
    environment,
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown ax command: frobnicate/);
});

test("ax and astrox print the package version for --version", (t) => {
  const { environment } = fixture(t);
  assert.equal(runAx(["--version"], environment).stdout.trim(), packageVersion);
  assert.equal(
    runCli(["--version"], environment).stdout.trim(),
    packageVersion,
  );
});

test("ax bootstrap names the missing build when dist is absent", (t) => {
  const distIndex = fileURLToPath(
    new URL("../dist/index.html", import.meta.url),
  );
  if (existsSync(distIndex)) {
    t.skip("dist is built; the bootstrap would start a real dashboard");
    return;
  }
  const { environment, root } = fixture(t);
  const result = runAx(
    ["--json", "--no-global", "--bin-dir", join(root, "bin")],
    environment,
  );
  assert.equal(result.status, 1, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.start.action, "failed");
  // The runtime was installed, so the failure names the actual gap.
  assert.match(report.start.message, /pnpm build/);
});

test("health exits non-zero when nothing answers the configured port", async (t) => {
  const { environment, root } = fixture(t);
  // Pin a genuinely free port: the default 5678 may be serving the user's
  // real dashboard, which would (correctly) answer the probe.
  const freePort = await getFreePort();
  const json = runCli(
    ["health", "--json", "--port", String(freePort)],
    environment,
  );
  assert.equal(json.status, 1, json.stderr);
  const report = JSON.parse(json.stdout);
  assert.equal(report.healthy, false);
  assert.match(report.error, /fetch failed|no response|HTTP/);
  assert.equal(report.recordedPid, 0);

  const text = runCli(["health", "--port", String(freePort)], environment);
  assert.equal(text.status, 1);
  assert.match(text.stderr, /did not answer \/api\/health/);
});

/** Grab an ephemeral port, release it, and return the number. */
function getFreePort() {
  return new Promise((resolvePort) => {
    const probe = createServer();
    probe.listen(0, "127.0.0.1", () => {
      const port = probe.address().port;
      probe.close(() => resolvePort(port));
    });
  });
}

/**
 * A fake /api/health endpoint served in its OWN process. `runCli` uses
 * spawnSync, which blocks this thread's event loop; an inline createServer
 * would therefore never answer the child's probe and it would time out.
 */
function fakeHealthServer(t, payload, portFile) {
  const script = `
    const { createServer } = require("node:http");
    const { writeFileSync } = require("node:fs");
    const server = createServer((req, res) => res.end(process.argv[1]));
    server.listen(0, "127.0.0.1", () => {
      writeFileSync(process.argv[2], String(server.address().port));
    });
    process.on("SIGTERM", () => process.exit(0));
  `;
  const child = spawn(
    process.execPath,
    ["-e", script, JSON.stringify(payload), portFile],
    { stdio: "ignore" },
  );
  t.after(() => child.kill("SIGTERM"));
  return child;
}

async function waitForPort(portFile, deadlineMs = 5_000) {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    if (existsSync(portFile)) {
      const port = Number(readFileSync(portFile, "utf8").trim());
      if (Number.isFinite(port)) {
        return port;
      }
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  throw new Error(`the fake server never wrote ${portFile}`);
}

test("health verifies a live dashboard and reports service facts", async (t) => {
  const { environment, root } = fixture(t);
  const healthPayload = {
    status: "ok",
    pid: 4242,
    build: "test-build",
    dataRoot: root,
    eventCount: 7,
    restartCount: 1,
    uptimeMs: 1500,
  };
  const portFile = join(root, "fake-port");
  fakeHealthServer(t, healthPayload, portFile);
  const port = await waitForPort(portFile);
  writePidRecord(environment.ASTRO_HOME, port, 4242, "");
  // Pin the port: without it the probe falls back to 5678, where the user's
  // real dashboard may be running.
  const healthArgs = ["health", "--json", "--port", String(port)];

  const json = runCli(healthArgs, environment);
  assert.equal(json.status, 0, json.stderr);
  const report = JSON.parse(json.stdout);
  assert.equal(report.healthy, true);
  assert.equal(report.eventCount, 7);
  assert.equal(report.build, "test-build");
  assert.equal(report.pid, 4242);
  assert.equal(report.recordedPid, 4242);
  assert.equal(report.dataRoot, root);

  const text = runCli(["health", "--port", String(port)], environment);
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /ASTROX HEALTH/);
  assert.match(text.stdout, /events +7/);
  assert.match(text.stdout, /record 4242/);
});

test("stop --json emits one machine-readable document", (t) => {
  const { environment } = fixture(t);
  const result = runCli(["stop", "--json"], environment);
  assert.equal(result.status, 0, result.stderr);
  // The JSON document is the entire stdout: no text chatter around it.
  const report = JSON.parse(result.stdout);
  assert.equal(report.action, "not-running");
  assert.equal(report.pid, 0);
});

test("restart --json reports stop and start results", (t) => {
  const { environment } = fixture(t);
  // Without an installed runtime the start half fails; the stop half is a
  // no-op. Both halves still arrive in one JSON document.
  const result = runCli(["restart", "--json"], environment);
  assert.equal(result.status, 1, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.stop.action, "not-running");
  assert.equal(report.start.action, "failed");
  assert.match(report.start.message, /No installed ASTRO plugin found/);
});

test("logs --follow streams appended lines", async (t) => {
  const { environment } = fixture(t);
  mkdirSync(environment.ASTRO_HOME, { recursive: true });
  const logFile = join(environment.ASTRO_HOME, "dashboard.log");
  writeFileSync(logFile, "first line\n");
  const child = spawn(
    process.execPath,
    [cliFile, "logs", "--follow", "--lines", "5"],
    { env: environment, stdio: ["ignore", "pipe", "pipe"] },
  );
  t.after(() => child.kill("SIGKILL"));
  const output = [];
  child.stdout.on("data", (chunk) => output.push(chunk.toString()));

  await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  appendFileSync(logFile, `appended line ${Date.now()}\n`);
  await new Promise((resolveWait, rejectWait) => {
    const deadline = Date.now() + 5_000;
    const timer = setInterval(() => {
      const text = output.join("");
      if (text.includes("appended line")) {
        clearInterval(timer);
        resolveWait();
      } else if (Date.now() > deadline) {
        clearInterval(timer);
        rejectWait(new Error(`appended line never appeared: ${text}`));
      }
    }, 100);
  });
  child.kill("SIGTERM");
});
