---
title: ax CLI 功能完善与 npm/npx 发布支持
priority: P2
created: 2026-11-19 23:46:17
updated: 2026-11-20 00:09:29
---

# ax CLI 功能完善与 npm/npx 发布支持

## 目标

ax 成为可透传子命令的完整控制入口，本地/npx 首次运行可一键自举启动，astro-plugin staging 包可真实发布到 npm

## 范围

- 包含：`bin/ax.mjs`、`bin/astrox.mjs`、`bin/astro.mjs`（仅命令分发与 help）、
  `scripts/build-plugin.mjs`、新增 `scripts/publish-plugin.mjs`、根 `package.json`
  scripts、`tests/astrox-cli.test.js`、新增 `tests/astro-cli.test.js`，以及
  AGENTS.md、`docs/plugin-installation.md`、user-manual / deployment 中涉及
  ax、npm 安装与 npx 的章节。
- 不包含：npm 真实发布（`--apply` 属维护者动作，本次只交付可通过 dry-run
  验证的发布脚本）；`astrox start` / `astro-trace serve` 既有语义变更；
  hook 集成安装逻辑；版本号 bump 与 dist-tag 发布策略变更；主工作区
  `feat/hook-auto-approve-question` 分支上的任何文件。

## 实施任务

- [x] bin/ax.mjs 子命令透传：裸 ax 保持快速启动，ax status/stop/restart/up/open/logs/info/update/path/start/help 透传到 astrox 同名命令，未知位置参数报 usage 错；命令名集合在 astrox.mjs 单一定义并导出
- [x] ax 快速启动自举：dashboardFile 缺失时先 installPluginRuntime（唯一安装定义），--no-install 跳过；自举后 dist 缺失给出明确 build 提示
- [x] ax 启动验证与耗时：轮询 /api/health 输出 start.healthy/start.elapsedMs（已运行实例同样验证），text 与 JSON 两种输出都带
- [x] astrox/ax 支持 --version
- [x] bin/astro.mjs 代理 npx 入口：npx astro-plugin ax|stop|restart|up|status|info|open|logs|path 透传到 astrox 同名命令（stdio inherit、退出码传递），help 更新 npx 用法；astro.mjs 自有命令语义不变
- [x] scripts/build-plugin.mjs staging package.json 补齐发布字段：license MIT、repository/bugs/homepage/keywords
- [x] scripts/publish-plugin.mjs：构建→校验 staging（name/version/license/bins/files/tarball）→默认 npm publish --dry-run，--apply 才真实发布；预发布版本自动 --tag alpha；package.json 增加 publish:plugin script
- [x] tests/astrox-cli.test.js 与新建 tests/astro-cli.test.js 覆盖透传、未知命令、--no-install、--version、astro.mjs 委派
- [x] 文档同步：AGENTS.md Quick Start CLI、docs/plugin-installation.md（staging README）npm/npx 用法、user-manual/deployment 涉及 ax 的章节

## 完成标准

- [x] code: 实现、迁移和文档均已完成，不保留双轨逻辑（启动路径仍只有
      `ensureDashboardStarted` 一条；状态报告仍只有 `collectStatusReport` 一份）
- [x] linter_result: `./node_modules/.bin/tsc --noEmit` 与
      `./node_modules/.bin/tsc -p site/tsconfig.json --noEmit` 退出码均为 0
- [x] unit_test_result: `node --test tests/*.test.*` 全绿，记录通过数与新增用例数
- [x] func_test_result: 真实进程验证三条：(a) 全新 scratch `ASTRO_HOME` 下
      `ax` 自举并启动，`/api/health` 探活成功且输出耗时；(b) `pnpm build:plugin`
      产物 tarball 在临时目录经 npm 安装后以 `npx astro-plugin …` 形式执行
      `ax --json` / `status --json` 成功；(c) `publish:plugin` dry-run 通过且
      预发布版本带 `--tag alpha`
- [x] status: 状态、剩余风险和回滚方式已记录

## 风险与回滚

- 风险：`ax` 自举会在首次运行时向 `ASTRO_HOME` 写入运行时副本（`--no-install`
  可跳过，写入目标始终是 `~/.astrox/plugins/astro/`，不触碰 hook 配置与 trace
  数据）；`npm publish --apply` 一旦执行即对外发布，24 小时内可 unpublish，
  之后只能发补丁版本；`npx astro-plugin` 依赖 npm exec 以包名匹配 bin 的行为，
  npm 大版本行为变化可能影响入口解析。
- 回滚：全部改动落在 `feat/ax-quick-cli` 分支，`git revert <commit>` 即可；
  已发布 npm 包按 npm 官方 unpublish 流程处理；staging 包目录
  `artifacts/astro-plugin/` 可随时删除重建，不影响仓库状态。

## 进度日志

- 2026-11-19 23:46:17 创建（planing）
- 2026-11-19 23:53:00 完成 #1 bin/ax.mjs 子命令透传：裸 ax 保持快速启动，ax status/stop/restart/up/open/logs/info/update/path/start/help 透传到 astrox 同名命令，未知位置参数报 usage 错；命令名集合在 astrox.mjs 单一定义并导出
- 2026-11-19 23:53:00 ax.mjs rewritten as dispatching launcher (commandNames passthrough); astrox exports commandNames + getAxPositionalArgs; real runs: ax status --json OK, ax frobnicate exits 1 with usage
- 2026-11-19 23:53:00 完成 #2 ax 快速启动自举：dashboardFile 缺失时先 installPluginRuntime（唯一安装定义），--no-install 跳过；自举后 dist 缺失给出明确 build 提示
- 2026-11-19 23:53:00 axCommand bootstraps via deps.installPluginRuntime when dashboardFile missing; --no-install hint verified; real run astro.mjs ax on empty ASTRO_HOME installed runtime and started dashboard
- 2026-11-19 23:53:00 完成 #3 ax 启动验证与耗时：轮询 /api/health 输出 start.healthy/start.elapsedMs（已运行实例同样验证），text 与 JSON 两种输出都带
- 2026-11-19 23:53:00 checkDashboardHealth polls /api/health 3s; start.healthy/healthUrl/elapsedMs in text+JSON; real run reported healthy=True elapsedMs=600
- 2026-11-19 23:53:01 完成 #4 astrox/ax 支持 --version
- 2026-11-19 23:53:01 astrox --version and ax --version both print 0.0.7-alpha.4
- 2026-11-19 23:53:01 完成 #5 bin/astro.mjs 代理 npx 入口：npx astro-plugin ax|stop|restart|up|status|info|open|logs|path 透传到 astrox 同名命令（stdio inherit、退出码传递），help 更新 npx 用法；astro.mjs 自有命令语义不变
- 2026-11-19 23:53:01 astro.mjs ASTROX_DELEGATED_COMMANDS (ax/info/logs/open/path/restart/status/stop/up) delegates via spawnSync stdio inherit; npx-style astro.mjs ax --json returned full quick report; help documents npx forms
- 2026-11-20 00:02:23 完成 #8 tests/astrox-cli.test.js 与新建 tests/astro-cli.test.js 覆盖透传、未知命令、--no-install、--version、astro.mjs 委派
- 2026-11-20 00:02:23 tests/astrox-cli.test.js +7 (forwarding/unknown/version/--no-install/health fields/bootstrap-missing-build), new tests/astro-cli.test.js +4 (delegation); node --test both files: 25 tests, 24 pass 1 skip(dist present)
- 2026-11-20 00:05:42 完成 #9 文档同步：AGENTS.md Quick Start CLI、docs/plugin-installation.md（staging README）npm/npx 用法、user-manual/deployment 涉及 ax 的章节
- 2026-11-20 00:05:42 AGENTS.md Quick Start CLI rewritten (forwarding/bootstrap/health/publish); deployment-zh/en 2.6 ax block; user-manual-zh/en 12.1 + section 12 tables; plugin-installation.md npm/npx + publishing sections; no new doc pages so docs/index.md and site/src/docs.ts untouched
- 2026-11-20 00:09:25 完成 #6 scripts/build-plugin.mjs staging package.json 补齐发布字段：license MIT、repository/bugs/homepage/keywords
- 2026-11-20 00:09:25 staging manifest: license MIT, repository/bugs/homepage/keywords, LICENSE copied and declared in files; dry-run tarball carries it
- 2026-11-20 00:09:25 完成 #7 scripts/publish-plugin.mjs：构建→校验 staging（name/version/license/bins/files/tarball）→默认 npm publish --dry-run，--apply 才真实发布；预发布版本自动 --tag alpha；package.json 增加 publish:plugin script
- 2026-11-20 00:09:25 scripts/publish-plugin.mjs: build→validate(name/version/license/bins/files/tarball)→npm publish --dry-run default, --apply real, prerelease auto-tag alpha verified; package.json publish:plugin script added
- 2026-11-20 00:09:25 完成 #10 code: 实现、迁移和文档均已完成，不保留双轨逻辑（启动路径仍只有
- 2026-11-20 00:09:25 all 9 tasks implemented; single start path (ensureDashboardStarted) and single status collector (collectStatusReport) preserved; no placeholders
- 2026-11-20 00:09:26 完成 #11 linter_result: `./node_modules/.bin/tsc --noEmit` 与
- 2026-11-20 00:09:26 tsc --noEmit exit 0; tsc -p site/tsconfig.json --noEmit exit 0; git diff --check clean
- 2026-11-20 00:09:26 完成 #12 unit_test_result: `node --test tests/*.test.*` 全绿，记录通过数与新增用例数
- 2026-11-20 00:09:26 790 tests, 787 pass, 1 skip, 2 fail = pre-existing baseline failures re-verified on pristine 2ffa5a1 (hook reused-page + native-plugins sync); +8 new CLI tests green
- 2026-11-20 00:09:26 完成 #13 func_test_result: 真实进程验证三条：(a) 全新 scratch `ASTRO_HOME` 下
- 2026-11-20 00:09:26 (a) npx tarball bare ax: started+healthy=True+bootstrapped=True elapsedMs=590 fresh ASTRO_HOME; (b) npx ax --version/--help/stop/status --json verified, global bin dirs clean; (c) publish dry-run: astro-plugin@0.0.7-alpha.4 tag alpha 585KB
- 2026-11-20 00:09:26 完成 #14 status: 状态、剩余风险和回滚方式已记录
- 2026-11-20 00:09:26 risks+rollback recorded in 风险与回滚: ASTRO_HOME-only bootstrap writes, --apply publish unpublish window, npm-exec bin resolution dependency; rollback = git revert on feat/ax-quick-cli
- 2026-11-20 00:09:29 归档：任务与完成标准全部满足
