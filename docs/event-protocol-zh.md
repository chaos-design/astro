# ASTRO 事件协议参考

> 协议版本：Schema v2  
> 适用范围：Hook 采集器、Codex 历史导入、Browser SDK、HTTP API、JSONL 导入导出与前端投影

## 1. 设计目标

ASTRO 事件协议把不同编码智能体的生命周期、消息、工具和子智能体信号转换为同一份可持久化事实。协议遵循以下约束：

- **事实优先**：标准字段用于检索和关联，来源原始信息继续保存在 `payload` 中。
- **追加写入**：一个事件对应 JSONL 中的一行，正常采集不会原地修改历史行。
- **未知兼容**：无法识别的事件名和额外字段不会导致整条记录被丢弃。
- **稳定关联**：会话、轮次、父子智能体和工具调用使用独立 ID，不依赖显示文本推断。
- **写前脱敏**：Hook 与 HTTP 写入链路在持久化前处理常见敏感字段和秘密格式。
- **本地优先**：默认写入 `~/.astrox`，不要求远程数据库。

## 2. 标准事件封装

一条完整事件示例：

```json
{
  "schemaVersion": 2,
  "id": "evt-018f5f7f",
  "capturedAt": "2026-09-09T06:30:12.418Z",
  "source": "trae",
  "sourceVersion": null,
  "workspaceId": "58f9d6b37d2a",
  "sessionId": "session-42",
  "turnId": "turn-3",
  "parentId": null,
  "eventName": "PreToolUse",
  "nativeEventName": "PreToolUse",
  "toolUseId": "tool-17",
  "toolName": "exec_command",
  "cwd": "/workspace/example",
  "status": null,
  "sequence": 18,
  "payload": {
    "tool_input": {
      "cmd": "pnpm test"
    }
  },
  "locator": "trace://trae/session-42/evt-018f5f7f"
}
```

### 2.1 字段定义

| 字段 | 类型 | 必填 | 语义与生成规则 |
| --- | --- | --- | --- |
| `schemaVersion` | number | 是 | 当前写入值为 `2`；读取端仍会归一化旧格式。 |
| `id` | string | 是 | 事件唯一 ID。实时采集默认生成 UUID；Codex 历史导入使用确定性哈希。 |
| `capturedAt` | ISO 8601 string | 是 | 来源时间或采集时间，写入时标准化为 ISO 字符串。 |
| `source` | string | 是 | 规范化来源名，例如 `trae`、`claude`、`codex`、`workbuddy`、`browser`。 |
| `sourceVersion` | string | null | 是 | 来源客户端版本；无法获知时为 `null`。 |
| `workspaceId` | string | 是 | 工作区隔离键；缺省时由绝对 `cwd` 的 SHA-256 前 12 位生成。 |
| `sessionId` | string | 是 | 来源侧会话 ID；无法获知时为 `unknown-session`。 |
| `turnId` | string | null | 是 | 来源侧轮次 ID；没有显式轮次时允许为 `null`。 |
| `parentId` | string | null | 是 | 父智能体、子智能体或父执行关系 ID。 |
| `eventName` | string | 是 | ASTRO 规范事件名；未知名称原样保留。 |
| `nativeEventName` | string | 是 | 来源原始事件名，用于排障和兼容性分析。 |
| `toolUseId` | string | null | 是 | 工具开始与结果的关联 ID。 |
| `toolName` | string | null | 是 | 工具、函数或来源 item 类型。 |
| `cwd` | string | null | 是 | 事件发生时的工作目录或浏览器上下文 URL。 |
| `status` | string | null | 是 | 来源状态或 ASTRO 推断的 `failed`。 |
| `sequence` | number | null | 是 | 来源可选序号；没有可靠序号时为 `null`。 |
| `payload` | object | 是 | 脱敏后的来源业务载荷和补充字段。 |
| `locator` | string | 是 | 可复制定位符：`trace://source/session/event`。 |

## 3. 来源名称归一化

采集器把来源名转为小写，并应用以下归类：

| 输入包含 | 标准来源 |
| --- | --- |
| `claude` | `claude` |
| `codex` 或 `openai` | `codex` |
| `deepseek` 或精确的 `dsh` | `deepseek` |
| `workbuddy` 或 `codebuddy` | `workbuddy` |
| `trae` | `trae` |
| `browser`、`chrome` 或 `extension` | `browser` |
| 其他名称 | 转为只含 `a-z0-9._-` 的自定义来源名 |

来源目录使用同样的小写安全名称。自定义来源应选择长期稳定的标识，不要把版本号或机器名拼入 `source`。

## 4. 规范事件类型

当前识别 17 类核心规范事件：

| 类别 | 事件 | 语义 |
| --- | --- | --- |
| 会话 | `SessionStart` | 会话运行时已创建或首次可观察。 |
| 会话 | `SessionEnd` | 会话明确结束。 |
| 会话 | `Interrupt` | 会话或轮次被中止、取消或打断。 |
| 交互 | `UserPromptSubmit` | 用户提交一轮输入；同文案重复提交也必须保留。 |
| 消息 | `AgentMessage` | 智能体中间或最终可见消息。 |
| 消息 | `Reasoning` | 来源提供的推理摘要或推理更新。 |
| 工具 | `PreToolUse` | 工具调用开始。 |
| 工具 | `PostToolUse` | 工具调用成功返回。 |
| 工具 | `PostToolUseFailure` | 工具调用失败返回。 |
| 交互 | `PermissionRequest` | 智能体请求权限或确认。 |
| 交互 | `Elicitation` | 智能体等待结构化用户输入。 |
| 交互 | `ElicitationResult` | 已收到请求的用户输入。 |
| 信号 | `Notification` | 无法归入其他语义的运行时通知。 |
| 子智能体 | `SubagentStart` | 子智能体开始执行。 |
| 子智能体 | `SubagentStop` | 子智能体结束并返回。 |
| 轮次 | `Stop` | 当前回答或轮次完成，不代表整个会话订阅结束。 |
| 轮次 | `StopFailure` | 当前回答因运行时或 API 故障停止。 |

限流类 `StopFailure` 和等待类通知会保留原始语义，使界面可显示等待态。未识别
事件按原名称保留，前端以 Unknown 语义显示。

投影层将 `PermissionRequest`、`PermissionDenied`、`Elicitation`、
`ElicitationResult` 和 `Notification` 映射为 `user.question` 显示键。通用工具
生命周期中的 `AskUserQuestion`、`request_user_input` 或 `UserQuestion` 也映射到
同一原子；开始与完成事件分别打开和关闭一次等待交互。持久化的 `eventName` 与
`nativeEventName` 保持不变，仍可在详情中检查。

## 5. Codex 原生事件映射

Codex Hook 或 rollout 记录会按外层 `type` 和内层 `payload.type` 推断：

| Codex 记录 | ASTRO 事件 |
| --- | --- |
| `session_meta`、`thread.started` | `SessionStart` |
| `turn.started`、运行错误或其他状态信号 | `Notification` |
| `turn.completed`、`task_complete` | `Stop` |
| `turn.aborted`、`turn.cancelled`、`turn_aborted` | `Interrupt` |
| 工具类 `item.started` | `PreToolUse` |
| 工具类 `item.completed` | `PostToolUse` |
| `agent_message`、`assistant_message` | `AgentMessage` |
| `reasoning` | `Reasoning` |
| 用户角色的 message | `UserPromptSubmit` |

工具类 item 包括 `command_execution`、`file_change`、`mcp_tool_call`、`web_search`、`function_call` 和 `custom_tool_call`。

DeepSeek Harness bundle 直接消费规范 Session 事件：`user/message` 映射为
`UserPromptSubmit`，`assistant/message` 映射为 `AgentMessage`，
`tool/call` 与 `tool/result` 映射为工具开始/结果，`turn/end` 映射为
`Stop` 或 `Interrupt`。其他 Harness 事件保留为 `Notification`。

## 6. 标识与关联规则

### 6.1 会话隔离

前端会话键为：

```text
source::workspaceId::sessionId
```

只使用 `sessionId` 会让不同平台或工作区的同名会话互相污染，因此消费端必须使用完整键。

### 6.2 工具配对

`PreToolUse` 与 `PostToolUse` / `PostToolUseFailure` 通过同一个 `toolUseId` 配对。配对后轨迹视图把两条事件显示为一个步骤，并计算开始到结果的持续时间。缺少结果事件时，该步骤保持运行中。

### 6.3 子智能体关系

`parentId`、`payload.agent_id`、`payload.subagent_id` 等来源字段用于识别委派关系。ASTRO 会为观测到的子智能体动态建立执行域；没有直接事件证据的中间原子会明确标记为 `INFERRED`。

### 6.4 轮次关系

优先使用显式 `turnId`。来源没有轮次 ID 时，轨迹模型会依据提示词、停止和事件顺序推断轮次边界。推断结果只用于展示，不会回写原始事件。

控制台还会从每条 `UserPromptSubmit` 派生一个 Prompt 子运行。该子运行包含当前 Prompt
及下一条 Prompt 之前的全部事件；第一项分类为 `initial`，后续项分类为
`follow-up`。这是读取时的 UI 投影，不会新增协议字段或持久化记录。

## 7. 会话状态与持续时间

`Stop` 是一轮回答完成，不会关闭同一 `sessionId` 的后续采集。新的
`UserPromptSubmit` 会开始一个 Prompt 子运行，并把事件派生状态重新置为 `active`，
直到下一次停止、等待、失败或终止信号。

### 7.1 事件派生状态

事件按确定顺序折叠，后到且适用的证据会覆盖先前状态：

| 事件或条件 | 事件派生状态 | 说明 |
| --- | --- | --- |
| `SessionStart` 或 `UserPromptSubmit` | `active` | 新 Prompt 开始新的诊断区间。 |
| 权限、用户问题、限流、退避或显式等待信号 | `waiting` | 等待不等于失败或终止。 |
| `waiting` 或 `failed` 后出现执行进展 | `active` | 新证据表明执行已经恢复。 |
| 失败信号 | `failed` | 保持到后续进展、Prompt 或终态证据出现。 |
| `Stop` | `complete` | 只结束当前回答。 |
| `Interrupt`、`SessionEnd`、取消、中止或等价信号 | `terminated` | 明确的终止证据。 |
| 同一来源和工作区出现更新会话 | 旧 active 会话变为 `terminated` | 避免遗留会话永久保持 Live。 |

这些状态属于读取模型。生产者应上报真实观察事件，不应生成虚构的超时事件。

### 7.2 持续时间与有效显示状态

已完成运行的持续时间是最后事件减第一事件。对 `active` 和 `waiting` Prompt 子运行，
候选实时持续时间为：

```text
max(已记录跨度, 当前时间 - 开始时间)
```

前端将该值与 `appTimings.activeRunTimeoutMs` 比较，默认阈值为 24 小时：

| 候选持续时间 | 有效持续时间 | 有效状态 |
| --- | ---: | --- |
| `< 阈值` | 候选持续时间 | 事件派生状态 |
| `= 阈值` | 阈值 | `terminated` |
| `> 阈值` | 阈值 | `terminated` |

已有终态不会进入实时计算，原始状态和时长都会保留。Session 父行比 Prompt 子行更
严格：父行只有在最新 Prompt 为 `active` 时继续计时，而 Prompt 子行在 `active` 或
`waiting` 时继续计时。

超时只是有效 UI 投影，不会新增事件、替换已存 Session 状态或改写 JSONL。它会停止
当前选中运行的 Live 动画与运行标记。当没有父行或 Prompt 仍符合继续计时条件时，
页面会移除一秒刷新定时器。刷新页面后，系统根据事件、时间戳、当前时间和配置阈值
重新得到相同结果。

### 7.3 边界示例

以 24 小时阈值为例：

- `23:59:59.999` 仍保持 Live；
- `24:00:00.000` 恰好封顶并显示为 `terminated`；
- 一条持续 30 小时且已完成的历史运行仍显示 complete 和 30 小时时长；
- waiting Prompt 子行会超时，但父行保持 waiting 且时长冻结，因为父行仅在最新
  Prompt 为 active 时增加；
- 修改阈值只会在重新构建前端后改变展示，不需要迁移已存事件。

## 8. 顺序、幂等与重复数据

- JSONL 保留实际追加顺序。
- Repository 聚合多个文件时先按 `capturedAt`，再按 `id` 排序。
- 会话模型内部先按 `capturedAt`，同时间再按 `sequence` 排序。
- API 与 Repository 以 `id` 去重；已存在 ID 不会再次追加。
- Codex 历史导入 ID 由文件路径、行号、时间、类型和调用 ID 共同确定，因此未变化的文件可重复导入。
- 实时 Hook 事件默认生成随机 ID；两个内容完全相同的后续问题或回答仍是两条独立事件。

消费端不得按消息文本去重，也不应假设不同来源的 `sequence` 可比较。

## 9. Payload 补全

为方便跨来源展示，采集器会在不删除原字段的前提下补充常用结构：

| 事件 | 规范 payload 字段 | 补全来源 |
| --- | --- | --- |
| `UserPromptSubmit` | `prompt` | message、嵌套 message 或文本 content |
| `AgentMessage` | `message` | 嵌套 message、item.text 或文本 content |
| `PreToolUse` | `tool_input` | item.arguments、item.command 或 item 本身 |
| `PostToolUse*` | `tool_response` | item.output、item.result 或 item 本身 |

字符串形式的工具参数会优先尝试 JSON 解析，解析失败则保留原字符串。

## 10. 写入前脱敏

以下键名会递归替换为 `[redacted]`：authorization、cookie、password、passwd、secret、API key、access token、refresh token、credential 和 private key 的常见写法。

字符串中还会处理：

- Bearer Token；
- `sk-` 前缀密钥；
- 常见 `key=value` 或 `key: value` 秘密；
- 三段式 JWT。

这是降低误采集风险的规则集，不是完整 DLP。提示词、代码、文件路径和业务数据仍可能敏感，导出或分享前必须人工检查。

## 11. JSONL 约定

每行必须是一个独立 JSON 对象：

```jsonl
{"schemaVersion":2,"id":"e1","capturedAt":"2026-09-09T06:30:00.000Z","source":"custom-agent","workspaceId":"demo","sessionId":"s1","eventName":"SessionStart","payload":{}}
{"schemaVersion":2,"id":"e2","capturedAt":"2026-09-09T06:30:01.000Z","source":"custom-agent","workspaceId":"demo","sessionId":"s1","eventName":"UserPromptSubmit","payload":{"prompt":"Inspect the build"}}
```

读取器会隔离损坏行并继续处理后续有效行。不要格式化为跨多行 JSON，也不要在同一行拼接两个对象。

## 12. HTTP 写入契约

`POST /api/events` 接受三种请求体：

1. 单个事件对象；
2. 事件数组；
3. `{ "events": [...] }` 包装体。

可通过 `X-Astro-Source` 指定来源。成功返回 HTTP 202：

```json
{
  "accepted": 1,
  "events": [
    {
      "id": "evt-018f5f7f",
      "locator": "trace://custom-agent/s1/evt-018f5f7f"
    }
  ]
}
```

`accepted` 只统计本次真正新增的事件。重复 ID 被忽略。请求体超过 `ASTRO_MAX_BODY_BYTES` 返回 413，无效 JSON 返回 400。

## 13. SSE 实时契约

连接 `GET /api/stream` 后，服务按以下顺序发送：

1. `reset`：当前完整事件快照；
2. `ready`：包含 `eventCount` 和 `connectedAt`；
3. `trace`：连接存续期间的单条新增事件；
4. 后续 `reset`：文件截断、发现新 Trace 文件或 Repository 需要全量同步时发送。

服务声明 `retry: 1000`。浏览器 EventSource 重连后会再次收到完整 `reset`，因此断线期间遗漏的后续问答能够被补齐。客户端处理 `trace` 时仍应按 ID 去重。

## 14. 导入、导出与兼容

- 页面导入支持 JSON 数组和 JSONL。
- 旧字段如 `event_name`、`session_id`、`tool_use_id` 会在读取时归一化。
- 页面导入只存在当前浏览器内存，不自动写入服务端。
- 页面导出以标准 JSONL 保存当前 Prompt 子运行；没有 Prompt 的会话使用会话级
  兼容回退。
- 未知 `payload` 字段应透传；新增消费者不应只白名单复制已知业务字段。

## 15. 版本演进规则

修改协议时应同时完成：

1. 保持旧字段读取兼容，或明确提供迁移工具。
2. 对新增字段给出缺省值和 nullability。
3. 更新 Hook、HTTP、Browser SDK 和导入路径的测试。
4. 更新中英文架构、用户手册和本协议文档。
5. 对事件 ID、会话键或关联规则的变化增加幂等与回放回归测试。

## 16. 生产者检查清单

- 使用稳定的 `source`、`workspaceId` 和 `sessionId`。
- 每个实际事件生成唯一 `id`；不要按消息文本去重。
- 工具开始和结束复用同一个 `toolUseId`。
- 可用时提供 `turnId`、`parentId` 和单调 `sequence`。
- 时间使用带时区的 ISO 8601。
- 把来源原始名称写入 `nativeEventName`。
- 在发送前避免放入不必要的凭证和大体积二进制内容。
- 用 `/api/health`、`/api/events` 和 `/api/stream` 验证落盘与实时链路。

实现归属、代码证据与交付状态参见
[实现细节与规划状态](implementation-details-zh.md)。
