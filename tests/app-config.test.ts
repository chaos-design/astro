import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  appDefaults,
  appLayout,
  appRepository,
  appTimings,
  appVersion,
  defaultHistoryRange,
  getHistoryRangeHours,
  historyRangeOptions,
  isHistoryRangeId,
  shouldShowDemo,
  storageKeys,
} from "../src/config/app-config.ts";

test("keeps user preference defaults and storage keys in app config", () => {
  assert.equal(appDefaults.platform, "claude");
  assert.equal(appDefaults.theme, "dark");
  assert.equal(appDefaults.activeView, "topology");
  assert.equal(appTimings.activeRunTimeoutMs, 24 * 60 * 60 * 1_000);
  assert.equal(appLayout.historyPromptListMaxHeight, 270);
  assert.ok(appLayout.historyPromptRowEstimate > 0);
  assert.ok(
    Object.values(storageKeys).every((key) => key.startsWith("ASTROX_")),
  );
});

test("defaults the loaded message range to the last three hours", () => {
  // The preference is shared by RUN HISTORY and the search dialog, so its
  // default is asserted once, here.
  assert.equal(appDefaults.historyRange, "3h");
  assert.equal(defaultHistoryRange, "3h");
  assert.equal(getHistoryRangeHours("3h"), 3);
  assert.equal(storageKeys.historyRange, "ASTROX_HISTORY_RANGE");
});

test("lists history ranges in ascending order with matching spans", () => {
  const ids = historyRangeOptions.map((option) => option.id);
  assert.deepEqual(ids, ["3h", "6h", "12h", "24h", "7d"]);

  const hours = historyRangeOptions.map((option) => option.hours);
  assert.deepEqual([...hours].sort((left, right) => left - right), hours);
  assert.ok(
    historyRangeOptions.every((option) => option.label && option.shortLabel),
  );
  assert.equal(getHistoryRangeHours("7d"), 168);

  assert.equal(isHistoryRangeId("3h"), true);
  assert.equal(isHistoryRangeId("9h"), false);
  assert.equal(isHistoryRangeId(null), false);
});

test("points the header link at the project repository", () => {
  assert.equal(appRepository.url, "https://github.com/chaos-design/astro");
  assert.match(appRepository.url, /^https:\/\/github\.com\/[^/]+\/[^/]+$/);
  assert.ok(appRepository.title.length > 0);
});

test("keeps the header version in sync with the release version", () => {
  const rootPackage = JSON.parse(
    readFileSync(path.resolve(import.meta.dirname, "../package.json"), "utf8"),
  ) as { version: string };
  assert.equal(appVersion, rootPackage.version);
});

test("keeps the collapsed header breakpoint in sync with the stylesheet", () => {
  const styles = readFileSync(
    path.resolve(import.meta.dirname, "../src/styles.css"),
    "utf8",
  );
  const { headerNavCollapseMaxWidth } = appLayout;
  const block = new RegExp(
    `@media \\(max-width: ${headerNavCollapseMaxWidth}px\\) \\{([\\s\\S]*?)\\n\\}`,
  ).exec(styles);
  assert.ok(
    block,
    `src/styles.css must declare a @media (max-width: ${headerNavCollapseMaxWidth}px) block`,
  );
  // The same breakpoint drives the JS media query, so the header rules that
  // collapse the nav must live in that block.
  assert.match(block[1], /\.studio-header__nav-toggle/);
  assert.match(block[1], /\.studio-header__actions\[data-open="true"\]/);
});

test("shows demo data only in development or test environments", () => {
  assert.equal(shouldShowDemo(0, { DEV: true, MODE: "development" }), true);
  assert.equal(shouldShowDemo(0, { DEV: false, MODE: "test" }), true);
  assert.equal(shouldShowDemo(0, { DEV: false, MODE: "production" }), false);
  assert.equal(shouldShowDemo(1, { DEV: true, MODE: "development" }), false);
});
