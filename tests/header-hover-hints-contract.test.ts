import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) =>
  readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

const app = read("app.tsx");
const repoLink = read("components/repo-link.tsx");
const settingsDialog = read("components/settings-dialog.tsx");
const jsonViewer = read("components/json-viewer.tsx");

/**
 * Tooltips are opt-in. A card that only translates a recognisable glyph
 * (GitHub mark, gear, sun/moon, copy) trails the pointer across the header and
 * covers the panel underneath, so those controls keep their `aria-label` and
 * nothing else. The hints that carry information — the `N LIVE` rules, the
 * reload state, which panel a chevron collapses — stay.
 */
test("the repository link announces itself without a hover card", () => {
  assert.doesNotMatch(repoLink, /Tooltip/);
  assert.match(repoLink, /<a\b/, "the control stays an anchor");
  assert.match(repoLink, /aria-label=\{appRepository\.title\}/);
  assert.match(repoLink, /target="_blank"/);
  assert.match(repoLink, /rel="noreferrer noopener"/);
});

test("the settings trigger and the theme switcher keep only aria-labels", () => {
  assert.doesNotMatch(settingsDialog, /Tooltip/);
  assert.match(settingsDialog, /aria-label="打开设置"/);

  // The theme switcher lives in app.tsx; its hover card text must be gone
  // while the aria-label keeps naming the current theme.
  assert.doesNotMatch(app, /<TooltipContent side="bottom">切换主题<\/TooltipContent>/);
  assert.match(app, /aria-label=\{`颜色主题：\$\{activeTheme\.label\}`\}/);
});

test("the JSON copy button relies on its own glyph and check state", () => {
  assert.doesNotMatch(jsonViewer, /Tooltip/);
  assert.match(jsonViewer, /aria-label=\{copied \? "JSON 已复制" : "复制 JSON"\}/);
});

test("the agent picker is not wrapped in a hover card", () => {
  assert.doesNotMatch(app, /<TooltipContent[^>]*>\s*切换智能体平台/);
  assert.doesNotMatch(app, /<TooltipTrigger asChild>\s*<div>\s*<AgentSelect/);
});

test("the hints that carry information are still there", () => {
  // Live semantics: the only place the freshness rules are explained.
  assert.match(app, /className="run-history__live-hint"/);
  assert.match(app, /最近有活动（running 要求 10 分钟内/);
  // The reload control reports its in-flight state through the same card.
  assert.match(app, /reloading \? "正在加载最新消息…" : "重新加载最新消息列表"/);
  // Panel chevrons name which side they collapse.
  assert.match(app, /`\$\{expanded \? "收起" : "展开"\}\$\{/);
});
