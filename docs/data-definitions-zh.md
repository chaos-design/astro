# ASTRO 数据定义参考

> 适用范围：`TraceEvent` 持久化模型、标识键、读取投影与存储布局。
> 事件语义、写入契约与脱敏规则的完整行为定义见《ASTRO 事件协议参考》。

## 1. 术语总览

| 术语 | 定义 |
| --- | --- |
| TraceEvent | ASTRO 的最小持久化事实单元。所有客户端信号都归一化为该结构后落盘。 |
| Session（会话） | 同一来源内一次连续的智能体执行上下文，以 `sessionId` 标识。 |
| 工作区（Workspace） | 事件的空间隔离维度，以 `workspaceId` 标识。 |
| 来源（Source） | 产生事件的客户端类型，如 `claude`、`codex`、`workbuddy`。 |
| Prompt 子运行 | 控制台从每条 `UserPromptSubmit` 派生的读取时区间，包含该提示词到下一条提示词之前的全部事件。 |
| 执行域（Execution Domain） | 控制台为会话内每个执行主体（主智能体或子智能体）动态划分的分组。 |
| 原子（Atom） | 拓扑图上的最小执行节点，由原子事件或配对的工具事件折叠而成。 |
| 轨迹（Trajectory） | 以轮次为骨架、串联消息与工具步骤的时序视图。 |
| 投影（Projection） | 读取时由事件推导的 UI 状态（状态、时长、拓扑、轨迹），不落盘、不回写。 |

## 2. 存储布局

所有客户端共用用户级数据根目录，默认 `~/.astrox`，可用 `--astro-home` 修改：

```text
~/.astrox/
├── <source>/YYYY/MM-DD/HH_mm_ss-<sessionId>/events.jsonl
├── plugins/astro/                       # 控制台服务与前端产物
│   └── server/server.mjs
└── dashboard-<port>.pid                 # 控制台进程标记
```

- 目录按来源、日期与会话分层；`<source>` 是与事件 `source` 字段一致的小写安全名。
- `events.jsonl` 为只追加（append-only）的 JSON Lines 文件，每行一条 `TraceEvent`。
- 会话目录一旦创建即不再改名；新会话产生新目录。

## 3. TraceEvent 字段定义

当前 `schemaVersion` 为 `2`。字段语义与生成规则：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `schemaVersion` | number | 是 | 写入协议版本；读取端归一化旧格式。 |
| `id` | string | 是 | 事件唯一 ID。实时采集为 UUID；Codex 历史导入为确定性哈希。 |
| `capturedAt` | ISO 8601 string | 是 | 来源时间或采集时间。 |
| `source` | string | 是 | 归一化来源名。 |
| `sourceVersion` | string \| null | 是 | 来源客户端版本，未知为 `null`。 |
| `workspaceId` | string | 是 | 工作区隔离键；缺省时取绝对 `cwd` 的 SHA-256 前 12 位。 |
| `sessionId` | string | 是 | 来源侧会话 ID；缺省为 `unknown-session`。 |
| `turnId` | string \| null | 是 | 来源侧轮次 ID，无显式轮次时为 `null`。 |
| `parentId` | string \| null | 是 | 父子智能体或父执行关系 ID。 |
| `eventName` | string | 是 | 规范事件名，未知名称原样保留。 |
| `nativeEventName` | string | 是 | 来源原始事件名。 |
| `toolUseId` | string \| null | 是 | 工具开始与结果的关联键。 |
| `toolName` | string \| null | 是 | 工具、函数或来源 item 类型。 |
| `cwd` | string \| null | 是 | 事件发生时的工作目录或浏览器上下文 URL。 |
| `status` | string \| null | 是 | 来源状态；缺省时按规范事件名补 `failed`（`PostToolUseFailure`、`StopFailure`）或 `interrupted`（`Interrupt`）。 |
| `sequence` | number \| null | 是 | 来源可选序号，无可靠序号时为 `null`。 |
| `payload` | object | 是 | 脱敏后的来源业务载荷与补充字段。 |
| `locator` | string | 是 | 可复制定位符 `trace://source/session/event`。 |

## 4. 标识键

| 键 | 组成 | 用途 |
| --- | --- | --- |
| 事件 ID | UUID 或确定性哈希 | 去重与单事件定位。 |
| 会话键 | `source::workspaceId::sessionId` | 前端会话隔离；仅用 `sessionId` 会跨平台污染。 |
| 工作区键 | `workspaceId` | 工作区维度聚合。 |
| 工具配对键 | `toolUseId` | 把 `PreToolUse` 与 `PostToolUse` / `PostToolUseFailure` 折叠为一个轨迹步骤。 |
| 定位符 | `trace://source/session/event` | 人可读的跨系统引用。 |

## 5. 来源归一化

| 输入包含 | 标准来源 |
| --- | --- |
| `claude` | `claude` |
| `codex` 或 `openai` | `codex` |
| `deepseek` 或精确的 `dsh` | `deepseek` |
| `workbuddy` 或 `codebuddy` | `workbuddy` |
| `trae` | `trae` |
| `browser`、`chrome` 或 `extension` | `browser` |
| 其他 | 转为只含 `a-z0-9._-` 的自定义来源名 |

## 6. 规范事件类型

当前识别 17 类核心事件：

| 类别 | 事件 | 语义 |
| --- | --- | --- |
| 会话 | `SessionStart` | 会话运行时已创建或首次可观察。 |
| 会话 | `SessionEnd` | 会话明确结束。 |
| 会话 | `Interrupt` | 会话或轮次被中止、取消或打断。 |
| 交互 | `UserPromptSubmit` | 用户提交一轮输入。 |
| 消息 | `AgentMessage` | 智能体中间或最终可见消息。 |
| 消息 | `Reasoning` | 推理摘要或推理更新。 |
| 工具 | `PreToolUse` | 工具调用开始。 |
| 工具 | `PostToolUse` | 工具调用成功返回。 |
| 工具 | `PostToolUseFailure` | 工具调用失败返回。 |
| 交互 | `PermissionRequest` | 请求权限或确认。 |
| 交互 | `Elicitation` | 等待结构化用户输入。 |
| 交互 | `ElicitationResult` | 已收到请求的用户输入。 |
| 信号 | `Notification` | 无法归入其他语义的运行时通知。 |
| 子智能体 | `SubagentStart` | 子智能体开始执行。 |
| 子智能体 | `SubagentStop` | 子智能体结束并返回。 |
| 轮次 | `Stop` | 当前回答或轮次完成。 |
| 轮次 | `StopFailure` | 当前回答因故障停止。 |

## 7. 读取投影

### 7.1 事件派生状态

| 状态 | 触发 |
| --- | --- |
| `active` | `SessionStart` / `UserPromptSubmit`，或 `waiting`、`failed` 后出现执行进展。 |
| `waiting` | 权限请求、用户问题、限流、退避或显式等待信号。 |
| `failed` | 失败信号，保持到后续进展、Prompt 或终态证据出现。 |
| `complete` | `Stop`（只结束当前回答）。 |
| `terminated` | `Interrupt`、`SessionEnd` 或等价终止证据。 |

异常的判定顺序为 **终止 > 等待 > 失败 > 停止 > 恢复**：工具失败与用户拒绝是可
恢复的 `failed`，轮次失败（`StopFailure`、`Stop` + `failed`）与中止是终态，限流类
失败派生 `waiting`。完整边界、各客户端入口与载荷规则见《ASTRO 事件协议参考》
§4.1，读取端分类实现在 `src/lib/exception-events.ts`。

### 7.2 Prompt 子运行

每条 `UserPromptSubmit` 派生一个 Prompt 子运行，包含当前提示词到下一条提示词之前的全部事件；第一条分类为 `initial`，后续为 `follow-up`。子运行是读取时投影，不新增协议字段。

### 7.3 持续时间与超时

已完成运行的持续时间为最后事件减第一事件。`active` / `waiting` 的实时候选时长为
`max(已记录跨度, 当前时间 - 开始时间)`，与 `appTimings.activeRunTimeoutMs`（默认
24 小时）比较：达到或超过阈值显示为 `terminated` 并封顶时长。超时是有效 UI 投影，
不新增事件、不改写已存状态。

## 8. 排序与去重

- 文件内保持追加顺序；跨文件聚合先按 `capturedAt` 再按 `id`。
- 会话模型内同时间戳再按 `sequence`。
- 以 `id` 去重；已存在 ID 不会再次追加。
- 不按消息文本去重，也不假设不同来源的 `sequence` 可比较。

## 9. 演进约束

- `events.jsonl` 只追加；已写入事件不可变。
- 读取投影（状态、时长、拓扑、轨迹、超时）不回写事件，也不新增持久化记录。
- 字段演进通过 `schemaVersion` 演进，读取端向后兼容旧格式。
