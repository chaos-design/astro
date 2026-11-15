# 计划流转契约

`plans/` 是 ASTRO 仓库的任务计划目录。计划所在目录就是它的唯一状态，进度以文件内
checkbox 计数为准，不另存状态文件；避免状态漂移。

## 状态

| 目录 | 含义 |
| --- | --- |
| `planing/` | 已拆解、可实施；目标、范围、任务与完成标准均已写明 |
| `pending/` | 被产品、安全、发布或平台决策阻塞；「待决事项」全部勾选后 `move ... planing` |
| `archive/` | 已完成，只读（仅限勘误），不再重新打开 |

## 优先级

- **P0**：边界逃逸、凭据泄漏、跨工作区写入、不可控破坏。
- **P1**：核心功能不可达、恢复不完整、并发写不可靠、门禁失效。
- **P2**：其余，包括文档治理、可选能力完善、可观测性增强。

## 完成标准（DoD）

每个计划必须包含以下五个键；只有拿到证据才能勾选：

- `code`：实现、迁移和文档均完成，不保留双轨逻辑，无模板占位符残留。
- `linter_result`：本仓库没有 `lint` 脚本，用
  `./node_modules/.bin/tsc --noEmit` 与
  `./node_modules/.bin/tsc -p site/tsconfig.json --noEmit`，退出码均为 0。
- `unit_test_result`：`node --test tests/*.test.*` 全绿，记录通过数与新增用例数。
- `func_test_result`：真实进程或真实捕获轨迹验证，记录命令与关键输出。
- `status`：剩余风险与回滚方式已写入计划正文。

## 约定

- 所有状态变更走
  `python3 ~/.workbuddy/skills/plan-flow/scripts/plan_flow.py`；禁止手工在状态目录间移动文件。
- 时间戳为 UTC+8，格式 `YYYY-MM-DD HH:mm:ss`，由脚本写入。
- 每完成一项任务立即 `tick`，不批量补勾；勾选时把命令、退出码、数量写进 `--note`。
- 计划文件本身不自动产生 Git 提交，版本基线由维护者决定。
- 归档由脚本把关：存在未勾选项、缺失 DoD 键、残留占位符或仍为 `pending` 时拒绝归档。
- 新增文档页需同时更新 `docs/index.md` 与 `site/src/docs.ts`；不新增文档页时这两处保持
  现状即可。
