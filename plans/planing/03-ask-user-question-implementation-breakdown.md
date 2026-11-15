---
title: AskUserQuestion 交互 Hook 实施任务拆解
priority: P2
created: 2026-11-15 22:51:45
updated: 2026-11-15 22:51:45
---

# AskUserQuestion 交互 Hook 实施任务拆解

## 目标

把 `docs/interaction-hooks-{zh,en}.md` 的规划项拆成 32 条可独立验证的实现任务，
形成待执行 backlog，并在成对设计文档中补充「实施任务拆解」章节。本计划是**待执行
清单**，不是完成记录：实施开始时逐项 `tick`，全部勾选并满足完成标准后再归档。

## 范围

- 包含：`plans/planing/03-*.md`；`docs/interaction-hooks-zh.md` 与
  `docs/interaction-hooks-en.md` 新增 §11；`AGENTS.md` 新增计划索引一句。
- 不包含：实现任何交互 Hook、交互服务、新 `/api/*` 路由或控制台 UI；修改 6 份
  `trace-recorder.cjs` / `zcode-adapter.cjs`；改变可选决策 Hook「默认关闭」策略；
  把规划项改成「已实现」；写入使用者真实的 `~/.claude`、`~/.codebuddy`、
  `~/.zcode` 配置；新建 Git 提交（按 `plans/README.md` 约定）；重开
  `plans/archive/01-*.md` 与 `plans/archive/02-*.md`。

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

- [ ] A1 定义 5 类消息类型与 action / kind / target / channel 枚举常量
- [ ] A2 实现 validateQuestionDescriptor 并覆盖正负例
- [ ] A3 实现 validateInteractionEvent 并覆盖 seq、final、互斥与大小约束
- [ ] A4 实现 validateAnswers 并覆盖键匹配、label 合法性与 4000 字符上限
- [ ] A5 实现 buildInteractionRequest 与 ttlMs ≤ timeout-500 的 TTL 计算
- [ ] B1 建立交互 Hook 骨架：非提问工具与解析异常空 stdout、exit 0
- [ ] B2 从 stdin 构造 InteractionRequest 并写 PermissionRequest TraceEvent
- [ ] B3 实现 TTL 内快速路径轮询：命中 allow+answers，未命中空 stdout
- [ ] B4 支持 PreToolUse / PermissionRequest 两种 stdout 形状与 modifiedInput
- [ ] B5 支持 ExitPlanMode 回显 plan 且不生成 answers
- [ ] B6 补齐四类 fail-open 回归（非法 JSON、Bash、缺 questions、TTL 到期）
- [ ] C1 实现 interactions 目录原子写与单写者
- [ ] C2 增加 POST /api/interactions 创建请求与 400 校验
- [ ] C3 增加 POST /api/interactions/:id/events 与 seq 幂等
- [ ] C4 增加 POST /api/interactions/:id/close 与 final 幂等
- [ ] C5 增加 GET /api/interactions/:id 与 SSE open / update / close 三帧
- [ ] C6 实现单定时器超时与重复触发保护
- [ ] D1 实现 interaction-reducer 的 open / update / close / reset 状态迁移
- [ ] D2 实现 interaction-panel 单选卡片渲染与点击
- [ ] D3 实现多选、反选与逗号连接提交
- [ ] D4 实现自由文本、edit、skip、cancel 四条动作
- [ ] D5 实现事件发送 seq 递增、乐观更新、失败回滚与重复提交拦截
- [ ] D6 实现关闭态、设备接管展示并与 QuestionContent 的 Answers 段联动
- [ ] E1 实现 buildAgentNotification 与 summary 字段约束
- [ ] E2 Hook 输出 additionalContext / systemMessage / permissionDecisionReason
- [ ] E3 通知写入 TraceEvent 不新增事件名并完成脱敏
- [ ] E4 跑通观测与 Prompt 层级回归
- [ ] F1 实现交互 Hook 安装器：独立 source、dry-run、--apply、--remove
- [ ] F2 扩展 ZCode 与 CodeBuddy 的安装校验与配置说明
- [ ] F3 完成 Claude 与 ZCode 真实宿主集成验收并记录
- [ ] F4 自动化四条负例集成测试
- [ ] F5 更新文档状态标注与全部索引、约定文件

## 完成标准

- [ ] code: 32 条任务全部落地；设计文档中已实现项去掉规划标注；不保留双轨逻辑；交互 Hook 与自动同意 Hook 的边界清晰
- [ ] linter_result: ./node_modules/.bin/tsc --noEmit 与 ./node_modules/.bin/tsc -p site/tsconfig.json --noEmit 退出码均为 0
- [ ] unit_test_result: node --test tests/*.test.* 全绿（当前基线 578/578），记录总数与新增用例数
- [ ] func_test_result: 真实 ZCode PermissionRequest(AskUserQuestion) 轨迹端到端（stdin → InteractionEvent → answers → PostToolUse → Answers 预览）；Claude/ZCode 宿主集成按 F3 验收；vite build 与文档站 build 成功
- [ ] status: 剩余风险（宿主协议版本差异、hook 超时窗口、默认关闭策略）与回滚方式（逐条 revert 或 --remove）已记录

## 风险与回滚

- 风险：本计划只是 backlog，32 条任务全部未实施，设计文档仍应保留「规划项 / 未实现」
  标注直至 F5 完成。三套宿主协议（Claude `updatedInput`、CodeBuddy
  `modifiedInput`、ZCode `hooks.events`）随版本变化；5 s / ZCode 5000 ms 的同步
  Hook 超时窗口决定了 D 阶段的人工交互不能阻塞 Hook；新增 `/api/interactions/*`
  会扩大服务攻击面，必须校验 `requestId`、seq 与帧大小；`answers` 是宿主注入
  字段，不能写成 Agent 产生的事实。
- 回滚：实施阶段每步只改 1–2 个文件，单步 `git revert` 即可；交互 Hook 用
  `install-interaction-hook.mjs --remove --apply` 卸载；文档回滚为逐文件 revert，
  不影响运行时。本计划文件在归档前保留在 `plans/planing/`，归档后只读；若范围
  变化，直接编辑本文件并在进度日志说明，不得绕开任务清单勾选。

## 进度日志

- 2026-11-15 22:51:45 创建（planing）
