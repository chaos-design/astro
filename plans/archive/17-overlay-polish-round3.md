---
title: 放大层交互与渲染精修
priority: P1
created: 2026-11-27 16:04:49
updated: 2026-11-27 16:43:01
---

# 放大层交互与渲染精修

## 目标

消息切换移入放大层 header、数组 item 块式标识与代码样式、原子消息收起不展示内容、进度条贴 header 边框渐变+呼吸灯、清理服务端越界守卫与二次提醒、版本升级并 push

## 范围

- 包含：放大层 header 消息切换、数组 item 块渲染、折叠隐藏内容、进度条视觉、清理守卫与二次提醒、版本升级
- 不包含：采集协议、文档站

## 实施任务

- [x] T1 stepper 移入放大层 header
- [x] T2 数组 item 块标识与代码样式
- [x] T3 原子消息收起不展示内容
- [x] T4 进度条渐变与呼吸灯
- [x] T5 清理越界守卫与二次提醒
- [x] T6 版本升级
- [x] T7 校验并 push

## 完成标准

- [x] code: 实现、迁移和文档均已完成，不保留双轨逻辑
- [x] linter_result: `corepack pnpm lint` 退出码为 0
- [x] unit_test_result: 新增边界测试通过，关键包覆盖率不低于 90%
- [x] func_test_result: 对应场景完成真实进程验证
- [x] status: 状态、剩余风险和回滚方式已记录

## 风险与回滚

- 风险：blockquote 增强影响普通引用样式（payload 中引用罕见）；呼吸灯动画受 prefers-reduced-motion 保护
- 回滚：表现层为主，`git revert` 单提交即可；版本号回退需同步 4 个 manifest

## 进度日志

- 2026-11-27 16:04:49 创建（planing）
- 2026-11-27 16:43:01 归档：任务与完成标准全部满足
