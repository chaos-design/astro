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
| `data/` | 控制台示例数据集等本地资源文件 | 采集数据、用户偏好 |

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
  - 时间窗口计算只在 `src/lib/run-history-window.ts`；
  - 预览页「是否打开过」的状态只在 `plugin/trace-recorder.cjs`
    （`readPreviewState` / `markPreviewOpened`，持久化为 `ASTRO_HOME` 下的
    `preview-state.json`）：服务端在控制台页面接入 `/api/stream` 时打点，
    Hook 启动流程据此决定是否还需要为用户打开浏览器；
  - 运行所用模型的读取只在 `src/lib/trace-model.ts`（`extractRunModel` +
    `buildSessionPromptRuns` 的 SessionStart 回退）：各客户端的 payload 形态
    （pi 的 `model`/`provider`、deepseek 的模型对象、opencode 的 step 通知、
    zcode 的会话起始模型）在此归一成一个展示串；某条运行自身没上报模型时
    回退到会话起始模型（ZCode 只在 SessionStart 携带 model），界面只在有
    可显示值时渲染 `MODEL` 标签。
  新增消费方必须复用这些函数，不得再写一份“失败事件名单”或“live 名单”。
- 示例（Demo）数据只在 `data/demo-events.json`：服务通过 `server/demo-dataset.mjs`
  读取并由 `GET /api/demo-events` 提供，控制台只在 `src/lib/demo-events.ts` 解析。
  不要在组件、测试或服务里再写一份内联事件数组；测试需要示例会话时读取该文件。
  渲染门禁只在 `src/config/app-config.ts` 的 `isDemoGateOpen`：dev/test 自动放行，
  生产构建仅在读者显式带 `?demo=1`（`isDemoPreviewEnabled` 解析）时放行，且只在
  无捕获事件时渲染——生产页默认绝不隐式回退示例。
- 部署页面的服务地址只在 `src/lib/api-base.ts` 解析（`?api=` → `ASTROX_API_BASE` →
  同源/本机默认），请求一律走 `joinApi`；跨域边界只在服务端
  `ASTRO_CORS_ORIGINS`（默认关闭，显式允许列表，含 Private Network 预检应答），
  已安装运行时的长期配置写在 `config.yaml` 的 `server.corsOrigins`。不要在组件里
  硬编码 `/api/...`，也不要让服务默认放开 `*`。
- `public/` 下的资源一律经 `src/lib/asset-url.ts` 的 `assetUrl()` 取地址，不得写
  `/icons/...` 这类根路径：GitHub Pages 把页面挂在 `/astro/`，根路径会逃出项目
  前缀并 404（智能体下拉的品牌图标踩过）。`scripts/verify-console-build.mjs` 在
  CI 里复查构建产物没有根路径资源，并确认产物只有控制台、没有混入文档站。
- 事件流快照按 `hours` 窗口下发，并拆成 `reset`（元数据）+ 分批 `trace` + `ready`，
  不得恢复成一次 `JSON.stringify` 全量事件：单帧几百 MB 会阻塞事件循环，实时事件、
  健康检查和其它 SSE 客户端都排在它后面。窗口外的更早历史由 `truncated` 驱动
  `LOAD EARLIER` 扩大窗口重新订阅；扩大时清游标与快照键。
- 数据目录设置只经 `server/runtime-settings.mjs` 改写 `.env` 的 `ASTRO_TRACE_DIR`
  （保留其它行、拒绝不存在的相对路径），`POST /api/config/data-root` 成功后重启
  服务；不要在组件里拼接或直接写配置文件。
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
  豁免集合。该集合已经按智能体收窄，别的智能体的 live 会话不会因此进入列表。
- 加载更早的消息用**翻倍**而不是逐日推进：3 → 6 → 12 → 24 → 48 小时，直到
  `canLoadMoreRunHistory` 为 false。
- 切换智能体或修改默认范围时，窗口宽度回到设置的默认值。
- **智能体筛选只列智能体**：RUN HISTORY 的下拉与全局搜索的 Agent 筛选都只包含
  `agentOptions` 里的已配置智能体，其余来源（browser、generic、自定义 HTTP 采集器）
  统一落到末尾的 `Others`（`OTHERS_AGENT_ID` / `matchesAgentSourceFilter`）。旧实现
  会把数据里出现的每个来源都变成一项伪智能体，列表随采集器数量增长且真假难辨。
- 窗口内的**稀疏/紧凑布局带迟滞**（`isSparseRunHistoryList` +
  `RUN_HISTORY_SPARSE_HYSTERESIS_ROWS`）：条数到达
  `appLayout.runHistorySparseListRows`（4）时进入稀疏布局（标题放宽到 6 行），
  但要超过阈值 2 条才回到紧凑布局。窗口锚点随最新消息移动，会话一边老化出窗、
  一边有追问把旧会话拉回来，条数会在阈值附近反复横跳；没有迟滞时每次穿越都会
  让整列表的行高重排一次，看起来就是执行期间列表在跳动。
- 展开的 Prompt 子列表**按内容测量高度**（`ResizeObserver`，上限 300 px，越界不超过
  1/4 时完整展开）：固定“行数 × 估算高度”会裁掉换行标题的最后一行，两条消息的线程
  反而出现滚动条。
- Prompt 子列表对多条消息的会话**常驻挂载并带动画**：展开/收起在测量高度与 0 之间
  过渡（边距同步参与，收起后不留占位，`visibility: hidden` 保证不绘制、不可聚焦、
  不进无障碍树）。卸载式收起让每次展开都变成一次“瞬移”——执行中的行一次提交长高
  数百像素，把下方所有行顶下去，同样读作 Live 列表跳动。只有一条消息的会话不渲染
  子列表（父行就是它），Live 筛选不再把单消息会话重复画成两行。

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
- **智能体是外层筛选，live 集合跟着收窄**：`liveSessionKeys` 由
  `scopeLiveRunIndex` 拿全机器 live 索引与本智能体的会话求交得到。`N LIVE`、置顶、
  窗口豁免、Live 筛选四个口径因此永远描述同一个列表。别的智能体正在执行的消息不得
  混进本智能体的历史：旧实现用 `historySessions` 把其它智能体的 live 会话补进列表，
  于是「Codex」视图里出现 Claude 正在跑的那条消息，还被置顶。
- 别的智能体是否在跑由**下拉框的 live 圆点**提示：`scopeLiveRunIndex` 同时返回全
  机器的 `sources`，命中项的智能体在 `AgentSelect` 里带一个 `--status-running`
  圆点。跨智能体的消息靠切换下拉框查看，不靠塞进当前列表。
- 打开运行后再切智能体，会清空当前选中（`activeSessionKey` / `activePromptRunKey` /
  `selectedEventId`），画布、日志、列表一起落到新智能体的最新消息；深链
  `?session=` 指向别的智能体时，下拉框跟着跳到该智能体，地址栏的 `agent` 同步重写，
  保证“打开的运行一定在列表里”。

## 7. 设置与本地偏好

- 设置弹窗只承载浏览器本地偏好，立即生效，不经过服务端，不需要“应用”按钮。
- 弹窗是**两栏卡片**：左侧 `settings-nav` 分区栏（外观 / 运行历史 / 画布 / 面板 /
  性能 / 关于），右侧 `settings-pane` 只渲染当前分区的字段；改用 `Tabs orientation="vertical"`
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
- **最长同步时长是一项本地偏好，也是一个硬上限**：`ASTROX_MAX_SYNC`
  （`1h` / `4h` / `8h` / `12h` / `24h` / `off`，默认 `8h`）。预算只用**一个**
  `setTimeout`（`getSyncStopDelay`）实现，`off` 时不建任何计时器；到点后
  `syncStopped` 关闭 `EventSource`，停止追加事件、停止派生、停止内存增长。不要改成
  每秒轮询或 `setInterval`。
- 预算是「自当前同步窗口起」的墙钟时间，所以**暂停同时停表**：`syncStopped`
  期间不挂任何计时器，时钟只在恢复时归零。改动「最长同步时长」会按**新上限**重新
  挂载计时器（从原起点算剩余），把上限调得比已耗时还短会立即停流。
- 停止后的恢复入口有三个且必须等价：顶栏 `synced` 变成 `paused`（可点击，
  `resumeSync`）、服务卡片里的「重启本地服务」、以及在设置里把上限调到仍有剩余
  （含 `off`）——后两者在暂停中会自动走同一条恢复路径（`capChangeResumesSync`）。
  三者都会重置 `syncStartedAt`，重新同步时拉**当前快照**
  （`handleReloadLatestEvents`）而不是补播错过的增量——补播
  恰好会把预算刚截住的数组重新撑大。重启服务后仍停在 `paused` 属于 bug。
- `syncStopped` 与 `connected === false` 是两件事：后者是掉线（`EventSource` 会自动
  重连），前者是主动停止，只能由用户动作解除。

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
- 每个图标按钮都保留 `aria-label`，但 **tooltip 是可选装饰**：只有图标本身说不清动作
  （收起/展开哪一侧面板的箭头、操作菜单、拓扑/轨迹切换）或者能补充状态与后果
  （`N LIVE` 的判定口径、重新加载进行中的状态）时才加。只是把图形翻译一遍的提示
  （GitHub、齿轮、日/月、复制）属于噪声：它会跟着光标在顶栏图标行上一路弹出，挡住下面
  的面板。
- 列表内的滚动控件放在面板头部，不做浮层：浮动箭头会压住第一条可见原子，读者刚滚到
  的那一行反而看不全。只在对应方向还有内容时才渲染该方向的控件。

## 9. 首屏、渲染与反馈

- **格式化器只建一次**：`Intl.DateTimeFormat` / `Intl.NumberFormat` 放在模块作用域，
  不要在渲染函数或行组件里 `toLocaleString(...)`——构造格式化器的代价远高于格式化
  本身，结果列表每敲一个键就会为每一行重建一次。时间戳解析同理，统一走
  `getEventTimestamp`（按事件对象缓存），不要直接 `Date.parse(event.capturedAt)`。
- **热路径不分配**：按事件逐个判断的地方（`getTraceRunState`、`isWaitingTraceEvent`、
  `getExceptionOutcome`、`isUserQuestionToolEvent`）只查模块级 `Set`，不在循环里
  写 `[...].includes(...)`。一次加载要为每个事件跑两遍这些判定，临时数组会直接变成
  主线程长任务。
- **首屏不按"0"报数**：数据没到之前，RUN HISTORY 头部写 `loading…` 并画骨架行，
  顶栏连接标记写 `connecting`。`0 runs` 与 `offline` 都是关于"已经确认的事实"的陈述，
  在快照还没到时不成立。
- **按需功能走独立 chunk**：只在明确动作后才出现的界面（历史搜索）不进入首屏包，
  由 `lazy()` + 空闲预取（`requestIdleCallback`，退化到定时器）加载；首次打开前
  已完成预取的机器上，行为与同步导入一致。Suspense 兜底复用真实面板的类名，避免
  打开瞬间闪一个无样式面板。
- **反馈走控制台提示条**（`ConsoleNotices`），不用 `window.alert`：原生弹窗会阻塞
  页面、无法样式化、也无法忽略。成功、失败、空结果都要有明确文案；失败要给出原因
  而不只是一句"失败"。
- **光标即可供**：可点击的元素一律 `pointer`——`button:not(:disabled)`、
  `[role="button"]`，以及 Radix 菜单/下拉项（不要在可操作的行上写
  `cursor-default`）；禁用控件是普通箭头（`button:disabled`、
  `[aria-disabled="true"]`，控制台用变暗表达禁用，不用 `not-allowed`）；忙碌控件
  可用 `cursor: progress`；可拖动手柄用 `grab`，拖动进行中切 `grabbing`（性能面板
  拖拽即如此实现）。
- **长列表行端到端记忆化**：结果行组件（如 HistorySearch 的 `SearchResult`）用
  `React.memo` 包裹，行内派生（摘要、高亮）按行记忆化，回调经 ref 路由保持稳定，
  追加批次套 `startTransition`。滚动追加或应用根部后台重渲染不得重渲染已在屏幕上
  的行——否则每次分批追加都会为整屏行重建摘要与正则，滚动吃掉自己造成的卡顿。
- **结论必须可测**：性能改动前后用同一份数据夹具、同一台机器、同一个采样脚本对比，
  PR 里写清指标（脚本时间、长任务、chunk 体积），不写"更快了"。
## 10. 服务重启与快照重载

- 重启本地服务 = 新进程**从磁盘重新读了一遍历史**，不是「同一份历史多了几条」。所以
  重启必须丢弃续传游标、请求完整快照，并重新套用当前筛选（智能体 → 默认时间范围 →
  Live 筛选）。保留游标会让服务端回一个空的 `resume`，列表看起来刚加载过，其实是
  旧进程的数据。
- 快照**只有和屏幕上已有的历史不同才应用**：客户端带上自己持有的快照签名
  （`?snapshot=<key>`，服务端 `getSnapshotKey` = 事件条数 + 全部事件 ID 的滚动哈希），
  历史没变时服务端回 `reset-same`，页面既不传输也不解析；没有签名时（首次加载、旧版
  服务端）由 `isSameEventSequence` 在解析后判定，命中就跳过 `setLiveEvents`——替换数组
  正是强制全量重建会话的开关。
- 签名只回答「是不是同一份历史」，不承担事件去重；去重仍然是每个连接的 `seenIds`。
- 控制台在「即将有快照」的窗口里（重启中、强制快照在途）顶部状态是
  `restarting` / `reloading`，不是 `offline`：重启成功不是连接断开。
- 重启后选中项落在当前筛选的最新消息上；筛选里没有消息时保持空列表，不回退到别的
  智能体。
## 11. 文档同步

- 文档成对发布：`<name>-zh.md` / `<name>-en.md`；文档站按后缀自动配对语言切换。
- 行为变化必须同步四处：
  1. `docs/user-manual-*.md`（使用者可见的变化）；
  2. `docs/conventions-*.md`（本文，规则层面的变化）；
  3. `AGENTS.md`（智能体执行时读到的不变量）；
  4. `docs/index.md` 与 `site/src/docs.ts`（目录与阅读顺序）。
- 文档描述当前行为，不承诺未实现的能力；规划项必须显式标注。
- 引用界面文案时使用界面里的原文（中英文各自对应），不要自行翻译键名。

## 12. 验证清单

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

## 13. 常见错误

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `N LIVE` 少了一条正在执行的消息 | live 集合没按智能体收窄，或列表没走同一个集合 | 用 `scopeLiveRunIndex` 从全量 live 索引求交，别另算一份 |
| 别的智能体正在跑的消息出现在本智能体列表里 | live 集合取了全机器范围 | 列表只用求交后的 `liveSessionKeys`；对方在跑靠下拉框圆点提示 |
| 切了智能体，画布还停在别的智能体的运行 | 选中回落到 `sessions[0]`，或切换时没清空选中 | 回落到 `filteredSessions[0]`，切换时清空 `activeSessionKey` |
| 行显示 RUNNING 但不在 `N LIVE` 里 | 展示状态绕过了 `isFreshLiveRun` | 统一走 `getRunDisplayState` |
| 隔夜打开列表是空的 | 窗口以 `now` 为终点 | 用 `getRunHistoryAnchorTime` 锚定最近消息 |
| 新消息发出后要手动翻找 | Live 筛选没有做 live 集合差集 | 见 §6 的自动定位 |
| Live 筛选开着但列表是空的 | 可能确实没有执行中的消息；也可能是窗口没被丢弃 | 先看 `0 LIVE`，再确认走的是 `selectLiveRunHistory`（不套时间窗口） |
| 设置改了但列表没变 | 窗口宽度没随范围重置 | `runHistoryHours` 跟随 `historyRangeHours` |
| 列表先闪一下 `0 runs` 再跳成真实条数 | 首屏把"还没加载"当成"已经确认为 0" | 未加载时走骨架 + `loading…`，见 §9 |
| 刷新页面时顶栏先报 `offline` | 首次连接用"断开"的文案 | 区分 `connecting` 与 `offline`（`everConnected`） |
| 搜索框每敲一个键都卡一下 | 行内 `toLocaleString(...)` 每次重建格式化器 | 模块级 `Intl.DateTimeFormat`，见 §9 |
| 大历史首次加载主线程长任务明显 | 事件级判定里反复分配临时数组 | 模块级 `Set` + `getEventTimestamp` 缓存 |
| 重启服务后列表还是旧的 | 保留了续传游标，服务端只回空 `resume` | 重启时清游标 + `forceSnapshot`，见 §10 |
| 重启后状态先闪 `offline` | 把「等待下一个快照」当成断线 | 用 `restarting` / `reloading` 状态，见 §10 |
