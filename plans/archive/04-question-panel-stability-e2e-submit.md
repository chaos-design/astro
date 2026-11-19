---
title: Question panel: mode jitter, state-aware default, E2E submit
priority: P1
created: 2026-11-19 12:23:24
updated: 2026-11-19 13:04:27
---

# Question panel: mode jitter, state-aware default, E2E submit

## 目标

- 切换 dock/float 不产生抖动:toggle `questionPanelMode` 时不出现新的 border、不 reflow/remount、问题面不 teleport。
- 默认落点随状态:live/open 请求默认 `float`,settled 或静态(已捕获)问题默认 `dock-full`;显式用户选择持久化后覆盖默认。
- 端到端交付答案:点 Submit 一定发出真实 `text`+`submit` 事件,经 service→result file→host hook 送达;真实进程功能测试证明整条链。
- 窄视口下停靠面板的作答按钮仍可达。

## 范围

- 包含:
  - `src/styles.css`(`.inspector-question-dock` 的 `border-top`、`.interaction-panel--floating`、`.question-surface*`、`@media(max-width:620px)` 响应式)
  - `src/components/interaction-panel.tsx`、`src/components/question-content.tsx`(按钮文案/样式统一)
  - `src/config/app-config.ts`(`appDefaults.questionPanelMode` + 解析器)、`src/app.tsx`(`questionPanelMode`/`questionDocked` 解析)、`src/components/settings-dialog.tsx`(设置行)、`tests/app-config.test.ts`
  - `tests/interaction-integration.test.mjs`(扩展)或新增端到端测试文件
  - `AGENTS.md`、`docs/conventions-*.md`、`docs/user-manual-*.md`(设置表)、`docs/index.md`/`site/src/docs.ts`(仅当新增文档页;本计划不新增)
- 不包含:
  - 宿主侧(ZCode/Claude)原生 AskUserQuestion 对 `updatedInput` 的消费——属 plan 03 的 F3,仍因本机无 host 二进制而阻塞
  - auto-approve 决策 hook(`scripts/auto-approve-question-hook.mjs`)
  - recorder/捕获适配器;`/api/interactions` 的 wire 协议不变

## 实施任务

- [x] 任务1 稳定模式切换:toggle `questionPanelMode` 在 dock-full 与 float 之间时不出现新 border、不 reflow——中和/预留 `.inspector-question-dock` 的 `border-top:1px solid var(--line-bright)`(或改为两态恒定的分隔线),问题面在 dock 与 Input tab 间不再整体 remount 跳动(`src/styles.css`、`src/app.tsx`);scratch console 双向切换肉眼验证无跳动
- [x] 任务2 默认落点随状态:live/open 请求默认 `float`,settled/静态问题默认 `dock-full`;用户在控件上的显式选择写入 `ASTROX_QUESTION_PANEL_MODE` 并持久化,覆盖状态默认(`src/config/app-config.ts` 的 `appDefaults`/解析逻辑、`src/app.tsx` 的 `questionPanelMode`/`questionDocked` 解析、`src/components/settings-dialog.tsx` 设置行、`tests/app-config.test.ts` 新用例)
- [x] 任务3 统一 Submit/Cancel 按钮:两个表面(浮动卡 + 停靠面)同一文案、图标、尺寸、variant、顺序;删掉「一次性提交」「提交发送」措辞,定稿为一致的 `Submit`(Send 图标)/`Cancel`(X 图标)并同步 footer meta 文案(`src/components/interaction-panel.tsx`、`src/components/question-content.tsx`)
- [x] 任务4 修复右下角溢出:窄视口下停靠面底部 pinned 作答栏(Submit/Cancel)与右侧内容保持可达——调整 `.question-surface*`、`.inspector-question-dock` 及 `@media (max-width: 620px)` 规则(`src/styles.css`);scratch console 缩窗验证按钮不被裁切
- [x] 任务5 端到端功能测试(真实进程):真实 service + `scripts/interaction-hook.mjs` 进程 + `src/lib/interaction-client.ts` 的 `answerInteractionQuestions` 真客户端;断言 `text`+`submit` 事件被接受、请求以 answered 关闭、result file 落盘、hook stdout 为 `allow` + `updatedInput.answers`(扩展 `tests/interaction-integration.test.mjs`;hook 用短 `--timeout` 保持测试快速稳定)
- [x] 任务6 文档同步:`AGENTS.md`、`docs/conventions-*.md`、`docs/user-manual-*.md` §15.1 设置表(新默认语义 + 按钮文案);`docs/interaction-hooks-*.md` 仅在 wire 格式变化时改(本计划不变,仅核对引用)

## 完成标准

- [x] code: 六个任务全部落地,样式/组件/配置/测试/文档一致,不保留双轨逻辑(旧文案、旧默认值、旧 border 行为均已移除),无占位符残留
- [x] linter_result: `./node_modules/.bin/tsc --noEmit` 与 `./node_modules/.bin/tsc -p site/tsconfig.json --noEmit` 退出码均为 0
- [x] unit_test_result: `node --test tests/*.test.*` 全绿,记录通过数与新增用例数
- [x] func_test_result: 真实进程 E2E(service + `scripts/interaction-hook.mjs` + 真客户端 `answerInteractionQuestions`)通过,记录命令与关键输出(result file 内容、hook stdout、close frame)
- [x] status: 剩余风险(宿主侧 F3 仍阻塞、窄屏边界)与回滚方式已写入「风险与回滚」

## 风险与回滚

- 风险:
  - 状态感知默认改变首启行为(live 请求现在默认浮动);偏好停靠的用户需手动切一次,显式选择会持久化并获胜。
  - E2E 测试依赖真实 service + 真实 hook 进程;hook 轮询窗口 = timeout - 500,测试须用短 `--timeout` 避免慢/flake。
  - 宿主侧(ZCode/Claude 是否真正消费 `updatedInput`)属 plan 03 F3,仍因本机无 host 二进制而阻塞;本计划只证明链到 hook stdout,不声称宿主验收通过。
  - 窄屏修复可能改动 620px 断点下的既有布局,需回归检查 LOG/EVENTS 列在窄视口下不裁切。
- 回滚:
  - 全部改动落在受版本管理的源码 + 测试 + 文档,`git revert` 特性提交即恢复原双表面行为;无数据迁移、无 wire 协议变更,service/hook 保持兼容。

## 进度日志

- 2026-11-19 12:23:24 创建（planing）
- 2026-11-19 13:04:07 完成 #1 任务1 稳定模式切换:toggle `questionPanelMode` 在 dock-full 与 float 之间时不出现新 border、不 reflow——中和/预留 `.inspector-question-dock` 的 `border-top:1px solid var(--line-bright)`(或改为两态恒定的分隔线),问题面在 dock 与 Input tab 间不再整体 remount 跳动(`src/styles.css`、`src/app.tsx`);scratch console 双向切换肉眼验证无跳动
- 2026-11-19 13:04:07 完成 #2 任务2 默认落点随状态:live/open 请求默认 `float`,settled/静态问题默认 `dock-full`;用户在控件上的显式选择写入 `ASTROX_QUESTION_PANEL_MODE` 并持久化,覆盖状态默认(`src/config/app-config.ts` 的 `appDefaults`/解析逻辑、`src/app.tsx` 的 `questionPanelMode`/`questionDocked` 解析、`src/components/settings-dialog.tsx` 设置行、`tests/app-config.test.ts` 新用例)
- 2026-11-19 13:04:07 完成 #3 任务3 统一 Submit/Cancel 按钮:两个表面(浮动卡 + 停靠面)同一文案、图标、尺寸、variant、顺序;删掉「一次性提交」「提交发送」措辞,定稿为一致的 `Submit`(Send 图标)/`Cancel`(X 图标)并同步 footer meta 文案(`src/components/interaction-panel.tsx`、`src/components/question-content.tsx`)
- 2026-11-19 13:04:07 完成 #4 任务4 修复右下角溢出:窄视口下停靠面底部 pinned 作答栏(Submit/Cancel)与右侧内容保持可达——调整 `.question-surface*`、`.inspector-question-dock` 及 `@media (max-width: 620px)` 规则(`src/styles.css`);scratch console 缩窗验证按钮不被裁切
- 2026-11-19 13:04:07 任务1-4: 移除 dock 专属 border-top(_tab 列表恒定分隔线); dock/Input 两处问答面保持 mounted、仅 hidden 切换; 两表面统一 Submit(Send)/Cancel(X) 文案与顺序、footer meta 与 pending 文案同步; 620px 下 footer 换行、meta 独占一行, 按钮可达。契约测试 question-content-contract/interaction-panel-contract 全绿
- 2026-11-19 13:04:07 完成 #5 任务5 端到端功能测试(真实进程):真实 service + `scripts/interaction-hook.mjs` 进程 + `src/lib/interaction-client.ts` 的 `answerInteractionQuestions` 真客户端;断言 `text`+`submit` 事件被接受、请求以 answered 关闭、result file 落盘、hook stdout 为 `allow` + `updatedInput.answers`(扩展 `tests/interaction-integration.test.mjs`;hook 用短 `--timeout` 保持测试快速稳定)
- 2026-11-19 13:04:07 任务5: tests/interaction-integration.test.mjs 新增真实进程 E2E(startServer + interaction-hook.mjs + 真客户端 answerInteractionQuestions), 断言 text+submit 事件被接受、result answered、result file 落盘、hook stdout allow+updatedInput.answers; 该测试暴露并修复 interaction-client.ts resultOf 只读顶层 result 的遗漏(真实 /events 响应把 result 嵌套), 新增 interaction-client.test.ts 回归例; node --test tests/interaction-integration.test.mjs 11/11 pass
- 2026-11-19 13:04:13 完成 #6 任务6 文档同步:`AGENTS.md`、`docs/conventions-*.md`、`docs/user-manual-*.md` §15.1 设置表(新默认语义 + 按钮文案);`docs/interaction-hooks-*.md` 仅在 wire 格式变化时改(本计划不变,仅核对引用)
- 2026-11-19 13:04:13 任务6: AGENTS.md、docs/conventions-{zh,en}.md、docs/user-manual-{zh,en}.md 同步新默认语义(跟随状态/区域全屏/悬浮)、按钮文案、稳定切换; 顺带修正 user-manual-en 残留的 region-half/region-full 陈旧布局名与折叠按钮描述; docs/index.md 与 site/src/docs.ts 无新增页面故不变; interaction-hooks 文档 wire 未变, 引用核对一致
- 2026-11-19 13:04:20 完成 #7 code: 六个任务全部落地,样式/组件/配置/测试/文档一致,不保留双轨逻辑(旧文案、旧默认值、旧 border 行为均已移除),无占位符残留
- 2026-11-19 13:04:20 code: 六项任务全部落地; 旧文案(一次性提交/提交发送)、旧 dock border、旧固定默认均已移除; 新 resolver 单点定义于 question-panel-model.ts, app-config 只给默认值与 storage key, 无双轨逻辑
- 2026-11-19 13:04:20 完成 #8 linter_result: `./node_modules/.bin/tsc --noEmit` 与 `./node_modules/.bin/tsc -p site/tsconfig.json --noEmit` 退出码均为 0
- 2026-11-19 13:04:20 linter_result: pnpm typecheck (tsc --noEmit) exit 0; ./node_modules/.bin/tsc -p site/tsconfig.json --noEmit exit 0
- 2026-11-19 13:04:20 完成 #9 unit_test_result: `node --test tests/*.test.*` 全绿,记录通过数与新增用例数
- 2026-11-19 13:04:20 unit_test_result: pnpm test 780/780 pass, 0 fail; 本计划新增 9 例(app-config +1, question-panel-model +2, question-content-contract +3, interaction-panel-contract +1, interaction-client +1, interaction-integration +1)
- 2026-11-19 13:04:20 完成 #10 func_test_result: 真实进程 E2E(service + `scripts/interaction-hook.mjs` + 真客户端 `answerInteractionQuestions`)通过,记录命令与关键输出(result file 内容、hook stdout、close frame)
- 2026-11-19 13:04:20 func_test_result: node --test tests/interaction-integration.test.mjs 11/11 pass, 新增 E2E 用例真实 service + interaction-hook.mjs 进程 + answerInteractionQuestions 端到端: result file status=answered/answers={Which framework?:React}, hook stdout decision.behavior=allow 且 decision.updatedInput.answers 键逐字匹配, submit 响应 result.status=answered; pnpm build 与 pnpm build:docs 均成功
- 2026-11-19 13:04:20 完成 #11 status: 剩余风险(宿主侧 F3 仍阻塞、窄屏边界)与回滚方式已写入「风险与回滚」
- 2026-11-19 13:04:20 status: 剩余风险(宿主侧 F3 仍阻塞、窄屏边界需真机回归)与回滚方式(git revert 特性提交, 无数据迁移、无 wire 变更)已写入风险与回滚
- 2026-11-19 13:04:27 归档：任务与完成标准全部满足
