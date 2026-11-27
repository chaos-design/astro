---
title: Agent 视图渲染与交互完善
priority: P1
created: 2026-11-27 13:01:05
updated: 2026-11-27 15:01:31
---

# Agent 视图渲染与交互完善

## 目标

数组块式渲染与代码样式、折叠后保留内容摘要、思考类字段全对齐、Agent 视图滚动进度条（turn 打点/hover/点击）、思考→回复 hover 闪现修复、Agent Name 后快速切换消息、耗时颜色分级

## 范围

- 包含：Agent 步骤渲染（数组块式、折叠正文、思考拼写）、链路进度条、消息 stepper、时长分级
- 不包含：服务端采集协议、保留策略的删除实现（本轮仅语义描述）、文档站构建

## 实施任务

- [x] T1 数组块式渲染与代码结构样式
- [x] T2 折叠消息保留内容摘要
- [x] T3 思考类字段(thinking/thought/深度思考)对齐
- [x] T4 Agent View 滚动进度条与 turn 打点
- [x] T5 思考→回复 hover 闪现修复
- [x] T6 快速切换消息
- [x] T7 耗时颜色分级
- [x] T8 全量校验并 push

## 完成标准

- [x] code: 实现、迁移和文档均已完成，不保留双轨逻辑（分级只有 `duration-label.ts` 一处；进度条 fill 走 DOM 直写，无每帧 setState）
- [x] linter_result: `./node_modules/.bin/tsc --noEmit`（root + site）退出码 0（本仓库 lint 入口为 tsc + verify-console-build）
- [x] unit_test_result: `node --test tests/*.test.*`（无沙箱）1032 pass / 0 fail，基线 1025、新增 7（duration heat、思考拼写、数组块式断言更新）
- [x] func_test_result: 无头 Chrome + 4411 fixture（两条消息、3 轮）：进度条 3 tick/aria 正确、fill 100%→50%、hover tooltip、点击跳轮 ratio 1.00；stepper 2/2→1/2；放大层无异常输出
- [x] status: 剩余风险（刻度比例在极端内容增长下依赖下一次滚动事件刷新；中文块类型集合随宿主漂移需增量）与回滚（revert 单提交即可，渲染均为表现层）已记录

## 风险与回滚

- 风险：进度条刻度比例在 live 内容高速追加时依赖滚动/resize 事件刷新（下一次滚动会重算）；思考块类型集合（含中文拼写）随宿主版本漂移，需按样本增量补充；`relatedTarget` 关闭竞态修复依赖 DOM 事件顺序（pointerenter 先于 pointerleave），宿主若是非标准合成事件需复验。
- 回滚：全部为表现层与采集解析，`git revert` 单提交即可；无数据迁移。

## 进度日志

- 2026-11-27 13:01:05 创建（planing）
- 2026-11-27 13:09:54 完成 #1 T1 数组块式渲染与代码结构样式
- 2026-11-27 13:09:54 payload-markdown: arrays render one block per item (no bullets; compact record rows too, checklist prefix kept); fenced code items keep their own block; tests 28/28
- 2026-11-27 13:09:54 完成 #3 T3 思考类字段(thinking/thought/深度思考)对齐
- 2026-11-27 13:09:54 transcript-enrich reasoningText rewritten shape-driven: THINKING_BLOCK_TYPES (thinking/thought/reasoning*/deepthinking/summary*/深度思考/思考) + THINKING_TEXT_FIELDS (thinking/thought/reasoning/reasoning_content/reasoningContent/summary_text); thinking entries read all fields, assistant records read typed blocks + scalar fields only (no double-count with assistantText); entryKind accepts thought/deep-thinking/Chinese types; tests 19/19; mirrors rebuilt
- 2026-11-27 13:12:23 完成 #2 T2 折叠消息保留内容摘要
- 2026-11-27 13:12:23 statCardRowHint: folded teaser now leads with the result's own first line (splitPayloadPreview content, or shell stdout for a command call) — inputs' key/value pairs only as fallback; the folded Read card shows the captured file content instead of file_path
- 2026-11-27 13:12:23 完成 #5 T5 思考→回复 hover 闪现修复
- 2026-11-27 13:12:23 two layers: StatChip leave handler checks event.relatedTarget — DOM fires pointerenter(next) BEFORE pointerleave(previous), so the previous chip's 140ms close timer fired after the next chip opened (flash then dead); StepStatusBadge/RunClockChip cards are CSS-:hover/:focus-within driven (mounted, display:none default) so any re-render under the pointer cannot flash them
- 2026-11-27 13:15:30 完成 #7 T7 耗时颜色分级
- 2026-11-27 13:15:30 durationHeatClass moved to duration-label.ts as the single classifier (fast<10s green / normal<1m teal / slow<5m amber / very-slow>=5m red, idle neutral); LOG + trajectory unchanged (heat-* classes), legend <10m-><5m; Agent step badges and the accumulated run clock now graded with the same ladder (clock skips grading while live or status-coloured); duration-label tests 4/4
- 2026-11-27 13:45:53 完成 #4 T4 Agent View 滚动进度条与 turn 打点
- 2026-11-27 13:45:53 ChainProgress under the Agent chain: thin violet fill = scroll completion (DOM-written per rAF, no re-render), one tick per turn placed by DOM measurement (first step's offset over the scroll range), hover card states 轮次/步数/起始行 (CSS hover), click scrolls that turn's first card into view; ResizeObserver re-measures on panel resize; e2e on 4411: 3 ticks with correct aria labels, fill 100%->50% on scroll, tooltip shows 第 3 轮 | 1 步 · 从 #010 行开始, tick click lands ratio 1.00
- 2026-11-27 13:45:54 完成 #6 T6 快速切换消息
- 2026-11-27 13:45:54 RunStepper beside AgentSelect: ‹ 1/N › steps the session's messages (setActivePromptRunKey + anchor event + locate), disabled at the edges, button title names the target prompt; hidden when the session has one message; e2e: 2/2 -> click prev -> 1/2
- 2026-11-27 13:46:46 完成 #8 T8 全量校验并 push
- 2026-11-27 13:46:46 tsc root+site exit 0; 1032/1032 unsandboxed; vite build ok; e2e evidence recorded; commits queued for push
- 2026-11-27 15:01:31 归档：任务与完成标准全部满足
