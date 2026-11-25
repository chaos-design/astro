import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { applyServeOptions } from "../bin/astro.mjs";

const cliFile = fileURLToPath(new URL("../bin/astro.mjs", import.meta.url));
const packageVersion = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
).version;

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "astro-cli-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return {
    environment: { ...process.env, ASTRO_HOME: join(root, "home") },
    root,
  };
}

/**
 * `npx astro-plugin <command>` runs this bin; the daemon-control names are
 * forwarded to bin/astrox.mjs with stdio inherited, so the child's output and
 * exit code must surface here unchanged.
 */
function runCli(args, environment) {
  return spawnSync(process.execPath, [cliFile, ...args], {
    encoding: "utf8",
    env: environment,
    timeout: 20_000,
  });
}

test("status forwards to the astrox status report", (t) => {
  const { environment, root } = fixture(t);
  const result = runCli(
    ["status", "--json", "--bin-dir", join(root, "bin")],
    environment,
  );
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.plugin.installed, false);
  assert.equal(report.dashboard.running, false);
  assert.equal(report.integrations.length > 0, true);
});

test("ax forwards to the quick start and propagates its exit code", (t) => {
  const { environment, root } = fixture(t);
  const result = runCli(
    [
      "ax",
      "--json",
      "--no-global",
      "--no-install",
      "--bin-dir",
      join(root, "bin"),
    ],
    environment,
  );
  assert.equal(result.status, 1, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.start.action, "failed");
  assert.match(report.start.message, /No installed ASTRO plugin found/);
  assert.equal(report.start.healthy, false);
});

test("unknown commands still fail with the astro-trace usage", (t) => {
  const { environment } = fixture(t);
  const result = runCli(["frobnicate"], environment);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown astro-trace command: frobnicate/);
});

test("--version prints the package version", (t) => {
  const { environment } = fixture(t);
  const result = runCli(["--version"], environment);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), packageVersion);
});

test("help documents the health probe and the npx entry", (t) => {
  const { environment } = fixture(t);
  const result = runCli(["help"], environment);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /astro-trace health/);
  assert.match(result.stdout, /npx astro-plugin ax/);
});

test("applyServeOptions maps serve flags onto the environment", (t) => {
  const tracked = ["ASTRO_PORT", "ASTRO_HOST", "ASTRO_HOME", "ASTRO_OPEN_BROWSER"];
  const before = Object.fromEntries(
    tracked.map((key) => [key, process.env[key]]),
  );
  t.after(() => {
    for (const key of tracked) {
      if (before[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = before[key];
      }
    }
  });

  const applied = applyServeOptions([
    "node",
    "astro.mjs",
    "serve",
    "--port",
    "4321",
    "--host",
    "0.0.0.0",
    "--astro-home",
    "/tmp/some-home",
    "--open",
  ]);
  assert.deepEqual(applied, {
    ASTRO_PORT: "4321",
    ASTRO_HOST: "0.0.0.0",
    ASTRO_HOME: resolve("/tmp/some-home"),
    ASTRO_OPEN_BROWSER: "1",
  });
  assert.equal(process.env.ASTRO_PORT, "4321");

  // Inline spelling and the aot-home alias work the same way.
  const inline = applyServeOptions([
    "node",
    "astro.mjs",
    "serve",
    "--port=4322",
    "--aot-home=/tmp/other",
  ]);
  assert.equal(inline.ASTRO_PORT, "4322");
  assert.equal(inline.ASTRO_HOME, resolve("/tmp/other"));

  // Without flags nothing is applied — the inherited env stays authoritative.
  assert.deepEqual(applyServeOptions(["node", "astro.mjs", "serve"]), {});
});

test("serve binds the port given by --port with the given astro home", async (t) => {
  const { root } = fixture(t);
  // Grab a free port, release it, and hand it to the server: a fixed port
  // could collide with a dashboard the user is running.
  const net = await import("node:net");
  const freePort = await new Promise((resolvePort) => {
    const probe = net.createServer();
    probe.listen(0, "127.0.0.1", () => {
      const port = probe.address().port;
      probe.close(() => resolvePort(port));
    });
  });
  const child = spawn(
    process.execPath,
    [
      cliFile,
      "serve",
      "--port",
      String(freePort),
      "--astro-home",
      join(root, "home"),
    ],
    { stdio: "ignore" },
  );
  t.after(() => child.kill("SIGKILL"));

  const deadline = Date.now() + 15_000;
  let health = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(
        `http://127.0.0.1:${freePort}/api/health`,
        { signal: AbortSignal.timeout(1_000) },
      );
      if (response.ok) {
        health = await response.json();
        break;
      }
    } catch {
      // The server is still booting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 200));
  }
  assert.ok(health, "the server never answered /api/health on the flag port");
  assert.equal(health.port, freePort);
  assert.equal(health.dataRoot, join(root, "home"));
});
