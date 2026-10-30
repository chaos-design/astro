# ASTRO 项目约定与执行规则

> 读者：仓库贡献者与在本仓库工作的编码智能体。
>
> 本文是根目录 `AGENTS.md` 的可读版本：`AGENTS.md` 面向智能体，逐条写死不变量；
> 本文解释这些规则的来由与落地位置。两者冲突时以 `AGENTS.md` 为准，并应同步修正
> 本文。

## 1. 适用范围

- 适用于整个仓库：前端 `src/`、服务端 `server/`、采集与适配 `plugin/`、各客户端
  便携插件目录、脚本 `scripts/`、测试 `tests/`、文档 `docs/` 与文档站 `site/`。
- 规则只描述“必须怎样”，不描述“曾经怎样”。历史原因写在注释与文档的说明段落里，
  不写进规则条目。

## 2. 目录职责

| 目录 | 职责 | 不要放什么 |
| --- | --- | --- |
| `src/` | React 控制台、领域投影、配置、UI 组件 | 采集逻辑、文件系统访问 |
| `server/` | HTTP、SSE、静态托管、JSONL 仓储 | 前端展示逻辑 |
| `plugin/` | 规范录制器、适配器、存储路径、浏览器客户端 | 具体客户端的 Hook 清单 |
| `*-plugin/` | 各客户端的可移植插件包 | 跨客户端共享逻辑 |
| `scripts/` | 安装、迁移、校验、打包 | 运行时依赖 |
| `tests/` | Node 测试运行器套件 | 手工验收记录 |
| `docs/` | 中英成对的使用、协议、架构、运维与约定文档 | 生成物 |
| `site/` | 文档站（读取 `docs/*.md`） | 文档正文副本 |

## 3. 分支、提交与 PR

- 新功能从 `origin/main` 切独立分支，不在他人尚未合并的分支上追加无关改动。
- 提交信息用 conventional 前缀：`feat(console):`、`fix(console):`、`docs:`、
  `test:`、`chore(plugins):`。
- PR 描述使用 `## 变更点 / ## 验证 / ## 备注` 三段；「验证」必须写出实际执行过的
  命令，而不是“已测试”。
- 不提交 `dist/`、`.astrox` 数据目录、临时截图与本机路径。
- 工作区里与本次改动无关的修改视为用户所有，不回滚、不夹带提交。

## 4. 代码约定

- TypeScript strict；前端文件名小写下划线连字符，函数名小驼峰。
- 原始 `TraceEvent` 不可变。状态、时长、拓扑、轨迹一律在读取/渲染时派生，不得
  回写或补造事件。
- 单一职责的单一定义：
  - 异常与错误判定只在 `src/lib/exception-events.ts`；
  - RUN HISTORY 的 live 判定只在 `src/lib/run-history-state.ts`（`isLiveRunStatus`
    + `isFreshLiveRun` + `collectLiveRunKeys`）；
  - 时间窗口计算只在 `src/lib/run-history-window.ts`。
  新增消费方必须复用这些函数，不得再写一份“失败事件名单”或“live 名单”。
- 平台相关的映射放到 `src/config/atom-platforms.ts` 或对应适配器，领域工具函数
  保持平台无关。
- 界面动作优先使用 Lucide 图标；品牌图标（如 GitHub）以内联 SVG 组件提供，不额外
  引入依赖。

## 5. 时间窗口（本次约定）

- 窗口单位是**小时**，不是自然日：`最近 3 小时` 在 09:00 与 23:00 表示同一个跨度，
  跨午夜不会突然变长或变空。
- 窗口长度来自设置项 `默认时间范围`（`3h` / `6h` / `12h` / `24h` / `7d`，默认
  `3h`），运行时用 `getHistoryRangeHours()` 换算。
- 窗口**终点是最近一条消息的时间**，不是 `Date.now()`。隔夜或长时间空闲后打开
  控制台，看到的仍是上次会话前后的消息。
- 正在执行的消息不受窗口限制：`selectVisibleRunHistory` 接收 `liveKeys` 作为窗口
  豁免集合。
- 加载更早的消息用**翻倍**而不是逐日推进：3 → 6 → 12 → 24 → 48 小时，直到
  `canLoadMoreRunHistory` 为 false。
- 切换智能体或修改默认范围时，窗口宽度回到设置的默认值。

## 6. Live 视图（本次约定）

- 面板头部的 `N LIVE` 胶囊既是计数也是开关，状态持久化在
  `ASTROX_RUN_HISTORY_LIVE_FILTER`，默认开启。
- 开启时列表是**所选智能体的全部消息**：忽略时间窗口，正在执行的消息置顶
  （`pinLiveRunHistory`）、自动展开、滚动定位；此时不提供 `LOAD EARLIER`。
- 关闭时回到默认时间窗口。
- 一个新 key 进入 live 集合即代表“刚发出一条消息”：`RunHistory` 用上一次的 live
  集合做差集，命中时自动定位。该比较保存在 ref，不进入 state，避免每个事件批次
  多一次渲染。
- 计数、置顶、窗口豁免、自动定位必须来自同一个 `liveSessionKeys`；出现“行被置顶
  但没被计数”这类现象就是 bug。
- 其它智能体的 live 消息仍然进入列表（`historySessions` 会补进来），下拉框只收窄
  已完成的历史，不允许隐藏正在执行的消息。

## 7. 设置与本地偏好

- 设置弹窗只承载浏览器本地偏好，立即生效，不经过服务端，不需要“应用”按钮。
- 键名统一 `ASTROX_` 前缀，集中在 `src/config/app-config.ts` 的 `storageKeys`。
- 非法值必须回退到 `appDefaults`，不能让损坏的 localStorage 阻止页面渲染。
- 新增偏好要同步：`storageKeys`、`appDefaults`、设置弹窗、`docs/user-manual-*.md`
  的 §15.1 表格，以及 `tests/app-config.test.ts`。

## 8. 顶栏控件

- GitHub 入口是一个锚点（`<a>`），地址来自 `appRepository.url`，新标签页打开，
  带 `rel="noreferrer noopener"`。不要在组件里硬编码 URL。
- 图标按钮统一 28 px（`size="console-icon"`），与主题切换器同高同圆角；新增控件
  放在主题切换器左侧，窄屏下不进入折叠菜单。
- 每个图标按钮都要有 `aria-label` 与 tooltip，说明动作而不是图标形状。

## 9. 文档同步

- 文档成对发布：`<name>-zh.md` / `<name>-en.md`；文档站按后缀自动配对语言切换。
- 行为变化必须同步四处：
  1. `docs/user-manual-*.md`（使用者可见的变化）；
  2. `docs/conventions-*.md`（本文，规则层面的变化）；
  3. `AGENTS.md`（智能体执行时读到的不变量）；
  4. `docs/index.md` 与 `site/src/docs.ts`（目录与阅读顺序）。
- 文档描述当前行为，不承诺未实现的能力；规划项必须显式标注。
- 引用界面文案时使用界面里的原文（中英文各自对应），不要自行翻译键名。

## 10. 验证清单

提交前至少执行：

```bash
pnpm typecheck                                  # tsc --noEmit
./node_modules/.bin/tsc -p site/tsconfig.json --noEmit   # 文档站单独 typecheck
pnpm build
pnpm build:docs
pnpm test
```

界面改动另外用独立数据根验证，避免真实历史拖慢浏览器：

```bash
ASTRO_HOME=/tmp/astro-check ASTRO_PORT=4401 node server/server.mjs
```

- 目录结构为 `<source>/YYYY/MM-DD/HH_MM_SS-<session>/events.jsonl`。
- 至少覆盖三种数据：窗口内的已完成消息、窗口外的旧消息、正在执行的消息；再验证
  一次 `POST /api/events` 触发新 Prompt 后的自动定位。

## 11. 常见错误

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `N LIVE` 少了一条正在执行的消息 | live 集合按智能体收窄了 | 从全量 session 派生 `liveSessionKeys` |
| 行显示 RUNNING 但不在 `N LIVE` 里 | 展示状态绕过了 `isFreshLiveRun` | 统一走 `getRunDisplayState` |
| 隔夜打开列表是空的 | 窗口以 `now` 为终点 | 用 `getRunHistoryAnchorTime` 锚定最近消息 |
| 新消息发出后要手动翻找 | Live 视图没有做 live 集合差集 | 见 §6 的自动定位 |
| 设置改了但列表没变 | 窗口宽度没随范围重置 | `runHistoryHours` 跟随 `historyRangeHours` |
