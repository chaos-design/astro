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
- 堆叠 PR：新分支若基于尚未合并的功能分支，PR base 必须设为该分支，并在「备注」
  写明合并顺序。本轮 `feat/hook-auto-approve-question`（PR #23）基于
  `feat/user-question-md-preview`（PR #22）的 `507edc9` 切出，需先合并 #22 再合并
  #23。若 #22 以 squash 合并进 `main`，先在 #23 上执行 `git fetch origin` 与
  `git rebase --onto origin/main 507edc9 feat/hook-auto-approve-question`，再把
  PR base 改为 `main`，避免把上游提交重复带入。
- 不提交 `dist/`、`.astrox` 数据目录、临时截图与本机路径。
- 工作区里与本次改动无关的修改视为用户所有，不回滚、不夹带提交。

## 4. 代码约定

- TypeScript strict；前端文件名小写下划线连字符，函数名小驼峰。
- 原始 `TraceEvent` 不可变。状态、时长、拓扑、轨迹一律在读取/渲染时派生，不得
  回写或补造事件。
- 单一职责的单一定义：
  - 异常与错误判定只在 `src/lib/exception-events.ts`；
  - RUN HISTORY 的 live 判定只在 `src/lib/run-history-state.ts`（`isLiveRunStatus`
    + `isFreshLiveRun` + `collectLiveRunKeys`）；等待用户提问的展示口径也只在
    同文件的 `isUserQuestionWaitingRun`：底层 `status` 仍是 `waiting`（保留
    长新鲜度窗口与 IDLE 文案），但 RUN HISTORY 以 RUNNING 呈现，限流等待仍显示
    WAITING；
  - 时间窗口计算只在 `src/lib/run-history-window.ts`；
  - 预览页「是否打开过」的状态只在 `plugin/trace-recorder.cjs`
    （`readPreviewState` / `markPreviewOpened`，持久化为 `ASTRO_HOME` 下的
    `preview-state.json`）：服务端在控制台页面接入 `/api/stream` 时打点，
    Hook 启动流程据此决定是否还需要为用户打开浏览器；
  - 把载荷变成 Markdown 预览文档只在 `src/lib/payload-markdown.ts`
    （`payloadToMarkdown`：在任意深度优先找真正的捕获结果——`captured`、
    `tool_response`、`output`、`result` 及其嵌套 `content` 数组——直接作为文本返回，
    让工具返回值的 Markdown 被真正渲染，而不是展示字段名和 JSON 块；`tool_input`
    等容器里的 `plan` 同样会被读出；JSON 结果用代码块包住以启用高亮；`answers`
    渲染成问题→Markdown 答案行，`questions` 渲染成带选项的列表，没有单一文本的
    捕获结果按可读字段行展示而不是 JSON 结构——检查器/浮层的 `{ contract,
    captured }` 包装只预览 `captured`，`contract` 拓扑元数据留给 Raw 标签）；
    Markdown 的解析、代码语法高亮与 HTML 清理
    只在 `src/lib/markdown-preview.ts`（`renderMarkdownPreview`，highlight.js 只
    注册捕获载荷常见语言）。带语言的围栏块包一层 `.md-code`：语言徽标画在
    滚动的 `<pre>` **外面**（横向滚动的宽代码不会带走徽标），`.md-code__lang`
    右对齐、等宽小字；`styles.css` 的 token 映射覆盖已注册语法会产出的全部
    token 类——关键字紫、字符串青、常量琥珀，函数/类型/标签名/json·yaml 键
    读专属的 `--code-accent`（它们曾落在近白上，与正文代码几乎不可分），
    diff 行带 addition/deletion 底色，注释灰斜体。shell 围栏走专用转义 tokenizer，
    给命令、选项、变量与赋值分别上色，行内注释与 heredoc 正文不算命令；
    Code 视图 `JsonViewer` 的键沿用同一 `--code-accent`，切标签不再换配色。
    `.markdown-preview` 显式
    恢复列表的 `list-style` 与块级布局：Tailwind preflight 全局重置
    `list-style`，而 flex 列布局会把 `li` 块化掉 `list-item`——任一都会让
    圆点/编号静默消失；GFM 任务清单用复选框替换 marker，标题按 em 缩放
    （h2 带下划线），行内代码 0.92em 不撑行高，表格塌陷边框 + 表头底色 +
    偶数行斑马纹，引用块紫边 + 底色。检查器的 Input/Output/Raw 与全局浮层共用这两个
    单一来源，浮层组件 `src/components/payload-overlay.tsx` 只负责展示，并用同一个
    切换提供 `Preview`（渲染后的 Markdown：标题、GFM 任务列表、高亮代码、问题/选项/答案）
    与 `Code`（未加工的原始 JSON）两种形态，不再另写一份转换或消毒逻辑；
    `Preview` 分两块区域：「原子内容」（真实文本，代码/JSON 高亮、Markdown 渲染）
    与「相关数据」（**全部**字段：含 content 键、空值、null/false/0 与嵌套路径，
    注释优先；对象数组保留形状——每个元素自带一行带下标的**分组行**
    （`questions[0]`、`questions[0].options[1]`，即遍历产出的 `groupHeader`），
    成员缩进排在它下面，重复的裸键（`label`、`label`、`label`）因此各归其位；
    只有**不在数组元素内**的注释浮到窗格顶部，元素内的注释不得脱离分组），
    正文提取口径唯一定义在 `src/lib/payload-preview.ts`
    （`splitPayloadPreview` / `contentToMarkdown`），字段清单则由 `collectPayloadFields`
    一次遍历给出——两者职责分离，不在组件里另写字段过滤；
    每个原子的预览在浮层内按事件 ID 缓存一次，并**按检查器标签页分域**
    （`cacheScope`；`payloadForAtom(atomId, eventId)` / `variantForAtom` 解析
    任意行的载荷与类型，选中的行**以它自己的事件为准**——工具调用行读自己的
    `tool_input`、结果行读 `tool_response`、提示词行读自己的 payload；记录器
    归一化会在只有 camel 拼写时写入**空 `{}` 占位**（`tool_input: {}`），
    `payloadField`（app.tsx）把空对象当作占位而非内容、跳到下一个拼写，
    空占位绝不能遮住真实的 `toolInput.command`（那曾让每次工具调用的 Input
    预览变成空白）；拆分后
    没有正文的载荷走共享的核心内容抽取 `payload-markdown.ts` 的
    `payloadToMarkdown`（读 camel `toolResponse`、把 `structuredPatch` 渲染成
    高亮 diff——预览的是载荷的**核心信息**：tool result 的结果、prompt input、
    message content，而不是原始信封）；通用视图是**纯内容的**——metadata 键
    不进正文（`isPayloadMetaKey`，容器键 `tool_input`/`toolResponse` 除外，
    它们递归展开），字段名标签不打印，字符串值按推断语言围栏高亮
    （`inferCodeLanguage` / `fenceCode`：json / diff / xml / typescript /
    python / bash；弱信号必须另有代码标点或多行才围栏，单行 shell 命令靠
    选项 / 管道 / 变量 / `VAR=value` 前缀或 shebang 判定；结果提取器解包出的
    文本统一走这一处围栏决策，不再退化成无高亮段落；关键词匹配只是
    **逐行**证据——带块级 Markdown 结构（标题、列表、强调、
    链接、围栏、表格）的文本是文档，整体按文档渲染（文档内部自带的围栏代码
    仍高亮、宽代码块与宽表格在块内横向滚动），绝不因其中一行像代码
    （计划里勾勒的 `export type …`）而把整篇变成横向滚动的等宽墙；
    json / diff / xml 自识别、无条件围栏，shell / Python 里 `#` 是注释、
    不算文档证据）；
    仍无内容才回退为高亮 JSON（`payload-preview.ts` 的
    `fallbackPayloadMarkdown`，倾倒前同样剥掉 metadata 键，`captured` 包装只
    倾倒 captured 半边）——切换行必须改变内容，面板不得停留在同一个空态），
    切换左侧列表是查表而非重新解析 Markdown；浮层左侧的「运行消息链路」由 app.tsx
    用 LOG 同源的 `buildLogEntries(activeEvents, …)` 结果映射出的 `overlayAtoms`
    提供——**每行一个事件**（附它提交到的 harness 原子 id），并按
    `buildTraceTurnIndex` 的轮次分隔符分组；旧的流水线原子列表（每个平台原子
    一行、只绑定其最新事件）无法复现消息链路，不得回退；
    栏头是**一行**：计数 + 自带搜索框 + Live 开关；搜索框（栏内局部状态，LOG
    的 deferred-needle 模式）匹配行的展示字段**与事件载荷内容**
    （`searchEvent` → `matchesEventQuery`，共享 LOG 已预热的逐事件 haystack），
    自带清空按钮；某轮全部未命中时该轮分隔符随行一起消失；
    点选走 `handleOverlaySelectEvent`，写入与 LOG 行点选同一份状态
    （选中事件 + `getAtomIdForEvent` 映射的原子），与画布 / LOG / 检查器共用
    同一个选中态；弹窗不持有第二份选中态，只接收 `atoms` / `selectedEventId` /
    `onSelectAtom`，内容随主控制台选中态响应式更新；左栏**倒序渲染**
    （弹窗内 `[...source].reverse()`），先执行的事件在下方，轮次分隔符按位置
    取 key、绝不按轮次值；行直接复用 LOG 行组件（`.atomic-log__row`）——
    同一 `formatLogSequence` 序号、`atomTypeLabel` TYPE 徽标、事件元 tone 色、
    时间、动作/摘要、成对耗时徽标（与 LOG 列表**同一阶梯单位**
    `formatDurationMs`（`src/lib/duration-label.ts`）：<10s `ms`、<1m `s`，
    随后 `m` / `h` / `d`，每档只取一个主单位；同一对事件在列表与浮层显示一致）
    与成对跳转标记
    （`PairLinkMarker`，与 LOG、轨迹共用 `src/components/pair-link-marker.tsx`
    里的同一个组件）；浮层独有的 CSS 覆盖只做「可读性」：更宽的栏、大一档
    字号、事件键换行、摘要两行截断、选中行再大一号并加亮、**行无 hover 态**
    （selected / running / 配对行保持自身状态，否则基础 `:hover` 会按源顺序
    压过它们）——名称不得再被省略号截断，且覆盖选择器必须带上
    `.atomic-log__row` 作用域，否则会被文件后方的基础行规则压回；方向键与
    Home/End 可导航，弹窗不得另写一份行实现、类型表或 tone 映射；
    栏头有**跟随开关（Live）**，镜像控制台的实时跟随：可用性键在 RUN HISTORY
    卡片仍打印的**记录状态**上（`getRunHistoryDisplayStatus`，含 STALE 标记），
    不是被新鲜度终止的展示状态——静默中的运行保持可点，直到终止事件落地；
    完成的运行（记录态终止）不可用；启用时骑到会话最新的 prompt run 并清空
    原子选中（同页脚 Live 跳转），armed 即跟随位姿：真正执行中的消息持续
    跟随最新原子，仅记录态运行的落在最新事件上并在再次产出事件时恢复跟随；
    之后新事件到达只做**滚动跟随**（把选中行滚进视口），绝不代替读者改选中态；
    点任意行即解除跟随；armed 呼吸灯；
    跟随推进（或任何非本弹窗发起的选中变化）替换预览内容时，两个窗格保留
    读者当前滚动位置（onScroll 写入的 ref 备忘 + 提交后恢复，流式消息每
    ~800ms 一个新事件快照，正文在读者下方增长而阅读位置不动）；只有**读者
    在链路里点选的行**才回到顶部重开；切到 Code 视图卸载两窗格、备忘清零，
    切回 Preview 从头开始；传给 `dangerouslySetInnerHTML` 的 `{ __html }`
    包装对象按 html 字符串 memo（`previewHtml` / `MarkdownView` 的 `html`）：
    React 按对象**引用**比较，内联字面量让应用每秒的 tick 重写相同的标记、
    每次重写重建子节点，宽代码块里的横向滚动约一秒就被打回 0——memo 之后
    相同标记直接跳过；
    预览正文与相关数据字号各大一档，两个窗格的标题（原子内容 / 相关数据）
    钉住不动、正文在标题下滚动；「相关数据」**按值折叠**——单个值超过
    `RELATED_VALUE_MAX_CHARS`（200）才在**该行**带「展开 / 收起」，短字段不受影响，
    绝不对整块区域做展开折叠；
    只读问题预览（`QuestionPreview` → `StaticQuestionContent`）先给问题数与
    捕获顺序提示，再给编号题目、作答状态与单独的已选答案行，静态选中 chip
    比实时选项更醒目；
  - 捕获答案的展示只在 `src/components/answer-rows.tsx`：悬浮卡结果、停靠检查器
    与历史 Answers 三处共用；选中选项由 `src/lib/question-panel-model.ts` 的
    `matchAnswerOptions` 从答案原文还原（只认与声明标签完全相同的逗号 token，
    自由文本不会被误点亮），以高亮 chip 呈现，余下文本按 Markdown 渲染。
    `QuestionResultList` 通过 `resultAnswerRows` 保持请求的题目顺序；结果到达后
    草稿会被清空，所以历史选中态必须从答案还原，不能从草稿推断；
  - 运行所用模型的读取只在 `src/lib/trace-model.ts`（`extractRunModel` +
    `buildSessionPromptRuns` 的 SessionStart 回退）：各客户端的 payload 形态
    （pi 的 `model`/`provider`、deepseek 的模型对象、opencode 的 step 通知、
    zcode 的会话起始模型）在此归一成一个展示串；某条运行自身没上报模型时
    回退到会话起始模型（ZCode 只在 SessionStart 携带 model），界面只在有
    可显示值时渲染 `MODEL` 标签；
  - 成对原子事件的耗时只在 `src/lib/trace-model.ts`（`buildPairDurations`，
    复用 `createFlowEntries` 的配对）：仅对已闭合的成对事件（起始有结果
    收尾，如 `PreToolUse`→`PostToolUse`/`PostToolUseFailure`）给出开始→结果
    的时长，不成对的事件一律不计入；轮次的 `totalPairDuration` 按唯一 pair
    求和（一个工具调用会投影成多个原子，两半也带同一跨度，不能按原子累加）；
    LOG 行、轨迹数据层（`pairDuration` / `totalPairDuration`）与悬停区块卡片
    都从这一处取值；
  - 成对关联标记的身份同样只在 `src/lib/trace-model.ts`（`buildPairLinks`，
    复用同一份 `createFlowEntries` 配对）：两半互指对方 ID，标记文字是
    `T<轮次>·#<另一半的 LOG 行号>`（轮次取起始事件的 `buildTraceTurnIndex` 结果，
    行号取自 flow entry 的 `stepIndex`/`endStepIndex`，即 LOG 打印的行号；例如
    `#027` ↔ `#029` 一对分别显示 `T7·#029` / `T7·#027`），`rows` 再写出
    `#027 ↔ #029` 供 tooltip 与悬停卡片使用；`ordinal` 只作 tooltip 里的轮内
    第几对，不再印在标记上。`pairId`（起始事件 ID）只作**内部**分组键
    （轨迹每对只画一个标记，轮次合计每对只加一次），不显示给读者；行号随当前
    事件窗口变化，跳转一律靠 `partnerId`；LOG 行与轨迹原子的标记、跨视图定位和高亮
    都从这一处取值，
    不得另写一份配对推断；
  - 原子 `TYPE` 的定义只在 `src/lib/atom-types.ts`：`atomTypeLabel(key, kind)` 按
    「原子 key 覆盖 → 归一化 kind 标签 → 原值回退」产出封闭的大写短标签；
    `eventAtomType(event, platformId)` 取 `getAtomIdForEvent` 选出的主原子（与画布
    定位同一映射）的 `key` 和经 `toAtomicDefinition` 归一化的 `kind`。LOG 行徽标、
    轨迹行徽标、悬停卡片 `TYPE` 全部调用这一个函数，不得从 `eventName`、payload
    或另写的分类表推导类型；查表按 `platformId` 做模块级缓存，长会话不逐行重建
    原子定义。一条事件投影多个原子时，LOG 只显示主原子一个标签；
  - 轮次编号只在 `src/lib/trajectory-model.ts`（`buildTraceTurnIndex`）：来源
    自带轮次标识时保留它印出的编号（DeepSeek 的 `data.turn` 可以从 5 开始），
    仅有不透明标识时按首次出现给序号，无标识的事件跟随当前轮次，开头的前导
    事件归入它引出的第一个轮次；LOG 分组、轨迹视图和轮次计数都读这一份结果，
    不得另写一份轮次推断。切到身份模式的判定是「批内任一带轮次标识」而非
    「多数带」：来源只要给过一条事件标了轮次，整批即视为权威，其后无编号
    的 prompt 折进上一轮、不另开新分组（部分标识来源是契约而非启发式，详见
    `docs/event-protocol-zh.md` §6）；
  - 用户问题的展示文本只在 `src/lib/user-question-content.ts`
    （`userQuestionSummary`）：结构化提问、自由文本与计划批准都从这一处抽，
    LOG 摘要、原子投影与检查器 Overview 都读它，提问行不得回退到工具名；
    「什么算用户问题」只在 `src/lib/trace-event-kind.ts`（`isUserQuestionEvent`
    / `isUserQuestionStartEvent`）：命名事件、点名提问工具的
    `Pre/PostToolUse` 之外，宿主没有 `PermissionRequest` Hook 时那条
    `notification_type=permission_prompt` 且正文点名提问工具的 `Notification`
    也算提问开始（WorkBuddy 弹题时只有它，`PreToolUse` 要等作答后才落盘）；
    提问工具名按**归一化后的精确值**匹配（`AskUserQuestion`、
    `request_user_input`、…、OpenCode 就叫 `question`）；
    正文匹配是**在句子里找工具名**，只保留无歧义的名字——"question" 单独一个词
    是任何句子的名词，不进正文匹配；
    `idle_prompt`、`auth_success` 与其他工具的权限提示不算，仍只是运行信号；
    是否**阻塞**另由 `isBlockingUserQuestionStartEvent` 判定：权限请求与权限提示
    通知必须带非空 `questions` / `plan` 才进入等待态与 Flow 作答，没有参数的
    是系统授权，显示键 `permission.request`：裸 `PermissionRequest(Bash/Edit)`
    投影到 Action Gate，点名提问工具的 WorkBuddy 权限通知仍留在 User Question 原子
    的 delta 阶段，好让后续带参数的 `PreToolUse` 接管同一个原子；
    `user-question` 原子绑定的事件只在 `src/lib/execution-topology.ts` 取
    最后一条提问开始事件，状态另由最后一条匹配事件决定；
  - 提问与交互请求的关联只在 `src/lib/question-interaction.ts`：先按
    `toolUseId`、再按会话与问题原文匹配，最后——对没有可读文本的 Plan 批准——
    兜底到同会话最新的 open ExitPlanMode 请求；答案键永远是请求里问题的原文；
    给出视图范围时，`questionMatchesCurrentView` 还要求问题事件属于当前消息、
    事件解析出的原子正是当前原子、会话与来源一致；检查器和浮层共用这个严格判定，
    切换 Agent 或消息后不再显示旧提问。检查器与浮层面板共用同一份交互状态，
    不各自推断当前问题；检查器只有一个问答面（`src/components/question-content.tsx`，
    停靠区与 Input 页复用同一组件，Overview 不再另挂作答框），顶部一行工具条只负责
    Preview / Code 与落位（问题本身不可折叠，没有折叠按钮）：Preview 展示问题与选项，
    Code 只展示原始 payload、不出现选项和提交栏。实时请求下选项可点、提交/Cancel 是滚动区之外的兄弟节点因而
    始终吸底；请求关闭后同一排选项退化为不可点的静态 chip，历史提问永远不假装可作答。
    问答面在窄面板内换行、正文区域内滚动，不撑宽日志列。
    两种作答面都用 `src/lib/question-panel-model.ts` 构建答案：
    选项点击只高亮并填入草稿，输入框内容覆盖选项值，没有 Set；只有一个 Submit，
    一次提交全部问题，底部按钮统一「提交 / 取消」顺序。`dock-full` / `float` 是两者共享的落位
    （`src/lib/question-panel-model.ts` 负责把升级前的 `dock-half` / `half` /
    `bottom` / `side` 归一化过来）：未手动切换时由 `autoQuestionPanelMode` 按运行状态决定——
    可作答的提问浮在画布上，已结束/历史提问铺满详情区；只有手动切换才写入偏好，避免把
    派生默认值固化到下次加载。`dock-full` 把同一份问答面停到检查器 Tab 以下并
    铺满详情区、行距更紧以显示更多正文，只有 `float` 才在画布上浮出卡片且每个选项独占一行，
    因此卡片要求高亮原子正是提问，区域布局则连历史提问也能展开；EVENTS 列收起时没有可停靠的区域，区域布局临时退回卡片，
    保证同步窗口内仍可作答。浮层卡片与检查器作答控件都是「实时作答」能力，只在当前任务
    仍在执行中才可用：判定键在左侧 RUN HISTORY 卡片显示的那个**会话**状态上（对当前会话
    走 `getRunHistoryDisplayState`），而非被选中的单条 prompt run（`isQuestionActionable`，
    `src/lib/question-interaction.ts`，委托 `isPromptExecuting`，因此 `active`/running 与
    `waiting` 都算）——这样在仍等待答复的会话里翻到更早的消息或原子，提问也不会被误冻结。
    会话一旦进入终态，或读者在回放历史快照，就不浮出卡片、检查器提问也只读——事件只作预览，
    绝不假装可作答。区域布局下历史提问仍可展开阅读，但控件禁用。卡片的问题本身不可折叠，滚动条贴卡片右边缘（卡片不留外层
    内边距，留白由问题行承载），键盘快捷键提示放在卡片头部摘要与状态之间（底部只留
    提交 / Cancel 两个按钮）。检查器的批量作答
    只在 `src/lib/interaction-client.ts` 的 `answerInteractionQuestions` 一处构建
    seq 链：每个问题一条 `text`，再一条带完整答案映射的 `submit`；单问题入口
    `answerInteractionQuestion` 只是它的单元素包装。交互帧不随快照重放，刷新页面后
    app.tsx 用 `interactionIdentityFromEvent`（会话 ID + 工具调用 ID + 工具名）调用
    同模块的 `fetchOpenInteractions`，从服务 `GET /api/interactions?...` 取回原始请求
    （服务 `interaction-store.findOpen` 按身份查未关闭记录），再以 open/update/close
    重新注入 reducer；绝不新建请求——宿主 hook 轮询的是原 requestId 的结果文件，
    新请求写出的答案无人读取。已关闭或已过期的请求不恢复。同一个模块里的
    `shouldLocateInteractionRequest` 决定 `interaction.open` 是否闪一下提问原子：
    只认正在跟随运行的同会话同来源请求，且只加定位脉冲、不改选中，避免把 Live
    跟随关掉。浮层问题卡片同样绑定当前消息与原子，并跟随请求生命周期：请求打开时
    带动画入场，头部按钮可折叠成单行摘要（新请求按 `requestId` key 重挂载并重新展开），
    问题列表按模式设置最大滚动高度而提交栏吸附卡片底部；请求关闭后卡片以 `--settling`
    状态保留结果约 2.4 秒再滑出，流重置清掉记录时立即消失。浮层卡片的键盘作答
    （数字键高亮第一个问题的选项、Enter 提交、Esc 取消）只在 `resolvePanelKey`
    一处判定，且只读卡片拒绝全部快捷键；监听器挂在卡片上而非 `document`，
    输入框里的数字仍是文本、回车提交整批。倒计时用一条 CSS 动画读请求的创建与到期时间，
    `interactionTimeLeft` 是数值展示的唯一比例来源。
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
  前缀并 404（智能体下拉的品牌图标踩过）。该工具目前只被测试引用——最后一批
  `public/` 资源（智能体品牌图标）已内联进 bundle——它仍是「若再添加 public
  资源」的唯一定义。`scripts/verify-console-build.mjs` 在
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
  引入依赖。智能体品牌图标由 `src/components/agent-icons.tsx` 的本地 `createBrandIcon`
  构建，每个路径节点都带 key；不要用 lucide 的 `createLucideIcon` 回退——它在 1.42
  版本里不给路径节点加 key，多路径图标每次渲染都会警告。

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
  于是「ChatGPT」视图里出现 Claude 正在跑的那条消息，还被置顶。
- 别的智能体是否在跑由**下拉框的 live 圆点**提示：`scopeLiveRunIndex` 同时返回全
  机器的 `sources`，命中项的智能体在 `AgentSelect` 里带一个 `--status-running`
  圆点。跨智能体的消息靠切换下拉框查看，不靠塞进当前列表。
- 打开运行后再切智能体，会清空当前选中（`activeSessionKey` / `activePromptRunKey` /
  `selectedEventId`）；新智能体有正在执行的消息时，落点由
  `selectScopeFallbackRun` 选那条 Live 消息而不是最新完成的消息——被恢复的会话可能
  几天前才开始，否则底部 Live 按钮会是暗的、画布停在错误的运行上。落点按最新消息
  开始时间排序，与 RUN HISTORY 置顶、`N LIVE`、底部 Live 跳转共用同一顺序；
  没有 Live 时才退回新智能体最新一条。深链
  `?session=` 指向别的智能体时，下拉框跟着跳到该智能体，地址栏的 `agent` 同步重写，
  保证“打开的运行一定在列表里”。地址栏的参数写入只在 `src/lib/console-location.ts`
  一处完成：切换时旧 `session` / `event` 丢弃，新智能体有数据时画布定位到它的
  最新一条消息并写回该 `session`，无数据时只剩 `agent`；`?api=` 等连接参数原样保留。

## 7. 设置与本地偏好

- 设置弹窗只承载浏览器本地偏好，立即生效，不经过服务端，不需要“应用”按钮。
- 弹窗是**两栏卡片**：左侧 `settings-nav` 分区栏（外观 / 运行历史 / 画布 / 面板 /
  性能 / 通知 / 关于），右侧 `settings-pane` 只渲染当前分区的字段；改用 `Tabs orientation="vertical"`
  取得方向键导航，不再把全部偏好叠成一列。弹窗固定 920×672（窄屏退化为上下两段），
  头部与底部固定，只有右侧面板滚动。底部的「完成」只负责关闭——没有“应用”这一步。
- 已在顶栏或工具栏有开关的偏好也要并列出来——一个能列全的入口胜过让用户去顶栏找。
  「关于」列出控制台版本、偏好实际存放位置（浏览器 localStorage、`ASTROX_` 前缀）和
  「不写回事件」的说明，避免把弹窗当成服务端配置。
- 键名统一 `ASTROX_` 前缀，集中在 `src/config/app-config.ts` 的 `storageKeys`。
- 非法值必须回退到 `appDefaults`，不能让损坏的 localStorage 阻止页面渲染。
- 新增偏好要同步：`storageKeys`、`appDefaults`、设置弹窗、`docs/user-manual-*.md`
  的 §15.1 表格，以及 `tests/app-config.test.ts`。
- **任务完成提示音**是设置 → 通知里的一项本地偏好（`ASTROX_TASK_COMPLETION_CHIME`，
  默认开启，无需找开关即可生效；该开关是唯一的关闭入口）。声音由
  `src/lib/task-completion-chime.ts` 用 Web Audio 振荡器本地生成，
  不引入音频资源，因此部署在项目路径下也无需 `assetUrl()`。音调只按终态在该模块里
  定义（`getChimeTone`）：完成上行、失败下行、终止中性双击，听声音即可区分成功、
  出错与被停止。音色偏好（`ASTROX_CHIME_STYLE`，选项列表与其它偏好一样放在
  `app-config.ts`）挑选音色——波形、响度与音符节奏——但状态区分规则在任何音色下都
  不变；设置弹窗按终态逐个试听当前音色。同一批次只播一声，由 `resolveChimeStatus`
  择优（失败 > 终止 > 完成），
  批次里同时有失败时不能播成成功音。终态转换只由
  `collectTerminalTransitions` 依据**已记录**的状态（`getRunHistoryDisplayStatus`）
  判断，不采用新鲜度/超时派生出来的显示状态——只是“看起来终止”的活跃运行不能响。
  `app.tsx` 里的效果首次快照时把已经结束的运行记入基线（历史不响），运行重新活跃时
  移除该键（再次完成还能响），示例数据完全跳过；这份账本放在 ref 而非 state，流式批次
  不因记录一次完成而重渲染整个 studio。
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
- 暂停同样作用于**显示出来的时钟**：服务卡片的运行时长在 `paused` 期间冻结在暂停
  开始时的读数，暂停期间服务累计的 uptime 永远不再显示（恢复后从冻结读数继续，
  而不是把暂停时长补放出来）。规则只有一个定义：`sync-budget.ts` 的
  `applyUptimePause` / `resolveDisplayedUptime`，组件只消费结果；服务换新进程
  （pid 变化）时整体归零——重启服务重新计时是有文档的暂停出口。
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
- 采集插件版本可观测：长驻采集器（opencode / pi）把各自 `package.json` 版本作为 `payload.captureVersion` 盖在事件上，服务按 source 汇总到 `/api/health.captureVersions`。漂移判定必须把「无版本」事件单独计桶——旧代码进程根本不写版本，只数带版本事件会永远看不到它仍在写入；`stale`＝两个带版本版本并存，或无版本事件不早于最新带版本事件，按事件时间而非墙上时钟推导。卡片显示 `v旧(未标记)` 桶，`stale` 时给出可一键复制的宿主相关重启指令（`captureRestartCommand`，opencode 为 `opencode service restart`，Pi 为会话提示），不假装浏览器能重启进程。单一来源就是适配器自己的清单，不在别处硬编码期望版本。
- 每个图标按钮都保留 `aria-label`，但 **tooltip 是可选装饰**：只有图标本身说不清动作
  （收起/展开哪一侧面板的箭头、操作菜单、拓扑/轨迹切换）或者能补充状态与后果
  （`N LIVE` 的判定口径、重新加载进行中的状态）时才加。只是把图形翻译一遍的提示
  （GitHub、齿轮、日/月、复制）属于噪声：它会跟着光标在顶栏图标行上一路弹出，挡住下面
  的面板。
- 列表内的滚动控件放在面板头部、紧贴列表搜索框（LOG、全局历史搜索），不做浮层：浮动
  箭头会压住第一条可见行，读者刚滚到的那一行反而看不全。两个方向的按钮都常驻并预留
  宽度；到头的方向用 `disabled` 而非卸载表示，滚动时旁边的搜索输入框不来回伸缩。

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
- **虚拟化列表的测量不依赖自己写入的状态**：`AtomicLog` 从 ref 读取行高/分隔高，
  布局 effect 只跟随 entries 变化；若把 `metrics` 放进依赖，`setMetrics` 会让新切出来的
  第一行换成另一个高度，反复触发直到 React 报 #185（Maximum update depth exceeded，
  部署版上真实出现过）。估算取当前挂载的同类行中最高的一行，窗口滑动时既不会裁掉
  换行行，也不会因为换了一行就翻转高度。
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
- 可选 Hook 的文档落点是 `docs/plugin-installation.md`：自动同意见
  "Optional: auto-approve user questions"，控制台作答见
  "Optional: answer user questions from the console"；`AGENTS.md`、用户手册与
  README 的「只做观测」边界必须同时写明「独立组件、默认关闭、采集器不参与决策」，
  并说明两个 Hook 不要挂到同一个事件上。
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
| DeepSeek 插件「装好了」却没有任何 session 事件 | bundle 只被复制到 `ASTRO_HOME`，没有写进 profile 的 `dsh.profile.bundles`（`dsh plugin add` 退出 0 不代表成功，`npx` 回退常写入另一个构建的 `DSH_HOME`）；或多余的 `inject` 让 entry 一直 PENDING，`apply()` 从未执行 | 每次 add 后校验 `dependencies` + `bundles`，用 `--dump-config` 确认 `astro-trace`；事件订阅不声明服务依赖 |
