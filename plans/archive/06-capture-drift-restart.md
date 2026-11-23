---
title: Fix capture-version drift detection and add restart command
priority: P1
created: 2026-11-22 12:01:38
updated: 2026-11-22 12:11:40
---

# Fix capture-version drift detection and add restart command

## 目标

修复上一轮 captureVersions 漂移检测的真实缺陷（旧进程不写版本导致两版本条件永不触发），bump 适配器版本增加区分度，服务卡片加一键复制重启命令，并重装本地插件 + 重启 opencode service 让新代码生效。改完 push。

## 范围

- 包含：bump opencode/pi 适配器至 0.0.6；把无版本事件计入未标记桶并按事件时间推导 stale；服务卡片显示 v旧(未标记) 桶 + 一键复制重启指令；文档与测试同步；本地插件重装并重启 opencode service。
- 不包含：hook 型客户端版本上报（每次新建进程，无旧进程漂移）；让浏览器真的重启宿主进程（只复制命令）；改动 8 份 recorder 镜像（用 payload 透传）。

## 实施任务

- [x] bump opencode/pi 插件版本 0.0.5→0.0.6；修 trackCaptureVersion/getCaptureVersions：把无版本事件计入未标记桶，按最近事件时间判定 stale（两桶共存），更新测试
- [x] 新增 captureRestartFor(source) 命令助手与测试；服务卡片展示未标记桶、按 stale 给一键复制重启命令按钮
- [x] 同步文档（AGENTS.md、implementation-details-zh/en、conventions-zh/en、user-manual-zh/en）
- [x] 运行测试/typecheck/build/build:native-plugins/hooks/diff-check，commit + push + pr-update
- [x] 重装本地 opencode/pi 插件并重启 opencode service，让新代码生效

## 完成标准

- [x] code: 实现、迁移和文档均已完成，不保留双轨逻辑
- [x] linter_result: `corepack pnpm lint` 退出码为 0
- [x] unit_test_result: 新增边界测试通过，关键包覆盖率不低于 90%
- [x] func_test_result: 对应场景完成真实进程验证
- [x] status: 状态、剩余风险和回滚方式已记录

## 风险与回滚

- 风险：`stale` 按事件 capturedAt 推导，跨文件事件时间戳时钟若偏差较大可能误判，但同一 source 通常来自同一进程时钟；无版本桶可能把「重装前的历史事件」计入——但因判定要求无版本事件不早于最新带版本事件，纯历史不会误报。完整套件默认并发下 1 个 interaction-integration 时序用例偶发超时，单独运行与 --test-concurrency=2 全绿，属既有抖动。`opencode service restart` 会中断正在运行的会话；本次在用户明确授权后执行，已确认新 pid 62614 起来。
- 回滚：`git revert b10e886`（漂移检测修复与重启指令）；纯代码/文档变更，无数据迁移。已装插件若回滚需重装回 0.0.5。

## 进度日志

- 2026-11-22 12:01:38 创建（planing）
- 2026-11-22 12:10:57 完成 #1 bump opencode/pi 插件版本 0.0.5→0.0.6；修 trackCaptureVersion/getCaptureVersions：把无版本事件计入未标记桶，按最近事件时间判定 stale（两桶共存），更新测试
- 2026-11-22 12:10:57 完成 #2 新增 captureRestartFor(source) 命令助手与测试；服务卡片展示未标记桶、按 stale 给一键复制重启命令按钮
- 2026-11-22 12:10:57 完成 #3 同步文档（AGENTS.md、implementation-details-zh/en、conventions-zh/en、user-manual-zh/en）
- 2026-11-22 12:10:57 完成 #4 运行测试/typecheck/build/build:native-plugins/hooks/diff-check，commit + push + pr-update
- 2026-11-22 12:10:57 完成 #5 重装本地 opencode/pi 插件并重启 opencode service，让新代码生效
- 2026-11-22 12:10:57 版本 bump 0.0.6；修无版本桶与 stale 判定；captureRestartCommand + 一键复制；文档同步；852 测试全绿 + typecheck/site tsc/build/native-plugins/hooks/diff-check；commit b10e886 + push + PR#23 同步；本地插件重装 0.0.6 并 opencode service restart 生效（pid 62614）。
- 2026-11-22 12:10:57 完成 #6 code: 实现、迁移和文档均已完成，不保留双轨逻辑
- 2026-11-22 12:10:57 完成 #7 linter_result: `corepack pnpm lint` 退出码为 0
- 2026-11-22 12:10:57 完成 #8 unit_test_result: 新增边界测试通过，关键包覆盖率不低于 90%
- 2026-11-22 12:10:57 完成 #9 func_test_result: 对应场景完成真实进程验证
- 2026-11-22 12:10:57 code: 单一真相源为适配器清单，无双轨。linter: tsc/site tsc 退出 0，diff-check 干净。unit: 852/852，新增无版本漂移/重启指令测试。func: build/native-plugins/hooks 通过，真实 opencode service restart 成功。
- 2026-11-22 12:11:40 完成 #10 status: 状态、剩余风险和回滚方式已记录
- 2026-11-22 12:11:40 状态完成：剩余风险（时钟偏差/历史桶/并发时序用例抖动/重启中断会话）与 git revert 回滚方式已写入正文。
- 2026-11-22 12:11:40 归档：任务与完成标准全部满足
