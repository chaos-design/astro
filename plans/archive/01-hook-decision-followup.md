---
title: Hook 决策通道后续：当前问题梳理与文档补全
priority: P2
created: 2026-11-15 21:54:42
updated: 2026-11-15 22:20:30
---

# Hook 决策通道后续：当前问题梳理与文档补全

## 目标

问题1的可选决策 Hook 落地后，把观测/决策两通道模型下仍存在的缺口逐条写成可执行任务，补齐全部配套文档与可观测性，使代码、文档、验证三条线自洽。

## 范围

- 包含：`plans/README.md` 与本计划文件；`docs/implementation-details-{zh,en}.md`、`docs/deployment-{zh,en}.md`、`docs/operations-{zh,en}.md`、`docs/user-manual-{zh,en}.md`、`docs/event-protocol-{zh,en}.md`、`docs/conventions-{zh,en}.md`、`docs/plugin-installation.md`；`README.md`、`README-zh.md`；`src/lib/user-question-content.ts`、`src/components/question-content.tsx`；`scripts/auto-approve-question-hook.mjs`、`scripts/install-auto-approve-hook.mjs`；`tests/user-question-content.test.ts`、`tests/auto-approve-hook.test.mjs`。
- 不包含：修改 6 份 `plugin/trace-recorder.cjs` 与 `plugin/zcode-adapter.cjs`；改变「默认关闭」策略；把 PR #23 的 base 改成 `main`；写入使用者真实的 `~/.claude`、`~/.codebuddy`、`~/.zcode` 配置；新增文档页（不引入 `site/src/docs.ts` 目录条目）；合并或 push PR；为计划文件本身创建 Git 提交（按 `plans/README.md` 约定）。

## 现在的问题

以下 10 项基于「Hook_观测通道与决策通道」的两通道模型，对照当前分支
`feat/hook-auto-approve-question`（HEAD `ce513d8`，PR #23）逐条核查得出。

1. **代答结果在控制台不可见**：`src/lib/user-question-content.ts` 的
   `extractQuestions` / `freeFormText` / `planText` 都不读 `tool_input.answers`，
   `tests/user-question-content.test.ts` 也没有 `answers` 用例。决策通道替用户
   选了什么，观测通道的 Input/Preview 无法显示，审计链断在最后一环。
2. **设计落地总表缺行**：`docs/implementation-details-zh.md:18-33` 的 10 项
   「已实现」不含可选决策 Hook，`-en.md` 对应段同样缺失，而 `docs/index.md` 已
   新增对应阅读路径，状态事实源与索引不一致。
3. **环境变量全表缺 4 项**：`docs/deployment-zh.md:64-80` 与
   `docs/deployment-en.md:76-88` 的 env 全表只列服务侧 `ASTRO_*`；
   `ASTRO_AUTO_APPROVE_EVENTS/TOOLS/ANSWER/INPUT_FIELD` 未登记，也没说明它们由
   **宿主 hook 进程**继承、不进入 ASTRO 服务配置。
4. **故障矩阵无对应排查项**：`docs/operations-zh.md:455-466` 只覆盖采集 Hook。
   `hooks.enabled` 未开、ZCode 会话启动快照、matcher 过窄、
   `~/.zcode/cli/log/zcode-<date>.jsonl`、超时回退、禁用方法都没有入口。
5. **用户侧文档不成对、不完整**：`docs/plugin-installation.md` 的新章节是英文，
   `docs/user-manual-{zh,en}.md` 在检查器段末尾只补了一句指引；缺中文完整说明、
   启用/禁用/卸载步骤、宿主差异与风险清单，违反仓库「文档成对发布」约定。
6. **README 特性列表未列该能力**：`README.md:82+` 与 `README-zh.md` 的 Features
   没有条目，只在「只做观测」边界段补了一句，读者从特性列表发现不了。
7. **事件协议未说明注入字段**：`docs/event-protocol-{zh,en}.md` §4 只写了
   `tool_input.plan`，未说明自动同意后 `tool_input.answers` /
   `tool_response.answers` 会出现，也未标注「由宿主 hook 注入，不是 Agent 产生的
   事实」，容易与「原始 `TraceEvent` 不可变」的口径混淆。
8. **协议与安装器边界未覆盖**：`tests/auto-approve-hook.test.mjs` 的 13 例覆盖
   首选项与 fail-open，但缺 `multiSelect` 逗号分隔、自定义 `answers` 映射、
   CodeBuddy `modifiedInput` 的 CLI 层、多 hook 聚合 `deny > ask > allow` 模拟；
   `scripts/install-auto-approve-hook.mjs` 没有 `--remove`，也没有 ZCode
   `hooks.events` 结构校验。
9. **两通道共存缺真实宿主证据**：左通道（recorder 输出 `{continue:true}` 或
   `--quiet` 空 stdout、退出码 0）与右通道（决策 `allow`）目前只有单测；真实
   Claude Code / ZCode 会话里两个 handler 同时注册后的聚合结果，以及
   `PermissionRequest` 是否仍被 ASTRO 完整记录，没有 `func_test_result` 记录。
10. **发布依赖未固化到约定**：PR #23 的 base 是 `feat/user-question-md-preview`
    （堆叠 PR），若 #22 以 squash 合并，必须 rebase 并改 base，否则重复提交。
    该步骤目前只写在 PR 备注里，`docs/conventions-{zh,en}.md` 的分支约定没有。

## 实施任务

- [x] 编写 docs/implementation-details-zh.md / -en.md 的 §2 设计落地总表：新增「可选自动同意决策 Hook」行（状态、核心结果、代码与测试证据），同步表下状态说明
- [x] 补齐 docs/deployment-zh.md / -en.md 的 §2.4 环境变量全表：新增全部 ASTRO_AUTO_APPROVE_* 变量行，注明它们属于宿主 hook 进程、不进入 ASTRO 服务配置
- [x] 补齐 docs/operations-zh.md / -en.md 故障矩阵：新增「决策 Hook 不生效」排查项（hooks.enabled、新会话、matcher、日志路径、超时回退、禁用方法）
- [x] 补齐 docs/user-manual-zh.md / -en.md 与 docs/plugin-installation.md 的完整章节：启用、禁用、卸载、风险、宿主差异与验证清单，消除中文只有一句指引的缺口
- [x] 补齐 README.md / README-zh.md 的 Features 条目，并与「只做观测」边界声明交叉引用
- [x] 补齐 docs/event-protocol-zh.md / -en.md 的 §4：说明自动同意后 tool_input.answers 与 tool_response.answers 的载荷形状，标注该字段由宿主 hook 注入而非 Agent 产生
- [x] 让控制台可见自动代答结果：src/lib/user-question-content.ts 解析 answers，src/components/question-content.tsx 渲染答案区，补 tests/user-question-content.test.ts 用例
- [x] 补齐协议边界：scripts/auto-approve-question-hook.mjs 支持 multiSelect 逗号分隔与自定义 answers 映射，tests/auto-approve-hook.test.mjs 增加 multiSelect、自定义映射、CodeBuddy modifiedInput 的 CLI 层与 deny>ask>allow 聚合模拟
- [x] 补齐安装器：scripts/install-auto-approve-hook.mjs 增加 --remove 卸载路径与 ZCode 配置结构校验，tests/auto-approve-hook.test.mjs 增加卸载后其他 hooks 保留的断言
- [x] 真实轨迹与全量验证：node --test tests/*.test.*、两处 typecheck、vite build、文档站 build，以及真实 ZCode 轨迹含 answers 的端到端检查；记录 PR #23 堆叠依赖与 #22 squash 后的 rebase 步骤

## 完成标准

- [x] code: 上述 10 项任务全部落地，计划文件与 plans/README.md 无模板占位符残留，不保留双轨逻辑，决策 Hook 仍默认关闭
- [x] linter_result: ./node_modules/.bin/tsc --noEmit 与 ./node_modules/.bin/tsc -p site/tsconfig.json --noEmit 退出码均为 0（仓库无 lint 脚本）
- [x] unit_test_result: node --test tests/*.test.* 全绿（当前基线 564/564），记录总数与新增用例数；tests/user-question-content.test.ts 与 tests/auto-approve-hook.test.mjs 单独运行也全绿
- [x] func_test_result: 真实 ZCode ~/.astrox/zcode/**/events.jsonl 的 PermissionRequest(AskUserQuestion) 喂 scripts/auto-approve-question-hook.mjs 输出含 answers；临时 HOME 下验证 --apply / --remove 的备份与其他 hooks 保留；vite build 与 vite build --config site/vite.config.ts 成功
- [x] status: 剩余风险（宿主协议版本差异、自动同意扩大权限面、PR #23 堆叠依赖 #22 的合并方式）与回滚方式（删除 hook 分组或 `--remove --apply`；代码 `git revert ce513d8` 及本轮提交；文档逐文件 revert）已写入本文件「风险与回滚」

## 风险与回滚

- 风险：Claude Code 的 `updatedInput`、CodeBuddy 的 `modifiedInput`、ZCode 的
  `hooks.events` 是三套随宿主版本变化的协议，文档与实现须同版本验证；自动同意
  扩大权限面，matcher 必须保持 `AskUserQuestion|ExitPlanMode`，不得放宽到 Bash；
  展示 `answers` 时若把 hook 注入内容误记为 Agent 产生的事实，会污染事件语义，
  必须在 `docs/event-protocol-*.md` 明确来源；PR #23 依赖 #22 的合并方式。
- 回滚：功能禁用 = 从宿主 settings 删除该 hook 分组，或用新增的 `--remove`；
  代码回滚 = `git revert ce513d8`（决策 Hook 实现）及本轮产生的文档/代码提交；
  文档回滚为逐文件 revert，不影响运行时；计划文件在归档前保留在
  `plans/planing/`，归档后只读。

## 进度日志

- 2026-11-15 21:54:42 创建（planing）
- 2026-11-15 22:01:58 完成 #1 编写 docs/implementation-details-zh.md / -en.md 的 §2 设计落地总表：新增「可选自动同意决策 Hook」行（状态、核心结果、代码与测试证据），同步表下状态说明
- 2026-11-15 22:01:58 implementation-details zh/en 的 §2 落地总表各新增一行「可选自动同意决策 Hook（默认关闭）」并同步表下说明；证据指向 3 个脚本/测试
- 2026-11-15 22:02:57 完成 #2 补齐 docs/deployment-zh.md / -en.md 的 §2.4 环境变量全表：新增全部 ASTRO_AUTO_APPROVE_* 变量行，注明它们属于宿主 hook 进程、不进入 ASTRO 服务配置
- 2026-11-15 22:02:57 deployment zh/en §2.4 各补 5 个 ASTRO_AUTO_APPROVE_* 变量行并说明属宿主 hook 进程；范围调整：任务 8 新增自定义映射变量 ASTRO_AUTO_APPROVE_ANSWERS，故由 4 个改为全部，已同步改写计划任务 2 文本
- 2026-11-15 22:02:57 完成 #3 补齐 docs/operations-zh.md / -en.md 故障矩阵：新增「决策 Hook 不生效」排查项（hooks.enabled、新会话、matcher、日志路径、超时回退、禁用方法）
- 2026-11-15 22:02:57 operations zh/en 故障矩阵各新增「决策 Hook 不生效」排查行（--apply、hooks.enabled、新会话、matcher、ZCode 日志、超时回退、--remove --apply）
- 2026-11-15 22:06:12 完成 #4 补齐 docs/user-manual-zh.md / -en.md 与 docs/plugin-installation.md 的完整章节：启用、禁用、卸载、风险、宿主差异与验证清单，消除中文只有一句指引的缺口
- 2026-11-15 22:06:12 user-manual zh/en 新增 5.5.1 完整章节（启用/宿主差异/参数/风险/禁用卸载/验证 4 步）；plugin-installation 补 --remove、ZCode 结构校验、ANSWERS 变量、验证第 4 步 answers 可见
- 2026-11-15 22:07:02 完成 #5 补齐 README.md / README-zh.md 的 Features 条目，并与「只做观测」边界声明交叉引用
- 2026-11-15 22:07:02 README.md / README-zh.md 的 Features 首条新增可选决策 Hook 能力，并交叉引用「只做观测」边界段与 plugin-installation
- 2026-11-15 22:07:32 完成 #6 补齐 docs/event-protocol-zh.md / -en.md 的 §4：说明自动同意后 tool_input.answers 与 tool_response.answers 的载荷形状，标注该字段由宿主 hook 注入而非 Agent 产生
- 2026-11-15 22:07:32 event-protocol zh/en §4 补自动同意后 tool_input.answers / tool_response.answers 的载荷形状，明确该字段由宿主 Hook 注入、不是 Agent 事实，且不改变事件名/配对/等待态
- 2026-11-15 22:10:26 完成 #7 让控制台可见自动代答结果：src/lib/user-question-content.ts 解析 answers，src/components/question-content.tsx 渲染答案区，补 tests/user-question-content.test.ts 用例
- 2026-11-15 22:10:26 user-question-content.ts 新增 UserQuestionAnswer/answers 解析（tool_input.toolInput.tool_response.nested 四处来源），question-content.tsx 渲染 Answers 段且 answers-only 不再显示空态；新增 4 例，user-question-content + projection 共 24/24 通过，tsc --noEmit 退出码 0
- 2026-11-15 22:13:36 完成 #8 补齐协议边界：scripts/auto-approve-question-hook.mjs 支持 multiSelect 逗号分隔与自定义 answers 映射，tests/auto-approve-hook.test.mjs 增加 multiSelect、自定义映射、CodeBuddy modifiedInput 的 CLI 层与 deny>ask>allow 聚合模拟
- 2026-11-15 22:13:36 hook 新增 ANSWER=all（多选逗号连接）与 ASTRO_AUTO_APPROVE_ANSWERS 自定义映射（字符串/数组、容错）；新增 5 例含 multiSelect、映射优先级、malformed map、CodeBuddy modifiedInput CLI 层、deny>ask>allow 聚合模拟；auto-approve-hook 测试 18/18 通过；deployment/user-manual/plugin-installation 同步 all 与数组语义
- 2026-11-15 22:17:20 完成 #9 补齐安装器：scripts/install-auto-approve-hook.mjs 增加 --remove 卸载路径与 ZCode 配置结构校验，tests/auto-approve-hook.test.mjs 增加卸载后其他 hooks 保留的断言
- 2026-11-15 22:17:20 installer 新增 validateHookConfig（仅校验自有分组、ZCode 要求 hooks.enabled 与 events、拒绝 '*' matcher）与 removeHookConfig/--remove（只删自有 handler、保留其他 hooks、幂等、写前备份）；--apply 前校验失败则不写并退出 1；新增 6 例，auto-approve-hook 测试 23/23 通过；user-manual/plugin-installation/deployment 已同步 --remove 与 ANSWER=all
- 2026-11-15 22:20:10 完成 #10 真实轨迹与全量验证：node --test tests/*.test.*、两处 typecheck、vite build、文档站 build，以及真实 ZCode 轨迹含 answers 的端到端检查；记录 PR #23 堆叠依赖与 #22 squash 后的 rebase 步骤
- 2026-11-15 22:20:10 全量验证完成：node --test tests/*.test.* 578/578；两处 tsc 退出码 0；vite build 与文档站 build 成功；真实 ZCode 轨迹 hook→answers→parser→SSR 渲染通过；临时 HOME --apply/--remove 与非法 matcher 门禁验证通过；PR #23 堆叠依赖与 #22 squash rebase 步骤已写入 conventions zh/en §3
- 2026-11-15 22:20:10 完成 #11 code: 上述 10 项任务全部落地，计划文件与 plans/README.md 无模板占位符残留，不保留双轨逻辑，决策 Hook 仍默认关闭
- 2026-11-15 22:20:10 code: 10 项任务全部落地（10 份文档成对更新 + 4 处代码/脚本 + 2 个测试文件）；计划与 README 无模板占位符残留；决策 Hook 仍默认关闭，未写用户真实 settings
- 2026-11-15 22:20:10 完成 #12 linter_result: ./node_modules/.bin/tsc --noEmit 与 ./node_modules/.bin/tsc -p site/tsconfig.json --noEmit 退出码均为 0（仓库无 lint 脚本）
- 2026-11-15 22:20:10 linter_result: ./node_modules/.bin/tsc --noEmit 退出码 0；./node_modules/.bin/tsc -p site/tsconfig.json --noEmit 退出码 0
- 2026-11-15 22:20:10 完成 #13 unit_test_result: node --test tests/*.test.* 全绿（当前基线 564/564），记录总数与新增用例数；tests/user-question-content.test.ts 与 tests/auto-approve-hook.test.mjs 单独运行也全绿
- 2026-11-15 22:20:10 unit_test_result: node --test tests/*.test.* 输出 1..578 / pass 578 / fail 0（基线 564，新增 14 例：user-question-content +4、auto-approve-hook +10）；两个改动测试文件单独运行分别为 24/24 与 23/23
- 2026-11-15 22:20:11 完成 #14 func_test_result: 真实 ZCode ~/.astrox/zcode/**/events.jsonl 的 PermissionRequest(AskUserQuestion) 喂 scripts/auto-approve-question-hook.mjs 输出含 answers；临时 HOME 下验证 --apply / --remove 的备份与其他 hooks 保留；vite build 与 vite build --config site/vite.config.ts 成功
- 2026-11-15 22:20:11 func_test_result: 真实 ZCode PermissionRequest(AskUserQuestion) 喂 hook 得到 3 条 answers，parseUserQuestionContent 解析 3 条，SSR 渲染出 h3 Answers 且无空态；临时 HOME zcode --apply 生成 hooks.enabled=true 与窄 matcher，--remove --apply 移除自有 handler 并保留 enabled；--matcher=* 校验失败 rc=1 且不写文件；vite build 与 vite build --config site/vite.config.ts 均成功
- 2026-11-15 22:20:11 完成 #15 status: 剩余风险（宿主协议版本差异、自动同意扩大权限面、PR #23 堆叠依赖 #22 的合并方式）与回滚方式（删除 hook 分组或 `--remove --apply`；代码 `git revert ce513d8` 及本轮提交；文档逐文件 revert）已写入本文件「风险与回滚」
- 2026-11-15 22:20:11 status: 剩余风险（宿主协议版本差异、权限面、PR #23 堆叠依赖 #22 合并方式）与回滚（--remove --apply / git revert ce513d8 / 文档逐文件 revert）已写入本文件风险与回滚及完成标准
- 2026-11-15 22:20:30 归档：任务与完成标准全部满足
