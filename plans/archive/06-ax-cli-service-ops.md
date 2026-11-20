---
title: ax CLI 服务运维细节功能
priority: P2
created: 2026-11-20 08:50:17
updated: 2026-11-20 10:40:03
---

# ax CLI 服务运维细节功能

## 目标

ax/astrox 成为可脚本化的服务运维入口：health 探活命令、快速启动报告服务数据规模、serve 旗标、logs --follow、stop/restart --json

## 范围

- 包含：`bin/astrox.mjs`（health/logs/stop/restart/ax）、`bin/ax.mjs`（无改动或
  仅注释）、`bin/astro.mjs`（main 守卫 + serve 旗标 + 委派表 + help）、
  `tests/astrox-cli.test.js`、`tests/astro-cli.test.js`，以及 AGENTS.md、
  `docs/deployment-{zh,en}.md`、`docs/user-manual-{zh,en}.md`、
  `docs/plugin-installation.md`。
- 不包含：server.mjs 行为变更（serve 旗标只映射环境变量，不新增服务端参数）；
  状态/信息采集逻辑（仍只有 `collectStatusReport` 一份）；启动路径（仍只有
  `ensureDashboardStarted` 一条）；npm 发布流程变更；hook 集成逻辑；console
  前端。

## 实施任务

- [x] astrox 新增 health 命令：探活 /api/health（复用 checkDashboardHealth 并扩展为 getDashboardHealth(base, timeoutMs) 返回解析后的 health 载荷），text 与 --json 输出 pid/uptime/eventCount/build/dataRoot；不健康或未运行退出码 1；health 加入 commands map，ax 透传与 astro.mjs 委派自动覆盖
- [x] ax 快速启动报告利用 health 载荷：start.service = {eventCount, build, uptimeMs}（仅 healthy 时），text 输出 events 行，JSON 一并携带
- [x] bin/astro.mjs 增加 main 守卫（isInvokedAsEntry，与 astrox 相同模式）并导出 applyServeOptions；serve 支持 --port/--host/--astro-home/--open（映射为 ASTRO_PORT/ASTRO_HOST/ASTRO_HOME/ASTRO_OPEN_BROWSER 后再动态 import server）；help 更新
- [x] astrox logs 支持 --follow：初始 tail 后每 500ms 追加读取，处理文件截断重建，SIGINT 干净退出
- [x] stop/restart 支持 --json：stop 输出 {action,pid,port,url} 或 {action:not-running,port,others}；restart 输出 {stop,start}（复用 ensureDashboardStarted，不新增启动路径）
- [x] tests：health（停机/带假 HTTP 服务两种）、stop --json、restart --json（未安装失败路径）、logs --follow 追加行、applyServeOptions 解析、serve 真实进程旗标验证（临时端口+scratch home+进程清理）
- [x] 文档同步：AGENTS.md Quick Start CLI、deployment zh/en 2.6、user-manual zh/en 12.0/12.1、plugin-installation.md npx 示例加 health

## 完成标准

- [x] code: 实现、迁移和文档均已完成，不保留双轨逻辑（health 复用
      `getDashboardHealth` 单一定义；ax 透传与委派表共享 `commandNames`）
- [x] linter_result: `./node_modules/.bin/tsc --noEmit` 与
      `./node_modules/.bin/tsc -p site/tsconfig.json --noEmit` 退出码均为 0
- [x] unit_test_result: `node --test tests/*.test.*` 全绿（按当前基线允许的
      既有失败除外），记录通过数与新增用例数
- [x] func_test_result: 真实进程验证：(a) scratch `ASTRO_HOME` 起真实服务后
      `ax health` / `astrox health --json` 报告 eventCount/build 且退出码 0；
      (b) `astro-trace serve --port N --astro-home DIR` 真实绑定 N；
      (c) `ax logs --follow` 收到追加行； (d) tarball 重建后 `npx astro-plugin
      health` 可用
- [x] status: 状态、剩余风险和回滚方式已记录

## 风险与回滚

- 风险：`logs --follow` 是长驻轮询（500ms），在脚本中忘记退出会占用终端 ——
  以 SIGINT 干净退出与 `--lines` 初始窗口缓解；`astro.mjs` 增加 main 守卫后
  import 不再执行命令分发（与 astrox 一致），需验证 delegateCommand、pnpm
  scripts、测试 spawn 三个既有调用面仍走 argv[1] 入口；serve 旗标映射的是
  环境变量，显式 env 值会被旗标覆盖 —— 帮助文本写明优先级。
- 回滚：改动全部落在 `feat/ax-quick-cli` 分支一个提交内，`git revert <sha>`
  即可；不涉及数据迁移与外部发布，无运行时回滚步骤。

## 进度日志

- 2026-11-20 08:50:17 创建（planing）
- 2026-11-20 10:39:45 完成 #1 astrox 新增 health 命令：探活 /api/health（复用 checkDashboardHealth 并扩展为 getDashboardHealth(base, timeoutMs) 返回解析后的 health 载荷），text 与 --json 输出 pid/uptime/eventCount/build/dataRoot；不健康或未运行退出码 1；health 加入 commands map，ax 透传与 astro.mjs 委派自动覆盖
- 2026-11-20 10:39:45 完成 #2 ax 快速启动报告利用 health 载荷：start.service = {eventCount, build, uptimeMs}（仅 healthy 时），text 输出 events 行，JSON 一并携带
- 2026-11-20 10:39:45 完成 #3 bin/astro.mjs 增加 main 守卫（isInvokedAsEntry，与 astrox 相同模式）并导出 applyServeOptions；serve 支持 --port/--host/--astro-home/--open（映射为 ASTRO_PORT/ASTRO_HOST/ASTRO_HOME/ASTRO_OPEN_BROWSER 后再动态 import server）；help 更新
- 2026-11-20 10:39:45 完成 #4 astrox logs 支持 --follow：初始 tail 后每 500ms 追加读取，处理文件截断重建，SIGINT 干净退出
- 2026-11-20 10:39:45 完成 #5 stop/restart 支持 --json：stop 输出 {action,pid,port,url} 或 {action:not-running,port,others}；restart 输出 {stop,start}（复用 ensureDashboardStarted，不新增启动路径）
- 2026-11-20 10:39:45 完成 #6 tests：health（停机/带假 HTTP 服务两种）、stop --json、restart --json（未安装失败路径）、logs --follow 追加行、applyServeOptions 解析、serve 真实进程旗标验证（临时端口+scratch home+进程清理）
- 2026-11-20 10:39:45 完成 #7 文档同步：AGENTS.md Quick Start CLI、deployment zh/en 2.6、user-manual zh/en 12.0/12.1、plugin-installation.md npx 示例加 health
- 2026-11-20 10:39:45 all 7 implemented: getDashboardHealth(base,timeoutMs)+payload, healthCommand, ax start.service facts+events line, astro.mjs main-guard+applyServeOptions+serve flags+health delegate, stop/restart/up --json, logs --follow; commandNames auto-covers health for ax+delegation
- 2026-11-20 10:39:58 完成 #8 code: 实现、迁移和文档均已完成，不保留双轨逻辑（health 复用
- 2026-11-20 10:39:58 no second start path (restart --json reuses ensureDashboardStarted); health reuses getDashboardHealth single definition; ax/delegation share commandNames; docs agree
- 2026-11-20 10:39:58 完成 #9 linter_result: `./node_modules/.bin/tsc --noEmit` 与
- 2026-11-20 10:39:58 tsc --noEmit exit 0; tsc -p site/tsconfig.json --noEmit exit 0; git diff --check clean
- 2026-11-20 10:39:58 完成 #10 unit_test_result: `node --test tests/*.test.*` 全绿（按当前基线允许的
- 2026-11-20 10:39:58 pnpm test: 798 tests, 795 pass, 1 skip, 2 fail = pre-existing baseline failures (hook reused-page + native-plugins sync) confirmed on baseline; CLI suites: 33 tests 32 pass 1 skip
- 2026-11-20 10:39:58 完成 #11 func_test_result: 真实进程验证：(a) scratch `ASTRO_HOME` 起真实服务后
- 2026-11-20 10:39:58 (a) scratch ASTRO_HOME real service -> ax health + astrox health --json report eventCount/build exit 0; (b) astro-trace serve --port N --astro-home DIR binds N (real process, free port); (c) ax logs --follow received appended line; (d) rebuilt tarball -> npx astro-plugin health healthy=true
- 2026-11-20 10:39:59 完成 #12 status: 状态、剩余风险和回滚方式已记录
- 2026-11-20 10:39:59 risks+rollback recorded in 风险与回滚: logs --follow is a 500ms polling tail (SIGINT clean exit); astro.mjs main guard keeps all three entry faces on argv[1]; serve flags override inherited env (documented); rollback = git revert on feat/ax-quick-cli, no data migration or external publish
- 2026-11-20 10:40:03 归档：任务与完成标准全部满足
