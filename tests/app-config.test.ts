import assert from "node:assert/strict";
import test from "node:test";
import {
  appDefaults,
  appLayout,
  appTimings,
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

test("shows demo data only in development or test environments", () => {
  assert.equal(shouldShowDemo(0, { DEV: true, MODE: "development" }), true);
  assert.equal(shouldShowDemo(0, { DEV: false, MODE: "test" }), true);
  assert.equal(shouldShowDemo(0, { DEV: false, MODE: "production" }), false);
  assert.equal(shouldShowDemo(1, { DEV: true, MODE: "development" }), false);
});
