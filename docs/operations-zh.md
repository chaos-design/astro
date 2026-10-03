# ASTRO 运维与故障处理手册

> 面向本地安装、升级、权限配置、数据维护和故障恢复。产品操作请阅读 [使用手册](user-manual-zh.md)，协议细节请阅读 [事件协议参考](event-protocol-zh.md)。

## 1. 运行模型

ASTRO 由三个彼此解耦的部分组成：

1. **采集器**：客户端 Hook 或 SDK 负责把事件追加到 JSONL；即使控制台没有运行，也能继续写入。
2. **本地服务**：扫描 Trace 文件、维护内存索引、提供 HTTP、SSE 和生产静态页面。
3. **浏览器控制台**：通过 SSE 接收完整快照与增量事件，在浏览器内构建会话、轨迹和拓扑。

控制台故障不应中断 Agent。Hook 写入失败也会以诊断消息报告并返回放行结果，但该事件本身无法恢复，除非来源另有历史记录可导入。

## 2. 部署方式

| 模式 | 适用场景 | 运行时来源 | 数据根目录 |
| --- | --- | --- | --- |
| 源码生产模式 | 本仓库本地使用和开发后验收 | 当前仓库 `dist` 与 `server` | `~/.astrox` |
| 开发模式 | 修改 React、服务端或协议 | Vite + Node 服务 | `~/.astrox` 或显式覆盖 |
| 原生 Codex 插件 | Codex 支持 marketplace/plugin | `codex-plugin` 内置副本 | `~/.astrox` |
| 原生 Claude Code 插件 | Claude Code plugin | `claude-plugin` 内置副本 | `~/.astrox` |
| 原生 WorkBuddy 插件 | CodeBuddy Code plugin | `workbuddy-plugin` 内置副本 | `~/.astrox` |
| DeepSeek Harness bundle | `dsh` profile 插件 | `deepseek-plugin` 内置副本 | `~/.astrox` |
| 直接 Hook 安装 | Trae 或不支持原生插件的环境 | `~/.astrox/plugins/astro` | `~/.astrox` |
| 便携式压缩包 | 从其他工作区安装 | tgz 解包后的独立运行时 | `~/.astrox` |

同一个客户端环境不要同时安装原生插件和直接 Hook，否则相同生命周期事件会被采集两次。

## 3. 首次部署

### 3.1 环境要求

- 当前 Node.js LTS；
- Corepack 管理的 pnpm；
- 可写的 `ASTRO_HOME`；
- 可用的本机回环端口；
- 支持 EventSource、Web Worker 和现代 CSS 的浏览器。

### 3.2 构建与启动

```bash
corepack enable
pnpm install
pnpm test
pnpm typecheck
pnpm build
pnpm start
```

默认地址是 `http://127.0.0.1:4318`。如果端口被占用，服务最多尝试后续 20 个端口，并在终端输出最终 URL。

### 3.3 开发模式

Vite 从环境读取 `ASTRO_HOST` 和 `ASTRO_PORT`，默认代理到 `http://127.0.0.1:4318`：

```bash
# 终端 1
ASTRO_HOME="$HOME/.astrox" pnpm start

# 终端 2
pnpm dev
```

如果 API 使用其他端口，两边必须使用同一配置：

```bash
# 终端 1
ASTRO_PORT=4320 pnpm start

# 终端 2
ASTRO_PORT=4320 pnpm dev
```

## 4. 数据与运行时目录

默认布局：

```text
~/.astrox/
  plugins/astro/
    dist/
    plugin/
    server/
  dashboard-4318.pid
  trae/YYYY/MM-DD/HH_mm_ss-<sessionId>/events.jsonl
  claude/YYYY/MM-DD/HH_mm_ss-<sessionId>/events.jsonl
  codex/YYYY/MM-DD/HH_mm_ss-<sessionId>/events.jsonl
  deepseek/YYYY/MM-DD/HH_mm_ss-<sessionId>/events.jsonl
  workbuddy/YYYY/MM-DD/HH_mm_ss-<sessionId>/events.jsonl
  browser/YYYY/MM-DD/HH_mm_ss-<sessionId>/events.jsonl
  <custom-source>/YYYY/MM-DD/HH_mm_ss-<sessionId>/events.jsonl
```

同一会话的后续事件会复用首次创建的时间目录，不会因跨分钟、跨小时或 `Stop` 事件拆分。

### 4.1 权限要求

采集客户端进程必须能：

- 创建 `~/.astrox`；
- 递归创建来源、日期和会话目录；
- 追加写入 `events.jsonl`；
- 创建、读取和删除 `dashboard-<port>.pid`；
- 读取 `~/.astrox/plugins/astro` 中的独立运行时。

Codex 直接 Hook 安装还需要写入 `$CODEX_HOME/hooks.json`，默认是 `~/.codex/hooks.json`。Claude 用户级安装需要写入 `~/.claude/settings.json`。Trae 项目级安装需要写入目标工作区的 `.trae/hooks.json`。DeepSeek 安装通过 `dsh plugin` 更新 `$DSH_HOME/profiles/<profile>`，默认 `$DSH_HOME=~/.dsh`。

在带文件系统沙箱的 IDE 中，应将实际 `ASTRO_HOME` 和对应客户端配置目录加入写权限范围。不要把 `ASTRO_HOME` 指向一个只读项目副本。

### 4.2 权限快速检查

```bash
mkdir -p "$HOME/.astrox"
test -w "$HOME/.astrox"
find "$HOME/.astrox" -type f -name events.jsonl -print
```

如果 Hook 报告 `ASTRO event was not recorded`，优先检查写权限和 Hook/服务是否解析到同一个 `ASTRO_HOME`。

## 5. 配置与优先级

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `ASTRO_HOST` | `127.0.0.1` | HTTP/SSE 监听地址和 Vite 代理主机。 |
| `ASTRO_PORT` | `4318` | 首选服务端口和 PID 文件名中的端口。 |
| `ASTRO_HOME` | `~/.astrox` | 运行时和按来源组织的数据根目录。 |
| `ASTRO_TRACE_DIR` | 未设置 | 覆盖 Trace 目录；可为绝对或相对路径。 |
| `ASTRO_PROJECT_DIR` | 当前目录 | 解析相对 `ASTRO_TRACE_DIR` 的基准。 |
| `ASTRO_MAX_BODY_BYTES` | `5242880` | HTTP 写入体积上限。 |
| `ASTRO_AUTO_OPEN` | `1` | 安装或 Agent 触发时自动启动控制台。 |
| `CODEX_HOME` | `~/.codex` | Codex 配置、活动和归档历史目录。 |

安装器会从仓库模板创建 `<ASTRO_HOME>/plugins/astro/config.yaml` 与 `.env`。
采集器、CLI、服务、安装器、DeepSeek 适配器和 Vite 代理统一读取这两个文件。

新变量优先于兼容变量。`AOT_HOME`、`AGENT_TRACE_*` 和 `TRAE_TRACE_*` 只用于升级兼容。

实时运行超时是前端构建时策略，不是进程环境变量。修改
`src/config/app-config.ts` 中的 `appTimings.activeRunTimeoutMs` 可调整阈值，
默认值为 24 小时。

### 5.1 修改实时运行超时

使用明确的毫秒表达式，便于评审时核对单位：

```ts
export const appTimings = {
  activeRunTimeoutMs: 24 * 60 * 60 * 1_000,
  // ...
} as const;
```

修改后执行：

```bash
pnpm test
pnpm typecheck
pnpm build
```

随后重启静态服务；如果原生插件携带自己的 `dist/index.html`，还需要重新构建和安装
对应插件。JSONL 无需迁移。已经打开旧构建的浏览器会继续使用旧阈值，直到刷新页面。

不要在服务端、采集器或各行组件中分别实现超时，否则会产生互相冲突的状态判断。
前端配置始终是唯一策略来源，纯展示函数通过参数接收该策略。

### 5.2 共享运行时配置

实际生效的文件为：

```text
<ASTRO_HOME>/plugins/astro/config.yaml
<ASTRO_HOME>/plugins/astro/.env
```

安装器首次创建两个文件，升级时不会覆盖。普通配置写入 YAML；机器相关或敏感值写入
`.env`，并在 YAML 中通过 `${NAME}` 或 `${NAME:-fallback}` 引用。

优先级依次为 CLI、继承的环境变量、继承的兼容变量、插件 `.env`、插件 `.env`
中的兼容变量、YAML、内置默认值。`ASTRO_HOME` 是定位插件的引导配置，在插件
`.env` 中设置会被忽略；需要在安装前通过父进程环境或 `--astro-home` 指定。

修改配置后执行 `astro-trace doctor`。它只报告文件有效性和配置来源，不输出变量值。

## 6. 自动启动与 PID

当采集器记录 `SessionStart` 或 `UserPromptSubmit` 时：

1. 检查 `ASTRO_AUTO_OPEN`；
2. 查找同包的 `server/server.mjs` 和 `dist/index.html`；
3. 读取 `dashboard-<requestedPort>.pid`；
4. 若兼容服务已运行，只报告当前 URL，不重复打开标签页；
5. 若 PID 失效或属于其他服务，清理 PID 并启动新的后台服务；
6. 服务完成端口选择后写回实际 URL，并按来源和会话打开深链。

手动模式：

```bash
ASTRO_AUTO_OPEN=0 node ~/.astrox/plugins/astro/server/server.mjs
```

PID 文件是避免重复启动的协调信息，不是 Trace 数据。进程异常结束后如果 PID 没有自动移除，可在确认对应进程不存在后删除该文件。

## 7. 健康检查

### 7.1 HTTP 健康状态

```bash
curl -s http://127.0.0.1:4318/api/health
```

关键字段：

| 字段 | 说明 |
| --- | --- |
| `status` | 正常时为 `ok`。 |
| `pid` | 当前本地服务进程。 |
| `url` | 服务最终监听 URL。 |
| `clientCount` | 当前 SSE 客户端数量。 |
| `eventCount` | Repository 当前聚合事件数。 |
| `dataRoot` | 服务实际扫描的数据根目录。 |
| `traceFiles` | 当前已发现的所有 JSONL 文件。 |

`dataRoot` 和 `traceFiles` 是判断路径是否一致的权威依据。

### 7.2 事件与流

```bash
curl -s http://127.0.0.1:4318/api/events
curl -N http://127.0.0.1:4318/api/stream
```

SSE 首先应出现 `reset`，随后是 `ready`。新事件产生后出现 `trace`。服务声明 1 秒重连间隔；重连时再次发送完整 `reset`，用于补齐断线期间遗漏事件。

### 7.3 CLI doctor

`astro-trace doctor` 会检查独立运行时、控制台、Codex/Claude 的原生插件或直接
Hook、DeepSeek Harness profile bundle，以及各来源按会话分目录后的实际文件数和
总字节数。`DATA` 表示至少存在一个非空 `events.jsonl`；仍可使用
`/api/health.traceFiles` 核对当前服务实际加载的文件清单。

## 8. 连续多轮会话验收

同一会话的标准验收序列：

```text
SessionStart
UserPromptSubmit  turn 1
AgentMessage      turn 1
Stop              turn 1
UserPromptSubmit  turn 2
AgentMessage      turn 2
Stop              turn 2
```

验收要点：

- `Stop` 后 Hook 仍然保留，第二轮无需刷新或重新安装；
- 相同文本的两次问题或回答保留为不同 ID；
- 所有事件追加到同一个会话目录；
- 打开的 SSE 连接收到每个后续事件；
- 模拟断线重连后，`reset` 包含断线期间的完整事件；
- Run History 将会话展开为 `INITIAL` 与编号 `FOLLOW-UP` 子项，每个子项只包含本轮
  Prompt 区间；
- 选择旧子项后，拓扑、轨迹、日志、回放和导出都限定在该区间；点击父行回到最新
  Prompt；
- active 会话时长每秒增加，收到 `Stop` 后停止，后续问题到达后继续按当前时间计算；
  达到默认 24 小时上限后封顶并显示为 `terminated`。

### 8.1 超时验收矩阵

需要手工快速验证时，可临时使用较短的测试阈值，重新构建后执行以下检查，并在发布前
恢复默认值：

| 场景 | 准备方式 | 预期结果 |
| --- | --- | --- |
| 阈值前 | 检查运行到 `阈值 - 1 ms` 的 active Prompt | 状态仍为 `active`，时长未封顶 |
| 恰好阈值 | 将同一 Prompt 推进到阈值 | 状态变为 `terminated`，时长等于阈值 |
| 超过阈值 | 推进到大于阈值 | 时长仍等于阈值 |
| waiting Prompt | 触发权限/用户问题等待并跨过阈值 | 子行变为 `terminated`，不新增虚构事件 |
| waiting 父行 | 最新子项处于 waiting | 父行时长冻结，父行保持 `waiting` |
| 历史终态 | 加载长于测试阈值的 complete 运行 | 原始状态和时长不变 |
| 页面刷新 | 刷新已超时的选中运行 | 重新构建出同一有效状态 |

同时确认超时选中项不再显示日志运行标记或拓扑实时转换。导出其 JSONL，验证其中没有
新增 timeout 事件。

## 9. 备份与恢复

### 9.1 全量备份

先停止当前 Agent 或接受备份期间仍可能追加新行，再复制数据根目录：

```bash
cp -R "$HOME/.astrox" "$HOME/.astrox-backup-$(date +%Y%m%d-%H%M%S)"
```

PID 文件和 `plugins/astro` 可重新生成；真正需要保留的是各来源下的会话目录。对一致性要求较高时，应先停止 Hook 来源和 ASTRO 服务。

### 9.2 单会话与单轮备份

复制对应 `events.jsonl` 可保留完整会话。页面的 **Export run** 导出当前选中的 Prompt
区间，文件名为 `astro-<source>-<sessionId>-prompt-<number>.jsonl`；内容仍是标准
JSONL，适合再次导入。

### 9.3 恢复

把来源会话目录放回 `ASTRO_HOME` 后启动服务。Repository 每 500 ms 发现新文件，并发送全量 `reset`。也可以使用 `astro-trace ingest` 导入标准 JSONL。

## 10. 迁移

直接 Hook 安装器默认迁移：

- 将旧的 `HH:mm:ss-<sessionId>` 会话目录重命名为
  `HH_mm_ss-<sessionId>`；
- 项目内 `.agent-trace/events.jsonl`；
- 旧 `.aot` 根目录；
- 扁平的 `.astrox/<source>/events.jsonl`；
- 项目内按 session 分目录的旧 ASTRO 数据。

手动命令：

```bash
node bin/astro.mjs migrate
node bin/astro.mjs migrate /path/to/events.jsonl
node bin/astro.mjs migrate /path/to/legacy-root
```

目录布局迁移仅在成功重命名或无损合并后删除旧目录；导入来源文件会保留，重复事件
ID 会被跳过。原生 marketplace 安装不会自动运行仓库迁移脚本，需要手动执行一次。

## 11. 升级流程

源码部署：

```bash
git pull
pnpm install
pnpm test
pnpm typecheck
pnpm build
pnpm build:native-plugins
```

然后重新安装所选原生插件，或再次执行 `pnpm install-plugins`。直接安装器会更新 ASTRO 命令并保留无关 Hook。

升级前后检查：

1. `/api/health.dataRoot` 未意外改变；
2. 原生插件内 recorder 与共享 recorder 同步；
3. 已有会话仍可读取；
4. 新会话和后续轮次能继续写入；
5. 生产构建空数据不出现 Demo；
6. 本地主题、平台和面板偏好迁移正常。

## 12. 浏览器本地状态

当前持久化键：

| 键 | 值 | 说明 |
| --- | --- | --- |
| `ASTROX_THEME` | `light` / `dark` / `system` | 主题。 |
| `ASTROX_PLATFORM` | `codex` / `claude` / `deepseek` / `trae` / `workbuddy` | 拓扑平台上下文。 |
| `ASTROX_HISTORY_OPEN` | boolean string | 左侧 History 展开状态。 |
| `ASTROX_CONSOLE_OPEN` | boolean string | 右侧 Events/Inspector 展开状态。 |

旧 `astro-theme` 和 `astro-platform` 会在读取后迁移，并在新键写入时删除。localStorage 不可用时，偏好只在当前页面内生效，不影响 Trace 数据。

## 13. 环境与 Demo 边界

- Vite development 和 test 模式在事件数为 0 时允许展示内置 Demo。
- production build 在事件数为 0 时保持真实空状态，禁止生成测试会话。
- 页面是否显示 Demo 不改变服务端 `eventCount`，也不会写入 JSONL。
- 排障时以 `/api/health` 和 `/api/events` 为准，不要把 Demo 行误判为已采集数据。

## 14. 常见故障矩阵

| 现象 | 优先检查 | 恢复动作 |
| --- | --- | --- |
| 页面打不开 | 进程、端口、`dist/index.html` | 手动启动服务，读取终端实际 URL。 |
| 状态为 offline | `/api/stream`、Vite 代理端口 | 统一 `ASTRO_HOST/PORT`，恢复 SSE。 |
| 第一轮有记录，后续轮次缺失 | Hook 是否仍加载、JSONL 是否继续增长 | 重载客户端配置；检查 `Stop` 后 Hook 配置没有被移除。 |
| JSONL 有事件，页面没有 | `health.dataRoot`、`traceFiles`、SSE reset | 统一数据根目录；重连 SSE 或重启服务。 |
| 后续 Prompt 已写入但列表未出现 | Prompt 层级与当前会话 | 展开会话父行；确认每条 `UserPromptSubmit` 有唯一事件 ID。 |
| Hook 报未记录 | `ASTRO_HOME` 权限和磁盘状态 | 修复写权限/空间后重新触发；历史来源可再导入。 |
| 事件重复 | 是否同时安装原生插件和直接 Hook | 每个客户端只保留一种接入方式。 |
| 清空后重新出现 | 运行中的 Hook 仍在追加 | 先停止 Agent，再执行清空。 |
| 端口不是 4318 | 首选端口被占用 | 使用终端或 PID 中的实际 URL，或释放端口。 |
| active 时长不动 | 会话状态、超时阈值和页面 JS | 检查最新事件是否是新的提示词、页面 JS 是否运行；默认达到 24 小时并显示 `terminated` 属于预期行为。 |
| 父行 waiting，但子行时长仍增加 | 最新 Prompt 是否是等待状态 | 属于预期：父行仅在 active 时增加，waiting 子行继续独立计时直到超时。 |
| terminated 状态没有对应 JSONL 事件 | 显示时长是否等于超时阈值 | 属于派生状态；通过 Raw/导出排除显式 interrupt 或 cancel 证据。 |
| 生产空数据出现 Demo | 是否运行开发服务器或旧构建 | 重新执行 production build 并从本地服务加载。 |

## 15. 容量与维护

当前模型适合单机本地观察：

- Repository 和浏览器都持有完整事件集合；
- `GET /api/events` 没有分页；
- 搜索扫描嵌套字段，没有索引；
- JSONL 没有自动轮转、压缩或保留策略；
- 每 500 ms 发现新文件，每个文件每 250 ms 检查追加字节；
- 路由器默认上限为 500 节点和 1,000 条边。

长期运行建议定期停止服务后归档旧日期目录，并在归档前验证导出可读。团队部署需要另行增加认证、TLS、授权、持久索引、分页和保留策略。

## 16. 发布验收清单

- `pnpm test`：当前 182 项测试全部通过。
- `pnpm typecheck`：无 TypeScript 错误。
- `pnpm build`：生产构建成功。
- `pnpm build:native-plugins`：原生插件副本同步。
- 源码生产模式和开发模式均能连接正确 API。
- 所有 Hook 客户端可记录重复文本的连续问答。
- SSE 初连和重连都先收到完整 `reset`。
- 多 Prompt 会话展示相互隔离的 `INITIAL` 与 `FOLLOW-UP` 子运行。
- 子运行选择能同步限定拓扑、日志、回放、深链和导出范围。
- active 时长每秒变化，默认在 24 小时封顶并变为 `terminated`。
- 阈值前、恰好阈值和超过阈值的检查全部通过。
- waiting 子行、冻结的 waiting 父行、历史终态时长和刷新重建符合验收矩阵。
- 超时选中项停止运行标记和拓扑转换，且没有新增 timeout 事件。
- History、Events、主题和平台偏好刷新后保留。
- production 空数据不显示 Demo。
- 导入、导出、清空和深链行为正常。
- `1440 x 900` 控制台与演示 HTML 无遮挡，窄窗口按比例缩放。
