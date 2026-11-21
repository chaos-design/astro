---
title: AskUserQuestion 交互 Hook 实施任务拆解
priority: P2
created: 2026-11-15 22:51:45
updated: 2026-11-16 11:26:34
---

# AskUserQuestion 交互 Hook 实施任务拆解

## 目标

把 `docs/interaction-hooks-{zh,en}.md` 的规划项拆成 32 条可独立验证的实现任务，
形成可执行 backlog，并在成对设计文档中补充「实施任务拆解」章节。实施时逐项
`tick`：当前 31/32 完成，仅 F3（真实 Claude / ZCode 宿主验收）因本机没有宿主
二进制而阻塞；F3 完成并满足全部完成标准后才可归档。

## 范围

- 包含：`plans/planing/03-*.md`；`docs/interaction-hooks-zh.md` 与
  `docs/interaction-hooks-en.md` 新增 §11；`AGENTS.md` 新增计划索引一句。
- 不包含：实现任何交互 Hook、交互服务、新 `/api/*` 路由或控制台 UI；修改 6 份
  `trace-recorder.cjs` / `zcode-adapter.cjs`；改变可选决策 Hook「默认关闭」策略；
  把规划项改成「已实现」；写入使用者真实的 `~/.claude`、`~/.codebuddy`、
  `~/.zcode` 配置；新建 Git 提交（按 `plans/README.md` 约定）；重开
  `plans/archive/01-*.md` 与 `plans/archive/02-*.md`。

## 待决事项

- [ ] F3 真实宿主验收三项中，**ZCode「新会话日志无 `hook.run.failed`」一项本机已满足**：`pnpm verify:host-integration` 现每次运行自动扫描当天 ZCode CLI 日志（`~/.zcode/cli/log/zcode-$(date +%F).jsonl`），本机今日 300+ 条 `hook.run.allowed`、**0 条 `hook.run.failed`**、全部 ASTRO 来源（`plugin.astro@astro-zcode-local`），证明真宿主 hook 机制健康、当日会话干净，证据机器生成进 `plans/host-acceptance-03.md` 的「Live ZCode host session」段。
  **仍待人工宿主环境执行的**：① Claude `/hooks` 可见且 transcript 出现 `Allowed by PermissionRequest hook`（本机 Claude 无二进制、无凭证）；② interaction-hook 闭环——把交互 Hook 装进宿主并触发一次 `AskUserQuestion`，确认控制台作答把 `answers` 回传给宿主（上面那条只证明 recorder 插件的 hook 跑通了，不等于 interaction hook 的应答链路）。
  本机探测（每次运行由 `pnpm verify:host-integration` 机器生成）：claude 仅配置目录、无二进制；zcode / codebuddy 是 Electron 桌面应用、无独立 CLI 可无头驱动，但**当前确有活跃的真实 ZCode 会话在跑 ASTRO hook**。等价验收 6/6 已入库。请在装有 Claude 的环境执行 ①、并在任一宿主里装交互 Hook 触发一次提问完成 ②，再把 ZCode 项与 ①② 一起勾选，`move 03 planing`、补齐完成标准后归档。

## 拆解口径

- 每条任务只触及 1–2 个源文件加 1 个测试文件，验收点是**一条可运行的断言或一个
  spawn 命令**，不含「完成某模块」这类无法判定的描述。
- 编号 `A1..A5`、`B1..B6`、`C1..C6`、`D1..D6`、`E1..E4`、`F1..F5`，共 32 条。
- 依赖顺序：`A → B`、`A → C`；`B` 与 `C` 可并行；`D → C`；`E → B` 与 `E → C`；
  `F → 全部`。同阶段内按编号顺序执行。
- 所有任务遵循设计文档 §9：`AskUserQuestion|ExitPlanMode` 窄 matcher、
  `deny > ask > allow`、空 stdout + exit 0 的 fail-open、原始 `TraceEvent` 不可变、
  写入前脱敏、`ttlMs ≤ hookTimeoutMs - 500`。
- 设计文档 §11 给出阶段总览与依赖图；本文件是任务编号与验收点的唯一来源。

## 任务明细

### A · 契约与校验（5 条，无运行时行为）

| 编号 | 文件落点 | 验收点 | 依赖 |
| --- | --- | --- | --- |
| A1 | `src/lib/interaction-contract.ts`、`tests/interaction-contract.test.ts` | 断言 5 类消息类型与 action / kind / target / channel 枚举集合 | 无 |
| A2 | 同上 | `validateQuestionDescriptor` 接受 1..4 问题、2..8 唯一 label，拒绝空 question 与超长 header | A1 |
| A3 | 同上 | `validateInteractionEvent` 拒绝非法 action、回退 seq、非法的 final 组合、text 与 optionLabel 同时出现、超过 8 KiB | A1 |
| A4 | 同上 | `validateAnswers` 要求键逐字等于问题原文、值属于已声明 label 或逗号组合、长度 ≤ 4000，丢弃未知键 | A2 |
| A5 | 同上 | `buildInteractionRequest` 生成幂等 requestId、ISO expiresAt，且 5000 ms 超时得到 ttlMs=4500 | A1 |

### B · Hook 同步决策窗口（6 条）

| 编号 | 文件落点 | 验收点 | 依赖 |
| --- | --- | --- | --- |
| B1 | `scripts/interaction-hook.mjs`、`tests/interaction-hook.test.mjs` | 非提问工具与解析异常均空 stdout、status=0 | A5 |
| B2 | 同上 | 从 stdin 构造请求并写 `PermissionRequest` TraceEvent，断言落盘字段含 sessionId / toolUseId / questions | B1 |
| B3 | 同上 | 轮询 `<ASTRO_HOME>/interactions/<id>.json`：命中输出 allow+answers，未命中与超时输出空 stdout，3 例 | B2 |
| B4 | 同上 | `PreToolUse` 与 `PermissionRequest` 两种 stdout 形状、以及 `modifiedInput` 开关，3 例 | B3 |
| B5 | 同上 | `ExitPlanMode` 回显 plan / planFilePath / allowedPrompts 且不生成 answers，2 例 | B3 |
| B6 | 同上 | 非法 JSON、Bash、缺 questions、TTL 到期四种 fail-open 场景，4 例 spawn | B4 |

### C · 交互服务与 SSE（6 条）

| 编号 | 文件落点 | 验收点 | 依赖 |
| --- | --- | --- | --- |
| C1 | `server/interaction-store.mjs`、`tests/interaction-store.test.mjs` | 临时文件 + rename 原子写，并发写入不产生半截 JSON | A5 |
| C2 | `server/server.mjs`、`tests/interaction-service.test.mjs` | `POST /api/interactions` 返回 201，非法载荷返回 400 | C1 |
| C3 | 同上 | `POST /api/interactions/:id/events` 拒绝回退 seq，重复 eventId 幂等 | C2 |
| C4 | 同上 | `POST /api/interactions/:id/close` 生成 InteractionResult，重复提交不改变结果 | C3 |
| C5 | 同上 | `GET /api/interactions/:id` 与 SSE `open` / `update` / `close` 帧格式，`close` 只发一次 | C4 |
| C6 | `server/interaction-store.mjs` | 单 setTimeout 到点写 timeout 并 close，重复触发保护 | C4 |

### D · 控制台交互（6 条）

| 编号 | 文件落点 | 验收点 | 依赖 |
| --- | --- | --- | --- |
| D1 | `src/lib/interaction-reducer.ts`、`tests/interaction-reducer.test.ts` | open / update / close 状态迁移，`reset` 不补播历史交互 | C5 |
| D2 | `src/components/interaction-panel.tsx`、`tests/interaction-panel.test.tsx` | 单选卡片渲染与点击派发 select | D1 |
| D3 | 同上 | 多选与反选按 options 顺序逗号连接提交 | D2 |
| D4 | 同上 | 自由文本、edit、skip、cancel 四条动作 | D2 |
| D5 | 同上 | seq 递增、乐观更新、请求失败回滚、重复提交拦截 | D3 |
| D6 | 同上 | 关闭态与设备接管只读展示，与 `QuestionContent` 的 Answers 段联动 | D5 |

### E · 通知与观测（4 条）

| 编号 | 文件落点 | 验收点 | 依赖 |
| --- | --- | --- | --- |
| E1 | `src/lib/agent-notification.ts`、`tests/agent-notification.test.ts` | kind / target / channel 枚举、summary 1..500 纯文本且不含完整 answers | A1 |
| E2 | `scripts/interaction-hook.mjs` | additionalContext / systemMessage ≤ 10000 与 permissionDecisionReason 输出 | B4、E1 |
| E3 | `server/interaction-store.mjs` | 通知写入 TraceEvent 不新增事件名，且按 event-protocol §10 脱敏 | C1、E1 |
| E4 | 全量测试 | answers 解析、user.question 投影、等待态、Prompt 层级无回归 | B6、C6、D6 |

### F · 安装、文档与验收（5 条）

| 编号 | 文件落点 | 验收点 | 依赖 |
| --- | --- | --- | --- |
| F1 | `scripts/install-interaction-hook.mjs`、`tests/install-interaction-hook.test.mjs` | 独立 source 标识、dry-run 默认、`--apply` 备份、`--remove` 不覆盖 ASTRO 组 | B6 |
| F2 | 同上 | ZCode hooks.enabled 与 events 校验、CodeBuddy modifiedInput、新会话说明 | F1 |
| F3 | 验收记录 | Claude `/hooks` 可见且 transcript 出现 Allowed by PermissionRequest hook；ZCode 新会话日志无 hook.run.failed | F2 |
| F4 | `tests/interaction-integration.test.mjs` | Bash 不拦截、显式 deny 优先、Notification 无决策、超时回退 | F3 |
| F5 | 文档 | 去掉已实现项的规划标注，同步 plugin-installation / user-manual / event-protocol / index / site catalog / AGENTS.md | F4 |

## 实施任务

- [x] A1 定义 5 类消息类型与 action / kind / target / channel 枚举常量
- [x] A2 实现 validateQuestionDescriptor 并覆盖正负例
- [x] A3 实现 validateInteractionEvent 并覆盖 seq、final、互斥与大小约束
- [x] A4 实现 validateAnswers 并覆盖键匹配、label 合法性与 4000 字符上限
- [x] A5 实现 buildInteractionRequest 与 ttlMs ≤ timeout-500 的 TTL 计算
- [x] B1 建立交互 Hook 骨架：非提问工具与解析异常空 stdout、exit 0
- [x] B2 从 stdin 构造 InteractionRequest 并写 PermissionRequest TraceEvent
- [x] B3 实现 TTL 内快速路径轮询：命中 allow+answers，未命中空 stdout
- [x] B4 支持 PreToolUse / PermissionRequest 两种 stdout 形状与 modifiedInput
- [x] B5 支持 ExitPlanMode 回显 plan 且不生成 answers
- [x] B6 补齐四类 fail-open 回归（非法 JSON、Bash、缺 questions、TTL 到期）
- [x] C1 实现 interactions 目录原子写与单写者
- [x] C2 增加 POST /api/interactions 创建请求与 400 校验
- [x] C3 增加 POST /api/interactions/:id/events 与 seq 幂等
- [x] C4 增加 POST /api/interactions/:id/close 与 final 幂等
- [x] C5 增加 GET /api/interactions/:id 与 SSE open / update / close 三帧
- [x] C6 实现单定时器超时与重复触发保护
- [x] D1 实现 interaction-reducer 的 open / update / close / reset 状态迁移
- [x] D2 实现 interaction-panel 单选卡片渲染与点击
- [x] D3 实现多选、反选与逗号连接提交
- [x] D4 实现自由文本、edit、skip、cancel 四条动作
- [x] D5 实现事件发送 seq 递增、乐观更新、失败回滚与重复提交拦截
- [x] D6 实现关闭态、设备接管展示并与 QuestionContent 的 Answers 段联动
- [x] E1 实现 buildAgentNotification 与 summary 字段约束
- [x] E2 Hook 输出 additionalContext / systemMessage / permissionDecisionReason
- [x] E3 通知写入 TraceEvent 不新增事件名并完成脱敏
- [x] E4 跑通观测与 Prompt 层级回归
- [x] F1 实现交互 Hook 安装器：独立 source、dry-run、--apply、--remove
- [x] F2 扩展 ZCode 与 CodeBuddy 的安装校验与配置说明
- [ ] F3 完成 Claude 与 ZCode 真实宿主集成验收并记录
- [x] F4 自动化四条负例集成测试
- [x] F5 更新文档状态标注与全部索引、约定文件

## 完成标准

- [ ] code: 32 条任务全部落地；设计文档中已实现项去掉规划标注；不保留双轨逻辑；交互 Hook 与自动同意 Hook 的边界清晰
- [x] linter_result: ./node_modules/.bin/tsc --noEmit 与 ./node_modules/.bin/tsc -p site/tsconfig.json --noEmit 退出码均为 0
- [x] unit_test_result: node --test tests/*.test.* 全绿（当前基线 578/578），记录总数与新增用例数
- [ ] func_test_result: 真实 ZCode PermissionRequest(AskUserQuestion) 轨迹端到端（stdin → InteractionEvent → answers → PostToolUse → Answers 预览）；Claude/ZCode 宿主集成按 F3 验收；vite build 与文档站 build 成功
- [x] status: 剩余风险（宿主协议版本差异、hook 超时窗口、默认关闭策略）与回滚方式（逐条 revert 或 --remove）已记录

## 风险与回滚

- 风险：三套宿主协议（Claude `updatedInput`、CodeBuddy `modifiedInput`、ZCode
  `hooks.events`）随版本变化，F3 的真实宿主验收仍缺，宿主侧字段或 stdout schema
  变动无法由单测覆盖；5 s / ZCode 5000 ms 的同步 Hook 超时窗口只留约 4.5 s 作答，
  超时即回退原生弹窗，交互面板不适合需要长思考的提问；两个可选 Hook 都不默认安装，
  同一事件同时安装自动同意与交互 Hook 时自动同意会立即 `allow`、交互面板失去意义，
  文档已写明不要混装；`/api/interactions/*` 只在回环地址提供、校验 `requestId`、
  seq 与帧大小，但仍扩大本机服务攻击面；`answers` 是宿主注入字段，不能写成 Agent
  产生的事实。交互 Hook 不重复写 `PermissionRequest` TraceEvent（recorder 已写同一
  宿主事件，重复写会在 LOG 产生两行相同提问），提问行口径只有 recorder 一处。
- 回滚：交互 Hook 用 `pnpm install:interaction -- --client=<client> --remove
  --apply` 卸载（只删自己的分组）；服务端回滚为还原 `server/server.mjs` 与删除
  `server/interaction-store.mjs`，控制台回滚为还原 `src/app.tsx` / `src/styles.css`
  与删除交互组件，二者都按文件 `git revert` 即可；文档回滚为逐文件 revert，不影响
  运行时；已落盘的 `Notification` 行属于既有事件名，无需数据迁移。本计划文件在归档前保留在 `plans/planing/`，归档后只读；若范围
  变化，直接编辑本文件并在进度日志说明，不得绕开任务清单勾选。

## 进度日志

- 2026-11-15 22:51:45 创建（planing）
- 2026-11-15 23:43:15 完成 #1 A1 定义 5 类消息类型与 action / kind / target / channel 枚举常量
- 2026-11-15 23:43:15 完成 #2 A2 实现 validateQuestionDescriptor 并覆盖正负例
- 2026-11-15 23:43:15 完成 #3 A3 实现 validateInteractionEvent 并覆盖 seq、final、互斥与大小约束
- 2026-11-15 23:43:15 完成 #4 A4 实现 validateAnswers 并覆盖键匹配、label 合法性与 4000 字符上限
- 2026-11-15 23:43:15 完成 #5 A5 实现 buildInteractionRequest 与 ttlMs ≤ timeout-500 的 TTL 计算
- 2026-11-15 23:43:15 node --test tests/interaction-contract.test.ts: 10/10 pass; tsc --noEmit exit 0; contract implemented once in plugin/interaction-contract.mjs (installed runtime ships no src/), src/lib/interaction-contract.ts is the typed facade
- 2026-11-15 23:48:07 完成 #6 B1 建立交互 Hook 骨架：非提问工具与解析异常空 stdout、exit 0
- 2026-11-15 23:48:07 完成 #7 B2 从 stdin 构造 InteractionRequest 并写 PermissionRequest TraceEvent
- 2026-11-15 23:48:07 完成 #8 B3 实现 TTL 内快速路径轮询：命中 allow+answers，未命中空 stdout
- 2026-11-15 23:48:07 完成 #9 B4 支持 PreToolUse / PermissionRequest 两种 stdout 形状与 modifiedInput
- 2026-11-15 23:48:07 完成 #10 B5 支持 ExitPlanMode 回显 plan 且不生成 answers
- 2026-11-15 23:48:07 完成 #11 B6 补齐四类 fail-open 回归（非法 JSON、Bash、缺 questions、TTL 到期）
- 2026-11-15 23:48:07 node --test tests/interaction-hook.test.mjs: 9/9 pass; B2 asserts POST /api/events body (sessionId/toolUseId/questions) and POST /api/interactions; B6 spawns 4 fail-open cases + dead service
- 2026-11-15 23:51:11 完成 #12 C1 实现 interactions 目录原子写与单写者
- 2026-11-15 23:51:11 完成 #13 C2 增加 POST /api/interactions 创建请求与 400 校验
- 2026-11-15 23:51:11 完成 #14 C3 增加 POST /api/interactions/:id/events 与 seq 幂等
- 2026-11-15 23:51:11 完成 #15 C4 增加 POST /api/interactions/:id/close 与 final 幂等
- 2026-11-15 23:51:11 完成 #16 C5 增加 GET /api/interactions/:id 与 SSE open / update / close 三帧
- 2026-11-15 23:51:11 完成 #17 C6 实现单定时器超时与重复触发保护
- 2026-11-15 23:51:11 node --test tests/interaction-store.test.mjs (5/5) + tests/interaction-service.test.mjs (5/5): atomic rename writes, duplicate create/event/close idempotent, backward seq 400, single timeout timer, SSE open/update/close once; GET 404 unknown
- 2026-11-16 00:03:48 完成 #18 D1 实现 interaction-reducer 的 open / update / close / reset 状态迁移
- 2026-11-16 00:03:48 完成 #19 D2 实现 interaction-panel 单选卡片渲染与点击
- 2026-11-16 00:03:48 完成 #20 D3 实现多选、反选与逗号连接提交
- 2026-11-16 00:03:48 完成 #21 D4 实现自由文本、edit、skip、cancel 四条动作
- 2026-11-16 00:03:48 完成 #22 D5 实现事件发送 seq 递增、乐观更新、失败回滚与重复提交拦截
- 2026-11-16 00:03:48 完成 #23 D6 实现关闭态、设备接管展示并与 QuestionContent 的 Answers 段联动
- 2026-11-16 00:03:48 node --test tests/interaction-reducer.test.ts (11/11) + tests/interaction-panel-model.test.ts (8/8) + tests/interaction-panel-contract.test.ts (5/5) + tests/interaction-client.test.ts (7/7); panel mounted as a floating card in src/App.tsx, decisions in interaction-panel-model.ts, optimistic send/rollback in interaction-client.ts
- 2026-11-16 10:29:07 完成 #24 E1 实现 buildAgentNotification 与 summary 字段约束
- 2026-11-16 10:29:07 完成 #25 E2 Hook 输出 additionalContext / systemMessage / permissionDecisionReason
- 2026-11-16 10:29:07 node --test tests/agent-notification.test.ts (5/5) + tests/interaction-hook.test.mjs (11/11); notification summary built via buildAgentNotification (500-char clamp, counts only), PreToolUse output carries additionalContext/systemMessage/permissionDecisionReason clamped to 10000
- 2026-11-16 10:30:24 完成 #26 E3 通知写入 TraceEvent 不新增事件名并完成脱敏
- 2026-11-16 10:30:24 node --test tests/interaction-store.test.mjs (6/6) + tests/interaction-service.test.mjs (6/6); close writes one Notification TraceEvent via createTraceEvent, payload uses counts only, answeredBy 'sk-...' is redacted to sk-[redacted]
- 2026-11-16 10:34:52 完成 #27 E4 跑通观测与 Prompt 层级回归
- 2026-11-16 10:34:52 完成 #28 F1 实现交互 Hook 安装器：独立 source、dry-run、--apply、--remove
- 2026-11-16 10:34:52 node --test tests/install-interaction-hook.test.mjs (6/6) + tests/interaction-hook.test.mjs (12/12) + tests/auto-approve-hook.test.mjs (23/23); shared merge/validate/remove helpers generalized with hookMarker/events/hookArgs, installer dry-run default, backup on --apply, --remove keeps recorder and decision groups; ZCode hooks.enabled + events + 5000 ms, CodeBuddy --input-field=modifiedInput, new-session note
- 2026-11-16 10:37:26 完成 #29 F2 扩展 ZCode 与 CodeBuddy 的安装校验与配置说明
- 2026-11-16 10:37:26 node --test tests/install-interaction-hook.test.mjs (6/6) + tests/interaction-hook.test.mjs (12/12) + tests/auto-approve-hook.test.mjs (23/23); ZCode gets hooks.enabled=true, events map per --events and timeoutMs 5000, CodeBuddy gets --input-field=modifiedInput, both source and input field override the environment, installer prints the new-session note
- 2026-11-16 10:37:29 完成 #31 F4 自动化四条负例集成测试
- 2026-11-16 10:37:29 node --test tests/interaction-integration.test.mjs (6/6) against the real server: Bash creates no interaction file, explicit deny/ask outrank allow, Notification returns empty stdout, a 200 ms interaction TTL times out with result status=timeout (hook exits inside 2 s), a dead service still exits 0, requestId keeps the irq- shape
- 2026-11-16 10:37:52 F3（#30）阻塞：`command -v claude`、`command -v zcode`、`command -v codebuddy` 均无输出（仅存在 ~/.claude、~/.zcode、~/.codebuddy 配置目录），本机没有可启动的宿主二进制，无法执行 `/hooks` 可见性与 `Allowed by PermissionRequest hook` / `hook.run.failed` 的真实宿主验收；该项保持未勾选，计划不归档。
- 2026-11-16 10:51:08 完成 #32 F5 更新文档状态标注与全部索引、约定文件
- 2026-11-16 10:51:08 docs/interaction-hooks-zh.md + -en.md status -> implemented (host acceptance pending), §1/§2/§2.1/§3/§5/§6.3/§6.4/§8/§9/§10/§11 labels corrected, §10 now lists the executed commands; docs/plugin-installation.md gains 'Optional: answer user questions from the console'; docs/user-manual-{zh,en} gain §5.5.2 and the interaction routes; docs/event-protocol-{zh,en} gain the three frames, Notification payload fields and the /api/interactions table; docs/index.md, README.md, docs/conventions-{zh,en} and AGENTS.md updated; package.json adds install:interaction; site/src/docs.ts needs no change because it reads titles/summaries from the docs
- 2026-11-16 10:51:15 完成 #34 linter_result: ./node_modules/.bin/tsc --noEmit 与 ./node_modules/.bin/tsc -p site/tsconfig.json --noEmit 退出码均为 0
- 2026-11-16 10:51:15 pnpm typecheck exit=0; ./node_modules/.bin/tsc -p site/tsconfig.json --noEmit exit=0
- 2026-11-16 10:51:15 完成 #35 unit_test_result: node --test tests/*.test.* 全绿（当前基线 578/578），记录总数与新增用例数
- 2026-11-16 10:51:15 pnpm test: 660/660 pass, 0 fail (baseline 578, +82 new cases); includes tests/agent-notification.test.ts, tests/interaction-*.test.*, tests/install-interaction-hook.test.mjs, tests/interaction-integration.test.mjs; the earlier page-visibility flake did not recur
- 2026-11-16 10:51:19 完成 #37 status: 剩余风险（宿主协议版本差异、hook 超时窗口、默认关闭策略）与回滚方式（逐条 revert 或 --remove）已记录
- 2026-11-16 10:51:19 risks rewritten in 风险与回滚: host protocol drift (F3 unverified), 4.5 s window, default-off policy and the do-not-mix rule for the two hooks, loopback-only /api/interactions attack surface, answers are host-injected facts, and the single PermissionRequest writer; rollback is --remove --apply for the hook and per-file git revert for service/console/docs, no data migration because Notification is an existing event name
- 2026-11-16 10:51:37 修正 B2：交互 Hook 不再写 `PermissionRequest` TraceEvent。recorder 已为同一宿主事件写该行，两者并行执行时重复写会在 LOG 产生两行相同提问；`tests/interaction-hook.test.mjs` 改为断言不 POST `/api/events`，文档 §3.2/§6.4 同步为「提问行只由 recorder 写」。
- 2026-11-16 11:26:34 转入 pending：F3 真实宿主验收需要 claude / zcode 二进制；本机 command -v 均无输出。等价验收 6/6 已通过并记录于 plans/host-acceptance-03.md，但 /hooks 可见性、transcript 文本与 ZCode 新会话日志仍需宿主环境。
- 2026-11-16 11:28:10 修正 CodeBuddy 注册事件：官方只在 `PreToolUse` 文档化 `modifiedInput`，原安装器注册在 `PermissionRequest` 会让决策被宿主忽略；`install-interaction-hook.mjs` 改为按客户端选默认事件（claude/zcode=PermissionRequest，codebuddy=PreToolUse），`tests/install-interaction-hook.test.mjs` 与 `docs/plugin-installation.md` 同步。新增 `scripts/verify-host-integration.mjs`（`pnpm verify:host-integration`）与验收记录 `plans/host-acceptance-03.md`；全量 660/660、两处 tsc、两处 build 均通过。
- 2026-11-16 11:55 复核 F3 宿主可用性：Claude 二进制确认不存在；ZCode 宿主实际存在（ZCode.app + 每日 CLI 日志）但 Electron 二进制无法从无头沙箱驱动（子进程调用禁用 Node 环境变量、asar 入口需要 GUI 运行时），F3 仍需人工宿主环境执行，细节补记于 `plans/host-acceptance-03.md` 附录。同轮代码审计清理 `src/lib/interaction-reducer.ts` 的恒真过滤器（行为等价，26 项相关测试与全量 660/660 复跑通过）。
- 2026-11-16 12:08 把 F3 交接做成开箱即用：`scripts/verify-host-integration.mjs` 新增「Host availability probe」（按客户端探测 PATH/已知安装路径/配置目录，输出 cli/app/config-only/absent）与「Runbook for the host-equipped machine」（三步逐条命令与判据），两者机器生成进验收记录；新增 `tests/verify-host-probe.test.mjs`（6 例，可注入文件系统/PATH/home）。全量 666/666（660+6）；`pnpm verify:host-integration -- --out plans/host-acceptance-03.md` 重生成入库。待决事项措辞更正：asar 内是 `out/main`+`out/renderer` 桌面 app 而非 CLI 入口，`~/.zcode/cli/node-fallback` 仅是 app 生成的 shim。
