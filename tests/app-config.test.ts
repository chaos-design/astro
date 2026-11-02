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
  getMaxSyncHours,
  getMaxSyncLabel,
  historyRangeOptions,
  isDemoGateOpen,
  isHistoryRangeId,
  isMaxSyncId,
  maxSyncOptions,
  retiredStorageKeys,
  shouldShowDemo,
  storageKeys,
} from "../src/config/app-config.ts";

test("keeps user preference defaults and storage keys in app config", () => {
  assert.equal(appDefaults.platform, "claude");
  assert.equal(appDefaults.theme, "dark");
  assert.equal(appDefaults.activeView, "topology");
  assert.equal(appTimings.activeRunTimeoutMs, 24 * 60 * 60 * 1_000);
  // The ceiling of the measured Prompt thread; short threads may overshoot it
  // by 1.25x and are still shown whole (see RunHistoryItem).
  assert.equal(appLayout.historyPromptListMaxHeight, 300);
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

test("opens RUN HISTORY unfiltered", () => {
  // The Live filter can legitimately match nothing, so it must not be armed
  // on first load: an empty panel would read as broken rather than as "idle".
  assert.equal(appDefaults.liveView, false);
  assert.equal(storageKeys.runHistoryLiveView, "ASTROX_RUN_HISTORY_LIVE_VIEW");
  // The old key meant "show the whole history" — the opposite of the filter —
  // so it is retired rather than migrated.
  assert.equal(
    retiredStorageKeys.runHistoryLiveFilter,
    "ASTROX_RUN_HISTORY_LIVE_FILTER",
  );
  assert.ok(!Object.values(storageKeys).includes("ASTROX_RUN_HISTORY_LIVE_FILTER"));
});

test("caps the console's sync window at eight hours by default", () => {
  // A console left open overnight must stop appending events on its own; eight
  // hours covers a working day and the setting can raise it or remove it.
  assert.equal(appDefaults.maxSync, "8h");
  assert.equal(getMaxSyncHours("8h"), 8);
  assert.equal(getMaxSyncLabel("8h"), "8 小时");
  assert.equal(storageKeys.maxSync, "ASTROX_MAX_SYNC");

  // `off` disables the limit instead of scheduling a zero-length window.
  assert.deepEqual(
    maxSyncOptions.map((option) => option.hours),
    [1, 4, 8, 12, 24, 0],
  );
  assert.equal(getMaxSyncHours("off"), 0);
  assert.equal(isMaxSyncId("8h"), true);
  assert.equal(isMaxSyncId("2h"), false);
  assert.equal(isMaxSyncId(null), false);
});

test("lists history ranges in ascending order with matching spans", () => {
  const ids = historyRangeOptions.map((option) => option.id);
  // Four per row in the settings dialog: the hour choices read as one row, the
  // day choices as the next.
  assert.deepEqual(ids, ["1h", "3h", "6h", "12h", "1d", "3d", "5d", "7d"]);

  const hours = historyRangeOptions.map((option) => option.hours);
  assert.deepEqual([...hours].sort((left, right) => left - right), hours);
  assert.ok(
    historyRangeOptions.every((option) => option.label && option.shortLabel),
  );
  assert.equal(getHistoryRangeHours("1h"), 1);
  assert.equal(getHistoryRangeHours("1d"), 24);
  assert.equal(getHistoryRangeHours("3d"), 72);
  assert.equal(getHistoryRangeHours("5d"), 120);
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

test("isDemoGateOpen: dev/test needs no opt-in; production needs ?demo=1", () => {
  const dev = { DEV: true, MODE: "development" };
  const prod = { DEV: false, MODE: "production" };
  // Development permits the sample automatically, with or without the flag.
  assert.equal(isDemoGateOpen(0, dev, false), true);
  assert.equal(isDemoGateOpen(0, dev, true), true);
  // Production stays empty unless the reader explicitly opts in.
  assert.equal(isDemoGateOpen(0, prod, false), false);
  assert.equal(isDemoGateOpen(0, prod, true), true);
  // The flag never overrides real data: captured events always win.
  assert.equal(isDemoGateOpen(5, prod, true), false);
  assert.equal(isDemoGateOpen(5, dev, true), false);
});
