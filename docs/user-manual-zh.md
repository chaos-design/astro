# ASTRO 使用手册

> 默认地址：`http://127.0.0.1:4318`
>
> 所有客户端的默认数据根目录：`~/.astrox`
>
> 说明：本文以 PC 桌面端作为默认且唯一的界面讲解范围。

## 1. 产品用途

**ASTRO** 是 **Agent State Trace & Runtime Observations** 的缩写，中文可理解为
“智能体状态追踪与运行时观测”，与 Astro Web 框架无关。

ASTRO 用于在本机采集、查看和回放编码智能体的运行事件。典型用途包括：

- 查看一次智能体运行经过了哪些提示词、模型、工具、通知和最终回复事件；
- 从执行拓扑理解工具调用、观察结果、记忆、质量门禁和输出提交之间的关系；
- 检查某个工具调用的输入、输出、耗时和原始载荷；
- 回放历史会话，定位失败发生前后的状态变化；
- 在 Trae、Claude Code、Codex、DeepSeek Harness、WorkBuddy 和浏览器客户端之间使用统一事件格式；
- 导入、导出和分享单次运行的 JSONL Trace。

![ASTRO 桌面界面](assets/astro-desktop.png)

图中左右面板均已展开，四个主要区域分别承担以下工作：

| 区域 | 显示内容 | 支持的操作 |
| --- | --- | --- |
| 左侧 `RUNS` | 来源、Session、初始 Prompt、后续 Prompt、事件数、状态与持续时间 | 展开 Prompt 子运行、切换历史会话、定位单轮执行 |
| 中央画布 | Execution Topology 或 Run Trajectory、原子状态、领域边界与连线路径 | 切换平台和视图、显示 Deep View、选择或定位原子、查看 Flow Guide |
| 右侧 `EVENTS` | 按时间排序的事件日志，以及所选事件的 Overview、Input、Output、Raw JSON | 搜索事件、点击定位、检查工具参数与结果、查看原始载荷 |
| 底部回放 | 当前事件位置、进度与 Live 状态 | 重新开始、上一步、播放/暂停、下一步、拖动定位、切换播放速度 |

界面中的选中态使用青色，运行态使用紫色，完成态使用青绿色，失败或终止态使用红色。
连线颜色与线型分别表示执行、数据、反馈和持久化关系；这些语义可以在
`Flow Guide` 中查看完整定义。

## 2. 环境要求

- Node.js：支持当前依赖和原生 ESM 的当前 LTS 版本；
- 包管理器：通过 Corepack 激活的 `pnpm`；
- 浏览器：支持 ES Module、Web Worker、SSE、ResizeObserver 和现代 CSS；
- 端口：默认使用 `127.0.0.1:4318`。

## 3. 安装与启动

推荐流程：

```bash
corepack enable
pnpm install
pnpm typecheck
pnpm build
pnpm start
```

启动成功后终端会输出实际访问地址和数据根目录。若默认端口被占用，服务会从
`4318` 开始自动尝试后续端口，最多继续尝试 20 个端口。该流程用于运行生产构建
或手动管理服务；直接安装 Hook 后会立即启动并打开控制台，后续新建 Agent
会话时由 `SessionStart` 确保监听页已打开。

开发模式需要同时运行 API 服务和 Vite。Vite 会读取同一组
`ASTRO_HOST/ASTRO_PORT` 环境变量，默认代理到 `127.0.0.1:4318`：

```bash
# 终端 1：API
ASTRO_HOME="$HOME/.astrox" pnpm start

# 终端 2：前端
pnpm dev
```

如需使用 `4320` 等其他端口，两个进程都设置相同的 `ASTRO_PORT`。

## 4. 快速开始

### 4.1 只查看演示数据

在 `pnpm dev` 的 development 模式中，如果真实事件数为 0，控制台会展示一条
内置演示会话，可直接体验拓扑、轨迹、检查器和回放。test 环境采用相同策略。

`pnpm build` 生成的 production 控制台不会展示 Demo。没有真实事件时保持空状态，
避免把测试数据误认为业务 Trace。

### 4.2 采集当前项目中的智能体

以下命令都需要在 ASTRO 仓库中执行，并先完成第 3 节的构建。

使用原生插件时，先同步插件内置的采集器、服务端和已构建控制台：

```bash
pnpm build:native-plugins
```

然后通过当前仓库的 marketplace 安装 Codex 插件：

```bash
codex plugin marketplace add /absolute/path/to/astro
codex plugin add astro@astro-local
```

Claude Code 可以直接加载原生插件：

```bash
claude --plugin-dir /absolute/path/to/astro/claude-plugin
```

也可以通过当前仓库的 marketplace 安装：

```bash
claude plugin marketplace add /absolute/path/to/astro
claude plugin install astro@astro-local --scope user
```

以下各节介绍直接写入 Hook 配置的兼容安装方式，适用于 Trae 或不支持原生插件的
运行环境。

#### 4.2.1 Codex

将当前用户的 Hook 安装到 `$CODEX_HOME/hooks.json`：

```bash
pnpm install-plugins -- --clients=codex
```

使用非默认 Codex Home：

```bash
pnpm install-plugins -- --clients=codex --codex-home=/path/to/.codex
```

安装后重启 Codex，在需要观测的项目中执行 `codex` 并新建会话。实时事件写入
`~/.astrox/codex/YYYY/MM-DD/HH_mm_ss-<sessionId>/events.jsonl`。如需导入已有的活动和归档 rollout：

```bash
pnpm import-codex
```

#### 4.2.2 Claude Code

安装项目级 Hook：

```bash
pnpm install-plugins -- \
  --clients=claude \
  --scope=project \
  --target=/absolute/path/to/workspace
```

该命令写入 `<workspace>/.claude/settings.local.json`。为当前用户的所有项目安装：

```bash
pnpm install-plugins -- --clients=claude --scope=user
```

用户级配置写入 `~/.claude/settings.json`。安装后重启 Claude Code，在需要观测的
项目中执行 `claude` 并新建会话。事件写入 `~/.astrox/claude/YYYY/MM-DD/HH_mm_ss-<sessionId>/events.jsonl`。

#### 4.2.3 DeepSeek Harness

安装官方 `dsh` 后，将 ASTRO bundle 加入需要观测的 profile：

```bash
pnpm install-plugins -- --clients=deepseek --deepseek-profile=web
```

如果 PATH 中没有 `dsh`，安装器会回退到
`npx --yes @deepseek-ai/dsh`。自定义位置使用 `--dsh-home`，自定义可执行文件
使用 `--deepseek-command`。安装后重启 `dsh web`，事件写入
`~/.astrox/deepseek/YYYY/MM-DD/HH_mm_ss-<sessionId>/events.jsonl`。

#### 4.2.4 Trae

安装项目级 Hook：

```bash
pnpm install-plugins -- \
  --clients=trae \
  --target=/absolute/path/to/workspace
```

该命令写入 `<workspace>/.trae/hooks.json`。在 Trae 中重新打开或重新加载该工作区，
然后新建 Agent 会话。事件写入
`~/.astrox/trae/YYYY/MM-DD/HH_mm_ss-<sessionId>/events.jsonl`。

#### 4.2.5 查看运行记录

默认情况下，安装器会立即启动并打开控制台。重载或重启客户端后，
`SessionStart` 会先记录当前 Agent 会话，再检查
`<data-root>/dashboard-<port>.pid`；仅在控制台未运行时后台启动服务，并打开已选中
当前会话的实际地址。若 `4318` 已占用，浏览器会打开自动选择的后续端口。

需要手动管理进程时，关闭自动启动并任选一种方式运行：

```bash
ASTRO_AUTO_OPEN=0 pnpm start
# 所有客户端共用用户级运行时和数据根目录
node ~/.astrox/plugins/astro/server/server.mjs
```

在 **Run History** 中选择会话，再选择匹配的平台。即使控制台停止，Hook 仍会继续
采集；控制台只负责界面和 SSE 实时更新。长期禁用自动启动时，在客户端进程环境中
设置 `ASTRO_AUTO_OPEN=0`。

执行 `pnpm install-plugins` 可一次安装三类基于 Hook 的客户端，并保留已有 Hook
命令；DeepSeek bundle 需通过 `--clients=deepseek` 显式安装。使用
`--no-migrate` 跳过旧数据迁移，或使用 `--astro-home=/path/to/.astrox` 修改数据根目录。

## 5. 界面导览

### 5.1 顶栏

- `ASTRO`：产品标识。
- 菜单按钮：导入、导出和清空事件。
- `ASTRO EVENT STREAM`：当前来源与事件总数。
- Search History：打开全局历史搜索；快捷键为 `Cmd/Ctrl + K`。
- 状态：
  - `accepted`：已连接 SSE；
  - `offline`：API/SSE 不可用；
  - `demo`：development/test 且无真实事件时使用内置演示数据。
- 主题：浅色、深色、跟随系统；选择保存在 `ASTROX_THEME`。

### 5.2 全局历史搜索

点击顶栏 Search History 或按 `Cmd/Ctrl + K`，可以搜索浏览器已经加载的全部事件，
而不只限于当前 Prompt。默认时间范围为最近 3 小时。

筛选条件包括：

- 最近 3、6、12、24 小时、今天、昨天、最近 7 天或自定义日期；
- 一个或多个 Agent；
- 一个或多个运行状态；
- 一个或多个事件分类。

不同筛选组之间取交集，组内多选取并集。文本匹配不区分大小写，同时支持精确子串与
有序模糊匹配；结果列表滚动时自动继续加载。

选择结果后，界面会在可用时切换到对应平台，选中所属 Session、Prompt、精确事件与
映射原子，退出回放，打开 History 与 Events，并分别定位拓扑节点和 LOG 行。全局
History 搜索只覆盖浏览器已加载数据，与服务端 `/api/search` 是两个独立入口。

### 5.3 左侧 Run History

每个父行代表一个会话，显示：

- 状态：运行中、完成或失败；
- 会话标题：优先取第一条用户提示词；
- 开始时间；
- 来源平台；
- 持续时间；active 会话每秒刷新，默认最多增加到 24 小时，到达阈值后显示为
  `terminated`；
- Prompt 数量；
- 缩略会话 ID。

包含多条 Prompt 的会话在选中时自动展开，子行依次标记为 `INITIAL`、
`FOLLOW-UP 01`、`FOLLOW-UP 02` 等。每个子行显示该 Prompt 的标题、状态、开始
时间、持续时间、事件数和缩略 Prompt 事件 ID。一个 Prompt 子运行从对应
`UserPromptSubmit` 开始，到下一条 Prompt 之前结束。

点击子行会把它设为当前诊断范围；点击父行会选择最新 Prompt。界面同时只展开一个
会话层级，子列表最高 270 px 并独立滚动，选中项会自动保持在可见区域。左侧面板可
收起为 `RUNS` 轨道，为中央拓扑释放更多桌面空间。
展开状态写入 `ASTROX_HISTORY_OPEN`，刷新后恢复。

### 5.4 中央工作区

中央区域使用当前选中的 Prompt 子运行，并提供两种视图：

- **Execution Topology**：按领域展示原子节点和正交连线；
- **Run Trajectory**：按轮次和 Input / Model / Tools 泳道展示实际事件步骤。

工具栏功能：

- 平台语义：Codex、Claude Code、Trae；
- 拓扑/轨迹切换；
- 原子与连线指南；
- 全部原子/仅运行时原子切换；
- 打开右侧事件面板。

平台切换不会修改原始事件，只改变拓扑的运行时上下文。所有受支持的平台当前使用稳定
一致的 27 原子语义。
平台选择写入 `ASTROX_PLATFORM`。

### 5.5 右侧事件面板

上半部分是 LOG：

- 最新事件显示在前；
- 按 Turn 分组；
- 可搜索当前 Prompt 子运行事件的任意序列化字段；
- 点击事件可选择，再次点击同一事件可取消；
- 定位按钮会切回拓扑并聚焦当前映射原子；
- 浮动箭头可快速滚动到日志顶部或底部。

下半部分是检查器：

- `Overview`：状态、来源、类型、时间、工具、调用 ID 等；
- `Input`：工具输入或提示词；
- `Output`：工具结果或回复；
- `Raw`：完整标准化事件；
- JSON 复制按钮：复制当前结构化数据。

选择拓扑原子时，检查器会额外显示原子契约、输入端口、输出端口、门禁状态和绑定事件。
右侧面板展开状态写入 `ASTROX_CONSOLE_OPEN`。

### 5.6 会话状态

- `active`：最近一轮尚未出现完成、失败或终止信号；持续时间每秒更新，直到达到配置
  的超时阈值。
- `complete`：最近 `Stop` 不早于最近提示词；`Stop` 只结束当前回答。
- `failed`：最近提示词或完成标记之后出现失败事件。
- `terminated`：存在中止、取消、`Interrupt`、`SessionEnd`、同工作区已有更新会话，
  或达到默认 24 小时的实时运行上限。

超时终止属于有效 UI 状态：它会封顶显示时长并停止实时动画，但不会修改已存储事件。

同一 `sessionId` 在 `Stop` 后收到新的 `UserPromptSubmit` 会重新进入 active，
后续问答继续归入原 Session 并形成独立子运行，不需要刷新页面。处于 Live 状态时，
新 Prompt 会自动成为当前子项；手动选择旧子项后，后续事件不会混入该历史范围。

### 5.7 在控制台中识别超时

同一超时结果会一致作用于当前诊断范围：

| 界面位置 | 超时前 | 到达及超过阈值后 |
| --- | --- | --- |
| Session 或 Prompt 状态图标 | active/waiting 对应颜色与图标 | 红色 `terminated` 图标 |
| 持续时间 | 符合条件时每秒增加 | 固定为配置阈值 |
| 拓扑 | 最新活动原子和转换可以动画 | 不再显示实时转换动画 |
| 事件日志 | 最新执行行可显示运行标记 | 运行标记停止 |
| 回放与检查器 | 可用 | 仍可用，证据不会删除 |
| 导出 | 导出当前选择的原始事件 | 行为不变 |

超时不代表 ASTRO 已经杀死外部 Agent 进程，只表示 ASTRO 不再把该记录区间视为实时
执行。如果需要判断进程是否仍运行，应检查来源客户端和 JSONL 中的最新事件。

父子行状态允许有意不同。Session 父行只有在最新 Prompt 为 `active` 时才增加；最新
Prompt 为 waiting 时父行冻结。waiting 子行仍继续计算自身时长，并可独立达到超时。
历史 complete、failed 或 terminated 运行即使长于当前阈值，也保留其已记录时长。

## 6. 执行拓扑操作

### 6.1 读取节点

每个节点包含：

- 状态点：等待、执行中、完成或失败；
- 计数：该原子实例或匹配事件数量；
- 英文原子名称；
- 稳定原子键；
- Turn 计数；
- `INFERRED` 或原子类型标记。

点击节点选择它，并把右侧检查器同步到绑定事件。再次点击同一节点可取消选择。

### 6.2 读取连线

- 主执行流：正常执行交接；
- 推理循环：模型决策、动作门禁、观察与下一轮；
- 能力调用：工具解析、执行和结果回传；
- 记录链路：检查点、Trace 和轨迹投影；
- 子智能体链路：任务委派与结果返回；
- 提示/交互链路：用户问题或权限请求。

当前原子发生变化时，相关路径会出现流动粒子。选择一个原子后，与其直接相连的边会高亮。

### 6.3 全部原子与运行时原子

工具栏的 Sparkles 图标用于切换：

- **全部原子**：展示完整 6 领域、27 原子；
- **运行时原子**：只显示高频运行时语义，隐藏深层实现原子。

需要理解完整架构、工具内部阶段或质量链路时使用全部原子；实时监控时可使用运行时视图减少信息密度。

### 6.4 原子指南

点击问号按钮打开指南：

- “连线”页解释各类链路；
- 每个领域单独一页；
- 原子条目提供中文名称、稳定键、职责和输入/输出数量；
- 点击条目会关闭指南并定位对应节点。

## 7. 轨迹视图

轨迹视图强调真实事件时间顺序，而不是完整架构，并且只使用当前 Prompt 子运行。

顶部摘要显示：

- Turn 数；
- Step 数；
- Complete 数；
- Failed 数。

泳道概览把步骤映射到 Input、Model 和 Tools。下方列表按 Turn 分组，显示事件类型、摘要、时间、持续时间和状态。

工具调用会把 `PreToolUse` 与同 `toolUseId` 的 `PostToolUse` 或 `PostToolUseFailure` 合并为一个步骤。点击带详情的行，可展开输入和输出 JSON。

## 8. 历史回放

底部回放栏支持：

- 从头播放；
- 上一个事件；
- 播放/暂停；
- 下一个事件；
- `0.5x`、`1x`、`2x`、`4x`；
- `Live`：退出回放并回到最新事件；
- 拖动时间轴跳转到任意事件。

回放会按游标截断当前 Prompt 子运行并重新计算：

- 可见轨迹步骤；
- 原子实例状态；
- 始终可见的稳定连线及其运行状态；
- 活动原子和流动路径；
- 检查器所选事件。

回放不会修改或重新写入 Trace 数据。

## 9. 导入、导出与清空

点击顶部菜单：

### Import run

支持：

- JSON 数组；
- 每行一个对象的 JSONL；
- 已标准化事件；
- 包含 Hook 原始字段的事件。

导入事件只保存在当前页面内存中，不会自动写入服务端 JSONL。当前页面内重复 ID 会被忽略。

### Export run

导出当前 Prompt 子运行为：

```text
astro-<source>-<sessionId>-prompt-<number>.jsonl
```

每行是该 Prompt 区间内的完整标准化事件，可用于备份、分享或重新导入。没有
`UserPromptSubmit` 的会话回退为会话级导出，文件名为
`astro-<source>-<sessionId>.jsonl`。

### Clear local events

确认后会：

- 清空当前页面中的导入事件；
- 非演示模式下请求 `DELETE /api/events`；
- 清空服务端 JSONL 和实时内存状态。

该操作不可撤销，清空前应先导出需要保留的会话。

## 10. URL 深链

页面会把当前定位写入查询参数：

```text
?source=codex&session=<sessionId>&event=<eventId>
```

打开该 URL 时，页面会优先选择匹配来源、会话、包含该事件的 Prompt 子运行并定位
事件。深链依赖目标环境中已存在对应 Trace 数据。

## 11. 导入 Codex 历史

导入默认 Codex 目录下所有活动和归档会话：

```bash
pnpm import-codex
```

导入指定 rollout 文件：

```bash
node bin/astro.mjs import-codex /path/to/rollout.jsonl
```

指定 Codex Home：

```bash
node bin/astro.mjs import-codex --codex-home=/path/to/.codex
```

导入器生成确定性事件 ID，因此同一文件重复导入时不会产生重复事件。

## 12. CLI

```text
astro-trace serve
astro-trace install [--target DIR] [--clients trae,claude,codex,deepseek,workbuddy] [--scope user|project]
astro-trace update [--no-deepseek]
astro-trace doctor [--target DIR] [--scope user|project] [--deepseek-profile NAME]
astro-trace migrate [FILE_OR_DIR] [--astro-home DIR]
astro-trace import-codex [FILE ...] [--codex-home DIR]
astro-trace ingest [FILE] [--source NAME]
```

`astro-trace update` 原地刷新已安装插件的内容：重新拷贝 recorder、vendor 依赖、
`dist` 与 `server` 产物并更新 `plugin.json` 版本，同时刷新 DeepSeek 插件包
（`--no-deepseek` 可跳过）。它不改动 hook 配置，也不迁移 trace 数据；构建新版本后
执行 `pnpm build && astro-trace update` 即可让已安装的插件用上新内容。需要重建
hook 集成或迁移数据时，仍使用 `astro-trace install`。

从文件导入通用 JSONL：

```bash
node bin/astro.mjs ingest ./trace.jsonl --source custom-agent
```

从标准输入导入：

```bash
printf '%s\n' \
  '{"sessionId":"s1","eventName":"AgentMessage","payload":{"message":"Done"}}' \
  | node bin/astro.mjs ingest --source custom-agent
```

## 13. HTTP API

### 13.1 健康检查

```bash
curl http://127.0.0.1:4318/api/health
```

### 13.2 写入单个事件

```bash
curl -X POST http://127.0.0.1:4318/api/events \
  -H 'Content-Type: application/json' \
  -H 'X-Astro-Source: custom-agent' \
  -d '{
    "sessionId": "s1",
    "eventName": "AgentMessage",
    "payload": {
      "message": "Done"
    }
  }'
```

### 13.3 批量写入

请求体可以直接是数组：

```json
[
  {
    "sessionId": "s1",
    "eventName": "SessionStart",
    "payload": {}
  },
  {
    "sessionId": "s1",
    "eventName": "Stop",
    "payload": {
      "message": "Done"
    }
  }
]
```

也可以使用：

```json
{
  "events": []
}
```

### 13.4 读取与搜索

```text
GET /api/events
GET /api/events?source=codex&session=<sessionId>
GET /api/events/<eventId>
GET /api/search?q=<query>
GET /api/search?q=<query>&source=codex&session=<sessionId>
GET /api/stream
```

注意：服务端 `/api/search` 可跨嵌套字段搜索；当前 UI 的 LOG 搜索只过滤选中的
Prompt 子运行，无 Prompt 时才回退到完整会话，不直接调用服务端搜索接口。

`/api/stream` 每次初连或重连都先发送完整 `reset`，再发送 `ready`，之后发送
新增 `trace`。服务声明 1 秒重连间隔，因此断线期间产生的后续问答会在重连快照中补齐。

## 14. Browser SDK

```js
import { createAstroClient } from "./plugin/browser-client.js";

const trace = createAstroClient({
  source: "browser",
  workspaceId: "my-extension",
});

await trace.startSession({ extension: "my-extension" });
await trace.submitPrompt("Inspect the current page");

const call = await trace.startTool(
  "querySelector",
  { selector: "main" },
);

await trace.finishTool(
  "querySelector",
  call.toolUseId,
  { matches: 1 },
);

await trace.agentMessage("Inspection finished");
await trace.stop({ message: "Done" });
```

默认写入端点是 `http://127.0.0.1:4318/api/events`。浏览器扩展后台进程需要在 Manifest 中声明对应的回环地址权限。

## 15. 配置

安装时会在共享插件目录创建实际配置：

```text
<ASTRO_HOME>/plugins/astro/config.yaml
<ASTRO_HOME>/plugins/astro/.env
```

普通的结构化配置写入 `config.yaml`；本机私密值写入 `.env`，并通过 `${NAME}` 或
`${NAME:-fallback}` 在 YAML 中引用。仓库根目录的 `config.example.yaml` 和
`.env.example` 只是安装模板，不会直接影响已经安装的插件。

原有环境变量继续作为覆盖方式：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `ASTRO_HOST` | `127.0.0.1` | 服务监听地址 |
| `ASTRO_PORT` | `4318` | 首选端口 |
| `ASTRO_HOME` | `~/.astrox` | 运行时、插件和按来源、时间及 session 拆分的事件文件 |
| `ASTRO_TRACE_DIR` | 未设置 | 可选的相对或绝对共享 Trace 目录 |
| `ASTRO_PROJECT_DIR` | 当前工作目录 | 相对 `ASTRO_TRACE_DIR` 的解析基准 |
| `ASTRO_MAX_BODY_BYTES` | `5242880` | POST 请求体最大字节数 |
| `ASTRO_AUTO_OPEN` | `1` | 安装或 Agent 启动时自动启动并打开控制台；设为 `0` 关闭 |
| `DSH_HOME` | `~/.dsh` | DeepSeek Harness profile 与插件目录 |
| `DSH_COMMAND` | `dsh` | DeepSeek Harness 启动器 |
| `CODEBUDDY_HOME` | `~/.codebuddy` | WorkBuddy / CodeBuddy Code 设置与插件目录 |
| `CODEBUDDY_COMMAND` | `codebuddy` | 诊断时使用的 WorkBuddy / CodeBuddy Code CLI |

`AOT_HOME`、`AGENT_TRACE_*` 和 `TRAE_TRACE_*` 仅作为升级兼容的后备变量保留。

优先级为：显式 CLI 参数、继承的进程环境、插件 `.env`、`config.yaml`、内置默认值。
`ASTRO_HOME` 决定插件所在位置，必须在安装前通过环境变量或 `--astro-home` 设置，
不能写入插件自己的 `.env`。

首次安装会自动创建两个文件，升级不会覆盖。修改后重启 Agent 或 ASTRO 进程：

```bash
$EDITOR ~/.astrox/plugins/astro/config.yaml
$EDITOR ~/.astrox/plugins/astro/.env
astro-trace doctor
```

前端构建时常量 `src/config/app-config.ts` 中的
`appTimings.activeRunTimeoutMs` 控制实时超时，默认值为
`24 * 60 * 60 * 1_000`。修改后需要执行 `pnpm build` 并重启静态服务。该值只控制
有效显示状态，因此现有 JSONL 不需要迁移。

### 15.1 浏览器本地偏好

| 键 | 值 | 说明 |
| --- | --- | --- |
| `ASTROX_THEME` | `light` / `dark` / `system` | 主题 |
| `ASTROX_PLATFORM` | `codex` / `claude` / `trae` | 平台上下文 |
| `ASTROX_HISTORY_OPEN` | `true` / `false` | 左侧 History 展开状态 |
| `ASTROX_CONSOLE_OPEN` | `true` / `false` | 右侧 Events/Inspector 展开状态 |

旧 `astro-theme` 和 `astro-platform` 会自动迁移并在新键写入后删除。Storage
不可用或值非法时使用默认值，不影响 Trace 采集。

### 15.2 从旧数据目录升级

旧项目使用 `~/.astrox`，更早的构建还可能使用项目内
`.agent-trace/events.jsonl`。直接 Hook 安装器会把这两类数据复制到 `~/.astrox`，
除非传入 `--no-migrate`。迁移时还会将已有的 `HH:mm:ss-<sessionId>` 目录重命名
为 `HH_mm_ss-<sessionId>`。原生插件安装不会执行仓库中的迁移脚本。

需要时可手动执行：

```bash
node bin/astro.mjs migrate
node bin/astro.mjs migrate ~/.astrox
node bin/astro.mjs migrate /path/to/.agent-trace
node bin/astro.mjs migrate /path/to/events.jsonl
```

迁移按事件 ID 去重，可重复执行。导入来源文件会保留；旧时间格式目录仅在成功
重命名或无损合并后删除。删除或归档旧数据前先验证：

```bash
find ~/.astrox -type f -name events.jsonl -print
curl http://127.0.0.1:4318/api/health
```

## 16. 数据安全与备份

- 默认仅在回环地址监听。
- Trace 默认只写本地 JSONL。
- 写入前会按敏感字段名和常见秘密格式脱敏。
- `~/.astrox` 应位于项目版本库之外，不要把真实运行数据提交到版本库。
- 分享 Trace 前仍应人工检查 `payload`，规则脱敏无法保证识别所有业务秘密。
- 备份完整会话时复制整个 `~/.astrox`，也可以从界面导出选中的 Prompt 子运行。

不建议在没有认证和 TLS 的情况下把服务绑定到 `0.0.0.0` 或暴露到公共网络。

## 17. 常见问题

### 页面显示 demo

Demo 只应出现在 development/test 且真实事件数为 0 的场景。production 页面空数据
应保持空状态；如果 production 仍显示 Demo，通常是打开了 Vite 开发服务器或旧构建。

检查：

```bash
curl http://127.0.0.1:4318/api/health
curl http://127.0.0.1:4318/api/events
```

### 状态显示 offline

检查服务是否运行、页面端口是否正确，以及 `/api/stream` 是否可连接。开发模式下还要检查 Vite 代理目标是否与 API 端口一致。

### 安装或新会话启动后没有自动打开控制台

确认 Hook 在 `pnpm build` 或 `pnpm build:native-plugins` 之后安装，并检查安装包内
`dist/index.html` 与 `server/server.mjs` 是否存在。所有客户端的安装包均位于
`~/.astrox/plugins/astro`。
若 PID 文件对应的进程已不存在，删除 `<data-root>/dashboard-<port>.pid` 后重新提交
消息。设置
`ASTRO_AUTO_OPEN=0` 会按预期关闭自动启动。

### 已运行 Agent 但没有事件

检查：

1. 对应客户端 Hook 配置是否存在；
2. Hook 命令中的 `trace-recorder.cjs` 路径是否有效；
3. Hook 与服务是否解析到相同的 `ASTRO_HOME` 或 `ASTRO_TRACE_DIR`；
4. 是否在安装 Hook 之后新建了会话；
5. JSONL 文件是否有新增内容；Trae 应检查
   `~/.astrox/trae/YYYY/MM-DD/HH_mm_ss-<sessionId>/events.jsonl`。
6. `/api/health` 返回的 `dataRoot` 和 `traceFiles` 是否指向同一数据根目录。
7. Hook stderr 是否出现 `ASTRO event was not recorded`；该消息说明写入失败而非 UI 延迟。

### 第一轮有记录，后续问答没有记录

`Stop` 只表示当前回答完成，Hook 不应停止。依次确认：

1. 在同一 Agent 会话中连续提交两轮问题，不要重新使用旧的静态导出文件；
2. JSONL 行数在第二轮继续增加，且相同文本仍有不同事件 ID；
3. Hook 与服务使用相同 `ASTRO_HOME`；
4. SSE 重连后首先收到包含完整事件列表的 `reset`；
5. 修改 Hook 配置后已重载工作区或重启客户端。

### Codex 导入后重复

同一文件正常不会重复。若文件路径、行顺序或原始行内容变化，确定性 ID 也会变化，可能被视为新事件。

### 拓扑长时间显示布局中

复杂子智能体拓扑需要更多路由时间。检查浏览器控制台是否存在 Worker 错误；Worker 不可用时系统会回退到主线程，界面可能短暂卡顿。

### 搜索结果与 API 不一致

LOG 搜索范围是当前 Prompt 子运行；`/api/search` 可在过滤范围内搜索服务端全部事件。
两者用途不同。

### 清空后仍看到数据

若页面曾导入本地文件，需要确认导入内存也已清空；若重新出现事件，可能有仍在运行的 Hook 正在继续追加。

### 显示 terminated，但事件中没有终止记录

将显示时长与 `appTimings.activeRunTimeoutMs` 比较。达到实时上限会直接派生
`terminated`，不会新增事件。通过 Raw 页签或导出的 JSONL，可将这种情况与
`Interrupt`、`SessionEnd`、取消或中止证据区分。显示时长恰好封顶为配置阈值，是
超时派生的预期特征。

## 18. 验证与维护

发布或修改后运行：

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm build:native-plugins
```

当前自动化套件包含 182 项测试，覆盖事件模型、Hook、连续问答、Prompt 子运行、
SSE 重连、
存储、迁移、原子投影、拓扑路由、偏好持久化、环境边界和 Vite 代理。

重点手工检查：

- 桌面端三栏展开/折叠；
- `1440 × 900` 桌面视口下三栏、工具栏和回放区无遮挡；
- 拓扑和轨迹切换；
- 四个平台切换；
- Prompt 层级展开、子运行选择、内部滚动和 Live 自动跟随；
- 回放、拖动和速度；
- 导入/导出；
- SSE 新事件和文件截断后的 reset；
- 原子选择、日志选择和检查器同步；
- 深色、浅色和跟随系统主题；
- 刷新后 History、Events、主题和平台选择保持；
- active 会话时长每秒更新、24 小时封顶并在超时后显示 `terminated`；
- 在阈值前 1 毫秒、恰好阈值和超过阈值三个位置验证精确行为；
- 验证 waiting 子行超时、waiting 父行冻结，以及历史终态时长不被截断；
- production 空数据不生成 Demo；
- SSE 断线期间新增事件可由重连 `reset` 补齐。

更完整的协议说明见 [事件协议参考](event-protocol-zh.md)，权限、备份、恢复、升级
和故障矩阵见 [运维与故障处理手册](operations-zh.md)。
