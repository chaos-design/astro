---
title: PR 30 agent data view task and review audit
priority: P2
created: 2026-11-26 20:14:00
updated: 2026-11-26 20:17:17
---

# PR 30 agent data view task and review audit

## 目标

把 PR #30 的 44 次提交、7 轮代码审查归纳为可校验档案：拆分执行任务并标注真实执行时间，逐项核对问题来源与修复 commit，列出遗留问题及其来源，逐项校验后归档。

## 范围

- 包含：PR #30（`feat/agent-data-view`，相对 `main` 44 commits，2026-11-23T05:29:41Z → 2026-11-26T05:23:12Z）的提交时间线；7 轮审查评论（2026-11-23T07:46:34Z → 2026-11-26T03:27:05Z）中的问题、来源与修复；15 项执行任务及真实执行时间；当前工作树的校验证据；未关闭事项与当前问题来源。
- 包含：`plans/archive/11-agent-data-view-issue-27.md` 覆盖的首版（`1b0b398` / `b0b0254`）作为基线引用，不重复展开其内部 15 项。
- 不包含：重新实现或改动 PR #30 的业务代码；用户工作树中未提交的 7 个文件（见 L5）；PR 合并决策本身与 issue #27 的关闭动作；#28 / #29 / #31 / #32 的工作。
- 校验口径：`node --test tests/*.test.*`、`./node_modules/.bin/tsc --noEmit`（root + site）、`git diff --check`；进度日志时间由脚本写 UTC+8，任务时间沿用 commit / 评论的 UTC 原始时刻并标注 `Z`。

## PR #30 事实基线

| 项 | 值 |
| --- | --- |
| PR | #30 `feat(console): add agent data view to the payload overlay`，state **OPEN**，`mergedAt = null` |
| 分支 / 提交 | `feat/agent-data-view`，`git rev-list --count origin/main..HEAD` = 44 |
| 时间跨度 | 首提交 2026-11-23T05:29:41Z，末提交 2026-11-26T05:23:12Z |
| 审查轮次 | 7 轮 Rain120 评论 + 1 条 vercel 部署 bot（不计入审查） |
| 审查累计 | **2 P0 / 9 P1 / 21 P2，共 32 项**；逐轮 2 / 2 / 3 / 9 / 3 / 3 / 10，全部在 PR 内修复并验证 |
| 测试口径 | PR 描述自述 978 passed；审查沿途记录 925 → 933 → 936 → 941 → 969 passed；本次复核 **983 passed / 0 fail** |
| 关闭关系 | PR body 写 `Closes #27`；issue #27 当前仍 OPEN，最后评论 2026-11-23T06:46:13Z「按当前安排暂不合并，合并后会自动关闭本 issue」 |

44 次提交按阶段分布（时间为 committedDate，UTC）：

- **2026-11-23 05:29Z–18:21Z（18 次）**：`1b0b398` 首版 → `b0b0254` 归档计划 → `a806eea5` 滚动 → `f3eeda3b` / `e863ce63` 文档与内容 → `0d8fc204` / `592cd1bc` / `3dab2c78` / `fd3ec681` / `6d05e3a0` / `784b98b5` 定位与跟随 → `860029d1` / `3c0ddc31` / `d52245f0` / `d4b8964d` / `b3705117` / `b3fde0de` / `986034d4` 内容类型、时钟、工具调用、答案、性能与约定。
- **2026-11-24 04:48Z–20:16Z（11 次）**：`478bdde0` 复合时长 → `c42b6fd1` CI → `ba48e344` / `bfd7954e` / `38ac0092` / `fc8a9516` / `c9f89b75` / `0a242349` / `806e3e8d` 头部、命令帧、审查修复与测试对齐。
- **2026-11-25 05:04Z–18:09Z（11 次）**：`f2c627ea` / `dd64a6da` 两轮审查修复 → `df27975d` / `bab4f582`（版本 0.0.8）→ `f4e6ff2d` / `8739e818` / `c6d3aa0b` / `43dedc8a` / `ec35b0fb` / `e8dd4f52` / `9751bb92` 身份、rail 联动、JSON 树与高亮。
- **2026-11-26 03:27Z–05:23Z（4 次）**：`3589a1fd` 第七轮修复 → `67ea0dc7` / `da1b9ac1` 任务行与共享折叠 → `f250e188` 稳健性 → `b01f90c1` 嵌入图片与阅读行跟随。

## 实施任务

任务编号 T1–T15 与下列 checkbox 一一对应；时间均为提交/评论的原始 UTC 时刻。

- [x] T1 · 2026-11-23 05:29Z–05:38Z 基线实现与计划归档：1b0b398 落地 Agent 视图；b0b0254 归档 issue 27 计划
- [x] T2 · 2026-11-23 05:29Z P0 样本与采集协议：demo 扩至 20 事件，opencode/pi 写 messageId，协议文档同步，版本 0.0.7
- [x] T3 · 2026-11-23 05:29Z P1 派生层：agent-view.ts 纯函数 buildAgentView，分组/前缀合并/降级/诊断/统计
- [x] T4 · 2026-11-23 05:29Z P2 呈现层：agent-transcript.tsx + related-fields.tsx + styles.css，四类 block 复用单一渲染源
- [x] T5 · 2026-11-23 05:29Z P3 集成：PayloadOverlay 三态默认 Agent，app.tsx 单一选择态与提问绑定
- [x] T6 · 2026-11-23 06:52Z–11:40Z 滚动与定位交互迭代：a806eea5/0d8fc204/3dab2c78/fd3ec681/6d05e3a0/784b98b5
- [x] T7 · 2026-11-23 08:01Z–11-24 05:16Z 展示精修与性能：e863ce63/b3705117/b3fde0de/478bdde0/c42b6fd1
- [x] T8 · 2026-11-23 07:46Z 第一轮审查 0P0/0P1/2P2 → 592cd1bc：messageId 缺失对称、O(n²) 分组改 Map
- [x] T9 · 2026-11-23 07:52Z 第二轮审查 +2P2 → 592cd1bc：合并回复序号/定位同一事件、RelatedValue 按事件复位
- [x] T10 · 2026-11-24 06:57Z 第三轮审查 0/0/3 → fc8a9516/f250e188：todos 布尔状态、camelCase toolInput、PR 描述口径
- [x] T11 · 2026-11-24 11:18Z 第四轮审查 2P0/4P1/3P2 → fc8a9516：真实宿主 id、测试 fixture、空 tool_input、fallback 越界、diff 幽灵行、去重误删
- [x] T12 · 2026-11-25 05:01Z 第五轮审查 0/1/2 → f2c627ea：Pi 跨进程 id、Escape 悬停残留、CI 等待预算注释
- [x] T13 · 2026-11-25 05:08Z 第六轮复核 1P1/2P2 → dd64a6da：step id 带 origin、Stop 兜底按 origin、pendingCount 收缩
- [x] T14 · 2026-11-26 03:27Z 第七轮审查 0/3/7 → 3589a1fd/f250e188：live follow 顺序、Pi terminal 去重、答案双半 join、rail 坐标系等 10 项
- [x] T15 · 2026-11-25 05:29Z–11-26 05:23Z 发布与后续精修：0.0.8 bump、JSON 树、26 语言高亮、嵌入图片、rail 阅读行跟随、task rows/StepBodyCollapse

## 审查问题清单（来源 → 修复 → 校验）

每项的「来源」是可回溯的 PR 评论 UTC 时刻与定位；「修复」是实际落地的 commit 与 UTC 时刻；「校验」是 commit message、审查复核或本次源码/测试结果。

### R1 · 2026-11-23T07:46:34Z — 0 P0 / 0 P1 / 2 P2（T8）

- **R1-1 P2** 流式快照写 `messageId: "default"` / `partID`，最终消息不写；`buildAgentView` 按 `sessionId + messageId` 分组会把同一回复拆成两条。来源：R1 评论 `opencode-plugin/index.ts:187-188` / `pi-plugin/index.ts:235` 与 `mapping.ts`。修复：`592cd1bc`（2026-11-23T08:11:52Z）将字面量 `default` 视为缺失，两侧走同一路径。校验：commit message 明列该项；`opencode-plugin/mapping.ts:69 openCodeTextMessageId` 与 `pi-plugin/index.ts:252` 可读。
- **R1-2 P2** 按 `messageId` 分组时对每个 `AgentMessage` 做一次全表 `filter`，O(n²)。来源：R1 评论 `src/lib/agent-view.ts:276`。修复：同一 commit 改为一次扫描的 `messageId -> events[]` Map，并按 subagent origin 限定作用域。校验：commit message 明列该项；`src/lib/agent-view.ts:265 agentMessageOrigins` 存在。

### R2 · 2026-11-23T07:52:08Z — 新增 2 P2（累计 4）（T9）

- **R2-1 P2** 合并回复卡显示 `sequence = firstIndex`，`eventId = anchor.id`（最终消息），徽标序号与点击定位目标不是同一事件。来源：R2 评论 `agent-view.ts:237-252` + `agent-transcript.tsx:313-324`。修复：`592cd1bc` 让合并回复的 rail 锚点与 LOG 序列指向同一首事件。校验：commit message 明列该项。
- **R2-2 P2** `RelatedValue` 用 `key={field.key}`，切换事件时同名字段复用实例，`expanded` 跨事件残留，与文件注释承诺不符。来源：R2 评论 `related-fields.tsx:10-13,57-77`。修复：同一 commit 把折叠作用域按 event/step id 收紧。校验：commit message 明列该项；`src/components/related-fields.tsx` 现按值折叠。

### R3 · 2026-11-24T06:57:38Z — 0 P0 / 0 P1 / 3 P2（T10）

- **R3-1 P2** `compactRecordStatus` 只认 string 状态，`{ content, done: true }` 既无复选框又因键被后缀过滤而丢状态。来源：R3 评论 `payload-markdown.ts:451`。修复：`fc8a9516`（2026-11-24T11:19:44Z）接受标量并 `String()` 归一化。校验：commit message 明列 boolean todo statuses；`d52245f0` 亦覆盖 list-shaped arrays。
- **R3-2 P2** `getToolCallCommand` 只读 snake `tool_input.command`，camel `toolInput.command` 降级为普通字段且去重失效。来源：R3 评论 `trace-model.ts:577`。修复：`f250e188`（2026-11-26T04:48:39Z）补 camelCase/空占位处理。校验：commit message 明列「add camelCase filePath to language inference; ignore empty tool_input placeholders」。
- **R3-3 P2** PR 描述写 `formatDurationClock`（仓库不存在），实现用 `formatDuration`。来源：R3 评论「PR 描述与实现不一致」。修复：`478bdde0`（2026-11-24T04:48:54Z）移除 `formatDurationClock` 并统一为 `formatDuration`。校验：本次重读 PR body 已无该字符串。
- **非阻断观察** `interaction-integration.test.mjs` F4 在满负载下一次 5648ms 超时、单跑 10/10 通过；不在本 PR diff 内 → 见 L3。

### R4 · 2026-11-24T11:18:57Z — 2 P0 / 4 P1 / 3 P2（T11）

- **R4-1 P0** OpenCode 读 `data.messageID || data.partID`，真实发布事件字段是 `assistantMessageID + ordinal/textID`，改动在真实宿主上是空操作。来源：R4 评论 `opencode-plugin/index.ts:187`、`mapping.ts:198`。修复：`fc8a9516` 新增 `openCodeTextMessageId()` 复合 id，同时避免多 text part 被错误合并。校验：`opencode-plugin/mapping.ts:69` 存在并被 `index.ts:192` 调用。
- **R4-2 P0** Pi 侧四个 id 来源（`message.id` 等）在官方类型上都不存在，`messageId` 恒空。来源：R4 评论 `pi-plugin/mapping.ts:49`、`index.ts:235`。修复：`fc8a9516` 在 `message_start` 合成 `pi-<sessionId>-<seq>`，快照与最终消息复用。校验：`pi-plugin/index.ts:252` 存在；后续 `f2c627ea` 再加 per-instance token。
- **R4-3 P1** 新增测试用宿主不会发出的伪造字段，构成自证循环。来源：R4 评论四个 `opencode-*/pi-*` 测试文件（46 项）。修复：`fc8a9516` 改为真实事件形状并补端到端断言。校验：commit message 明列 933 passed。
- **R4-4 P1** 空 `tool_input: {}` 占位遮蔽真实 camel 入参，CallBlock 只剩工具名。来源：R4 评论 `trace-model.ts`。修复：`fc8a9516` 新增 `nonEmptyRecord()` 两处共用。校验：源码 `src/lib/user-question-content.ts:247-249` 使用 `nonEmptyRecord`。
- **R4-5 P1** `selectScopeFallbackRun` 按 `end` 排整个 `filteredSessions`，会打开已被时间窗过滤掉的老会话。来源：R4 评论 `run-history-window.ts` / `app.tsx`。修复：`fc8a9516` 将候选池收窄到 `selectVisibleRunHistory(...)`. 校验：commit message 明列该项 + 补测试。
- **R4-6 P2** `editStringsToDiff` 尾随 `\n` 产生幽灵增删行、膨胀 hunk 计数。来源：R4 评论 `payload-markdown.ts`。修复：`fc8a9516` 规范化 CRLF 并去单个尾空行。校验：commit message 明列该项。
- **R4-7 P2** `mergeRelated` 全局按 label+value 去重，误删不同路径的同值字段。来源：R4 评论 `payload-preview.ts`。修复：`fc8a9516` 把折叠范围收紧到工具 input/result 容器。校验：commit message 明列该项。
- **范围外建议** inspector 的 `{ contract, captured }` 包装不走 `findPatchMarkdown`，Edit 输入只得到裸文本。来源：R4 评论「不在本次 diff 内，建议作者确认」。关闭：`f250e188`（2026-11-26T04:48:39Z）已补 `capturedResultToMarkdown` 的 patch 检测；本次源码 `src/lib/payload-markdown.ts:658-672` 确认 `findPatchMarkdown` 在 `capturedResultToMarkdown` 内被调用 → **不是遗留问题**。

### R5 · 2026-11-25T05:01:10Z — 0 P0 / 1 P1 / 2 P2（T12）

- **R5-1 P1** Pi 合成 id 只用 session 内序号，进程重启/恢复会话后复用 `pi-<sessionId>-1`，跨进程回复被静默合并。来源：R5 评论 `pi-plugin/index.ts:244-247`。修复：`f2c627ea`（2026-11-25T05:04:05Z）加入 per-instance token。校验：`pi-plugin/index.ts:252` 使用 `pi-${replyIdToken}-${sessionId}-${seq}`。
- **R5-2 P2** 指针停在 rail 行上按 Escape 关闭浮层，无 `pointerleave`，悬浮卡片残留。来源：R5 评论 `payload-overlay.tsx:1019-1025`。修复：同一 commit 以 `open` 门控并清空 hover。校验：commit message 明列该项。
- **R5-3 P2** CI 等待预算注释写 ~4 minutes，实际 ~6 分钟。来源：R5 评论 `.github/workflows/console-preview.yml:196`。修复：同一 commit 更正注释；`f2c627ea` 消息亦记录「correct the artifact-wait backoff comment」。校验：commit message 明列该项。

### R6 · 2026-11-25T05:08:52Z — 1 P1 / 2 P2（T13）

- **R6-1 P1** 合并回复 step id 为 `stream:<messageId>`，两个 subagent origin 复用短 id 时产生重复 React key、`stepRefs` 互相覆盖。来源：R6 评论 `agent-view.ts` 原 `:354`。修复：`dd64a6da`（2026-11-25T05:08:25Z）改为 `stream:<messageId>:<groupAnchorId>`。校验：`src/lib/agent-view.ts:358` 已含 anchor id。
- **R6-2 P2** 全局 `hasAgentMessage` 让子代理回复抑制主 Agent 的 `Stop.last_assistant_message` 兜底。来源：R6 评论 `agent-view.ts` 原 `:263`。修复：同一 commit 按 `replyScopeKey` 建 `agentMessageOrigins` 集合。校验：`src/lib/agent-view.ts:265,465` 存在。
- **R6-3 P2** 步骤链收缩（replay 回退 / 前缀断裂）后 `pendingCount` 仍显示已不存在的步骤数。来源：R6 评论 `agent-transcript.tsx` 原 `:622`。修复：同一 commit 在 `count < previous` 时归零。校验：`src/components/agent-transcript.tsx` 多处 `setPendingCount(0)`。
- 复核声明：该评论明确「共修复 6 个审查发现」（R5 三项 + R6 三项），`pnpm test` 941 通过。

### R7 · 2026-11-26T03:27:05Z — 0 P0 / 3 P1 / 7 P2（T14）

- **R7-1 P1** `syncScrollState()` 被动 effect 声明在 append-pin effect 之前，每批流事件先把 `atBottomRef` 翻 false，实时跟随被中断。来源：R7 评论 `agent-transcript.tsx:675/704`。修复：`3589a1fd`（2026-11-26T03:27:15Z）调整 effect 顺序。校验：commit message 首项明列该项。
- **R7-2 P1** Pi 的 `lastTerminal` 只在 `Notification` 清除，`UserPromptSubmit` 不清，同会话第二条 prompt 的 `Stop` 被吞。来源：R7 评论 `pi-plugin/index.ts:308`。修复：同一 commit 让 `UserPromptSubmit` 也清除，并补两轮真实 prompt 测试。校验：commit message 明列该项。
- **R7-3 P1** `ToolResultStep.answers` 只读结果事件，答案写在起始事件时 `ANSWERS` 块消失。来源：R7 评论 `agent-view.ts:483`。修复：同一 commit 复用 `startParsed` 走 `mergeQuestionAnswers` 合并双半。校验：`src/lib/agent-view.ts:22` 导入 `mergeQuestionAnswers`。
- **R7-4 P2** rail 定位用 `row.offsetTop`，最近定位祖先是 fixed DialogContent，坐标系错位约一个头部高度。来源：R7 评论 `payload-overlay.tsx:654`。修复：同一 commit 改用 `getBoundingClientRect()` 差值。校验：源码 `src/app.tsx:421-422` 等存在矩形计算（`payload-overlay.tsx` 同模式）。
- **R7-5 P2** `readPiLiveText` 无条件读 `assistantMessageEvent.delta`，thinking / 工具调用参数被当正文写入快照，破坏前缀。来源：R7 评论 `pi-plugin/mapping.ts:68`。修复：同一 commit 只接受 `text_delta`。校验：`pi-plugin/mapping.ts:74` 已含该门控。
- **R7-6 P2** 无参数 `PermissionRequest(Bash/Edit)` 被投影为空白 question 步骤。来源：R7 评论 `agent-view.ts:424`。修复：同一 commit 改用 `isBlockingUserQuestionStartEvent`。校验：`src/lib/trace-status.ts:38` / `src/config/atom-platforms.ts:750` 使用该函数。
- **R7-7 P2** 连续点定位叠加多个 rAF tween，320ms 内回跳。来源：R7 评论 `payload-overlay.tsx:659`。修复：同一 commit 用 ref 保存并在新动画/卸载时 `cancelAnimationFrame`。校验：源码 `src/app.tsx:1705,3120,3180,4124` 有取消模式。
- **R7-8 P2** 悬停卡片在锚点行被搜索过滤卸载后不消失。来源：R7 评论 `payload-overlay.tsx:535`。修复：同一 commit 在 atom 从 rail 消失时清 hover。校验：commit message 明列该项。
- **R7-9 P2** `railItems` 的 `useMemo` 漏 `searchEvent` 依赖，payload  haystack 更新后仍命中旧数据。来源：R7 评论 `payload-overlay.tsx:473`。修复：同一 commit 补依赖。校验：commit message 明列该项。
- **R7-10 P2** `toolName` 用 `??` 而邻近通用步骤用 `||`，空字符串遮蔽 `tool_name`。来源：R7 评论 `agent-view.ts:500`。修复：同一 commit 统一为 `||`。校验：commit message 明列该项。
- 复核声明：该评论记录 969 passed 与全绿验证；`f250e188` 随后补 `editStringsToDiff` / 去重等稳健性修复。

## 遗留问题（关联任务 + 当前问题来源）

| 编号 | 遗留问题 | 关联任务 | 当前问题来源 | 当前状态 |
| --- | --- | --- | --- | --- |
| L1 | PR #30 未合并，issue #27 未关闭 | T1 | `gh pr view 30` → state OPEN / `mergedAt = null`；issue #27 评论 2026-11-23T06:46:13Z「按当前安排暂不合并，合并后会自动关闭本 issue」 | 等待人工合并决策；非代码缺陷 |
| L2 | Agent 视图三次 O(n) 子投影，增量 `buildAgentView` 未实现 | T7 | PR #30 body → Notes「Residual agent-view cost is its three O(n) sub-projections … an incremental `buildAgentView` is a follow-up」；本次 `grep -rn "incremental" src/lib/agent-view.ts` 无命中 | 未落地的 follow-up；长运行投影开销随事件数线性增长，非阻断 |
| L3 | `interaction-integration.test.mjs` F4 满负载偶发超时 | T10 / T11 | R3（2026-11-24T06:57:38Z）「5648ms，单跑 10/10 通过」；R4（2026-11-24T11:18:57Z）「两个 flaky 超时用例单跑全过」 | 不在 PR diff 内；本次 983 passed 未复现；需独立跟踪 |
| L4 | 工作树存在 7 个未提交文件（JSON 树槽位占位、inspector JSON 独立滚动、三份文档同步） | T15 | 本次 `git status --short`（`AGENTS.md`、`docs/conventions-{zh,en}.md`、`docs/user-manual-zh.md`、`src/components/json-viewer.tsx`、`src/styles.css`、`tests/json-viewer-contract.test.ts`） | 用户所有，未提交、未纳入本 plan、未 revert；内容对应 `67ea0dc7` / `da1b9ac1` / `b01f90c1` 之后的遗漏同步与新修复 |

已关闭、不再列为遗留：R3-3（`formatDurationClock`，`478bdde0`）、R4 范围外建议（inspector patch diff，`f250e188`，源码已确认）、R5-3（CI 注释，`f2c627ea`）。

## 完成标准

- [x] code: 15 项任务与 7 轮审查逐项对照提交与源码完成校验；问题来源、修复 commit、真实执行时间均已写入；无模板占位符残留；本 plan 不改动业务代码。
- [x] linter_result: 仓库无 lint 脚本，按契约执行 `./node_modules/.bin/tsc --noEmit` 与 `./node_modules/.bin/tsc -p site/tsconfig.json --noEmit`，退出码均为 0。
- [x] unit_test_result: `node --test tests/*.test.*` 全绿，983 pass / 0 fail / 0 skipped，耗时 75594.98ms。
- [x] func_test_result: 真实进程验证沿用归档 plan 11 的记录（`ASTRO_HOME=/tmp/astro-agent-view ASTRO_PORT=4397 node server/server.mjs`，`/api/demo-events` 返回 20 事件、2 streamed、`messageId` 存在，构建产物含 AGENT VIEW）；本次复核未重复启动服务，以 7 轮审查复核记录 + 源码定位 + 983 passed 为准。
- [x] status: 4 项遗留问题（L1–L4）的来源与状态、已关闭问题的去向、回滚方式均已写入本文件。

## 风险与回滚

- 风险：本档案是回顾性记录，任务时间取自 commit 的 `committedDate` 与评论的 `created_at`（UTC），与脚本写入的 UTC+8 进度日志时间不同源，不可互相替换。
- 风险：审查问题的严重级别沿用 reviewer 原文，未重新分级；「全部修复」的依据是修复 commit message、reviewer 复核声明与本次源码定位，不等于逐条重新做了真实宿主回归。
- 风险：L1 的合并决策与 L3 的 flaky 用例不在本 plan 的处置范围内；L4 的工作树文件属于用户，任何提交都不得携带它们。
- 回滚：本 plan 只新增一个 Markdown 文件，无代码/数据迁移；撤销用 `git revert <本 plan 的提交>` 或直接删除文件，不影响 PR #30 的代码。若需回滚 PR #30 本体，按阶段 `git revert` 其 44 个提交；前端为纯派生投影，回滚后无需数据迁移。

## 进度日志

- 2026-11-26 20:14:00 创建（planing）
- 2026-11-26 20:16:36 完成 #1 T1 · 2026-11-23 05:29Z–05:38Z 基线实现与计划归档：1b0b398 落地 Agent 视图；b0b0254 归档 issue 27 计划
- 2026-11-26 20:16:36 2026-11-23T05:29:41Z commit 1b0b398 feat(console): render agent artifacts; 2026-11-23T05:38:16Z commit b0b0254 archive issue 27 plan; archived plan 11 exists
- 2026-11-26 20:16:37 完成 #2 T2 · 2026-11-23 05:29Z P0 样本与采集协议：demo 扩至 20 事件，opencode/pi 写 messageId，协议文档同步，版本 0.0.7
- 2026-11-26 20:16:37 2026-11-23T05:29:41Z 1b0b398: demo-events.json 16->20, opencode/pi messageId, event-protocol-{zh,en} section 9; version bumped 0.0.7; PR files list confirms
- 2026-11-26 20:16:37 完成 #3 T3 · 2026-11-23 05:29Z P1 派生层：agent-view.ts 纯函数 buildAgentView，分组/前缀合并/降级/诊断/统计
- 2026-11-26 20:16:37 2026-11-23T05:29:41Z 1b0b398: src/lib/agent-view.ts added 547 lines; buildAgentView grouping + prefix merge + diagnostics + stats; tests/agent-view.test.ts 392 lines
- 2026-11-26 20:16:37 完成 #4 T4 · 2026-11-23 05:29Z P2 呈现层：agent-transcript.tsx + related-fields.tsx + styles.css，四类 block 复用单一渲染源
- 2026-11-26 20:16:37 2026-11-23T05:29:41Z 1b0b398: src/components/agent-transcript.tsx added 1270 lines, related-fields.tsx added 157 lines; styles.css +1655; four block kinds reuse MarkdownView/QuestionContent/PairLinkMarker
- 2026-11-26 20:16:37 完成 #5 T5 · 2026-11-23 05:29Z P3 集成：PayloadOverlay 三态默认 Agent，app.tsx 单一选择态与提问绑定
- 2026-11-26 20:16:37 2026-11-23T05:29:41Z 1b0b398: PayloadViewMode agent default, app.tsx +113 lines, shared onSelectAtom and question binding; PR body and review R1-R7 confirm single selection state
- 2026-11-26 20:16:45 完成 #6 T6 · 2026-11-23 06:52Z–11:40Z 滚动与定位交互迭代：a806eea5/0d8fc204/3dab2c78/fd3ec681/6d05e3a0/784b98b5
- 2026-11-26 20:16:45 2026-11-23T06:52:33Z a806eea5; 08:05:41Z 0d8fc204; 09:26:50Z 3dab2c78; 10:46:24Z fd3ec681; 11:40:28Z 6d05e3a0; 13:49:17Z 784b98b5 - scroll pin, jump pill, newest-step visibility gating
- 2026-11-26 20:16:45 完成 #7 T7 · 2026-11-23 08:01Z–11-24 05:16Z 展示精修与性能：e863ce63/b3705117/b3fde0de/478bdde0/c42b6fd1
- 2026-11-26 20:16:45 2026-11-23T08:01:46Z e863ce63; 17:04:33Z b3705117 incremental atomic fold + parse cache; 17:04:42Z b3fde0de; 2026-11-24T04:48:54Z 478bdde0 formatDuration; 05:16:07Z c42b6fd1 CI backoff - all in commit log
- 2026-11-26 20:16:46 完成 #8 T8 · 2026-11-23 07:46Z 第一轮审查 0P0/0P1/2P2 → 592cd1bc：messageId 缺失对称、O(n²) 分组改 Map
- 2026-11-26 20:16:46 R1 2026-11-23T07:46:34Z 0P0/0P1/2P2; fixed by 592cd1bc 2026-11-23T08:11:52Z: literal default treated as absent, Map bucketing; source PR comment verified
- 2026-11-26 20:16:46 完成 #9 T9 · 2026-11-23 07:52Z 第二轮审查 +2P2 → 592cd1bc：合并回复序号/定位同一事件、RelatedValue 按事件复位
- 2026-11-26 20:16:46 R2 2026-11-23T07:52:08Z +2P2; fixed by 592cd1bc 2026-11-23T08:11:52Z: rail anchor = LOG sequence first event, related folds scoped by event/step id; source PR comment verified
- 2026-11-26 20:16:46 完成 #10 T10 · 2026-11-24 06:57Z 第三轮审查 0/0/3 → fc8a9516/f250e188：todos 布尔状态、camelCase toolInput、PR 描述口径
- 2026-11-26 20:16:46 R3 2026-11-24T06:57:38Z 0/0/3; fixed by fc8a9516 2026-11-24T11:19:44Z (boolean todos, dedup, ghost lines) and f250e188 2026-11-26T04:48:39Z (camel toolInput, empty placeholder); formatDurationClock removed in 478bdde0 and absent from PR body
- 2026-11-26 20:16:53 完成 #11 T11 · 2026-11-24 11:18Z 第四轮审查 2P0/4P1/3P2 → fc8a9516：真实宿主 id、测试 fixture、空 tool_input、fallback 越界、diff 幽灵行、去重误删
- 2026-11-26 20:16:53 R4 2026-11-24T11:18:57Z 2P0/4P1/3P2; fixed by fc8a9516 2026-11-24T11:19:44Z; source-verified openCodeTextMessageId at mapping.ts:69, nonEmptyRecord at user-question-content.ts:247-249; inspector patch diff (out-of-diff suggestion) closed by f250e188, payload-markdown.ts:658-672 confirmed
- 2026-11-26 20:16:54 完成 #12 T12 · 2026-11-25 05:01Z 第五轮审查 0/1/2 → f2c627ea：Pi 跨进程 id、Escape 悬停残留、CI 等待预算注释
- 2026-11-26 20:16:54 R5 2026-11-25T05:01:10Z 0/1/2; fixed by f2c627ea 2026-11-25T05:04:05Z; pi-plugin/index.ts:252 ids include replyIdToken; hover card gated on open; workflow comment corrected
- 2026-11-26 20:16:54 完成 #13 T13 · 2026-11-25 05:08Z 第六轮复核 1P1/2P2 → dd64a6da：step id 带 origin、Stop 兜底按 origin、pendingCount 收缩
- 2026-11-26 20:16:54 R6 2026-11-25T05:08:52Z 1P1/2P2; fixed by dd64a6da 2026-11-25T05:08:25Z; agent-view.ts:358 stream id includes anchor id, :265/:465 agentMessageOrigins scoped, agent-transcript setPendingCount(0); reviewer reported 941 passed
- 2026-11-26 20:16:54 完成 #14 T14 · 2026-11-26 03:27Z 第七轮审查 0/3/7 → 3589a1fd/f250e188：live follow 顺序、Pi terminal 去重、答案双半 join、rail 坐标系等 10 项
- 2026-11-26 20:16:54 R7 2026-11-26T03:27:05Z 0/3/7; fixed by 3589a1fd 2026-11-26T03:27:15Z (effect order, UserPromptSubmit clears lastTerminal, mergeQuestionAnswers, rect coords, text_delta, blocking predicate, rAF cancel, hover clear, useMemo dep, toolName ||) plus f250e188 04:48:39Z; reviewer reported 969 passed
- 2026-11-26 20:16:55 完成 #15 T15 · 2026-11-25 05:29Z–11-26 05:23Z 发布与后续精修：0.0.8 bump、JSON 树、26 语言高亮、嵌入图片、rail 阅读行跟随、task rows/StepBodyCollapse
- 2026-11-26 20:16:55 2026-11-25T05:29:44Z bab4f582 version 0.0.8 in root and all plugin manifests; 18:09:00Z 9751bb92 JSON tree + ~26 languages + footer expand; 2026-11-26T04:04:35Z 67ea0dc7/da1b9ac1 task rows + StepBodyCollapse; 05:23:12Z b01f90c1 embedded images + rail reading-line follow
- 2026-11-26 20:17:07 完成 #16 code: 15 项任务与 7 轮审查逐项对照提交与源码完成校验；问题来源、修复 commit、真实执行时间均已写入；无模板占位符残留；本 plan 不改动业务代码。
- 2026-11-26 20:17:07 15 tasks + 7 review rounds cross-checked against gh pr view 30 commits/comments and source grep; no placeholder text remains; plan adds one Markdown file only, no business code touched
- 2026-11-26 20:17:07 完成 #17 linter_result: 仓库无 lint 脚本，按契约执行 `./node_modules/.bin/tsc --noEmit` 与 `./node_modules/.bin/tsc -p site/tsconfig.json --noEmit`，退出码均为 0。
- 2026-11-26 20:17:07 no lint script in repo; ./node_modules/.bin/tsc --noEmit exit 0; ./node_modules/.bin/tsc -p site/tsconfig.json --noEmit exit 0
- 2026-11-26 20:17:07 完成 #18 unit_test_result: `node --test tests/*.test.*` 全绿，983 pass / 0 fail / 0 skipped，耗时 75594.98ms。
- 2026-11-26 20:17:07 node --test tests/*.test.*: 983 pass / 0 fail / 0 cancelled / 0 skipped / 0 todo, duration 75594.975493ms
- 2026-11-26 20:17:08 完成 #19 func_test_result: 真实进程验证沿用归档 plan 11 的记录（`ASTRO_HOME=/tmp/astro-agent-view ASTRO_PORT=4397 node server/server.mjs`，`/api/demo-events` 返回 20 事件、2 streamed、`messageId` 存在，构建产物含 AGENT VIEW）；本次复核未重复启动服务，以 7 轮审查复核记录 + 源码定位 + 983 passed 为准。
- 2026-11-26 20:17:08 real-process evidence inherited from archived plan 11: ASTRO_HOME=/tmp/astro-agent-view ASTRO_PORT=4397 node server/server.mjs, GET /api/demo-events returned eventCount=20, streamed=2, messageIds=[demo-message-3], question=true; built bundle matched AGENT VIEW; this audit did not restart the service and says so
- 2026-11-26 20:17:08 完成 #20 status: 4 项遗留问题（L1–L4）的来源与状态、已关闭问题的去向、回滚方式均已写入本文件。
- 2026-11-26 20:17:08 L1-L4 with associated task and current source written; closed items (formatDurationClock, inspector patch diff, CI comment) documented; git diff --check exit 0; rollback via reverting this plan file only
- 2026-11-26 20:17:17 归档：任务与完成标准全部满足
