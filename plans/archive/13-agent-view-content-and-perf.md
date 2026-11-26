---
title: Agent 视图多维内容与性能完善
priority: P1
created: 2026-11-26 22:36:12
updated: 2026-11-26 23:38:09
---

# Agent 视图多维内容与性能完善

## 目标

复核计划 12 与 03 的真实完成状态并修掉校验出的功能缺陷；Agent 统计 chip 高亮时图标同步高亮；
每个客户端（ZCode / WorkBuddy / Claude / Codex / OpenCode / Pi / DeepSeek）都能采到思考与回复正文，
且正文一字不落；性能面板补当前页面帧率并统一时间量纲（ms / s / 01M01s / 01H01M）；消息时长语义
（主消息累积、子消息自身）与异常原因 hover；设置增加历史消息自动清理（默认 15 天可配）；Agent 滚动
时左 rail 跟随活动原子；派生管线有优化前后基准；三项新能力各自建 issue 与设计文档。

## 范围

- 包含：
  - `plans/archive/12-*.md`、`plans/pending/03-*.md` 的 15 + 32 项任务与 5 项 DoD 的实机校验（tsc、`node --test`、`pnpm verify:host-integration`、源码定位），以及校验暴露的缺陷修复。
  - `plugin/trace-recorder.cjs` 及相关适配器：hook 读 stdin / 写事件的硬预算、按 `transcript_path` 补采 `Reasoning` 与 `AgentMessage`（增量游标 + 去重），保证思考与回复正文完整。
  - 控制台：`src/components/agent-transcript.tsx`（chip 图标、步骤时长、异常原因 hover）、`src/components/payload-overlay.tsx`（rail 跟随阅读行）、`src/lib/agent-view.ts`（步骤时长 / 异常投影）、`src/lib/perf-metrics.ts`（页面帧率、时间量纲）、`src/components/settings-dialog.tsx` + `server/`（自动清理）。
  - 新 issue（gh，父 #29）与 `docs/` 设计文档、`docs/index.md`、`site/src/docs.ts`、`AGENTS.md`、`docs/conventions-{zh,en}.md`、`docs/user-manual-zh.md` 同步。
- 不包含：
  - 重开或改写已归档的计划 11 / 12；把计划 03 的 F3 标为通过（真实 Claude 宿主仍缺二进制，ZCode 日志仍有 3 条宿主侧失败）。
  - 改动 `TraceEvent` 持久化 schema、原子拓扑语义、视觉皮肤级还原宿主 UI。
  - 清理用户机器上的真实 trace 数据（自动清理默认关闭，代码只提供能力与预览计数）。
  - 部署（GitHub Pages / 插件发布）与版本号 bump。

## 实施任务

- [x] T1 校验计划 12/03：根级与 site 的 tsc、全量 `node --test`（无沙箱）、`pnpm verify:host-integration`、计划 12 的 15 项任务与 7 轮审查逐条源码定位、计划 03 的 F1–F5 产物定位；把结论写进本 plan 的进度日志并在计划 03 措辞有误处更正。
- [x] T2 修复校验发现的采集阻塞：`plugin/trace-recorder.cjs` 的 `readStdin` 增加硬截止（默认 1500ms，`ASTRO_STDIN_TIMEOUT_MS` 可调），超时按已读内容继续；确认 `PreToolUse` 超时（ZCode 日志 `outcome: timed_out`，5005ms）不再由采集器造成；补 `tests/recorder-stdin-budget.test.*`。
- [x] T3 统计 chip 高亮时图标同步高亮：`.agent-transcript__stat-icon` 改为跟随 `currentColor`，hover / `is-open` / `is-live` / `is-merged` 四种高亮态下图标与文字同色（`src/styles.css`）。
- [x] T4 各客户端思考/回答完整采集：新增 `plugin/transcript-enrich.cjs`（纯函数 + 增量游标），recorder 在写完宿主事件后按 `payload.transcript_path` 补采 `Reasoning` / `AgentMessage`，按条目 id 去重、按字节上限单次读取；`AgentMessage` 复用宿主 messageId，使 `buildAgentView` 走同一条前缀合并；补 `tests/transcript-enrich.test.cjs` 覆盖 WorkBuddy / Claude / Codex 三种 transcript 形状与去重、上限、损坏行。
- [x] T5 性能面板：`src/lib/perf-metrics.ts` 增加常驻页面帧率采样（1s 窗口，标签页隐藏时暂停），折叠胶囊与展开面板都显示当前 FPS；新增 `formatPerfDuration`（<10s `ms`、10–60s `s`、1–60min `01M01s`、>60min `01H01M`，两位补零）并替换面板里的时间行；补 `tests/perf-metrics.test.ts` 的量纲与帧率用例。
- [x] T6 消息时长与异常原因：`src/lib/agent-view.ts` 给每个步骤投影 `durationMs`（回复=首快照→最终消息、工具=配对跨度、其余=事件自身跨度）与 `anomaly`（复用 `getExceptionOutcome`）；主消息头部保持累积时长；`agent-transcript.tsx` 在每个步骤头部渲染自身时长，hover 卡片显示状态与原因（超时 / 中止 / 中断 / 会话结束 / 执行失败 + 记录文本）；`run-history-state.ts` 增加中文原因描述表（唯一定义）；补 `tests/agent-view-duration.test.ts`。
- [x] T7 设置增加历史自动清理：`server/retention.mjs`（纯选择 + 删除，保留 `data/demo-events.json`）、`POST /api/retention/prune`、`GET /api/retention/preview`；`app-config.ts` 新增 `ASTROX_RETENTION`（`{enabled, days}`，默认 `{enabled:false, days:15}`）；设置「运行历史」页加开关与天数输入，启用时先展示将被删除的条数与时间范围并要求确认；补 `tests/retention.test.mjs` 与服务路由用例。
- [x] T8 Agent 滚动时 rail 跟随活动原子：`payload-overlay.tsx` 在 `viewMode === "agent"` 时以阅读行（`contentActiveEventId`）为 rail reveal 的唯一驱动，取消 `following` 守卫；显式定位（`railLocateRequest`）仍走动画并让出一帧。
- [x] T9 派生管线性能优化：`node scripts/perf-fixture.mjs --write` + `node scripts/perf-derive-bench.mjs` 取基线，针对最慢阶段（预期 `projection` / `topology` / `agent-view`）做量化优化，复跑同一 fixture 记录前后数字进本 plan 与设计文档。
- [x] T10 创建 3 个 issue 与设计文档：`[007/设计]` 性能面板帧率与时间量纲、`[008/设计]` 消息时长与异常原因、`[009/设计]` 历史消息自动清理；issue 正文即设计（与 002/006 同构：背景/目标/非目标/架构/实现要点/验收/风险），不另建 `docs/design-*.md` 造成双源。
- [x] T11 同步文档与索引：`docs/index.md`、`site/src/docs.ts`、`AGENTS.md`、`docs/conventions-{zh,en}.md`、`docs/user-manual-zh.md`、`docs/event-protocol-{zh,en}.md`（补采事件与字段）与本 plan 一致。
- [x] T12 全量校验并提交推送：根级 + site tsc、全量测试、`vite build`、`node scripts/verify-console-build.mjs`；按 conventional commit 分组提交并 `git push`，PR #30 描述同步变更点。

## 性能基准（同一 fixture：`pnpm perf:fixture`，200 批 × 100 事件，steady 160）

| 阶段 | 优化前 ms/批 | 优化后 ms/批 | 说明 |
| --- | --- | --- | --- |
| agent-view | 133.2 | 129.0 / 134.1（两次，噪声内） | 一次 flow 遍历同时产出跨度与关联、轮次索引按数组缓存、回复文本 WeakMap、toolKey 只算工具事件、已序数组跳过排序、统计单次遍历 |
| topology | 78.5 | 77.7 / 84.7 | 未改动 |
| flow | 65.4 | 63.6 / 68.9 | 复用同一份缓存条目 |
| prompt-runs | 11.1 | 10.0 / 11.5 | 未改动 |
| projection | 4.6 | 4.3 / 5.0 | 未改动 |

派生本身是分配受限（2 万事件 × 每事件一个步骤对象），微优化落在噪声内；真正的收益在控制台路径：
`app.tsx` 的 `buildAgentView` 只在放大层打开时才派生，关闭时每个流式批次省下整次派生（约 130ms/批）。

## 完成标准

- [x] code: 上述 12 项落地；`AgentStep` 时长/异常只有 `agent-view.ts` 一处投影，原因文案只有 `run-history-state.ts` 一处，帧率只有 `perf-metrics.ts` 一处；无占位符残留。
- [x] linter_result: `./node_modules/.bin/tsc --noEmit` 与 `./node_modules/.bin/tsc -p site/tsconfig.json --noEmit` 退出码均为 0。
- [x] unit_test_result: `node --test tests/*.test.*`（无沙箱）1014 pass / 0 fail，基线 983，新增 31（stdin 2、transcript 13、retention 8、agent-view-duration 6、perf +2）。
- [x] func_test_result: 真实进程三组证据——① 保留策略：`ASTRO_HOME=/tmp/astro-retention-check{2} ASTRO_PORT=4398|4399 node server/server.mjs`，`GET /api/retention/preview` 返回 1 会话/105B、`days=0` 400，`POST /api/retention/prune` 删除 1 目录，`/api/health.eventCount` 1→0 且 `traceFiles` 清空（无需重启）；② 补采：`node plugin/trace-recorder.cjs --source=workbuddy --quiet < payload.json` 落盘 `Reasoning(r-1) → AgentMessage(m-1) → Stop`，`buildAgentView` 得 thinking 1 / replies 1（Stop 兜底被抑制）；真实 `~/.workbuddy` 转录两轮读完 48 个 payload（25 Reasoning + 23 AgentMessage）无重复；③ `vite build` 成功、`node scripts/verify-console-build.mjs` 通过。未做无头浏览器截图，UI 只经 tsc/契约测试/构建校验。
- [x] status: 剩余风险（补采的 transcript 契约随宿主漂移、自动清理不可逆、帧率采样在后台标签页暂停）与回滚方式已写入本文件。

## 风险与回滚

- 风险：`transcript_path` 的条目形状是宿主私有格式（WorkBuddy 的 `reasoning` / `message`、Claude 的 `assistant.message.content[]`、Codex 的 `response_item`），随版本变化会让补采退化为「什么也没采到」；因此补采全程 fail-open，游标损坏只重置该 session 的偏移，不影响宿主事件写入。
- 风险：补采会在一次 hook 内多读一个文件，必须受字节与行数上限约束；超过上限的部分留给下一次 hook 继续读，不阻塞宿主。
- 风险：历史自动清理不可逆。默认关闭、最小 1 天、只删 trace 目录下捕获的 session 文件，永不触碰 `data/demo-events.json`；启用前必须确认预览计数。
- 风险：页面帧率是常驻 rAF 采样，隐藏标签页时暂停；对低端机每帧成本为一次计数，不引入布局读取。
- 回滚：控制台改动按文件 `git revert`；补采取 `ASTRO_TRANSCRIPT_ENRICH=0` 关闭且删除 `plugin/transcript-enrich.cjs` 即回到旧行为；自动清理关闭开关即停止，已删文件不可恢复（无数据迁移）。

## 进度日志

- 2026-11-26 22:36:12 创建（planing）
- 2026-11-26 22:47:50 完成 #1 T1 校验计划 12/03：根级与 site 的 tsc、全量 `node --test`（无沙箱）、`pnpm verify:host-integration`、计划 12 的 15 项任务与 7 轮审查逐条源码定位、计划 03 的 F1–F5 产物定位；把结论写进本 plan 的进度日志并在计划 03 措辞有误处更正。
- 2026-11-26 22:47:50 plan 12: 15/15 tasks + 5/5 DoD, spot-checked agent-view.ts:358 / mapping.ts:69 / pi-plugin/index.ts:252 / payload-markdown.ts:672 / selectVisibleRunHistory in run-history-window.ts:75 + app.tsx; PR 30 OPEN mergedAt=null, 7 Rain120 review comments, commits now 47 (44 at audit time). plan 03: 31/32 tasks, F3 open; verify-host-integration 2026-11-26: 467 hook.run.allowed / 3 hook.run.failed, ZCode criterion not met; F1/F2/F4/F5 artifacts present; tsc+tests baseline 983/983
- 2026-11-26 22:47:53 完成 #2 T2 修复校验发现的采集阻塞：`plugin/trace-recorder.cjs` 的 `readStdin` 增加硬截止（默认 1500ms，`ASTRO_STDIN_TIMEOUT_MS` 可调），超时按已读内容继续；确认 `PreToolUse` 超时（ZCode 日志 `outcome: timed_out`，5005ms）不再由采集器造成；补 `tests/recorder-stdin-budget.test.*`。
- 2026-11-26 22:47:53 readStdin idle 1500ms / total 5000ms budget (ASTRO_STDIN_TIMEOUT_MS, 0 disables); tests/recorder-stdin-budget.test.cjs 2/2 pass (stalled pipe exits in ~1.1s and still records; streaming payload keeps content 64KiB intact); mirrors synced via node scripts/build-native-plugins.mjs (5 plugin copies)
- 2026-11-26 23:00:04 完成 #3 T3 统计 chip 高亮时图标同步高亮：`.agent-transcript__stat-icon` 改为跟随 `currentColor`，hover / `is-open` / `is-live` / `is-merged` 四种高亮态下图标与文字同色（`src/styles.css`）。
- 2026-11-26 23:00:04 styles.css: .agent-transcript__stat-icon color:inherit + opacity .62, opacity 1 on .is-merged / :hover / .is-open / .duration.is-live; no second colour token
- 2026-11-26 23:00:05 完成 #4 T4 各客户端思考/回答完整采集：新增 `plugin/transcript-enrich.cjs`（纯函数 + 增量游标），recorder 在写完宿主事件后按 `payload.transcript_path` 补采 `Reasoning` / `AgentMessage`，按条目 id 去重、按字节上限单次读取；`AgentMessage` 复用宿主 messageId，使 `buildAgentView` 走同一条前缀合并；补 `tests/transcript-enrich.test.cjs` 覆盖 WorkBuddy / Claude / Codex 三种 transcript 形状与去重、上限、损坏行。
- 2026-11-26 23:00:05 plugin/transcript-enrich.cjs + recorder wiring; tests/transcript-enrich.test.cjs 13/13 (WorkBuddy/Claude/Codex shapes, incremental cursor, path rotation, 256KiB chunking, corrupt line, e2e order Reasoning->AgentMessage->Stop, kill switch); mirrors include transcript-enrich.cjs via build-native-plugins runtimeFiles; hook-recorder 40/40 + stdin 2/2 still pass
- 2026-11-26 23:00:06 完成 #8 T8 Agent 滚动时 rail 跟随活动原子：`payload-overlay.tsx` 在 `viewMode === "agent"` 时以阅读行（`contentActiveEventId`）为 rail reveal 的唯一驱动，取消 `following` 守卫；显式定位（`railLocateRequest`）仍走动画并让出一帧。
- 2026-11-26 23:00:06 payload-overlay.tsx: selection-driven reveal skipped in Agent view, content-active follow no longer yields to following; stale contentActiveRowRef cleared; locate animation still wins one pass
- 2026-11-26 23:02:20 完成 #5 T5 性能面板：`src/lib/perf-metrics.ts` 增加常驻页面帧率采样（1s 窗口，标签页隐藏时暂停），折叠胶囊与展开面板都显示当前 FPS；新增 `formatPerfDuration`（<10s `ms`、10–60s `s`、1–60min `01M01s`、>60min `01H01M`，两位补零）并替换面板里的时间行；补 `tests/perf-metrics.test.ts` 的量纲与帧率用例。
- 2026-11-26 23:02:20 duration-label.ts formatPerfDuration ladder (9999ms / 59s / 01M01s / 01H00M, two digits); perf-metrics.ts resident startPageFpsSampler (1s window, visibilitychange pause, 300-sample ring) + pageFps in PerfSnapshot + PAGE FPS section + all time rows use the ladder; tests/perf-metrics.test.ts 12/12; tsc --noEmit exit 0
- 2026-11-26 23:07:40 完成 #6 T6 消息时长与异常原因：`src/lib/agent-view.ts` 给每个步骤投影 `durationMs`（回复=首快照→最终消息、工具=配对跨度、其余=事件自身跨度）与 `anomaly`（复用 `getExceptionOutcome`）；主消息头部保持累积时长；`agent-transcript.tsx` 在每个步骤头部渲染自身时长，hover 卡片显示状态与原因（超时 / 中止 / 中断 / 会话结束 / 执行失败 + 记录文本）；`run-history-state.ts` 增加中文原因描述表（唯一定义）；补 `tests/agent-view-duration.test.ts`。
- 2026-11-26 23:07:40 agent-view.ts: every AgentStepBase carries durationMs (pair span / streamed reply span, null when unmeasurable) + status (getExceptionOutcome + host detail); ToolResultStep keeps pairLink; agent-transcript.tsx StepStatusBadge on every step header + RunClockChip hover card on the header clock; run-history-state.ts adds runTerminalReasonDescriptions + runStatusLabels; app.tsx passes overlayAgentRunState via getRunHistoryTerminalInfo (timeout derived); tests/agent-view-duration.test.ts 6/6, agent-view 17/17, tsc exit 0
- 2026-11-26 23:19:01 完成 #7 T7 设置增加历史自动清理：`server/retention.mjs`（纯选择 + 删除，保留 `data/demo-events.json`）、`POST /api/retention/prune`、`GET /api/retention/preview`；`app-config.ts` 新增 `ASTROX_RETENTION`（`{enabled, days}`，默认 `{enabled:false, days:15}`）；设置「运行历史」页加开关与天数输入，启用时先展示将被删除的条数与时间范围并要求确认；补 `tests/retention.test.mjs` 与服务路由用例。
- 2026-11-26 23:19:01 server/retention.mjs (guard 1..3650, last-event age, tail read, root-bound delete) + GET /api/retention/preview + POST /api/retention/prune + TraceRepository.forgetMissing(); settings 运行历史 adds retention switch, day input/presets and a two-step confirm with preview counts; app config ASTROX_RETENTION default {enabled:false,days:15}, once-per-24h sweep with ConsoleNotices; tests/retention.test.mjs 8/8; real service on 4398: preview 1 session/105B, prune removed 1 dir, health eventCount 1->0 without restart
- 2026-11-26 23:28:51 完成 #10 T10 创建 3 个 issue 与设计文档：`[007/设计]` 性能面板帧率与时间量纲、`[008/设计]` 消息时长与异常原因、`[009/设计]` 历史消息自动清理；issue 正文即设计（与 002/006 同构：背景/目标/非目标/架构/实现要点/验收/风险），不另建 `docs/design-*.md` 造成双源。
- 2026-11-26 23:28:51 gh issues #33 [007/设计] 性能面板帧率与时间量纲, #34 [008/设计] 消息时长与异常原因, #35 [009/设计] 历史自动清理; bodies follow the 002/006 design-in-issue convention (背景/目标/非目标/架构 mermaid/实现要点/验收/风险/涉及文件) so there is no docs/design-* second source
- 2026-11-26 23:28:51 完成 #9 T9 派生管线性能优化：`node scripts/perf-fixture.mjs --write` + `node scripts/perf-derive-bench.mjs` 取基线，针对最慢阶段（预期 `projection` / `topology` / `agent-view`）做量化优化，复跑同一 fixture 记录前后数字进本 plan 与设计文档。
- 2026-11-26 23:28:51 perf: 20k-event fixture; structural changes = one buildPairArtifacts flow walk (was two createFlowEntries), buildTraceTurnIndex WeakMap cache, toolKey hoisted to tool events only, no-op sort skipped, replyText WeakMap, single-pass stats; derive 133.2 -> 129.0/134.1 ms (noise-level); the real win is app.tsx: buildAgentView now runs only while the overlay is open (was every batch, ~130ms/100-event batch on a 20k run); vite build ok
- 2026-11-26 23:31:25 完成 #11 T11 同步文档与索引：`docs/index.md`、`site/src/docs.ts`、`AGENTS.md`、`docs/conventions-{zh,en}.md`、`docs/user-manual-zh.md`、`docs/event-protocol-{zh,en}.md`（补采事件与字段）与本 plan 一致。
- 2026-11-26 23:31:25 AGENTS.md: buildPairArtifacts one-pass rule, step status source, two duration ladders, page fps source, transcript-enrich contract, retention boundary; docs/conventions-zh+en mirrored; user-manual-zh §5.8 retention + §5.5 Agent step durations/status/rail + performance-panel page fps and 01M01s ladder; event-protocol-zh+en §12.1 transcript recovery / §12.2 retention routes; docs/index.md rows and reading paths; no new doc page so site/src/docs.ts needs no catalog entry
- 2026-11-26 23:36:47 完成 #12 T12 全量校验并提交推送：根级 + site tsc、全量测试、`vite build`、`node scripts/verify-console-build.mjs`；按 conventional commit 分组提交并 `git push`，PR #30 描述同步变更点。
- 2026-11-26 23:36:47 tsc root+site exit 0; node --test 1014/1014 unsandboxed; vite build ok; verify-console-build ok; commits: fix(capture) + feat(console/service) + docs(conventions); pushed to origin/feat/agent-data-view
- 2026-11-26 23:38:09 归档：任务与完成标准全部满足
