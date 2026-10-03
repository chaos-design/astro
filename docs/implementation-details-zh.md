# ASTRO 实现细节与规划状态

更新日期：2026-09-10

本文把项目设计决策整理为长期维护的实现参考。它回答四个问题：

1. 当前能力是否已经落地；
2. 关键行为由哪一层负责；
3. 可以从哪些代码和测试验证；
4. 当前边界与后续演进是什么。

## 1. 状态口径

- **已实现**：存在可执行代码，并有自动化测试或可直接检查的渲染证据。
- **规划**：目标和接口已经设计，但尚未通过完整集成与发布验收。
- **文档治理**：用于组织事实、分享材料和面试材料，不属于运行时能力。

“已实现”不等于没有边界。“规划”也不表示可以按现状向用户承诺。

## 2. 设计落地总表

| 主题 | 状态 | 核心结果 | 主要证据 |
| --- | --- | --- | --- |
| 活动运行超时 | 已实现 | 仍在计时的运行默认在 24 小时封顶，并派生为 `terminated` | `src/config/app-config.ts`、`src/lib/trace-model.ts`、`tests/trace-model.test.ts` |
| Session 消息状态 | 已实现 | 最新语义事件驱动状态，新 Prompt 可重新激活已结束会话 | `src/lib/trace-status.ts`、`src/lib/trace-model.ts`、`tests/trace-model-boundaries.test.ts` |
| Prompt 子运行隔离 | 已实现 | 每条 `UserPromptSubmit` 建立独立诊断区间 | `src/lib/trace-model.ts`、`src/app.tsx`、`tests/trace-model.test.ts` |
| 父行时长与展开控件 | 已实现 | 父行只在最新 Prompt 为 `active` 时计时；展开操作与行选择分离 | `src/lib/run-history-state.ts`、`src/app.tsx`、`tests/run-history-state.test.ts` |
| 全局历史搜索与原子定位 | 已实现 | 组合筛选加载数据，并联动 Session、Prompt、LOG、检查器和拓扑 | `src/lib/history-search.ts`、`src/components/history-search.tsx`、`tests/history-search.test.ts` |
| 用户问题事件投影 | 已实现 | 问答、权限和通知事件统一投影到 `user.question` | `src/lib/trace-event-kind.ts`、`src/lib/atomic-projection.ts`、`tests/user-question-projection.test.ts` |
| 事件存储目录迁移 | 已实现 | 新目录使用 `HH_mm_ss`，旧冒号目录可无损迁移与合并 | `plugin/storage-paths.cjs`、`scripts/migrate-data.mjs`、`tests/migrate-data.test.js` |
| History 状态图例 | 已实现 | Guide 复用真实状态图标并解释父子状态规则 | `src/config/atom-guide-copy.ts`、`src/app.tsx`、`tests/atom-guide-copy.test.ts` |
| Guide 观测列表标记 | 已实现 | 观测列表恢复语义化圆点，不改变有序步骤 | `src/app.tsx`、`src/styles.css` |
| 拓扑领域标题可读性 | 已实现 | 放大领域标题和说明，不改变几何与布局 | `src/styles.css`、`tests/atom-node-typography-contract.test.ts` |
| 插件级 YAML 与 `.env` 配置 | 已实现 | 在安装目录统一加载结构化配置与本机私密值 | `config.example.yaml`、`plugin/runtime-config.cjs`、`tests/runtime-config.test.cjs` |
| 文档与 HTML 同步 | 文档治理 | 以本文为状态事实源，分享和面试材料按受众抽象 | `docs/index.md`、两份自包含 HTML |

当前 10 项产品设计均已形成实现与测试证据。本轮同步没有把尚未实现的路线图包装成
现有能力；分页索引、自动归档、远程认证和多租户仍属于后续规划。

## 3. 运行状态与 Prompt 隔离

### 3.1 状态只从事件派生

`TraceEvent[]` 是事实源。状态归约按时间和采集顺序处理有语义的事件：

| 事件语义 | 派生状态 |
| --- | --- |
| Prompt、Session 开始或执行进展 | `active` |
| 权限、询问、限流或重试等待 | `waiting` |
| 正常 `Stop` | `complete` |
| Hook、工具或非零退出失败 | `failed` |
| 中断、取消、终止或 Session 结束 | `terminated` |

未知事件不会清除最近一次已知状态。后到的 `UserPromptSubmit` 可以把同一 Session
从任何终态重新激活，因为 `Stop` 只结束一轮回答，不结束整个会话。

### 3.2 Prompt 是最小诊断范围

`buildSessionPromptRuns` 以每条 `UserPromptSubmit` 为边界切分事件。选中一个 Prompt
后，拓扑、轨迹、LOG、检查器、回放和导出都只消费该区间。历史 Prompt 不会吸收后续
事件；没有 Prompt 事件的旧数据才回退到完整 Session。

Session 父行使用最新 Prompt 的显示状态。Prompt 子行是唯一被选中的运行行，父行只
承担分组与进入最新 Prompt 的职责。展开按钮是独立交互目标，不会误触发行选择。

### 3.3 时长与超时

页面只维护一个共享的一秒时钟。纯函数接收已记录运行、`now` 和
`appTimings.activeRunTimeoutMs`，组件自身不读取时钟。

- Session 父行仅在最新 Prompt 为 `active` 时继续计时。
- Prompt 子行在 `active` 或 `waiting` 时继续计时。
- 仍在计时的候选时长达到默认 24 小时时，显示时长封顶并派生为
  `terminated`。
- 已经 `complete`、`failed` 或 `terminated` 的历史时长不截断。
- 超时后停止 Live 标记、拓扑动画和运行日志标记。
- 不追加合成事件，不改写 JSONL，不替换持久化状态。

因此相同事件、时间与配置在刷新后会得到相同显示状态。

## 4. 搜索、问题事件与联动定位

### 4.1 浏览器内全局索引

`buildHistorySearchIndex` 在已加载 Session 变化时建立事件索引。索引保存父 Session、
Prompt、状态、来源、时间、事件标签、摘要和规范化可搜索文本。搜索支持：

- 不区分大小写的子串与有序模糊匹配；
- 时间、Agent、状态和事件分类组合过滤；
- 过滤组之间取交集，同组多选取并集；
- 先做低成本结构过滤，再做文本评分；
- 大结果集使用 `IntersectionObserver` 自动分批展示。

这是客户端已加载数据搜索，不等同于服务端 `/api/search`，也不承诺查询尚未加载的
历史。

### 4.2 一次选择完成多视图定位

选择搜索结果会切换来源平台、Session 和 Prompt，选择精确事件与映射原子，退出回放，
打开 History 与 LOG，并分别触发拓扑和日志定位。两个滚动容器独立处理自己的定位，
避免用一个共享滚动状态互相覆盖。

手动原子选择、当前执行原子和事件映射原子按明确优先级解析。显式定位使用短时颜色
脉冲和背景强调；降低动态效果时保留静态强调。

### 4.3 用户问题语义

`PermissionRequest`、`PermissionDenied`、`Elicitation`、
`ElicitationResult` 和 `Notification` 显示为 `user.question`。通用工具事件中的
`AskUserQuestion`、`request_user_input` 和 `UserQuestion` 也映射到同一原子；
开始事件进入等待态，结束事件关闭对应实例。

## 5. 存储路径与迁移

规范路径为：

```text
<ASTRO_HOME>/<source>/YYYY/MM-DD/HH_mm_ss-<sessionId>/events.jsonl
```

`plugin/storage-paths.cjs` 是路径生成的唯一实现。迁移器继续识别旧的
`HH:mm:ss-<sessionId>` 目录：

1. 目标不存在时直接重命名；
2. 目标已存在时合并 `events.jsonl`；
3. 可解析事件按 `id` 去重；
4. 无 ID 或损坏行按原始文本保留并去重；
5. 只有目标写入成功后才删除旧目录；
6. 重复执行保持幂等。

Repository 在迁移期兼容发现两种目录，但所有新写入只使用下划线格式。

## 6. Guide 与拓扑可读性

History 图例复用运行历史中的 Lucide 状态图标和语义颜色，避免另建一套视觉定义。
图例同时说明父行跟随最新 Prompt、无子项时回退 Session 状态。

Guide 的观测列表保留语义化 `ul` / `li`，使用原生 `disc` 标记。领域标题从 8 px
提高到 12 px，说明从 8 px 提高到 10 px；只改善缩放后的阅读，不改变领域几何、
节点位置或正交路由。

## 7. 共享运行时配置

> **状态：已实现。** 配置加载、入口接入、安装保留、原生插件打包与回归验证均已完成。

安装器在 `<ASTRO_HOME>/plugins/astro` 创建两份用户拥有的配置：

```text
~/.astrox/plugins/astro/
├── config.yaml
└── .env
```

实现职责：

- `config.yaml` 保存带类型的服务、运行时、存储和客户端配置；
- `.env` 保存机器相关值或由 YAML 引用的私密值；
- 所有 Agent、CLI、服务和 Vite 代理使用一个共享加载器；
- 优先级为 CLI、进程环境、兼容环境变量、插件 `.env`、YAML、内置默认值；
- `${NAME}` 与 `${NAME:-fallback}` 只在字符串标量中插值，不执行 shell；
- 首次安装创建文件，升级不覆盖用户文件；
- `doctor` 只报告路径、有效性和来源层，不输出私密值。

`ASTRO_HOME` 是定位配置文件的引导值，不能由配置目录中的 `.env` 反向定义。该值变化
时需要重新安装集成，使 Hook 命令、运行时和配置保持同址。

发布验收包括：

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm build:native-plugins
pnpm validate:claude-hooks
git diff --check
```

## 8. 维护与验证

行为变化应先更新对应纯函数和聚焦测试，再同步本文、相关使用文档与两份 HTML。避免
在 README、组件和演示稿中分别维护互相冲突的规则。

常用验证入口：

| 责任 | 代码 | 测试 |
| --- | --- | --- |
| 状态、Prompt 与超时 | `src/lib/trace-model.ts`、`src/lib/run-history-state.ts` | `tests/trace-model.test.ts`、`tests/run-history-state.test.ts` |
| 搜索与定位 | `src/lib/history-search.ts`、`src/app.tsx` | `tests/history-search.test.ts`、`tests/atom-selection.test.ts` |
| 用户问题投影 | `src/lib/trace-event-kind.ts`、`src/lib/atomic-projection.ts` | `tests/user-question-projection.test.ts` |
| 存储路径迁移 | `plugin/storage-paths.cjs`、`scripts/migrate-data.mjs` | `tests/storage-paths.test.cjs`、`tests/migrate-data.test.js` |
| Guide 与可读性 | `src/config/atom-guide-copy.ts`、`src/styles.css` | `tests/atom-guide-copy.test.ts`、`tests/atom-node-typography-contract.test.ts` |
| 运行时配置 | `plugin/runtime-config.cjs`、安装和入口文件 | `tests/runtime-config.test.cjs` 及安装、打包、Hook 集成测试 |
