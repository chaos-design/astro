---
title: Pi main-session capture and subagent linkage, preview polish
priority: P1
created: 2026-11-22 20:15:00
updated: 2026-11-22 23:04:59
---

# Pi main-session capture and subagent linkage, preview polish

## 目标

让 Pi 在 CLI / Web / SDK 三种宿主下都能记录主 Agent 自己的 session；把 subagent 的消息关联回父 session 并在控制台展示；继续完善原子内容面板的 Markdown、shell 与代码高亮。

## 范围

- 包含：`pi-plugin/`（新的 session / subagent 解析模块、index.ts 接线）、`scripts/install-pi-plugin.mjs`、`src/components/json-viewer.tsx`、`src/styles.css`、`src/lib/markdown-preview.ts`、对应测试、`AGENTS.md` 与 `docs/conventions-*.md`。
- 不包含：Pi 宿主本身的配置、seeded 主 Agent 的 prompt 文本重建（宿主未加载扩展时无法补写）、控制台会话数据模型重构。

## 实施任务

- [x] 新增纯函数解析 sessionId：依次读 `ctx.sessionManager.getSessionId()` / `ctx.sessionId` / `ctx.session.id` / `event.sessionId` / `event.session.id` / `PI_SESSION_ID`，都没有时按 pid+cwd 生成稳定回退 id；`emit` 不再因 `ctx` 缺 sessionManager 而丢弃主 Agent 事件。
- [x] `message_start` / `message_end` 只处理 assistant 消息，避免 user / toolResult 消息清空正在累积的 assistant 文本。
- [x] 新增 subagent 身份解析：`PI_SUBAGENT_DEPTH` / `PI_SUBAGENT_STACK` / `PI_SUBAGENT_DELEGATION` 与 Pi 会话 JSONL 中 `customType: "pi-subagent:delegation"` 的持久化条目；子进程的事件写父 sessionId 并带 `agent` / `handle` / `childSessionId`，claim 仍用子进程自己的 sessionId 避免并行冲突。
- [x] 更新 `scripts/install-pi-plugin.mjs` 的 `pluginFiles`，让新增模块随全局安装一起拷贝；补安装清单断言与 session/subagent 纯函数测试。
- [x] Code 视图 `JsonViewer` 的 token 配色与 Markdown 围栏的 hljs token 映射对齐；shell tokenizer 处理行内注释与 heredoc，避免把参数误染成命令。
- [x] 更新 `AGENTS.md`、`docs/conventions-zh.md`、`docs/conventions-en.md`；运行 `pnpm test`、`pnpm typecheck`、`pnpm build`、`pnpm build:docs`、插件构建与 hook 校验。
- [x] 提交并 push，按 `pr-update` skill 同步 PR 标题/正文。

## 完成标准

- [x] code: 主 Agent 事件不再因 sessionId 缺失被丢弃；subagent 事件带父 session 关联；无双轨配色/解析逻辑。
- [x] linter_result: `./node_modules/.bin/tsc --noEmit` 与 `./node_modules/.bin/tsc -p site/tsconfig.json --noEmit` 退出码均为 0。
- [x] unit_test_result: `node --test tests/*.test.*` 全绿，记录新增用例数与总通过数。
- [x] func_test_result: 用注入的 Pi 事件夹具驱动扩展，验证主 session 事件与 subagent→父 session 归属，并记录命令与关键输出。
- [x] status: 剩余风险与回滚方式已写入本文件。

## 风险与回滚

- 风险：`PI_SUBAGENT_DELEGATION` 是 Pi 内部传输而非持久化契约；已加会话 JSONL 的持久化条目回退，并对子进程 fail-open。
- 风险：无 sessionId 的宿主使用 pid+cwd 合成 id，重启后会产生新 session；优于彻底丢失事件。
- 回滚：`git revert <sha>`，随后重跑 `pnpm test && pnpm typecheck && pnpm build` 验证。

## 进度日志

- 2026-11-22 20:15:00 创建（planing）
- 2026-11-22 23:04:03 完成 #1 新增纯函数解析 sessionId：依次读 `ctx.sessionManager.getSessionId()` / `ctx.sessionId` / `ctx.session.id` / `event.sessionId` / `event.session.id` / `PI_SESSION_ID`，都没有时按 pid+cwd 生成稳定回退 id；`emit` 不再因 `ctx` 缺 sessionManager 而丢弃主 Agent 事件。
- 2026-11-22 23:04:03 pi-plugin/session.ts resolvePiSessionId with ctx/event/env + pid-cwd fallback; pi-extension test records main session without sessionManager
- 2026-11-22 23:04:03 完成 #2 `message_start` / `message_end` 只处理 assistant 消息，避免 user / toolResult 消息清空正在累积的 assistant 文本。
- 2026-11-22 23:04:03 non-assistant message_start/end guard; pi-extension test keeps streamed snapshots Hel/Hello across a toolResult message
- 2026-11-22 23:04:03 完成 #3 新增 subagent 身份解析：`PI_SUBAGENT_DEPTH` / `PI_SUBAGENT_STACK` / `PI_SUBAGENT_DELEGATION` 与 Pi 会话 JSONL 中 `customType: "pi-subagent:delegation"` 的持久化条目；子进程的事件写父 sessionId 并带 `agent` / `handle` / `childSessionId`，claim 仍用子进程自己的 sessionId 避免并行冲突。
- 2026-11-22 23:04:03 readSubagentIdentity reads PI_SUBAGENT_* env + persisted delegation JSONL; child events written under parentSessionId, claim stays on child session
- 2026-11-22 23:04:04 完成 #4 更新 `scripts/install-pi-plugin.mjs` 的 `pluginFiles`，让新增模块随全局安装一起拷贝；补安装清单断言与 session/subagent 纯函数测试。
- 2026-11-22 23:04:04 installer pluginFiles includes session.ts; install test asserts it; 7 pi-session pure tests pass
- 2026-11-22 23:04:04 完成 #5 Code 视图 `JsonViewer` 的 token 配色与 Markdown 围栏的 hljs token 映射对齐；shell tokenizer 处理行内注释与 heredoc，避免把参数误染成命令。
- 2026-11-22 23:04:04 JsonViewer keys use --code-accent, overlay raw payload 12px; shell tokenizer handles inline comments and heredoc; markdown-preview 11 pass
- 2026-11-22 23:04:04 完成 #6 更新 `AGENTS.md`、`docs/conventions-zh.md`、`docs/conventions-en.md`；运行 `pnpm test`、`pnpm typecheck`、`pnpm build`、`pnpm build:docs`、插件构建与 hook 校验。
- 2026-11-22 23:04:04 AGENTS.md + conventions-{zh,en}.md synced; pnpm test 891/891, both tsc 0, build/build:docs/build:native-plugins/validate:claude-hooks pass; real installed-extension process verification recorded mainSession
- 2026-11-22 23:04:58 完成 #7 提交并 push，按 `pr-update` skill 同步 PR 标题/正文。
- 2026-11-22 23:04:58 commit c0304c4 pushed; PR #23 body regenerated, title unchanged
- 2026-11-22 23:04:59 完成 #8 code: 主 Agent 事件不再因 sessionId 缺失被丢弃；subagent 事件带父 session 关联；无双轨配色/解析逻辑。
- 2026-11-22 23:04:59 main-session events captured without sessionManager; subagent events carry parentSessionId; one session resolver and one token colour map
- 2026-11-22 23:04:59 完成 #9 linter_result: `./node_modules/.bin/tsc --noEmit` 与 `./node_modules/.bin/tsc -p site/tsconfig.json --noEmit` 退出码均为 0。
- 2026-11-22 23:04:59 both tsc commands exit 0 (BOTH_TSC_OK)
- 2026-11-22 23:04:59 完成 #10 unit_test_result: `node --test tests/*.test.*` 全绿，记录新增用例数与总通过数。
- 2026-11-22 23:04:59 pnpm test 891 pass / 0 fail; new cases: pi-session 7, pi-extension 3, install 1, markdown-preview 1
- 2026-11-22 23:04:59 完成 #11 func_test_result: 用注入的 Pi 事件夹具驱动扩展，验证主 session 事件与 subagent→父 session 归属，并记录命令与关键输出。
- 2026-11-22 23:04:59 real installed-extension process: SessionStart,UserPromptSubmit,AgentMessage,Stop,SessionEnd with sessionId pi-process-... and main prompt; subagent fixture asserts parentSessionId on every event
- 2026-11-22 23:04:59 完成 #12 status: 剩余风险与回滚方式已写入本文件。
- 2026-11-22 23:04:59 risks (internal delegation env, synthesized id) and git revert rollback recorded
- 2026-11-22 23:04:59 归档：任务与完成标准全部满足
