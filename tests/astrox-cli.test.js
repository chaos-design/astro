import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { findGlobalCli, registerGlobalCli } from "../bin/astrox.mjs";

const cliFile = fileURLToPath(new URL("../bin/astrox.mjs", import.meta.url));

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

test("help documents the plugin command set", (t) => {
  const { environment } = fixture(t);
  const result = runCli(["help"], environment);
  assert.equal(result.status, 0, result.stderr);
  for (const command of [
    "start",
    "stop",
    "restart",
    "status",
    "info",
    "update",
    "doctor",
    "install",
    "open",
    "logs",
    "path",
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
