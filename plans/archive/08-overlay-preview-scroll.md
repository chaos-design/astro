---
title: Overlay preview md-vs-code and reader scroll
priority: P2
created: 2026-11-22 15:25:22
updated: 2026-11-22 15:27:52
---

# Overlay preview md-vs-code and reader scroll

## 目标

浮层预览三处修复:Markdown 文档按文档渲染(不再因一行像代码而被整体围栏成横向滚动的等宽墙);跟随推进保留读者滚动位置、点选行才回顶;记录器的空 `tool_input: {}` 占位不再遮住工具参数(工具调用 Input 预览曾因此空白)。

## 范围

- 包含:`src/lib/payload-preview.ts` 的 `contentToMarkdown` 围栏判定(带块级 Markdown 结构的文本是文档;json/diff/xml 自识别无条件围栏;shell/Python 的 `#` 是注释不算文档证据);`src/lib/payload-markdown.ts` 的 `objectToMarkdown` 共用同一判定;`src/components/payload-overlay.tsx` 两窗格滚动备忘(onScroll 写入 ref、提交后恢复、点选行回顶、Code 视图清零)+ overlay 内宽表格块内滚动;`src/app.tsx` 的 `payloadField`(空对象占位跳到下一个拼写);`tests/payload-preview.test.ts`、`tests/payload-markdown.test.ts`、`tests/payload-overlay-contract.test.ts`;AGENTS.md / docs/conventions-*.md / docs/user-manual-*.md 同步。
- 不包含:改变跟随的选择语义(仍 scroll-only);记录器写空占位的行为(已录数据要兼容,控制台侧修复);`markdown-preview.ts` 的解析与消毒;其他面板样式。

## 实施任务

- [x] contentToMarkdown:关键词围栏仅限以代码为主的内容,带块级 Markdown 结构的文档渲染为文档(shell/Python 的 # 注释不算文档证据)
- [x] payload-overlay:两个窗格的滚动位置在跟随推进时保留(onScroll 备忘 + 提交后恢复),读者点选的行回顶,Code 视图切换清零
- [x] app.tsx payloadField:空 {} 占位跳到下一个拼写,修复工具调用 Input 预览空白
- [x] 契约/单元测试 + 全量校验(test/typecheck/build/docs) + CDP 真实进程验证 + 文档同步 + commit/push

## 完成标准

- [x] code: 实现、迁移和文档均已完成，不保留双轨逻辑
- [x] linter_result: `corepack pnpm lint` 退出码为 0
- [x] unit_test_result: 新增边界测试通过，关键包覆盖率不低于 90%
- [x] func_test_result: 对应场景完成真实进程验证
- [x] status: 状态、剩余风险和回滚方式已记录

## 风险与回滚

- 风险:围栏判定的 Markdown 信号(有序列表 `1.` 、行内 `**` 指数、bash `> file` 重定向)理论上可能与代码形态重叠;已用 bash/python 排除 `#` 注释并保留 json/diff/xml 无条件围栏兜底,单测覆盖四类守卫用例。滚动备忘在极端时序(同帧提交+滚动事件)下可能恢复到钳制后的值——浏览器钳制保证不出界,最坏是位置略偏。`payloadField` 只放宽(truthy 空 `{}` 现在会跳过),不改变非空行为。
- 回滚:`git revert <commit>`;纯前端展示与滚动逻辑,无数据迁移、无持久化状态变更。

## 进度日志

- 2026-11-22 15:25:22 创建（planing）
- 2026-11-22 15:25:46 完成 #1 contentToMarkdown:关键词围栏仅限以代码为主的内容,带块级 Markdown 结构的文档渲染为文档(shell/Python 的 # 注释不算文档证据)
- 2026-11-22 15:25:46 完成 #2 payload-overlay:两个窗格的滚动位置在跟随推进时保留(onScroll 备忘 + 提交后恢复),读者点选的行回顶,Code 视图切换清零
- 2026-11-22 15:25:46 完成 #3 app.tsx payloadField:空 {} 占位跳到下一个拼写,修复工具调用 Input 预览空白
- 2026-11-22 15:25:46 contentToMarkdown 文档判定 + objectToMarkdown 共用;overlay 两窗格滚动备忘(跟随保留/点选回顶/Code 清零);payloadField 空占位修复。均经单测与真实消息验证
- 2026-11-22 15:27:36 完成 #4 契约/单元测试 + 全量校验(test/typecheck/build/docs) + CDP 真实进程验证 + 文档同步 + commit/push
- 2026-11-22 15:27:36 test 864/864 + typecheck + site tsc + build + build:docs + diff-check 全绿;CDP 真实进程验证(真实 7.9KB reasoning 消息渲染为文档、无横向溢出、跟随推进 scrollTop 140 保留、点选回顶);AGENTS/conventions/user-manual 中英文同步;commit a3393a7 + push + PR#23 正文同步
- 2026-11-22 15:27:51 完成 #5 code: 实现、迁移和文档均已完成，不保留双轨逻辑
- 2026-11-22 15:27:51 contentToMarkdown 单一判定被 objectToMarkdown 共用;滚动备忘在 payload-overlay.tsx 单处;payloadField 单处;AGENTS/conventions/user-manual 中英文四份同步,无双轨
- 2026-11-22 15:27:51 完成 #6 linter_result: `corepack pnpm lint` 退出码为 0
- 2026-11-22 15:27:51 tsc --noEmit 退出 0;site tsc 退出 0;git diff --check 干净(仓库无独立 lint 脚本,按 AGENTS.md 以此为准)
- 2026-11-22 15:27:51 完成 #7 unit_test_result: 新增边界测试通过，关键包覆盖率不低于 90%
- 2026-11-22 15:27:51 pnpm test 864/864 全绿,新增边界用例:文档不围栏/短代码串围栏/shell-python 注释守卫/文档引用命令守卫/通用视图共用判定/滚动保持契约/空占位契约
- 2026-11-22 15:27:51 完成 #8 func_test_result: 对应场景完成真实进程验证
- 2026-11-22 15:27:51 scratch ASTRO_HOME + 注入真实捕获事件 + headless CDP:markdownRendered/noHorizOverflow/phase2Arrived/scrollPreserved/pickResetsTop 全 true,3 张截图核验
- 2026-11-22 15:27:52 完成 #9 status: 状态、剩余风险和回滚方式已记录
- 2026-11-22 15:27:52 剩余风险:Markdown 信号与罕见代码形态(行内指数/重定向)理论上重叠,已用守卫用例与 json/diff/xml 无条件围栏兜底;回滚 git revert a3393a7,纯前端展示逻辑
- 2026-11-22 15:27:52 归档：任务与完成标准全部满足
