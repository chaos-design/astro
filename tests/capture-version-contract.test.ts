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

test("the console service card shows capture versions and flags drift", () => {
  assert.match(app, /captureVersions: Record<string, Array<\{ version: string; lastSeenAt: number \}\>>/);
  assert.match(app, /<h4>采集插件版本<\/h4>/);
  assert.match(app, /const stale = versions\.length > 1/);
  assert.match(app, /同一客户端出现多个采集版本/);
  assert.match(styles, /\.service-card__capture-versions > div\[data-stale="true"\] dd/);
});
