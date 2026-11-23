---
title: AskUserQuestion 交互 Hook 流程设计与两通道图补全
priority: P2
created: 2026-11-15 22:28:54
updated: 2026-11-15 22:43:22
---

# AskUserQuestion 交互 Hook 流程设计与两通道图补全

## 目标

核对并重绘「Hook 观测通道与决策通道」图，补齐缺口；产出 AskUserQuestion 交互 Hook 的完整执行流程、交互行为、数据结构、消息格式、触发时机与字段约束，全部明确标注为规划项。

## 范围

- 包含：`plans/planing/02-*.md`；新增 `docs/interaction-hooks-zh.md` / `docs/interaction-hooks-en.md`；`docs/index.md`、`site/src/docs.ts`、`AGENTS.md`、`docs/event-protocol-zh.md` / `-en.md` 的目录与交叉引用；会话内联的完整版两通道图。
- 不包含：实现双向应答服务或新的 `/api/*` 路由；修改 6 份 `trace-recorder.cjs` / `zcode-adapter.cjs`；改变可选决策 Hook「默认关闭」策略；写入使用者真实的 `~/.claude`、`~/.codebuddy`、`~/.zcode` 配置；实现交互 UI 或推送通道；把规划项写成已实现能力；新建 Git 提交（按 `plans/README.md` 约定）；重开已归档的 `01-hook-decision-followup.md`。

## 核对基线

原图 6 个节点：宿主 Hook 事件（`PreToolUse` / `PermissionRequest`）→ 左「ASTRO 观测 hook（`continue:true` / `--quiet` 空 stdout、只写 JSONL、退出码 0）」→「宿主照常弹确认，仍需切回 App」；右「决策 hook（`hookSpecificOutput: allow` + `updatedInput / answers`）」→「宿主自动批准，无需切回 App」。

需逐项核对的当前事实（HEAD `ce513d8` 及本轮补全）：
`scripts/auto-approve-question-hook.mjs` 的两种输出分支与 fail-open、
`ASTRO_AUTO_APPROVE_*` 五个变量、`scripts/install-auto-approve-hook.mjs` 的
dry-run / `--remove` / ZCode 校验、`src/lib/user-question-content.ts` 的
`prompts` / `message` / `plan` / `answers` 四种解析形状、
`docs/plugin-installation.md` 的宿主差异、`docs/event-protocol-*.md` §4 的
「answers 由宿主 Hook 注入」、多 hook 聚合 `deny > ask > allow`、以及
ASTRO 服务端没有 approve/answer 接口这一事实。

## 实施任务

- [x] 核对 widget 与当前代码/文档，列出图与说明的缺失清单并写入设计文档
- [x] 重绘完整版两通道图（会话内联）并在成对设计文档中提供可持久化的 Mermaid 版本
- [x] 新增 docs/interaction-hooks-zh.md 与 -en.md：交互行为矩阵（选项点击、多选、文本输入、编辑、取消、超时、重复提交、外部设备接管、会话失效等）
- [x] 设计文档补齐各环节数据结构：QuestionDescriptor / InteractionRequest / InteractionEvent / InteractionResult / AgentNotification 及字段约束
- [x] 设计文档补齐消息格式（hook stdin/stdout、SSE、POST /api/events、TraceEvent 投影）与触发时机/超时边界
- [x] 设计文档补齐向 Agent 发送通知的消息设计规范（additionalContext / systemMessage / permissionDecisionReason / Notification 事件 / UI 提示）与安全约束
- [x] 同步 docs/index.md、site/src/docs.ts、AGENTS.md、docs/event-protocol-zh.md / -en.md 的目录、交叉引用与规划项标注
- [x] 全量验证（tsc、tests、vite build、文档站 build）并逐项核对图内容，归档计划

## 完成标准

- [x] code: 8 项任务全部落地；两份设计文档覆盖图核对结论、交互行为矩阵、5 类数据结构、4 类消息格式、触发时机与字段约束；规划项全部显式标注；计划文件无模板占位符残留
- [x] linter_result: ./node_modules/.bin/tsc --noEmit 与 ./node_modules/.bin/tsc -p site/tsconfig.json --noEmit 退出码均为 0（仓库无 lint 脚本）
- [x] unit_test_result: node --test tests/*.test.* 全绿（当前基线 578/578），新增文档不改变测试数量
- [x] func_test_result: 用真实 ZCode PermissionRequest(AskUserQuestion) 载荷校验文档中的 stdin/answers/TraceEvent 示例字段与 parseUserQuestionContent 输出一致；vite build 与 vite build --config site/vite.config.ts 成功；文档站目录包含新文档 slug
- [x] status: 剩余风险（规划项未实现、宿主协议版本差异、hook 超时窗口）与回滚方式已写入本文件

## 风险与回滚

- 风险：本计划产出的是**设计**，不是实现；文档必须逐节标注「规划项 / 未实现」，避免被当成现有能力。Claude Code `updatedInput`、CodeBuddy `modifiedInput`、ZCode `hooks.events` 三套协议随宿主版本变化；`PreToolUse` / `PermissionRequest` 的 hook 超时窗口（仓库配置 5 秒、ZCode `timeoutMs: 5000`）决定了异步人工交互必须走「先 fail-open 回退 + 后续通知」而不是长时间阻塞 Hook；`answers` 是注入字段，不能写成 Agent 产生的事实。
- 回滚：文档回滚为逐文件 revert（`docs/interaction-hooks-*.md`、`docs/index.md`、`site/src/docs.ts`、`AGENTS.md`、`docs/event-protocol-*.md`），不影响运行时；计划文件在归档前保留在 `plans/planing/`，归档后只读。内联图不落盘，无需回滚。

## 进度日志

- 2026-11-15 22:28:54 创建（planing）
- 2026-11-15 22:35:43 完成 #1 核对 widget 与当前代码/文档，列出图与说明的缺失清单并写入设计文档
- 2026-11-15 22:35:43 图核对结论写入 interaction-hooks zh/en §1：A-I 共 9 项缺失，逐项列当前事实与文档落点；确认原图不完整
- 2026-11-15 22:35:43 完成 #2 重绘完整版两通道图（会话内联）并在成对设计文档中提供可持久化的 Mermaid 版本
- 2026-11-15 22:35:43 两份设计文档 §2 提供持久化 Mermaid 三通道图（观测/决策/交互规划项）与 §3.2 时序图；会话内联图在最终回复重绘
- 2026-11-15 22:35:43 完成 #3 新增 docs/interaction-hooks-zh.md 与 -en.md：交互行为矩阵（选项点击、多选、文本输入、编辑、取消、超时、重复提交、外部设备接管、会话失效等）
- 2026-11-15 22:35:43 §4 交互行为矩阵 14 行覆盖单选、多选/反选、文本、编辑、提交、取消、跳过、超时、重复提交、设备接管、会话失效、方案变更、非提问工具、Hook 崩溃
- 2026-11-15 22:35:43 完成 #4 设计文档补齐各环节数据结构：QuestionDescriptor / InteractionRequest / InteractionEvent / InteractionResult / AgentNotification 及字段约束
- 2026-11-15 22:35:43 §5 定义 QuestionDescriptor / InteractionRequest / InteractionEvent / InteractionResult 四结构 + §8.2 AgentNotification，每个含 JSON 示例与字段约束表
- 2026-11-15 22:35:44 完成 #5 设计文档补齐消息格式（hook stdin/stdout、SSE、POST /api/events、TraceEvent 投影）与触发时机/超时边界
- 2026-11-15 22:35:44 §6 覆盖 hook stdin/stdout、SSE 交互帧、POST /api/events 单向限制、TraceEvent 投影；§7 给出 T0-T7 触发表与 ttlMs ≤ timeout-500 边界
- 2026-11-15 22:35:44 完成 #6 设计文档补齐向 Agent 发送通知的消息设计规范（additionalContext / systemMessage / permissionDecisionReason / Notification 事件 / UI 提示）与安全约束
- 2026-11-15 22:35:44 §8 定义四通道、AgentNotification 结构、8 条字段约束与 5 条禁止行为；§9 汇总安全约束总表
- 2026-11-15 22:37:40 完成 #7 同步 docs/index.md、site/src/docs.ts、AGENTS.md、docs/event-protocol-zh.md / -en.md 的目录、交叉引用与规划项标注
- 2026-11-15 22:37:40 docs/index.md 中英表各加设计文档条目与阅读路径；site/src/docs.ts 的 sectionBySlug/readingOrder 注册 interaction-hooks-zh/en；AGENTS.md 新增规划项边界节；event-protocol zh/en §4 加交叉引用与未实现标注
- 2026-11-15 22:43:10 完成 #8 全量验证（tsc、tests、vite build、文档站 build）并逐项核对图内容，归档计划
- 2026-11-15 22:43:10 全量验证通过并逐项核对图内容：A-I 九项在两份文档 §1 表格齐全、§2-§11 章节齐全且均有 Mermaid/规划项标注；重绘会话内联三通道图与交互执行流程图；两处 tsc 退出码 0；node --test 578/578；vite build 与文档站 build 成功，site/dist 产物含新文档标题
- 2026-11-15 22:43:11 完成 #9 code: 8 项任务全部落地；两份设计文档覆盖图核对结论、交互行为矩阵、5 类数据结构、4 类消息格式、触发时机与字段约束；规划项全部显式标注；计划文件无模板占位符残留
- 2026-11-15 22:43:11 code: 8 项任务落地；新增 docs/interaction-hooks-zh.md / -en.md（各 11 节，覆盖图核对、行为矩阵 14 行、5 类数据结构、4 类消息格式、T0-T7 触发时机、通知规范与安全约束）；index/docs.ts/AGENTS/event-protocol 同步；规划项全部显式标注；计划无模板占位符残留
- 2026-11-15 22:43:11 完成 #10 linter_result: ./node_modules/.bin/tsc --noEmit 与 ./node_modules/.bin/tsc -p site/tsconfig.json --noEmit 退出码均为 0（仓库无 lint 脚本）
- 2026-11-15 22:43:11 linter_result: ./node_modules/.bin/tsc --noEmit 退出码 0；./node_modules/.bin/tsc -p site/tsconfig.json --noEmit 退出码 0
- 2026-11-15 22:43:12 完成 #11 unit_test_result: node --test tests/*.test.* 全绿（当前基线 578/578），新增文档不改变测试数量
- 2026-11-15 22:43:12 unit_test_result: node --test tests/*.test.* 输出 1..578 / pass 578 / fail 0，与基线一致，纯文档改动未增减用例
- 2026-11-15 22:43:12 完成 #12 func_test_result: 用真实 ZCode PermissionRequest(AskUserQuestion) 载荷校验文档中的 stdin/answers/TraceEvent 示例字段与 parseUserQuestionContent 输出一致；vite build 与 vite build --config site/vite.config.ts 成功；文档站目录包含新文档 slug
- 2026-11-15 22:43:12 func_test_result: 真实 ZCode PermissionRequest(AskUserQuestion) 含 3 个问题，stdin 字段 hookEvent/toolName/toolUseId/questions 与 §6.1 对齐，Hook 输出 3 条 answers 且键逐字等于问题原文、值均为已声明 label，parseUserQuestionContent 解析 3 条；vite build 与 vite build --config site/vite.config.ts 成功；site/dist 含 Interaction Hook Flow Design；interaction-hooks-zh/en 均在 sectionBySlug 与 index
- 2026-11-15 22:43:13 完成 #13 status: 剩余风险（规划项未实现、宿主协议版本差异、hook 超时窗口）与回滚方式已写入本文件
- 2026-11-15 22:43:13 status: 剩余风险（规划项未实现、三套宿主协议版本差异、5s/5000ms Hook 超时窗口）与回滚（逐文件 revert 文档与 catalog，不影响运行时）已写入本文件风险与回滚及完成标准
- 2026-11-15 22:43:22 归档：任务与完成标准全部满足
