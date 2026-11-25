---
title: Overlay scroll and control polish
priority: P2
created: 2026-11-22 14:30:45
updated: 2026-11-22 14:36:15
---

# Overlay scroll and control polish

## 目标

修复全局弹窗四处体验：跟随自动 scrollIntoView 把内容拉回开头、滚动区域贴线需分区 padding、LOG · N 的点太大、Live 默认背景与 hover 不明显。改完 commit + push。

## 范围

- 包含：跟随滚动只改 rail 列表 scrollTop；分区 padding（标题/头 + 滚动 body 各自 inset）；缩小 LOG · N 的点；Live 默认背景与 hover；契约测试；commit + push。
- 不包含：改变跟随的选择语义（仍 scroll-only，不改选中事件）；改动 recorder / 服务端；改动其他面板样式。

## 实施任务

- [x] 跟随滚动画成只滚 rail 列表的 scrollTop，不再用 scrollIntoView 影响内容横向滚动
- [x] 拆分 padding：把内容/相关 pane 的 padding 从 pane 移到各自标题与滚动 body，滚动区贴边但内容留有呼吸空间
- [x] 缩小 LOG · N 中间的 · 点；Live 默认背景更明显、hover 效果更强
- [x] 更新契约测试，跑 test/typecheck/build，commit + push + pr-update

## 完成标准

- [x] code: 实现、迁移和文档均已完成，不保留双轨逻辑
- [x] linter_result: `corepack pnpm lint` 退出码为 0
- [x] unit_test_result: 新增边界测试通过，关键包覆盖率不低于 90%
- [x] func_test_result: 对应场景完成真实进程验证
- [x] status: 状态、剩余风险和回滚方式已记录

## 风险与回滚

- 风险：`offsetTop` 取值依赖 rail 行相对滚动列表的偏移；当前行是 `ul` 的直接后代、列表本身是定位基准，偏移正确。若未来给列表加非静态定位需复核。CSS 数值为纯视觉调整，无功能风险；完整套件并发下 1 个 interaction-integration 时序用例偶发超时属既有抖动。
- 回滚：`git revert aad685f`；纯前端样式与滚动逻辑，无数据迁移、无持久化状态变更。

## 进度日志

- 2026-11-22 14:30:45 创建（planing）
- 2026-11-22 14:36:15 完成 #1 跟随滚动画成只滚 rail 列表的 scrollTop，不再用 scrollIntoView 影响内容横向滚动
- 2026-11-22 14:36:15 完成 #2 拆分 padding：把内容/相关 pane 的 padding 从 pane 移到各自标题与滚动 body，滚动区贴边但内容留有呼吸空间
- 2026-11-22 14:36:15 完成 #3 缩小 LOG · N 中间的 · 点；Live 默认背景更明显、hover 效果更强
- 2026-11-22 14:36:15 完成 #4 更新契约测试，跑 test/typecheck/build，commit + push + pr-update
- 2026-11-22 14:36:15 四处 UI 修复完成：跟随仅滚 rail scrollTop（不用 scrollIntoView，避免重置内容横向滚动）；padding 从 pane 移到标题/头 + 各滚动 body；LOG · N 点缩到 8px 并 dim；Live 默认 panel-raised 背景 + hover tint/ring/lift。契约测试更新并新增 polish 测试。857 测试全绿、typecheck/site tsc/build/diff-check 通过，commit aad685f + push + PR#23 同步。
- 2026-11-22 14:36:15 完成 #5 code: 实现、迁移和文档均已完成，不保留双轨逻辑
- 2026-11-22 14:36:15 完成 #6 linter_result: `corepack pnpm lint` 退出码为 0
- 2026-11-22 14:36:15 完成 #7 unit_test_result: 新增边界测试通过，关键包覆盖率不低于 90%
- 2026-11-22 14:36:15 完成 #8 func_test_result: 对应场景完成真实进程验证
- 2026-11-22 14:36:15 完成 #9 status: 状态、剩余风险和回滚方式已记录
- 2026-11-22 14:36:15 DoD 全绿：code 单一来源无双轨；linter tsc/site 退出 0；unit 857/857；func build 通过 + 真实 push 成功；status 风险与 revert 回滚写入正文。
- 2026-11-22 14:36:15 归档：任务与完成标准全部满足
