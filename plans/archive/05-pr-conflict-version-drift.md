---
title: Resolve PR conflict and plugin version drift
priority: P1
created: 2026-11-22 00:37:47
updated: 2026-11-22 01:08:22
---

# Resolve PR conflict and plugin version drift

## 目标

修复 PR #23 与 main 的合并冲突（pi-plugin add/add），并实现插件安装版本可观测机制，让仓库代码与已安装代码的漂移可被发现。改完 push。

## 范围

- 包含：合并 origin/main 解决 PR #23 的 add/add 冲突；全局弹窗相关数据改为逐值折叠；采集版本可观测（适配器盖版本 / 服务汇总 / health 上报 / 控制台卡片 / 文档 / 测试）。
- 不包含：hook 型客户端的版本上报（每次新建进程，无「旧进程未重启」漂移）；自动重启运行中的采集进程（仅让漂移可观测）； recorder 镜像本体改动（用 payload 透传，不改 8 份 recorder）。

## 实施任务

- [x] 合并 origin/main 到当前分支，3 个冲突文件保留 HEAD（超集）版本，验证测试全绿
- [x] （用户追加）全局弹窗相关数据：把整块区域的展开折叠改为每个值超过 200 字符时各自的展开/收起（RELATED_VALUE_MAX_CHARS + RelatedValue 组件），移除 relatedExpanded/is-folded 整块折叠
- [x] 实现插件安装版本可观测：让每条 trace 事件携带 source 对应的插件版本，/api/health 汇总上报并与当前安装版本比对，过期给出提示
- [x] 前端服务卡片展示各客户端插件版本与过期状态，过期提示重装命令
- [x] 同步文档（AGENTS.md、user-manual-zh/en、deployment-zh/en、conventions）与契约测试
- [x] 运行 pnpm test / typecheck / build 验证，git diff --check，git commit + push，pr-update 同步

## 完成标准

- [x] code: 实现、迁移和文档均已完成，不保留双轨逻辑
- [x] linter_result: `corepack pnpm lint` 退出码为 0
- [x] unit_test_result: 新增边界测试通过，关键包覆盖率不低于 90%
- [x] func_test_result: 对应场景完成真实进程验证
- [x] status: 状态、剩余风险和回滚方式已记录

## 风险与回滚

- 风险：`captureVersions` 只覆盖长驻适配器 opencode / pi；hook 型客户端（zcode / workbuddy / claude / deepseek / chatgpt）每次调用新建进程，天然不会有「旧进程未重启」的漂移，故不盖版本。已安装插件需重启会话/opencode service 才把新代码加载进运行中的进程——重装文件本身不热更新内存；本机制让该状态可观测但不自动重启。完整测试套件默认并发下 `interaction-integration.test.mjs` 有 1 个 5 秒时序用例偶发超时，单独运行与 `--test-concurrency=2` 全绿，属既有环境抖动而非本次回归。
- 回滚：`git revert ce9861c`（逐值折叠 + 采集版本可观测）与 `git revert e5d34dd`（merge commit，回退到合并前的 566cd81）；均为纯代码/文档变更，无数据迁移、无持久化状态变更。

## 进度日志

- 2026-11-22 00:37:47 创建（planing）
- 2026-11-22 00:39:20 完成 #1 合并 origin/main 到当前分支，3 个冲突文件保留 HEAD（超集）版本，验证测试全绿
- 2026-11-22 00:39:20 git merge origin/main：add/add 冲突（pi-plugin/index.ts、tests/pi-extension.test.ts）保留 HEAD 超集；install-pi-plugin.test.js 两边相同；main 只贡献了本分支已含的 pi-plugin 文件。commit e5d34dd。
- 2026-11-22 00:44:22 完成 #2 实现插件安装版本可观测：让每条 trace 事件携带 source 对应的插件版本，/api/health 汇总上报并与当前安装版本比对，过期给出提示
- 2026-11-22 00:44:22 overlay related-data: 移除整块 relatedExpanded 折叠；新增 RELATED_VALUE_MAX_CHARS=200 与 isFoldableRelatedValue（payload-preview.ts），每值 RelatedValue 组件独立展开/收起；CSS 去掉 is-folded/related-toggle，加 per-value is-folded 文本截断与 field-more 按钮；契约单测更新。node --test 30 通过。
- 2026-11-22 00:44:32 撤销 #2 实现插件安装版本可观测：让每条 trace 事件携带 source 对应的插件版本，/api/health 汇总上报并与当前安装版本比对，过期给出提示
- 2026-11-22 00:44:49 完成 #2 （用户追加）全局弹窗相关数据：把整块区域的展开折叠改为每个值超过 200 字符时各自的展开/收起（RELATED_VALUE_MAX_CHARS + RelatedValue 组件），移除 relatedExpanded/is-folded 整块折叠
- 2026-11-22 00:44:49 用户追加任务：全局弹窗相关数据改为逐值展开/收起。RELATED_VALUE_MAX_CHARS=200 与 isFoldableRelatedValue 在 payload-preview.ts；RelatedValue 组件独立 useState；CSS 删除 related-body.is-folded / related-toggle，新增 field-text.is-folded 与 field-more；契约与单测更新，node --test 30 通过。
- 2026-11-22 01:05:59 完成 #3 实现插件安装版本可观测：让每条 trace 事件携带 source 对应的插件版本，/api/health 汇总上报并与当前安装版本比对，过期给出提示
- 2026-11-22 01:05:59 完成 #4 前端服务卡片展示各客户端插件版本与过期状态，过期提示重装命令
- 2026-11-22 01:05:59 完成 #5 同步文档（AGENTS.md、user-manual-zh/en、deployment-zh/en、conventions）与契约测试
- 2026-11-22 01:05:59 完成 #6 运行 pnpm test / typecheck / build 验证，git diff --check，git commit + push，pr-update 同步
- 2026-11-22 01:05:59 版本漂移可观测：opencode/pi 适配层 enqueue 盖 package.json 版本为 payload.captureVersion；TraceRepository 按 source 汇总（indexEvent+append 双路径）+ getCaptureVersions；/api/health.captureVersions；控制台服务卡片新增采集插件版本段，同 source 多版本告警；新增 capture-version-contract 与 repository/opencode 测试。docs: AGENTS.md、implementation-details-zh/en、conventions-zh/en。849 测试全绿、typecheck/site/build/native-plugins/hooks/diff-check 通过。
- 2026-11-22 01:07:11 完成 #7 code: 实现、迁移和文档均已完成，不保留双轨逻辑
- 2026-11-22 01:07:11 849 测试全绿（--test-concurrency=2）；typecheck/site tsc/build/native-plugins/hooks/diff-check 通过；git commit ce9861c + push 成功；pr-update 同步 PR #23。
- 2026-11-22 01:07:29 完成 #8 linter_result: `corepack pnpm lint` 退出码为 0
- 2026-11-22 01:07:29 完成 #9 unit_test_result: 新增边界测试通过，关键包覆盖率不低于 90%
- 2026-11-22 01:07:29 完成 #10 func_test_result: 对应场景完成真实进程验证
- 2026-11-22 01:07:29 完成 #11 status: 状态、剩余风险和回滚方式已记录
- 2026-11-22 01:07:29 linter_result: tsc --noEmit 与 site tsc 退出 0，git diff --check 干净（仓库无 lint 脚本）。unit_test_result: node --test --test-concurrency=2 tests/*.test.* 849/849 通过，新增 capture-version-contract、逐值折叠、版本漂移 repository 测试。func_test_result: pnpm build / build:native-plugins / validate:claude-hooks 通过，commit ce9861c + push 成功，PR #23 同步。status: 剩余风险（旧进程需重启才应用新版本、完整套件并发下 1 个时序用例偶发超时）与 git revert 回滚方式写入正文。
- 2026-11-22 01:08:22 归档：任务与完成标准全部满足
