import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  appDefaults,
  appLayout,
  appTimings,
  appVersion,
  shouldShowDemo,
  storageKeys,
} from "../src/config/app-config.ts";

test("keeps user preference defaults and storage keys in app config", () => {
  assert.equal(appDefaults.platform, "codex");
  assert.equal(appDefaults.theme, "dark");
  assert.equal(appDefaults.activeView, "topology");
  assert.equal(appTimings.activeRunTimeoutMs, 24 * 60 * 60 * 1_000);
  assert.equal(appLayout.historyPromptListMaxHeight, 270);
  assert.ok(appLayout.historyPromptRowEstimate > 0);
  assert.ok(
    Object.values(storageKeys).every((key) => key.startsWith("ASTROX_")),
  );
});

test("keeps the header version in sync with the release version", () => {
  const rootPackage = JSON.parse(
    readFileSync(path.resolve(import.meta.dirname, "../package.json"), "utf8"),
  ) as { version: string };
  assert.equal(appVersion, rootPackage.version);
});

test("shows demo data only in development or test environments", () => {
  assert.equal(shouldShowDemo(0, { DEV: true, MODE: "development" }), true);
  assert.equal(shouldShowDemo(0, { DEV: false, MODE: "test" }), true);
  assert.equal(shouldShowDemo(0, { DEV: false, MODE: "production" }), false);
  assert.equal(shouldShowDemo(1, { DEV: true, MODE: "development" }), false);
});
