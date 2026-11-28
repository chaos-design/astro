---
title: 放大层精修第四轮
priority: P1
created: 2026-11-27 18:15:32
updated: 2026-11-27 18:36:35
---

# 放大层精修第四轮

## 目标

stepper 右侧内容撑开、related 数组单项显示主要内容、进度条盖住 border 常驻按钮修复高亮、字段 padding 对称、bash 高亮、图片资源展示与长文本折叠

## 范围

- 包含：stepper grid 右对齐、related 单元素数组主要内容、进度条 ticks layer/pan/head border 移除、字段对称 padding、图片端点 /api/file 与 captured-image helper、长文本折叠
- 不包含：服务端采集协议；stdout 的语法高亮（输出无语法，保持终端帧）

## 实施任务

- [x] T1 stepper 右移内容撑开
- [x] T2 related 数组单项主要内容
- [x] T3 进度条盖 border 常驻按钮修复高亮
- [x] T4 字段 padding 对称
- [x] T5 bash 命令高亮
- [x] T6 图片资源展示与长文本折叠
- [x] T7 校验并 push

## 完成标准

- [x] code: 实现、迁移和文档均已完成，不保留双轨逻辑
- [x] linter_result: `corepack pnpm lint` 退出码为 0
- [x] unit_test_result: 新增边界测试通过，关键包覆盖率不低于 90%
- [x] func_test_result: 对应场景完成真实进程验证
- [x] status: 状态、剩余风险和回滚方式已记录

## 风险与回滚

- 风险：/api/file 是本机只读图片窗口（扩展名白名单 + 20MB 上限 + 绝对路径），不是通用文件服务；fold 阈值 600 字符为观感参数
- 回滚：`git revert` 单提交即可；/api/file 为新增路由，回退不影响既有功能

## 进度日志

- 2026-11-27 18:15:32 创建（planing）
- 2026-11-27 18:36:35 归档：任务与完成标准全部满足
