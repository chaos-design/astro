---
title: 放大层细节第三轮
priority: P1
created: 2026-11-27 17:32:03
updated: 2026-11-27 17:43:53
---

# 放大层细节第三轮

## 目标

单 item 直接渲染重要内容、进度条盖满 border 并去滚动条加两端平移按钮、stepper 移出 agent 胶囊

## 范围

- 包含：单 item 直渲染、进度条全宽 bed 与两端平移按钮、stepper 移出 agent 胶囊
- 不包含：采集协议与服务端

## 实施任务

- [x] T1 单 item 直接渲染
- [x] T2 进度条 border 覆盖与平移按钮
- [x] T3 stepper 外移
- [x] T4 校验并 push

## 完成标准

- [x] code: 实现、迁移和文档均已完成，不保留双轨逻辑
- [x] linter_result: `corepack pnpm lint` 退出码为 0
- [x] unit_test_result: 新增边界测试通过，关键包覆盖率不低于 90%
- [x] func_test_result: 对应场景完成真实进程验证
- [x] status: 状态、剩余风险和回滚方式已记录

## 风险与回滚

- 风险：blockquote 单项裸渲染与普通引用共用样式；edge 按钮在窄面板下可能挤占刻度区（is-hidden 兜底）
- 回滚：表现层为主，`git revert` 单提交即可

## 进度日志

- 2026-11-27 17:32:03 创建（planing）
- 2026-11-27 17:43:53 归档：任务与完成标准全部满足
