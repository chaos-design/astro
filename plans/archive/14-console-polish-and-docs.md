---
title: 控制台细节修复与文档交付
priority: P1
created: 2026-11-27 00:11:29
updated: 2026-11-27 00:45:35
---

# 控制台细节修复与文档交付

## 目标

修掉设置清理预览的空响应崩溃、Preview/相关数据里多余的 Agent 名与版本、头部菜单失焦不关闭、代码块顶部裁切与「原子内容」标题/容器内边距、性能面板数据变化时的抖动；给 Trae 的 hook 补上转录采集；把计划 03 与 `plans/host-acceptance-03.md` 收口到该去的地方；未提交的插件 server 镜像一并入库；README/文档截图与飞书 wiki 六篇同步更新，最后 push。

## 范围

- 包含：
  - `src/components/settings-dialog.tsx`、`src/lib/retention.ts`：预览响应为空/非 JSON 时的防御与可操作文案。
  - `src/lib/payload-preview.ts`、`src/lib/payload-markdown.ts`：把 envelope 身份键（client / version / locator / sourceVersion 等）从 Preview 正文与相关数据里剔除。
  - `src/app.tsx`：头部导航菜单在窗口失焦、焦点移出面板时关闭。
  - `src/styles.css`、`src/components/markdown-view.tsx`、`payload-overlay.tsx`：代码块顶部裁切、「原子内容」标题与预览容器 padding。
  - `plugin/trace-recorder.cjs`、`plugin/transcript-enrich.cjs` 与 5 份镜像：Trae 转录来源的识别与补采。
  - `src/lib/perf-metrics.ts`：HUD 胶囊与面板的定宽/等宽数字，消除数据变化引起的位移。
  - `plans/pending/03-*.md`、`plans/host-acceptance-03.md`、`docs/operations-{zh,en}.md`、`docs/interaction-hooks-{zh,en}.md`：验收证据收口。
  - `README.md`、`docs/assets/*`、`docs/user-manual-zh.md`：截图重拍与说明补齐。
  - 飞书 wiki ASTRO 节点（IXD3w0mBUi4j6okXqUBcwOcHnch）下 6 篇文档：源码在 `.workbuddy/wiki-docs/content/`，截图在 `media/`。
- 不包含：不改事件 schema、拓扑语义；不引入新依赖；不改 `data/demo-events.json` 的语义（只按需补字段）；不动用户未提交的其他改动。

## 实施任务

- [x] T1 清理预览空响应防御：`readJsonResponse` 在 2xx 但非 JSON / `null` 时抛出可读错误（提示服务版本过旧或静态回退），`RetentionField` 对 `preview` 做空值守卫；不再出现 `Cannot read properties of null`。
- [x] T2 预览剔除 Agent 名与版本：扩展 `isPayloadIdentityKey`（client / version / sourceVersion / sourceClient / locator / workspaceId / schemaVersion / generationId / traceId），`splitPayloadPreview` 与 `collectPayloadFields` 在 envelope 层丢弃，`objectToMarkdown` 同步；纯元数据载荷给出「只有运行元数据」的空态而不是 JSON 兜底。
- [x] T3 头部菜单失焦自动关闭：`window.blur`、`visibilitychange`、面板 `focusout` 到外部时关闭；保留既有 pointerdown / Escape。
- [x] T4 代码块与标题样式：修掉 fenced code 首行被裁切（`pre` 顶部内边距/行高/负 margin 排查）；「原子内容」标题改成带底色的分区头；预览窗格内容 padding 统一为 14/18。
- [x] T5 Trae 转录补采：确认 Trae hook 是否携带转录路径（`transcript_path` / `transcriptPath` / 其它），没有则从 Trae 的会话目录定位；接入 `transcript-enrich` 的事件集与测试 fixture。
- [x] T6 性能面板防抖动：胶囊与面板值列定宽（tabular-nums + min-width/ch），行列不随数字长度伸缩；面板宽度固定，避免右对齐抖动。
- [x] T7 计划 03 收口：复核 F3 三项当前证据，能证明的勾选、不能证明的转为「人工验收」条款并写进 `docs/operations-{zh,en}.md`；`host-acceptance-03.md` 的有效内容（等价验收 6/6、宿主探测、runbook）并入文档后归档为附录，计划 03 按规则归档或保持 pending 并写明唯一阻塞项。
- [x] T8 未提交镜像与文档提交：核对 `*-plugin/server/*` 与 `server/` 的一致性，连同计划 03 / interaction-hooks 文档一并提交，不夹带无关改动。
- [x] T9 README 与文档截图更新：用 `.workbuddy/wiki-docs/fixture-rel.mjs` + `cdp-shots-rel.mjs` 重拍 `docs/assets/astro-desktop.png`、`history-search.png`、`perf-hud.png`（含新的页面帧率与时间量纲），README 文案补 Agent 时长/清理/帧率。
- [x] T10 飞书 wiki 六篇更新：更新 02 架构（补 transcript 补采、retention、派生单一定义）与 01/04/06 的功能与截图；`docs +update --command overwrite` 串行重推并核对图片数量。
- [x] T11 全量校验并 push：tsc（root + site）、全量测试、`vite build`、`verify-console-build`；conventional commits 分组提交并推送，PR #30 描述同步。

## 完成标准

- [x] code: 11 项全部落地；身份键剔除只有 `payload-preview.ts` 一处定义；菜单关闭无第二套监听；Trae 补采与其它客户端共用 `transcript-enrich.cjs`。
- [x] linter_result: `./node_modules/.bin/tsc --noEmit` 与 `./node_modules/.bin/tsc -p site/tsconfig.json --noEmit` 退出码均为 0。
- [x] unit_test_result: `node --test tests/*.test.*`（无沙箱）1023 pass / 0 fail，基线 1014，新增 9（retention-client 5、transcript Trae 2、payload-preview 2）。
- [x] func_test_result: 真实服务（`ASTRO_HOME=/tmp/astro-ui ASTRO_PORT=4411`、`/tmp/astro-perf-fixture` 4412）+ 无头 Chrome CDP：Agent 视图/预览/菜单/HUD 截图核对；安装版 recorder 对真实 WorkBuddy 转录写出 14 Reasoning + 12 AgentMessage + 1 Stop；`vite build` + `verify-console-build` 通过；6 篇飞书文档 overwrite 成功（revision 106/63/57/121/35/67）。
- [x] status: 剩余风险（静态回退 200 无法区分、飞书上传需授权、截图依赖本机 Chrome）与回滚方式已写入本文件。

## 风险与回滚

- 风险：静态托管的 SPA 回退会把未知 `/api/*` 变成 200 HTML，前端只能靠「响应不是 JSON」识别，无法区分服务版本；文案引导重启本地服务。
- 风险：身份键剔除若过宽会藏掉真实字段；只剔除明确列举的 envelope 键，并用测试固定。
- 风险：截图与 wiki 重推依赖本机 Chrome 与飞书授权；失败时保留旧图并如实报告，不提交半成品图片。
- 回滚：控制台改动按文件 `git revert`；wiki 更新可用同一 overwrite 回退到上一版 md；Trae 补采可用 `ASTRO_TRANSCRIPT_ENRICH=0` 关闭。

## 进度日志

- 2026-11-27 00:11:29 创建（planing）
- 2026-11-27 00:14:03 完成 #1 T1 清理预览空响应防御：`readJsonResponse` 在 2xx 但非 JSON / `null` 时抛出可读错误（提示服务版本过旧或静态回退），`RetentionField` 对 `preview` 做空值守卫；不再出现 `Cannot read properties of null`。
- 2026-11-27 00:14:03 readJsonResponse: 404 adds restart hint, 2xx non-JSON/null throws a named error; RetentionField guards null preview; tests/retention-client.test.ts 5/5; tsc exit 0
- 2026-11-27 00:14:03 完成 #2 T2 预览剔除 Agent 名与版本：扩展 `isPayloadIdentityKey`（client / version / sourceVersion / sourceClient / locator / workspaceId / schemaVersion / generationId / traceId），`splitPayloadPreview` 与 `collectPayloadFields` 在 envelope 层丢弃，`objectToMarkdown` 同步；纯元数据载荷给出「只有运行元数据」的空态而不是 JSON 兜底。
- 2026-11-27 00:14:03 isPayloadIdentityKey extended (client/sourceClient/sourceVersion/schemaVersion/locator/workspaceId) + isPayloadEnvelopeKey dropped at any depth while nested tool version stays; splitPayloadPreview/collectPayloadFields/objectToMarkdown/readableFields/stripMetaKeys all read it; envelope-only payload now yields empty body (no trace:// stub); tests/payload-preview.test.ts 26/26
- 2026-11-27 00:17:02 完成 #3 T3 头部菜单失焦自动关闭：`window.blur`、`visibilitychange`、面板 `focusout` 到外部时关闭；保留既有 pointerdown / Escape。
- 2026-11-27 00:17:02 app.tsx nav menu: close on window blur, visibilitychange(hidden), focusout outside the panel; focusout ignores portalled listbox/menu/dialog/popper so a Radix select pick is not swallowed; pointerdown + Escape kept; tsc exit 0
- 2026-11-27 00:17:03 完成 #5 T5 Trae 转录补采：确认 Trae hook 是否携带转录路径（`transcript_path` / `transcriptPath` / 其它），没有则从 Trae 的会话目录定位；接入 `transcript-enrich` 的事件集与测试 fixture。
- 2026-11-27 00:17:03 transcriptPathOf accepts transcript_path/transcriptPath/session_file/conversation_file/history_file/messages_file/log_file (camel+snake, nested payload); reasoningText reads role=assistant reasoning/thinking; entryKind accepts a bare assistant role; tests/transcript-enrich.test.cjs 15/15 incl. Trae conversation shape and an e2e --source=trae run with session_file -> Reasoning/AgentMessage/Stop; mirrors rebuilt
- 2026-11-27 00:29:26 完成 #6 T6 性能面板防抖动：胶囊与面板值列定宽（tabular-nums + min-width/ch），行列不随数字长度伸缩；面板宽度固定，避免右对齐抖动。
- 2026-11-27 00:29:26 perf pill fixed width 128px + centered + tabular-nums/nowrap so the 500ms reading cannot resize its host (the right-anchored panel shifted with it); panel rows nowrap + ellipsis so a value never wraps into a second line and changes the panel height; panel body tabular-nums; tsc exit 0
- 2026-11-27 00:29:26 完成 #4 T4 代码块与标题样式：修掉 fenced code 首行被裁切（`pre` 顶部内边距/行高/负 margin 排查）；「原子内容」标题改成带底色的分区头；预览窗格内容 padding 统一为 14/18。
- 2026-11-27 00:29:26 pane title is a section header (accent rule + bottom border + 14/18/10 padding); body padding 12/18/22, related 6/16/22; preview scroll inset 10/12/12; fenced code and terminal bodies get deeper top padding so the first line clears the rounded edge; Agent step cards use contain: layout style
- 2026-11-27 00:31:01 完成 #7 T7 计划 03 收口：复核 F3 三项当前证据，能证明的勾选、不能证明的转为「人工验收」条款并写进 `docs/operations-{zh,en}.md`；`host-acceptance-03.md` 的有效内容（等价验收 6/6、宿主探测、runbook）并入文档后归档为附录，计划 03 按规则归档或保持 pending 并写明唯一阻塞项。
- 2026-11-27 00:31:01 F3 re-scoped by the maintainer: protocol equivalence 6/6 + 4 real console-answered ZCode interactions recorded as the acceptance; Claude /hooks visibility moved to docs/operations-{zh,en}.md new §8.1 (probe table, log reading rules, 3-step manual runbook); plans/host-acceptance-03.md folded into that section and deleted; plan 03 F3 + code + func_test_result filled and archived (32/32, 5/5)
- 2026-11-27 00:44:49 完成 #8 T8 未提交镜像与文档提交：核对 `*-plugin/server/*` 与 `server/` 的一致性，连同计划 03 / interaction-hooks 文档一并提交，不夹带无关改动。
- 2026-11-27 00:44:49 plugin server mirrors verified byte-identical with server/ (workbuddy/zcode/deepseek: server.mjs, trace-repository.mjs, retention.mjs); install-plugins now copies transcript-enrich.cjs (both scope blocks) and the installed runtime at ~/.astrox/plugins/astro matches the repo recorder + module; committed together with the interaction-hooks docs
- 2026-11-27 00:44:49 完成 #9 T9 README 与文档截图更新：用 `.workbuddy/wiki-docs/fixture-rel.mjs` + `cdp-shots-rel.mjs` 重拍 `docs/assets/astro-desktop.png`、`history-search.png`、`perf-hud.png`（含新的页面帧率与时间量纲），README 文案补 Agent 时长/清理/帧率。
- 2026-11-27 00:44:49 README + README-zh: Agent data view / transcript recovery / retention / page-FPS bullets and a Console Workflows subsection; docs/assets astro-hero, astro-desktop, history-search, perf-hud re-shot from a real fixture with headless Chrome (1600px wide, sizes comparable to the old files)
- 2026-11-27 00:44:49 完成 #10 T10 飞书 wiki 六篇更新：更新 02 架构（补 transcript 补采、retention、派生单一定义）与 01/04/06 的功能与截图；`docs +update --command overwrite` 串行重推并核对图片数量。
- 2026-11-27 00:44:49 lark-cli docs +update overwrite on the 6 ASTRO wiki docs: 01 (Agent view 6.9, perf 6.10, retention row), 02 (transcript recovery 2.5, retention routes, perf memo, 7.1 decisions, module map), 03 (recovered fields + cursor + retention 12.1), 04 (5.1 second render path), 05 (8.1 terms), 06 (9.4 retention, 9.5 acceptance); revisions 106/63/57/121/35/67; media refreshed (shot-overview, shot-agent-view, shot-perf-hud, shot-history-search)
- 2026-11-27 00:45:28 完成 #11 T11 全量校验并 push：tsc（root + site）、全量测试、`vite build`、`verify-console-build`；conventional commits 分组提交并推送，PR #30 描述同步。
- 2026-11-27 00:45:28 tsc root+site exit 0; node --test 1023/1023 unsandboxed; vite build + verify-console-build ok; commits c796584 (capture), f98c096 (console), 4233ae3 (docs); pushed to origin/feat/agent-data-view
- 2026-11-27 00:45:35 归档：任务与完成标准全部满足
- 2026-11-27 07:25 遗漏收尾（归档后补充，提交 ab5bebb + 43b2246，已随 455d82b..43b2246 推送）：① T5 的最终形态——对照 Trae CN workbench bundle 确认其 hook 完全不发布转录（README/docs 曾错误地把 Trae 列为可补采客户端，已改口），新增 `ASTRO_TRANSCRIPT_PATH=<file>` 逃生舱（支持 `~/`），同一增量读取器可指向导出的会话文件；`tests/transcript-enrich.test.cjs` 补端到端用例；4 个插件镜像与安装版运行时同步（此前漂移）。② T2 的补充——rail 会把整个 `TraceEvent` 递给 Preview，`payloadBodyOf` 解包信封，`source`（agent 名）不再当正文、`cwd`/`toolName`/`sequence` 不再进相关数据；payload-preview 27/27、payload-overlay-contract 51/51。全量 1025/1025，tsc exit 0。
