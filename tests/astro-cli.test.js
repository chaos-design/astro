import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

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
