---
title: Payload overlay atom rail
priority: P2
created: 2026-11-21 00:52:43
updated: 2026-11-21 01:09:48
---

# Payload overlay atom rail

## 目标

放大弹窗（`PayloadOverlay`）增加左侧「当前运行全部消息原子」列表，点选即同步主控制台选中态；弹窗放大。改完 git commit。

用户确认的三项决策：
1. 列表范围 = 当前运行的全部原子（trajectory / LOG 里的那些消息原子，取 `harnessFlow.nodes`）。
2. 切换行为 = 同步切换，保持单一选中态（复用 app.tsx 的选中 handler，不产生第二份弹窗状态）。
3. 结尾「提交」= git commit。

## 范围

- 包含：`app.tsx` 中由 `harnessFlow.nodes` 构造原子列表数据；抽取无切换的原子选中提交函数供画布与弹窗共用；三个 props 经 `TraceInspector` 透传到 `PayloadOverlay`；弹窗内左侧原子列表（序号 / 标签 / kind / 状态点 / 选中高亮）与空列表降级；`.payload-overlay` 尺寸放大并容纳左栏；契约测试与用户手册 / 约定文档同步；验证后 git commit。
- 不包含：不改 `selectedEventId` / `selectedAtomId` 之外的任何持久化状态；不新增文档页（故 `docs/index.md` 与 `site/src/docs.ts` 不动）；不改 recorder / server / 插件；不改 payload 内容转换链（`payload-markdown` / `markdown-preview`）。

## 实施任务

- [x] 在 app.tsx 构造当前运行的原子列表数据并抽取可复用的无切换原子选中 handler（单一选中态）
- [x] 把 atoms / selectedAtomId / onSelectAtom 三个 props 从 app.tsx 经 TraceInspector 传到 PayloadOverlay
- [x] PayloadOverlay 渲染左侧原子列表（序号、标签、kind、状态点、选中高亮），点击调用 onSelectAtom；空列表降级
- [x] 放大 .payload-overlay 尺寸（宽度容纳列表），处理窄屏与仅内容滚动的布局
- [x] 更新 tests/payload-overlay-contract.test.ts 与文档（user-manual-zh/en、conventions-zh/en、AGENTS.md）
- [x] 运行 pnpm test / pnpm typecheck / pnpm build 验证，git diff --check，git commit（含 pr-update skill）

## 完成标准

- [x] code: 实现、契约测试与文档一致，无双轨选中态、无模板占位符残留。
- [x] linter_result: `./node_modules/.bin/tsc --noEmit` 与 `./node_modules/.bin/tsc -p site/tsconfig.json --noEmit` 退出码均为 0。
- [x] unit_test_result: `node --test tests/*.test.*` 全绿；`payload-overlay-contract.test.ts` 新增列表/同步断言通过。
- [x] func_test_result: `pnpm build` 成功；`git diff --check` 干净；commit 成功。
- [x] status: 剩余风险与回滚方式已写入正文。

## 风险与回滚

- 风险：弹窗从「随选中态单向跟随」变为「列表驱动同一选中态」，若 onSelectAtom 重新实现选中逻辑会与画布 / LOG 错位。缓解：抽取单一 `commitAtomSelection`，画布与弹窗共用。
- 风险：弹窗放大 + 左栏挤压内容宽度；窄屏下布局溢出。缓解：宽度用 `min()` 上限并加窄屏媒体查询收窄左栏 / 单列降级。
- 风险：契约测试逐字断言 `<PayloadOverlay>` 绑定方式，新增 props 可能破坏。缓解：保留原有 payload/variant 绑定不动，只追加 props。
- 回滚：`git revert <commit>` 即可完整还原（无数据迁移、无持久化状态变更）。

## 进度日志

- 2026-11-21 00:52:43 创建（planing）
- 2026-11-21 01:01:52 完成 #1 在 app.tsx 构造当前运行的原子列表数据并抽取可复用的无切换原子选中 handler（单一选中态）
- 2026-11-21 01:01:52 app.tsx: 新增 overlayAtoms useMemo（由 harnessFlow.nodes 映射显示字段）；抽取 commitAtomSelection 单一提交点；handleCanvasSelectNode 与 handleOverlaySelectAtom 共用；移除不再使用的 toggleAtomSelection import。
- 2026-11-21 01:02:38 完成 #2 把 atoms / selectedAtomId / onSelectAtom 三个 props 从 app.tsx 经 TraceInspector 传到 PayloadOverlay
- 2026-11-21 01:02:38 app.tsx: 导入 PayloadOverlayAtom 类型；TraceInspector 增加 overlayAtoms / overlaySelectedAtomId / onOverlaySelectAtom 三个 props 并在两处透传；PayloadOverlay props 签名新增对应类型。
- 2026-11-21 01:04:26 完成 #3 PayloadOverlay 渲染左侧原子列表（序号、标签、kind、状态点、选中高亮），点击调用 onSelectAtom；空列表降级
- 2026-11-21 01:04:26 payload-overlay.tsx: 导出 PayloadOverlayAtom 类型；新增 atoms/selectedAtomId/onSelectAtom props；渲染左侧 atom 列表（序号 padStart(2)、label、key、status 点、选中高亮、aria-current），空列表不渲染 rail；内容区包在 .payload-overlay__content 内。
- 2026-11-21 01:04:58 完成 #4 放大 .payload-overlay 尺寸（宽度容纳列表），处理窄屏与仅内容滚动的布局
- 2026-11-21 01:04:58 styles.css: .payload-overlay 放大到 min(1440px,100vw-64px) × min(920px,100dvh-48px)；新增 __main/__rail/__atom-list/__atom/__seq/__copy/__key/__dot 与 __content；状态点取 status 色；900/620px 断点收窄 rail。
- 2026-11-21 01:05:45 完成 #5 更新 tests/payload-overlay-contract.test.ts 与文档（user-manual-zh/en、conventions-zh/en、AGENTS.md）
- 2026-11-21 01:05:45 更新 tests/payload-overlay-contract.test.ts 新增 3 个测试（rail 渲染 / props 透传 / 单一提交点）；同步 docs/user-manual-zh.md、user-manual-en.md、conventions-zh.md、conventions-en.md 与仓库 AGENTS.md；docs/index.md 与 site/src/docs.ts 因未新增文档页保持不变。
- 2026-11-21 01:08:51 完成 #7 code: 实现、契约测试与文档一致，无双轨选中态、无模板占位符残留。
- 2026-11-21 01:08:51 完成 #8 linter_result: `./node_modules/.bin/tsc --noEmit` 与 `./node_modules/.bin/tsc -p site/tsconfig.json --noEmit` 退出码均为 0。
- 2026-11-21 01:08:51 完成 #9 unit_test_result: `node --test tests/*.test.*` 全绿；`payload-overlay-contract.test.ts` 新增列表/同步断言通过。
- 2026-11-21 01:08:51 完成 #11 status: 剩余风险与回滚方式已写入正文。
- 2026-11-21 01:08:51 code: 9 个文件改动一致，无占位符、无第二份选中态（commitAtomSelection 单一提交点）。 linter_result: tsc --noEmit 退出 0；tsc -p site/tsconfig.json --noEmit 退出 0（SITE-TSC-OK）。 unit_test_result: pnpm test 806/806 通过，payload-overlay-contract.test.ts 新增 3 个断言全过。 status: 剩余风险（rail 挤压内容宽度、契约测试逐字绑定）与 git revert 回滚方式已写入 风险与回滚。
- 2026-11-21 01:09:42 完成 #6 运行 pnpm test / pnpm typecheck / pnpm build 验证，git diff --check，git commit（含 pr-update skill）
- 2026-11-21 01:09:42 完成 #10 func_test_result: `pnpm build` 成功；`git diff --check` 干净；commit 成功。
- 2026-11-21 01:09:42 func_test_result: pnpm build 成功（vite 8.2.2 构建完成）；git diff --check 干净；git commit c28d065 成功；pr-update 同步 PR #23 body（title 保持）。任务6: 806/806 测试、两份 tsc 退出 0、commit + pr-update 全部完成。
- 2026-11-21 01:09:48 归档：任务与完成标准全部满足
