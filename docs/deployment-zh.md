# 部署指南

> ASTRO 全部部署目标的完整参考：本地服务、云端控制台、文档站，以及环境变量、
> 配置文件与故障排查速查。用户侧行为（Live 筛选、时间窗口、偏好）见
> [使用手册](user-manual-zh.md)；权限与容量边界见 [运维手册](operations-zh.md)。

## 1. 部署拓扑

ASTRO 是 local-first 的：数据与采集永远在读者自己的机器上。可部署的只有两个
**静态产物**——控制台与文档站——它们可以放在任何静态主机上，通过 CORS 读
本机服务的数据：

| 组件 | 位置 | 说明 |
| --- | --- | --- |
| 本地服务 | 读者机器 | Node 单文件服务（`server/server.mjs`）：数据读写、SSE 流、静态托管控制台 |
| 控制台 | 本地或云 | 纯静态页。本地时由服务直接托管；云部署时通过 `?api=` / 同源回落到 `http://127.0.0.1:5678` |
| 文档站 | 云或任意静态主机 | 构建时把 `docs/*.md` 内联进产物，自包含 |

控制台寻址的唯一定义在 `src/lib/api-base.ts`：`?api=`（持久化为
`ASTROX_API_BASE`）→ 已存值 → 页面本身是本地源时同源 → 否则
`http://127.0.0.1:5678`。挂载后不再中途变更。

## 2. 本地服务：安装与运行

### 2.1 前提

- 当前 Node.js LTS（支持原生 ESM 与所用依赖树）。
- pnpm（仓库通过 `packageManager` 字段锁定版本；`corepack enable` 即可）。

### 2.2 从源码安装运行

```bash
corepack enable
pnpm install
pnpm build        # 控制台 → dist/
pnpm start        # 服务：127.0.0.1:5678，托管 dist/
```

服务缺 `dist/index.html` 时返回 503「Dashboard is not built. Run
`pnpm build` first.」——**安装后服务能起、但控制台 503，第一反应就是构建没做
或做在了别的目录**。端口被占用时服务从首选端口起逐步上探（最多 +20），
启动日志打印实际端口。

### 2.3 数据与配置的位置

`ASTRO_HOME`（默认 `~/.astrox`）：

```text
<ASTRO_HOME>/plugins/astro/config.yaml   # 结构化配置（安装时生成，升级不覆盖）
<ASTRO_HOME>/plugins/astro/.env          # 私密值（mode 0600），YAML 可用 ${VAR} / ${VAR:-默认} 引用
<ASTRO_HOME>/<source>/<日期>/<session>/events.jsonl   # 按来源、时间、session 拆分的事件
```

`config.yaml` 字段：`server.host` / `server.port` / `server.maxBodyBytes` /
`server.corsOrigins`、`runtime.autoOpen`、`storage.traceDir` /
`storage.projectDir`、`clients.{codex,claude,deepseek,workbuddy}.{home,command}`
（完整注释见仓库根目录的 `config.example.yaml`）。

**优先级**：显式 CLI 参数 → 继承的进程环境变量 → 升级兼容的旧变量（
`AOT_HOME`、`AGENT_TRACE_*`、`TRAE_TRACE_*`）→ 插件 `.env` → `config.yaml`
→ 内置默认值。`ASTRO_HOME` 决定插件自身位置，必须在安装前经环境变量或
`--astro-home` 指定，不能写进插件自己的 `.env`。

### 2.4 环境变量全表

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `ASTRO_HOST` | `127.0.0.1` | 服务监听地址 |
| `ASTRO_PORT` | `5678` | 首选端口；冲突时逐步上探（最多 +20） |
| `ASTRO_MAX_BODY_BYTES` | `5242880` | POST 请求体上限 |
| `ASTRO_CORS_ORIGINS` | 未设置（关闭跨域） | 允许读取本机 API 的部署页来源，逗号分隔；`*` 需显式写出。等价配置项 `server.corsOrigins`（无 shell 可传变量的安装运行时用这个） |
| `ASTRO_HOME`（`AOT_HOME`） | `~/.astrox` | 运行时、插件与事件文件的根目录 |
| `ASTRO_TRACE_DIR` | 未设置 | 数据目录覆盖；也可经控制台「数据目录 → 更改」（`POST /api/config/data-root`）写入插件 `.env` 后自动重启生效 |
| `ASTRO_PROJECT_DIR` | 当前工作目录 | 相对 `ASTRO_TRACE_DIR` 的解析基准 |
| `ASTRO_DEMO_EVENTS` | 未设置 | 示例数据集（`GET /api/demo-events`）路径覆盖 |
| `ASTRO_PID_FILE` | 自动 | 记录器启动服务时写入的 pid 文件位置（`astrox status/restart` 依赖） |
| `ASTRO_OPEN_BROWSER` | 继承 | 服务启动是否开浏览器；记录器以 `0` 无头启动服务 |
| `ASTRO_OPEN_SOURCE` / `ASTRO_OPEN_SESSION` | 未设置 | 记录器启动服务时传入的深度链接来源与 session |
| `ASTRO_TAKEOVER` | 内部 | 原地重启标记，继任进程继承同端口；勿手工设置 |
| `ASTRO_RESTART_COUNT` / `ASTRO_RESTARTED_AT` | 内部 | 原地重启的计数与时间戳，`/api/health` 会报告 |

### 2.5 启用各客户端的采集

- **直接 Hook（通用）**：`pnpm install-plugins [--clients codex,claude,...]`。
  自动把记录器、`dist/`、`server/` 与 `config.yaml` 装进
  `<ASTRO_HOME>/plugins/astro/` 并写好各客户端的 hook 配置；`dist/` 缺失时
  先自动执行 `pnpm build`（`--no-build` 可跳过）。
- **原生插件**：先 `pnpm build:native-plugins`（把运行时同步进
  `*-plugin/` 并打版本号），再按客户端安装：
  - Codex：`codex plugin add astro-codex-local`
  - Claude Code：`claude plugin add astro-claude-local`
  - WorkBuddy：`codebuddy plugin add astro-workbuddy-local`
  - DeepSeek Harness：`dsh plugin add cordis --source ~/.astrox/plugins/astro`
- **独立安装器**：ZCode（`pnpm install-zcode-plugin`）、OpenCode
  （`pnpm install-opencode-plugin`）、Pi（`pnpm install-pi-plugin`）。

安装/启动会顺带把仪表盘跑起来；之后的刷新用
`astrox update`（复制新构建）+ `astrox restart`。

### 2.6 服务管理与升级

```bash
astrox status|start|stop|restart|update|logs|doctor|path|open|info
```

两个 HTTP 端点等价于对应动作（控制台服务卡片在用）：

- `POST /api/restart`——**原地重启**：继任进程接管同一端口（takeover），
  SSE 客户端与浏览器标签自动重连，端口不漂移。重启意味着新进程重读全部
  文件，所以控制台会丢掉快照游标并重新订阅。
- `POST /api/config/data-root`，body `{"path": "/abs/path"}`——把数据目录
  写进插件 `.env`（保留其他行，拒绝缺失/相对路径），然后原地重启；
  `/api/health` 的 `dataRoot` 字段报告结果。

**陈旧包陷阱**：安装运行时服务的是 `<ASTRO_HOME>/plugins/astro/dist`，
**不是**仓库 checkout。在仓库里 `pnpm build` 之后必须
`astrox update`（或重装）+ `astrox restart`，页面才会用上新构建。

## 3. CORS 与部署页

- 未配置任何允许列表时服务**不发**任何 CORS 头——等价于纯同源安装。
- 命中允许列表的来源：回显 `Access-Control-Allow-Origin`、
  `Access-Control-Allow-Private-Network: true`（Chrome 公网→本地预检），
  以及通用的 `OPTIONS /api/*` 预检（允许方法/头）。
- 这些头挂在**每个** `/api/*` 响应上（含 SSE 流）——EventSource 发不了
  自定义头，响应头是部署页能拿到的全部。
- 验证：`/api/health` 的 `corsOrigins` 数组。
- 非 5678 端口或移动了服务：页面加 `?api=http://127.0.0.1:<port>`（会持久化
  到 `localStorage` 的 `ASTROX_API_BASE`）。

## 4. 云端部署：控制台

### 4.1 Vercel（控制台 + 文档同一仓库）

把仓库导入 Vercel，**零配置**：`vercel.json` 驱动整个构建
（`pnpm build && pnpm build:docs && node scripts/merge-deploy-output.mjs`），
产物布局：文档在根、控制台在 `/console/`（`rewrites` 保证 `/console` 直达）。

线上部署即在线文档地址：<https://astro-site-cyan-five.vercel.app/>。

读者侧（数据永远在读者机器上）：

1. 本机跑起服务（§2）；
2. 把部署域名加入允许列表：`ASTRO_CORS_ORIGINS="https://<domain>" pnpm start`，
   或写入 `~/.astrox/plugins/astro/config.yaml` 的 `server.corsOrigins`
   后重启（安装运行时通常由记录器无 shell 启动，只有 `config.yaml` 这一条
   路能保留下来）；
3. 打开部署页即连本机服务；必要时 `?api=` 指到非默认端口。

行为契约：连不上的部署页**只报一次**「无法连接本地服务」（附 base 与要加的
`ASTRO_CORS_ORIGINS` 行），不逐次重试刷屏，也**绝不**静默回落示例数据——
示例只在该读者显式 `?demo=1` 时渲染，且带常驻「示例数据」横幅。

### 4.2 GitHub Pages（仅控制台预览）

`.github/workflows/console-preview.yml` —— 在线预览地址是
<https://chaos-design.github.io/astro/>，追加 `?demo=1` 即可用示例数据体验：

- 每次 push/PR 到 `main`：构建控制台、跑 `verify-console-build` 校验（相对
  资源、自带图标与示例数据集、无文档站标记），上传 `console-dist` 工件。
- **Deploy 任务在 push 时自动发布**：推送到 `main`（正式发布）或工作流
  `push` 清单里登记的滚动预览分支（如进行中的 feature 分支——合并前即可拿到
  预览 URL；分支合并后把它从清单移除）都会把*该分支*的构建发布到**同一个**
  Pages 站点，最近一次命中的构建胜出。
- 手动 `workflow_dispatch` 从**任何分支**都能跑：用于重新发布已不在
  push 清单里的分支（如合并后删掉的测试分支）。

约束：Pages 单站点只放**控制台**，不放文档站（两者互斥，workflow 注释与
`verify-console-build` 都保证这一点）；文档站走自己的托管路径（Vercel 合并
产物或 `docs-dist` 工件），不在 Pages 自动部署。

### 4.3 其它静态主机

`pnpm build` 的控制台产物用相对 `base` 生成，挂到任何子路径都能跑；
与 §3 的 CORS 允许列表配对即可。

## 5. 文档站

`pnpm build:docs` 把 `docs/*.md` 在构建时内联进 `site/dist`（`docs/*.html`
演示页到 `/decks/`，`docs/assets/` 随附），产物自包含。已发布的实例即 §4.1
的 Vercel 部署（<https://astro-site-cyan-five.vercel.app/>）。三条托管路径：

1. 合并产物：`pnpm deploy:preview` 产出的 `deploy/`（文档在根）；
2. Actions 工件：`docs-site.yml` 每次 push/PR 上传 `docs-dist`（无自动发布，
   下载后部署到任意静态主机）；
3. 直接 `site/dist` 部署。

新增文档 = 把 `.md` 放进 `docs/`，并在 `site/src/docs.ts` 的
`sectionBySlug`（与 `readingOrder`）登记一行；`docs/index.md` 同步。

## 6. 本地验证部署产物

```bash
pnpm deploy:preview
# = pnpm build && pnpm build:docs
#   && node scripts/merge-deploy-output.mjs
#   && ASTRO_CONSOLE_DIST=deploy/console node scripts/verify-console-build.mjs
```

产出与 Vercel 完全一致的 `deploy/` 并当场校验；本地起个静态服务器即可
预览合并布局。

## 7. 故障排查速查

| 现象 | 检查 |
| --- | --- |
| 控制台 503「Dashboard is not built」 | 源码运行：`pnpm build`；安装运行时：`astrox update` + `astrox restart`（陈旧包陷阱） |
| 部署页报「无法连接本地服务」 | ① 服务是否在跑（`astrox status`）；② `corsOrigins` 是否含该域名（`/api/health`）；③ 端口：health 的 `clientCount` 与 `?api=` 是否一致 |
| 端口冲突 | 服务自动上探（最多 +20）；日志有实际端口，页面用 `?api=` 指过去 |
| 示例数据不可用 | `data/demo-events.json` 缺失（404）或损坏（500 报具体字段） |
| 流式时卡顿/长任务 | 「设置 → 性能」开性能面板（页面底部悬浮，展开看常驻指标卡与全部指标明细），`window.__astroPerf.snapshot()` 读数；`pnpm perf:fixture` + `pnpm perf:bench` 复现 |
| 服务行为异常 | `astrox doctor`（配置诊断）、`astrox logs`、`/api/health`（`restartCount`/`restartedAt`/`dataRoot`/`version`） |
