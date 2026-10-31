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
- 窗口长度来自设置项 `默认时间范围`（`1h` / `3h` / `6h` / `12h` / `1d` / `3d` /
  `5d` / `7d`，默认 `3h`；设置弹窗小时一行、天一行），运行时用
  `getHistoryRangeHours()` 换算。新增选项同时要补 `HistoryTimeRange` 的时长表，
  否则历史搜索的初始范围会退回自定义区间。
- 窗口**终点是最近一条消息的时间**，不是 `Date.now()`。隔夜或长时间空闲后打开
  控制台，看到的仍是上次会话前后的消息。
- 正在执行的消息不受窗口限制：`selectVisibleRunHistory` 接收 `liveKeys` 作为窗口
  豁免集合。
- 加载更早的消息用**翻倍**而不是逐日推进：3 → 6 → 12 → 24 → 48 小时，直到
  `canLoadMoreRunHistory` 为 false。
- 切换智能体或修改默认范围时，窗口宽度回到设置的默认值。
- **智能体筛选只列智能体**：RUN HISTORY 的下拉与全局搜索的 Agent 筛选都只包含
  `agentOptions` 里的已配置智能体，其余来源（browser、generic、自定义 HTTP 采集器）
  统一落到末尾的 `Others`（`OTHERS_AGENT_ID` / `matchesAgentSourceFilter`）。旧实现
  会把数据里出现的每个来源都变成一项伪智能体，列表随采集器数量增长且真假难辨。
- 展开的 Prompt 子列表**按内容测量高度**（`ResizeObserver`，上限 300 px，越界不超过
  1/4 时完整展开）：固定“行数 × 估算高度”会裁掉换行标题的最后一行，两条消息的线程
  反而出现滚动条。

## 6. Live 筛选（本次约定）

- 面板头部的 `N LIVE` 胶囊既是计数也是开关，状态持久化在
  `ASTROX_RUN_HISTORY_LIVE_VIEW`，默认**关闭**（设置弹窗里可改默认值）。旧的
  `ASTROX_RUN_HISTORY_LIVE_FILTER` 含义相反，不迁移，写入新键时删除。
- 开启与关闭必须一眼可分，且方向是「未选中浅、选中深」：选中时胶囊为深色实心
  （`--status-running` 26% 混入页面底色、浅紫文字、外加柔和光晕），未选中是浅色
  描边幽灵态；雷达图标**两种状态都保留**，由胶囊颜色决定它的颜色。同时标题第二行
  从 `N runs` 换成「全部历史」标签，说明筛选不套时间窗口。别把选中态做成“再深一点的
  同色底”，也别做成整块高亮实心——深色主题里那会变成面板里最亮的东西，和“选中更重”
  的直觉相反。
- 开启时列表是**筛选结果**：只显示正在执行的消息（`selectLiveRunHistory`）。
  筛选池是所选智能体的**全部历史**（忽略时间窗口，几天前开始、刚被追问的会话也
  在内），但已完成的消息不列出。执行中的消息置顶、自动展开、滚动定位；此时不提供
  `LOAD EARLIER`。
- 0 条 live 时列表为空，显示「当前没有正在执行的消息」+ 退出方式。不得回退到完整
  历史，也不得自动关闭开关：匹配不到就改成显示全部，那就不是筛选。默认关闭正是为了
  避免打开控制台看到空面板。
- 关闭时回到默认时间窗口。
- 一个新 key 进入 live 集合即代表“刚发出一条消息”：`RunHistory` 用上一次的 live
  集合做差集，命中时自动定位。该比较保存在 ref，不进入 state，避免每个事件批次
  多一次渲染。
- 计数、置顶、自动定位必须来自同一个 `liveSessionKeys`；出现“行被置顶但没被计数”
  这类现象就是 bug。
- 其它智能体的 live 消息仍然进入筛选结果（`historySessions` 会补进来），下拉框只
  收窄已完成的历史，不允许隐藏正在执行的消息。

## 7. 设置与本地偏好

- 设置弹窗只承载浏览器本地偏好，立即生效，不经过服务端，不需要“应用”按钮。
- 弹窗是**两栏卡片**：左侧 `settings-nav` 分区栏（外观 / 运行历史 / 画布 / 面板 /
  关于），右侧 `settings-pane` 只渲染当前分区的字段；改用 `Tabs orientation="vertical"`
  取得方向键导航，不再把全部偏好叠成一列。弹窗固定 920×672（窄屏退化为上下两段），
  头部与底部固定，只有右侧面板滚动。底部的「完成」只负责关闭——没有“应用”这一步。
- 已在顶栏或工具栏有开关的偏好也要并列出来——一个能列全的入口胜过让用户去顶栏找。
  「关于」列出控制台版本、偏好实际存放位置（浏览器 localStorage、`ASTROX_` 前缀）和
  「不写回事件」的说明，避免把弹窗当成服务端配置。
- 键名统一 `ASTROX_` 前缀，集中在 `src/config/app-config.ts` 的 `storageKeys`。
- 非法值必须回退到 `appDefaults`，不能让损坏的 localStorage 阻止页面渲染。
- 新增偏好要同步：`storageKeys`、`appDefaults`、设置弹窗、`docs/user-manual-*.md`
  的 §15.1 表格，以及 `tests/app-config.test.ts`。
- 语义变化的旧键不迁移、直接退役并删除（`retiredStorageKeys`）。Live 筛选就是例子：
  旧值 `true` 表示“显示全部消息”，迁移过来会变成“开着筛选却看不到东西”。

## 8. 顶栏控件

- GitHub 入口是一个锚点（`<a>`），地址来自 `appRepository.url`，新标签页打开，
  带 `rel="noreferrer noopener"`。不要在组件里硬编码 URL。
- 图标按钮统一 28 px（`size="console-icon"`），与主题切换器同高同圆角；窄屏下不进
  入折叠菜单。
- 顺序固定：设置（齿轮）→ 主题 → GitHub。GitHub 固定在最右端，它是唯一离开控制台
  的入口；新增控件插在它左侧。
- 设置按钮用齿轮图标，不用滑杆：它配置的是 Live 筛选本身，而不是替列表做筛选。
- 运行时长胶囊展开的 `LOCAL SERVICE` 卡片分「版本 / 进程 / 数据 / 会话」四段。版本
  必须写清主体：**控制台**是当前页面构建（`appVersion`），**服务**读 `/api/health`
  的 `build`；两者不一致给出提示，`build` 为 `unknown` 时显示「未上报」并说明原因
  （服务从源码目录或缺少清单的旧安装启动），而不是甩一个 `unknown` 让用户猜。
- 每个图标按钮都要有 `aria-label` 与 tooltip，说明动作而不是图标形状。
- 列表内的滚动控件放在面板头部，不做浮层：浮动箭头会压住第一条可见原子，读者刚滚到
  的那一行反而看不全。只在对应方向还有内容时才渲染该方向的控件。

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
| 新消息发出后要手动翻找 | Live 筛选没有做 live 集合差集 | 见 §6 的自动定位 |
| Live 筛选开着但列表是空的 | 可能确实没有执行中的消息；也可能是窗口没被丢弃 | 先看 `0 LIVE`，再确认走的是 `selectLiveRunHistory`（不套时间窗口） |
| 设置改了但列表没变 | 窗口宽度没随范围重置 | `runHistoryHours` 跟随 `historyRangeHours` |
