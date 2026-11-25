---
title: LOG follow, overlay duration and content preview polish
priority: P2
created: 2026-11-22 19:25:45
updated: 2026-11-22 19:45:18
---

# LOG follow, overlay duration and content preview polish

## 目标

修掉用户报告的五个控制台问题：非 Live 消息收到新原子时 LOG 不再被自动滚动；全局弹窗的成对耗时徽标与 LOG 列表使用同一单位；原子内容面板的代码高亮、Markdown 文档与 shell 命令都能正确呈现。

## 范围

- 包含：`src/app.tsx` 的 AtomicLog 定位效果与 overlay 绑定、`src/lib/log-window.ts` 的滚动决策、`src/lib/duration-label.ts`、`src/lib/payload-markdown.ts`、`src/lib/payload-preview.ts`、`src/styles.css` 的 hljs token 配色、对应测试、`AGENTS.md` 与 `docs/conventions-*.md`。
- 不包含：事件持久化格式、capture 适配器、后端协议、布局响应式规则；不改动未跟踪的 `plans/archive/05..08` 文件。

## 实施任务

- [x] 在 `log-window.ts` 加纯函数 `shouldScrollLogToSelection`，AtomicLog 的定位效果用它门控：仅 `live`（跟随）/ 显式定位 / 选中项变化时才滚动，新原子导致的 `rowTops`/`visibleEntries` 变化不再动滚动条；补单测。
- [x] 把 `formatDurationMs` 从 `app.tsx` 移到 `src/lib/duration-label.ts` 单一定义，overlay 的 `pairDuration` 绑定改用它，删除 `formatOverlayDuration`；同步 `duration-label.test.ts` 与 `payload-overlay-contract.test.ts`。
- [x] `payload-markdown.ts` 中所有提取出的文本（`resultToMarkdown`、字符串直接返回、单字段 unwrap）统一走 `contentToMarkdown`，去掉自造的 JSON-only fence；overlay 的 `preparePreview` 保持一次 fence 决策。
- [x] `payload-preview.ts` 的 shell 推断覆盖单行命令、`VAR=value` 前缀、shebang 与 `cd/echo/export` 等常见命令，并保留「Markdown 文档优先」的既有约束；补单测。
- [x] `styles.css` 补齐注册语法实际发射但缺色的 hljs token（`hljs-function`、`hljs-code` 等），确认 Markdown 标题/列表/引用/任务清单不受影响。
- [x] 更新 `AGENTS.md`、`docs/conventions-zh.md`、`docs/conventions-en.md` 中浮层阶梯与列表单位“不同”的旧表述；运行 `pnpm test`、`pnpm typecheck`、`pnpm build` 与 `pnpm build:docs`。
- [x] 提交并 push，随后按 `pr-update` skill 同步 PR 标题/正文。

## 完成标准

- [x] code: 五处行为均落地，无双轨格式化/推断逻辑，无模板占位符残留。
- [x] linter_result: `./node_modules/.bin/tsc --noEmit` 与 `./node_modules/.bin/tsc -p site/tsconfig.json --noEmit` 退出码均为 0。
- [x] unit_test_result: `node --test tests/*.test.*` 全绿，记录新增用例数与总通过数。
- [x] func_test_result: 用真实渲染探针验证 shell 命令被 fence 成 `bash`、Markdown 文档仍为文档、LOG 滚动门控命中，并记录命令与关键输出。
- [x] status: 剩余风险与回滚方式已写入本文件。

## 风险与回滚

- 风险：shell 关键字白名单可能把极少数以命令名开头的自然语言句子误判为代码；已用「结构性证据 + 单行命令模式」收窄，并由单测覆盖 Markdown 文档不被吞。
- 风险：duration 单位统一后，浮层里长的复合标签（如 `1H25M30s`）会变成 `1h`，属用户明确要求。
- 回滚：按提交逐项 revert；`git revert <sha>` 后可重新跑 `pnpm test && pnpm typecheck && pnpm build` 验证。

## 进度日志

- 2026-11-22 19:25:45 创建（planing）
- 2026-11-22 19:27:38 完成 #1 在 `log-window.ts` 加纯函数 `shouldScrollLogToSelection`，AtomicLog 的定位效果用它门控：仅 `live`（跟随）/ 显式定位 / 选中项变化时才滚动，新原子导致的 `rowTops`/`visibleEntries` 变化不再动滚动条；补单测。
- 2026-11-22 19:27:38 shouldScrollLogToSelection pure gate + AtomicLog effect wired; node --test tests/log-window.test.ts: 10 pass, 0 fail
- 2026-11-22 19:29:10 完成 #2 把 `formatDurationMs` 从 `app.tsx` 移到 `src/lib/duration-label.ts` 单一定义，overlay 的 `pairDuration` 绑定改用它，删除 `formatOverlayDuration`；同步 `duration-label.test.ts` 与 `payload-overlay-contract.test.ts`。
- 2026-11-22 19:29:10 formatDurationMs moved to src/lib/duration-label.ts, overlay binding switched, formatOverlayDuration removed; duration-label+contract tests 33 pass
- 2026-11-22 19:39:46 完成 #3 `payload-markdown.ts` 中所有提取出的文本（`resultToMarkdown`、字符串直接返回、单字段 unwrap）统一走 `contentToMarkdown`，去掉自造的 JSON-only fence；overlay 的 `preparePreview` 保持一次 fence 决策。
- 2026-11-22 19:39:46 payload-markdown unwrapped text now uses contentToMarkdown; pnpm test 880 pass, payload-markdown tests green
- 2026-11-22 19:39:46 完成 #4 `payload-preview.ts` 的 shell 推断覆盖单行命令、`VAR=value` 前缀、shebang 与 `cd/echo/export` 等常见命令，并保留「Markdown 文档优先」的既有约束；补单测。
- 2026-11-22 19:39:46 shell inference covers single-line/ENV-prefix/shebang; node --test tests/payload-preview.test.ts 16 pass
- 2026-11-22 19:39:46 完成 #5 `styles.css` 补齐注册语法实际发射但缺色的 hljs token（`hljs-function`、`hljs-code` 等），确认 Markdown 标题/列表/引用/任务清单不受影响。
- 2026-11-22 19:39:46 shell tokenizer colours commands/flags/assignments, hljs-function/hljs-code added to styles.css; markdown-preview 10 pass
- 2026-11-22 19:39:46 完成 #6 更新 `AGENTS.md`、`docs/conventions-zh.md`、`docs/conventions-en.md` 中浮层阶梯与列表单位“不同”的旧表述；运行 `pnpm test`、`pnpm typecheck`、`pnpm build` 与 `pnpm build:docs`。
- 2026-11-22 19:39:46 AGENTS.md + conventions-{zh,en}.md synced; pnpm test 880/880, typecheck exit 0, pnpm build + pnpm build:docs exit 0, git diff --check clean
- 2026-11-22 19:40:21 完成 #8 code: 五处行为均落地，无双轨格式化/推断逻辑，无模板占位符残留。
- 2026-11-22 19:40:21 5 behaviours implemented; formatOverlayDuration removed, no dual formatter; git diff --check clean
- 2026-11-22 19:40:21 完成 #9 linter_result: `./node_modules/.bin/tsc --noEmit` 与 `./node_modules/.bin/tsc -p site/tsconfig.json --noEmit` 退出码均为 0。
- 2026-11-22 19:40:21 tsc --noEmit and tsc -p site/tsconfig.json --noEmit both exit 0 (BOTH_TSC_OK)
- 2026-11-22 19:40:21 完成 #10 unit_test_result: `node --test tests/*.test.*` 全绿，记录新增用例数与总通过数。
- 2026-11-22 19:40:21 pnpm test -> 880 pass / 0 fail; new cases: log-window 1, duration 3, payload-preview 2, payload-markdown 1, markdown-preview 1, contract 1
- 2026-11-22 19:40:21 完成 #11 func_test_result: 用真实渲染探针验证 shell 命令被 fence 成 `bash`、Markdown 文档仍为文档、LOG 滚动门控命中，并记录命令与关键输出。
- 2026-11-22 19:40:21 render probe: shell command -> bash fence with hljs-keyword/attr/property spans; markdown plan -> h2/ol/checkbox; LOG gate contract test passes on app.tsx source
- 2026-11-22 19:40:21 完成 #12 status: 剩余风险与回滚方式已写入本文件。
- 2026-11-22 19:40:21 risks (shell keyword false positives, duration unit change) and git revert rollback recorded in 风险与回滚
- 2026-11-22 19:44:56 完成 #7 提交并 push，随后按 `pr-update` skill 同步 PR 标题/正文。
- 2026-11-22 19:44:56 commit bec09ac pushed to origin/feat/hook-auto-approve-question; PR #23 body regenerated (title unchanged) via gh pr edit
- 2026-11-22 19:45:18 归档：任务与完成标准全部满足
