# ASTRO Documentation

**Agent State Trace & Runtime Observations**

This directory separates task-oriented guides from protocol, architecture, and operations references. Start with the user manual for normal use; use the protocol and operations documents when implementing an integration or diagnosing capture.

## 中文

| 文档 | 适用读者 | 内容 |
| --- | --- | --- |
| [使用手册](user-manual-zh.md) | 控制台使用者 | 安装、Prompt 子运行层级、拓扑、轨迹、回放、实时超时、导入导出和常见问题。 |
| [事件协议参考](event-protocol-zh.md) | 集成开发者 | Schema v2、17 类事件、状态优先级、关联、顺序、幂等、HTTP 与 SSE 契约。 |
| [架构说明](architecture-zh.md) | 维护者 | 采集、Repository、派生状态、共享时钟、投影、布局、安全和容量边界。 |
| [运维与故障处理](operations-zh.md) | 本地运维与发布人员 | 权限、目录、超时配置、升级、备份、恢复、连续问答验收与故障矩阵。 |
| [实现细节与规划状态](implementation-details-zh.md) | 开发、评审与答辩人员 | 设计落地总表、实现机制、代码与测试证据、边界，以及明确标记的规划项。 |
| [插件安装](plugin-installation.md) | 客户端管理员 | Codex、Claude Code、DeepSeek Harness、WorkBuddy、Trae、直接 Hook 和便携包安装。 |
| [项目架构与功能演示](project-overview-slides-zh.html) | 分享与评审 | 自包含、可离线打开和打印的 22 页 16:9 交互演示，含设计落地地图、实时状态边界与共享运行时配置。 |
| [技术面试项目深讲](project-interview-zh.html) | 面试与答辩 | 14 页演示与 40 题交互题库，区分事实与规划，并提供详细答案、递进追问、筛选及考试复盘。 |

## English

| Document | Audience | Coverage |
| --- | --- | --- |
| [User Manual](user-manual-en.md) | Console users | Installation, prompt-run hierarchy, topology, trajectory, replay, live timeout, import/export, troubleshooting. |
| [Event Protocol Reference](event-protocol-en.md) | Integration developers | Schema v2, 17 event types, status precedence, correlation, ordering, idempotency, HTTP and SSE contracts. |
| [Architecture](architecture-en.md) | Maintainers | Capture, repository, derived state, shared clock, projection, layout, security, and capacity. |
| [Operations and Troubleshooting](operations-en.md) | Local operators and release owners | Permissions, directories, timeout configuration, upgrade, backup, recovery, and acceptance tests. |
| [Implementation Details and Delivery Status](implementation-details-en.md) | Developers and reviewers | Delivery matrix, mechanisms, code and test evidence, boundaries, and explicitly marked plans. |
| [Plugin Installation](plugin-installation.md) | Client administrators | Codex, Claude Code, DeepSeek Harness, WorkBuddy, Trae, direct hooks, and portable archive installation. |

## Recommended Reading Paths

- First use: User Manual -> Plugin Installation -> Operations.
- New producer integration: Event Protocol -> Architecture -> HTTP or Browser SDK sections in the User Manual.
- Missing events: Operations health checks -> multi-turn and prompt-hierarchy acceptance test -> incident matrix.
- Status or duration mismatch: Event Protocol state rules -> User Manual visible behavior -> Operations timeout acceptance test.
- Implementation or delivery review: Implementation Details -> Architecture -> focused tests.
- Project sharing: Project presentation -> Implementation Details -> Architecture.
- Interview preparation: Technical interview deep dive -> Implementation Details -> source evidence.
- Release review: Architecture verification -> Operations release checklist -> HTML presentation.
- Repository contributors and coding agents: root `AGENTS.md` -> Architecture -> relevant tests.

## Visual Assets

- `assets/astro-desktop.png`: source dashboard screenshot used by Markdown documents.
- `project-overview-slides-zh.html`: fully self-contained 22-page presentation. Screenshots, diagrams, CSS, and JavaScript are embedded; it includes a delivery map and a clearly labeled configuration plan.
- `project-interview-zh.html`: self-contained 14-page technical interview deck and 40-question practice bank with fact-versus-plan guidance, implementation evidence, follow-ups, exam scoring, responsive layouts, and local progress persistence.
