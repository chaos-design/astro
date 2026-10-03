import assert from "node:assert/strict";
import test from "node:test";
import {
  guideAtomCopy,
  guideHighlightItems,
  guideHistoryStatusDescription,
  guideHistoryStatusItems,
  guideLineItems,
  guideStatusItems,
} from "../src/config/atom-guide-copy.ts";

test("documents the dedicated Tool Result atom", () => {
  assert.deepEqual(guideAtomCopy["tool-result"], {
    label: "工具结果",
    description: "发布工具输出或错误，并交给观察阶段归一化。",
  });
});

test("documents every History status icon and its color", () => {
  assert.deepEqual(
    guideHistoryStatusItems.map(({ id, label }) => ({ id, label })),
    [
      { id: "active", label: "紫色 · Active" },
      { id: "waiting", label: "琥珀色 · Waiting" },
      { id: "complete", label: "青绿色 · Complete" },
      { id: "failed", label: "红色 · Failed" },
      { id: "terminated", label: "红色 · Terminated" },
    ],
  );
  assert.ok(
    guideHistoryStatusItems.every(({ description }) => description.length > 0),
  );
  assert.match(
    guideHistoryStatusItems.find(({ id }) => id === "active")?.description ?? "",
    /24 小时/,
  );
  assert.match(
    guideHistoryStatusItems.find(({ id }) => id === "terminated")
      ?.description ?? "",
    /超时阈值/,
  );
});

test("documents how a parent History row derives its status", () => {
  assert.match(guideHistoryStatusDescription, /最后一条 Prompt/);
  assert.match(guideHistoryStatusDescription, /没有 Prompt/);
  assert.match(guideHistoryStatusDescription, /Session 状态/);
});

test("documents the theme-aware edge hover highlight", () => {
  const hover = guideHighlightItems.find(({ id }) => id === "hover");

  assert.equal(hover?.label, "主题高亮 · Hover");
  assert.match(hover?.description ?? "", /暗色主题近白/);
  assert.match(hover?.description ?? "", /浅色主题亮蓝/);
});

test("keeps route types authoritative across lifecycle states", () => {
  assert.deepEqual(
    guideLineItems.map(({ id }) => id),
    ["execution", "data", "feedback", "persistence"],
  );
  assert.match(
    guideHighlightItems.find(({ id }) => id === "active")?.description ?? "",
    /保留类型颜色和线型/,
  );
  assert.match(
    guideHighlightItems.find(({ id }) => id === "complete")?.description ?? "",
    /保留类型颜色和线型/,
  );
  assert.match(
    guideStatusItems.find(({ id }) => id === "completed")?.description ?? "",
    /路径完成态保留类型色/,
  );
});
