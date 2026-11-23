import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../src/app.tsx", import.meta.url), "utf8");
const server = readFileSync(
  new URL("../server/server.mjs", import.meta.url),
  "utf8",
);
const repository = readFileSync(
  new URL("../server/trace-repository.mjs", import.meta.url),
  "utf8",
);
const styles = readFileSync(
  new URL("../src/styles.css", import.meta.url),
  "utf8",
);
const opencode = readFileSync(
  new URL("../opencode-plugin/index.ts", import.meta.url),
  "utf8",
);
const pi = readFileSync(new URL("../pi-plugin/index.ts", import.meta.url), "utf8");

/**
 * The drift that hid the stale opencode plugin (installed v0.0.3, repo v0.0.5)
 * had no observability: nothing recorded which capture code wrote an event.
 * Both long-lived adapters stamp their own manifest version; the service
 * aggregates it per source and the console shows it, so a reinstall without a
 * restart becomes visible as two versions for one client.
 */
test("long-lived capture adapters stamp their own manifest version", () => {
  for (const adapter of [opencode, pi]) {
    assert.match(adapter, /createRequire\(import\.meta\.url\)/);
    assert.match(adapter, /equire\("\.\/package\.json"\)\.version/);
    assert.match(adapter, /\{ \.\.\.payload, captureVersion \}/);
  }
});

test("the service aggregates capture versions and reports them in health", () => {
  assert.match(repository, /this\.captureVersions = new Map\(\)/);
  assert.match(repository, /trackCaptureVersion\(event\)/);
  assert.match(repository, /getCaptureVersions\(\)/);
  assert.match(server, /captureVersions: store\.getCaptureVersions\(\)/);
});

test("the repository counts unstamped events and derives drift clock-independently", () => {
  // The original bug: a process on pre-stamp code writes no captureVersion, so
  // counting only stamped versions showed one value and never warned.
  assert.match(repository, /unversionedAt/);
  assert.match(
    repository,
    /state\.unversionedAt >= newestStampedAt/,
    "an unstamped event at/after the newest stamp means an old process still writes",
  );
  assert.match(repository, /versions\.length > 1/);
});

test("the console service card shows generations, drift and a copyable restart command", () => {
  assert.match(app, /unversionedAt: number \| null/);
  assert.match(app, /<h4>采集插件版本<\/h4>/);
  assert.match(app, /v旧\(未标记\)/);
  assert.match(app, /state\.stale/);
  assert.match(app, /复制 \{source\} 重启指令/);
  assert.match(app, /copyCaptureRestart\(source\)/);
  assert.match(styles, /\.service-card__capture-restart \{/);
});

test("restart commands are per host and never claim to have applied themselves", () => {
  const helper = readFileSync(
    new URL("../src/lib/capture-restart-command.ts", import.meta.url),
    "utf8",
  );
  assert.match(helper, /opencode service restart/);
  assert.match(helper, /重新打开对应的 Pi 会话/);
  assert.match(helper, /已复制|请手动执行/);
});
