---
title: Agent data view issue 27
priority: P2
created: 2026-11-23 13:36:23
updated: 2026-11-23 13:38:06
---

# Agent data view issue 27

## 目标

在 `PayloadOverlay` 增加默认 `Agent` 视图，把一次运行的事件序列按 Agent 真实产出形态呈现为思考过程、回复、工具结果、用户提问和通用事件；同 `messageId` 的流式快照只显示一条回复，全部正文复用既有单一渲染源，`TraceEvent` 不可变，左 rail 与视图共用选择状态。

## 范围

- 包含：`data/demo-events.json`（20 事件验收样本）、`opencode-plugin/` 与 `pi-plugin/` 的 `messageId` 写入和版本 bump、`docs/event-protocol-{zh,en}.md`、`src/lib/agent-view.ts`、`tests/agent-view.test.ts`、`src/components/agent-transcript.tsx`、`src/components/related-fields.tsx`、`src/components/payload-overlay.tsx`、`src/app.tsx`、`src/styles.css`、既有测试的样本口径更新、`AGENTS.md`、`docs/user-manual-{zh,en}.md`、`docs/conventions-{zh,en}.md`、`docs/index.md`、`site/src/docs.ts` catalog 核对、PR #30。
- 不包含：画布拓扑语义、异常分类、提问可答性规则、compaction（#28）、宿主原生 UI 像素级还原、新文档页。无新文档页时 `docs/index.md` 与 `site/src/docs.ts` 只更新已有条目/阅读路径，不新增 catalog 项。

## 实施任务

- [x] P0-a 样本基线：`data/demo-events.json` 增加 2 条 `streamed: true` 前缀、1 条带 `messageId: demo-message-3` 的最终 `AgentMessage` 和 AskUserQuestion start/answer 生命周期；总数 16→20，同步 `demo-events.test.ts`、`demo-dataset.test.js` 计数及拓扑/轨迹既有断言。
- [x] P0-b OpenCode 采集端：`index.ts` 从 textKey 的 `messageID`/`partID` 取稳定 id 写入快照，`mapping.ts` 在 `session.text.ended` 写同一 id；版本 0.0.6→0.0.7，补 `opencode-index.test.ts`、`opencode-mapping.test.ts` 断言。
- [x] P0-b Pi 采集端：`readPiLiveText(event).messageId` 写入 throttled 快照与 `message_end` 最终消息；版本 0.0.6→0.0.7，补 `pi-extension.test.ts`、`pi-mapping.test.ts` 断言。
- [x] 协议同步：`docs/event-protocol-zh.md` 与 `docs/event-protocol-en.md` 的 §9 补 `messageId` / `streamed` 字段语义，说明同一消息的快照与最终消息共享 id，老数据缺字段时仍按独立事件展示。
- [x] P1 派生层：新增 `src/lib/agent-view.ts` 的 `AgentStep` 变体、`AgentView`、`AgentViewDiagnostic` 类型与纯函数 `buildAgentView(events, platformId)`；turn、sequence、atomId、tone、pair 耗时/链接全部复用既有函数。
- [x] P1 合并与降级：按 `sessionId + messageId` 分组、按 capturedAt 排序、前缀校验、最终消息收口；断裂记 diagnostic 且保留每一步，无 id 老数据只折叠时间邻近且 `startsWith` 的链（10 分钟窗口），Reasoning 每事件独立成块，question 只绑阻断 start 并复用 `parseUserQuestionContent`。
- [x] P1 单测：`tests/agent-view.test.ts` 从 demo 文件读取样本，验证 2 快照+1 最终消息只产出 1 个 ReplyStep、`snapshotCount === 2`、`stats.snapshotsMerged === 2`、D2、断裂降级、无 id 回退和 question 解析。
- [x] P2 共享相关字段：把 overlay 内的 `RelatedValue` 提取为 `src/components/related-fields.tsx` 的 `RelatedFields`，Preview 与 Agent 步骤共用 `collectPayloadFields` + `orderRelated` 完整清单与 `RELATED_VALUE_MAX_CHARS` 按值折叠。
- [x] P2 呈现层：新增 `agent-transcript.tsx` 与 `src/styles.css` 样式，四类 block 复用 `MarkdownView` / `QuestionContent` / `QuestionPreview` / `PairLinkMarker`，思考默认折叠，`.agent-step__head` / `.agent-step__toggle` 加入全局 button border reset 排除名单。
- [x] P3 集成：`PayloadViewMode` 增加 `agent` 且为默认，ToggleGroup 三态；`app.tsx` 用 `useMemo(buildAgentView(activeEvents, platformId))` 传参并传 `questionBinding`/`questionEventId`；步骤经 `handleAgentSelectEvent` 与 rail 共用 `onSelectAtom`，提问只在匹配当前视图且有 binding 时可答。
- [x] P4 文档同步：`user-manual-{zh,en}.md`、`conventions-{zh,en}.md`、`AGENTS.md`、`docs/index.md` 写明三视图、合并/降级口径与 messageId 协议；`site/src/docs.ts` 无新文档页，确认已有 catalog 条目无需新增。
- [x] P4 质量门禁：`node --test tests/*.test.*`（900/900）、`./node_modules/.bin/tsc --noEmit`、`./node_modules/.bin/tsc -p site/tsconfig.json --noEmit`、前端与站点 `vite build`、`node scripts/build-native-plugins.mjs`、`node scripts/validate-claude-hooks.mjs`、`git diff --check` 全绿。
- [x] P4 真实进程验证：用 `ASTRO_HOME=/tmp/astro-agent-view ASTRO_PORT=4397 node server/server.mjs` 启动服务，请求 `/api/demo-events` 验证 20 事件与 `messageId`/`streamed`；检查构建产物包含 Agent 视图标识。
- [x] 提交：conventional commit `1b0b398`、push `feat/agent-data-view`，PR #30 标题/正文中文且关联 issue #27；本计划随后单独提交。

## 完成标准

- [x] code: 实现集中在 `agent-view.ts` / `agent-transcript.tsx` / `related-fields.tsx`，采集端与协议同步，文档一致；无第二套 Markdown 解析器、异常分类、事件分类列表或内联样本数据。
- [x] linter_result: `./node_modules/.bin/tsc --noEmit` 与 `./node_modules/.bin/tsc -p site/tsconfig.json --noEmit` 退出码均为 0（仓库无 lint 脚本，按 README 契约执行）。
- [x] unit_test_result: `node --test tests/*.test.*` 全绿；记录总通过数与新增 `agent-view.test.ts` 用例数。
- [x] func_test_result: 真实服务进程返回 20 条 demo 事件且含组合样本；静态构建产物含 Agent 视图标识；记录命令与关键输出。
- [x] status: 剩余风险与回滚方式已写入本文件。

## 风险与回滚

- 风险：老采集进程不写 `messageId`，只能走时间邻近 + `startsWith` 回退；并发消息可能误合，因此只合并严格前缀且超过 10 分钟窗口即断开。
- 风险：前缀断裂时保留每一步会临时出现多条回复，但比静默丢弃更符合「不丢数据」要求；诊断区显示断裂原因。
- 风险：Demo 样本从 16 增至 20 会改变工具对计数和 turn 3 的 pair ordinal，已同步更新既有断言；以后改样本仍需复核拓扑/轨迹测试。
- 风险：`Agent` 为默认视图改变既有浮层习惯，`Preview` / `Code` 仍一键可达；提问表单仅在匹配当前视图且 binding 存在时出现，不答到旧请求。
- 回滚：`git revert <commit>` 撤销实现，恢复原 Demo 文件、插件版本与测试断言；前端为纯派生投影，无持久化数据迁移，回滚后服务无需迁移即可恢复。

## 进度日志

- 2026-11-23 13:36:23 创建（planing）
- 2026-11-23 13:37:19 完成 #1 P0-a 样本基线：`data/demo-events.json` 增加 2 条 `streamed: true` 前缀、1 条带 `messageId: demo-message-3` 的最终 `AgentMessage` 和 AskUserQuestion start/answer 生命周期；总数 16→20，同步 `demo-events.test.ts`、`demo-dataset.test.js` 计数及拓扑/轨迹既有断言。
- 2026-11-23 13:37:19 demo-events.json 20 events; node --test tests/demo-events.test.ts tests/demo-dataset.test.js pass; topology and trajectory counts updated for new question tool pair
- 2026-11-23 13:37:19 完成 #2 P0-b OpenCode 采集端：`index.ts` 从 textKey 的 `messageID`/`partID` 取稳定 id 写入快照，`mapping.ts` 在 `session.text.ended` 写同一 id；版本 0.0.6→0.0.7，补 `opencode-index.test.ts`、`opencode-mapping.test.ts` 断言。
- 2026-11-23 13:37:19 opencode index.ts and mapping.ts write messageId; package 0.0.7; opencode-index and opencode-mapping tests pass with captureVersion 0.0.7
- 2026-11-23 13:37:20 完成 #3 P0-b Pi 采集端：`readPiLiveText(event).messageId` 写入 throttled 快照与 `message_end` 最终消息；版本 0.0.6→0.0.7，补 `pi-extension.test.ts`、`pi-mapping.test.ts` 断言。
- 2026-11-23 13:37:20 pi index.ts and mapping.ts write messageId from readPiLiveText; package 0.0.7; pi-extension and pi-mapping tests pass
- 2026-11-23 13:37:20 完成 #4 协议同步：`docs/event-protocol-zh.md` 与 `docs/event-protocol-en.md` 的 §9 补 `messageId` / `streamed` 字段语义，说明同一消息的快照与最终消息共享 id，老数据缺字段时仍按独立事件展示。
- 2026-11-23 13:37:20 event-protocol-zh.md and event-protocol-en.md section 9 document messageId and streamed
- 2026-11-23 13:37:20 完成 #5 P1 派生层：新增 `src/lib/agent-view.ts` 的 `AgentStep` 变体、`AgentView`、`AgentViewDiagnostic` 类型与纯函数 `buildAgentView(events, platformId)`；turn、sequence、atomId、tone、pair 耗时/链接全部复用既有函数。
- 2026-11-23 13:37:20 src/lib/agent-view.ts adds AgentStep, AgentView, AgentViewDiagnostic and pure buildAgentView; reuses buildTraceTurnIndex, buildPairDurations, buildPairLinks, getAtomIdForEvent, formatLogSequence, eventMeta
- 2026-11-23 13:37:20 完成 #6 P1 合并与降级：按 `sessionId + messageId` 分组、按 capturedAt 排序、前缀校验、最终消息收口；断裂记 diagnostic 且保留每一步，无 id 老数据只折叠时间邻近且 `startsWith` 的链（10 分钟窗口），Reasoning 每事件独立成块，question 只绑阻断 start 并复用 `parseUserQuestionContent`。
- 2026-11-23 13:37:20 messageId grouping, capturedAt order, prefix check, final message closure, diagnostics on breaks with all steps kept, 10-minute startsWith fallback, Reasoning per event, question start via parseUserQuestionContent
- 2026-11-23 13:37:21 完成 #7 P1 单测：`tests/agent-view.test.ts` 从 demo 文件读取样本，验证 2 快照+1 最终消息只产出 1 个 ReplyStep、`snapshotCount === 2`、`stats.snapshotsMerged === 2`、D2、断裂降级、无 id 回退和 question 解析。
- 2026-11-23 13:37:21 tests/agent-view.test.ts reads demo fixture; 5 tests pass for merge, D2, question, prefix break and legacy fallback
- 2026-11-23 13:37:21 完成 #8 P2 共享相关字段：把 overlay 内的 `RelatedValue` 提取为 `src/components/related-fields.tsx` 的 `RelatedFields`，Preview 与 Agent 步骤共用 `collectPayloadFields` + `orderRelated` 完整清单与 `RELATED_VALUE_MAX_CHARS` 按值折叠。
- 2026-11-23 13:37:21 src/components/related-fields.tsx extracted; payload-overlay.tsx reuses RelatedFields; per-value folding keeps RELATED_VALUE_MAX_CHARS=200
- 2026-11-23 13:37:21 完成 #9 P2 呈现层：新增 `agent-transcript.tsx` 与 `src/styles.css` 样式，四类 block 复用 `MarkdownView` / `QuestionContent` / `QuestionPreview` / `PairLinkMarker`，思考默认折叠，`.agent-step__head` / `.agent-step__toggle` 加入全局 button border reset 排除名单。
- 2026-11-23 13:37:21 agent-transcript.tsx and styles.css render thinking, reply, tool-result and question; MarkdownView, QuestionContent, QuestionPreview, PairLinkMarker reused; button reset exclusions added
- 2026-11-23 13:37:21 完成 #10 P3 集成：`PayloadViewMode` 增加 `agent` 且为默认，ToggleGroup 三态；`app.tsx` 用 `useMemo(buildAgentView(activeEvents, platformId))` 传参并传 `questionBinding`/`questionEventId`；步骤经 `handleAgentSelectEvent` 与 rail 共用 `onSelectAtom`，提问只在匹配当前视图且有 binding 时可答。
- 2026-11-23 13:37:21 PayloadViewMode has agent default; app.tsx memoizes buildAgentView and passes questionBinding/questionEventId; handleAgentSelectEvent shares onSelectAtom
- 2026-11-23 13:37:22 完成 #11 P4 文档同步：`user-manual-{zh,en}.md`、`conventions-{zh,en}.md`、`AGENTS.md`、`docs/index.md` 写明三视图、合并/降级口径与 messageId 协议；`site/src/docs.ts` 无新文档页，确认已有 catalog 条目无需新增。
- 2026-11-23 13:37:22 user-manual-zh/en, conventions-zh/en, AGENTS.md and docs/index.md updated; site/src/docs.ts has existing catalog entries and no new docs were added
- 2026-11-23 13:37:22 完成 #12 P4 质量门禁：`node --test tests/*.test.*`（900/900）、`./node_modules/.bin/tsc --noEmit`、`./node_modules/.bin/tsc -p site/tsconfig.json --noEmit`、前端与站点 `vite build`、`node scripts/build-native-plugins.mjs`、`node scripts/validate-claude-hooks.mjs`、`git diff --check` 全绿。
- 2026-11-23 13:37:22 900/900 node tests; root and site tsc exit 0; console and site vite builds pass; build-native-plugins and validate-claude-hooks pass; git diff --check clean
- 2026-11-23 13:37:53 完成 #13 P4 真实进程验证：用 `ASTRO_HOME=/tmp/astro-agent-view ASTRO_PORT=4397 node server/server.mjs` 启动服务，请求 `/api/demo-events` 验证 20 事件与 `messageId`/`streamed`；检查构建产物包含 Agent 视图标识。
- 2026-11-23 13:37:53 ASTRO_HOME=/tmp/astro-agent-view ASTRO_PORT=4397 node server/server.mjs; GET /api/demo-events returned eventCount=20,total=20,streamed=2,messageIds=[demo-message-3],question=true; grep AGENT VIEW in dist/assets/index-Cq0c2QO9.js matched
- 2026-11-23 13:37:53 完成 #14 提交：conventional commit `1b0b398`、push `feat/agent-data-view`，PR #30 标题/正文中文且关联 issue #27；本计划随后单独提交。
- 2026-11-23 13:37:53 commit 1b0b398 pushed to origin/feat/agent-data-view; PR #30 OPEN, Chinese body with change/verify/notes and Closes issue 27
- 2026-11-23 13:37:53 完成 #15 code: 实现集中在 `agent-view.ts` / `agent-transcript.tsx` / `related-fields.tsx`，采集端与协议同步，文档一致；无第二套 Markdown 解析器、异常分类、事件分类列表或内联样本数据。
- 2026-11-23 13:37:53 single agent-view projection, shared related-fields, shared markdown/question renderers; docs and protocol synchronized; no inline sample data or second taxonomy
- 2026-11-23 13:37:53 完成 #16 linter_result: `./node_modules/.bin/tsc --noEmit` 与 `./node_modules/.bin/tsc -p site/tsconfig.json --noEmit` 退出码均为 0（仓库无 lint 脚本，按 README 契约执行）。
- 2026-11-23 13:37:53 root tsc --noEmit exit 0; site tsc -p site/tsconfig.json --noEmit exit 0
- 2026-11-23 13:37:54 完成 #17 unit_test_result: `node --test tests/*.test.*` 全绿；记录总通过数与新增 `agent-view.test.ts` 用例数。
- 2026-11-23 13:37:54 node --test tests/*.test.* 900 pass / 0 fail; new tests/agent-view.test.ts has 5 passing cases
- 2026-11-23 13:37:54 完成 #18 func_test_result: 真实服务进程返回 20 条 demo 事件且含组合样本；静态构建产物含 Agent 视图标识；记录命令与关键输出。
- 2026-11-23 13:37:54 real service process served 20 demo events with 2 streamed snapshots and one messageId; built console bundle contains AGENT VIEW and merge label
- 2026-11-23 13:37:54 完成 #19 status: 剩余风险与回滚方式已写入本文件。
- 2026-11-23 13:37:54 remaining risks and git revert rollback recorded in plan body
- 2026-11-23 13:38:06 归档：任务与完成标准全部满足
