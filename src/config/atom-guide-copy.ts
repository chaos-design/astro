type GuideCopy = {
  label: string;
  description: string;
};

export const guideLayerCopy: Record<string, GuideCopy> = {
  "session-control": {
    label: "会话控制",
    description: "负责请求接入、运行生命周期与检查点。",
  },
  "agent-execute": {
    label: "智能体执行",
    description: "负责单轮推理、动作路由与结果编排。",
  },
  "memory-system": {
    label: "记忆系统",
    description: "负责上下文召回、工作记忆捕获与持久化。",
  },
  "capability-runtime": {
    label: "能力运行时",
    description: "负责工具解析、执行与子智能体结果归一化。",
  },
  "quality-gates": {
    label: "质量门禁",
    description: "负责校验候选结果并提交最终产物。",
  },
  telemetry: {
    label: "遥测记录",
    description: "负责记录原子事件并生成可回放执行轨迹。",
  },
};

export const guideAtomCopy: Record<string, GuideCopy> = {
  "prompt-input": {
    label: "提示词输入",
    description: "接收用户请求，并转换为统一的提示词结构。",
  },
  "session-resume": {
    label: "会话恢复",
    description: "恢复当前运行会话以及已持久化的上下文。",
  },
  "stage-start": {
    label: "阶段开始",
    description: "为当前轮次创建执行阶段和运行上下文。",
  },
  checkpoint: {
    label: "检查点",
    description: "在执行过程中保存可观测、可恢复的状态快照。",
  },
  "stage-finish": {
    label: "阶段结束",
    description: "提交阶段结果并关闭当前执行轮次。",
  },
  run: {
    label: "运行入口",
    description: "根据当前请求启动智能体执行循环。",
  },
  "agent-select": {
    label: "智能体选择",
    description: "从注册表中选择负责当前轮次的智能体。",
  },
  "model-invoke": {
    label: "模型调用",
    description: "使用当前上下文调用模型并获得决策结果。",
  },
  "loop-turn": {
    label: "循环轮次",
    description: "携带观察结果进入下一次可观测执行轮次。",
  },
  "action-gate": {
    label: "动作门禁",
    description: "将模型决策路由到工具、用户提问或最终回复。",
  },
  observation: {
    label: "观察结果",
    description: "将工具或子智能体结果归一化为下一轮输入。",
  },
  "tool-call": {
    label: "工具调用",
    description: "分发选定能力及其调用参数。",
  },
  usage: {
    label: "用量记录",
    description: "记录令牌、延迟和运行资源消耗。",
  },
  handoff: {
    label: "任务移交",
    description: "将任务委派给子智能体并等待执行结果。",
  },
  "user-question": {
    label: "用户提问",
    description: "在缺少输入或权限时暂停并请求用户确认。",
  },
  "final-reply": {
    label: "最终回复",
    description: "将模型输出整理为面向用户的候选回复。",
  },
  "memory-recall": {
    label: "记忆召回",
    description: "为模型执行检索并排序相关上下文。",
  },
  "memory-capture": {
    label: "工作记忆捕获",
    description: "捕获本次运行产生的可复用上下文。",
  },
  "tool-resolve": {
    label: "工具解析",
    description: "从能力注册表中解析请求对应的工具实现。",
  },
  "tool-execute": {
    label: "工具执行",
    description: "执行工具并捕获结果或错误信息。",
  },
  "tool-result": {
    label: "工具结果",
    description: "发布工具输出或错误，并交给观察阶段归一化。",
  },
  "agent-result": {
    label: "智能体结果",
    description: "将能力和子智能体输出归一化为统一结果。",
  },
  "quality-gate": {
    label: "质量门禁",
    description: "依据完成标准检查候选回复是否可接受。",
  },
  "final-artifact": {
    label: "最终产物",
    description: "生成通过校验的回复、代码或其他交付物。",
  },
  "output-commit": {
    label: "输出提交",
    description: "将最终结果提交到当前会话。",
  },
  "trace-append": {
    label: "追踪追加",
    description: "把每次原子状态变化写入本地事件流。",
  },
  "trajectory-project": {
    label: "轨迹投影",
    description: "把原子事件映射成可检查、可回放的执行路径。",
  },
};

export const guideSectionCopy: Record<string, string> = {
  Input: "输入",
  Session: "会话",
  Lifecycle: "生命周期",
  Execution: "执行",
  Router: "路由",
  Model: "模型",
  Loop: "循环",
  Decision: "决策",
  Action: "动作",
  Metrics: "指标",
  Routing: "路由",
  Interaction: "交互",
  Output: "输出",
  Memory: "记忆",
  Capability: "能力",
  Quality: "质量",
  Telemetry: "遥测",
};

export const guideReadSteps = [
  "Session Control 接收请求，恢复 Session，并建立阶段和检查点。",
  "Memory System 召回上下文，Agent Execute 运行模型与工具循环。",
  "Capability Runtime 解析并执行工具，统一工具和子智能体结果。",
  "Quality Gates 校验候选回复并提交最终产物。",
  "Telemetry 持久化执行事实，并生成可诊断、可回放的轨迹。",
] as const;

export const guideKindItems: Array<GuideCopy & { id: string }> = [
  {
    id: "input",
    label: "input / question",
    description: "用户输入、授权确认与 Session 边界。",
  },
  {
    id: "run",
    label: "run / loop",
    description: "阶段与智能体循环控制。",
  },
  {
    id: "agent",
    label: "agent / handoff",
    description: "智能体选择、委派与子智能体生命周期。",
  },
  {
    id: "model",
    label: "model / action",
    description: "模型调用、决策与动作分派。",
  },
  {
    id: "tool",
    label: "tool / observation",
    description: "外部工具调用、结构化结果与观察。",
  },
  {
    id: "context",
    label: "context / checkpoint",
    description: "上下文召回、工作记忆与持久检查点。",
  },
  {
    id: "output",
    label: "output / telemetry",
    description: "最终回复、产物提交、Trace 与轨迹投影。",
  },
];

export const guideLineItems: Array<
  GuideCopy & { id: "data" | "execution" | "feedback" | "persistence"; visual: string }
> = [
  {
    id: "execution",
    label: "Execution",
    visual: "石板灰 · 实线",
    description: "连接调用方与被调用方，表示执行顺序、阶段推进或控制权转移。",
  },
  {
    id: "data",
    label: "Data",
    visual: "天蓝 · 点线",
    description: "承载上下文、模型结果、记忆内容或指标，不表示控制权转移。",
  },
  {
    id: "feedback",
    label: "Feedback",
    visual: "冷灰 · 虚线",
    description: "把观察、抽取或评估结果送回上游，表达反馈关系。",
  },
  {
    id: "persistence",
    label: "Persistence",
    visual: "靛紫 · 虚线",
    description: "表示检查点、Trace、Trajectory 或其他持久化写入路径。",
  },
];

export const guideStatusItems: Array<GuideCopy & { id: string }> = [
  {
    id: "scheduled",
    label: "灰色 · Scheduled",
    description: "原子已进入拓扑，但当前事件位置尚未观测到开始。",
  },
  {
    id: "running",
    label: "紫色 · Running",
    description: "原子正在执行；Live 模式仅让状态标记产生颜色呼吸。",
  },
  {
    id: "waiting",
    label: "琥珀色 · Waiting",
    description: "原子正在等待权限、用户输入或限流退避结束。",
  },
  {
    id: "completed",
    label: "青绿色 · Completed",
    description: "原子已产生完成事件；路径完成态保留类型色，仅增强线宽和不透明度。",
  },
  {
    id: "failed",
    label: "红色 · Failed / Terminated",
    description: "原子失败或 Session 被终止，不代表其他原子状态被覆盖。",
  },
];

export const guideHistoryStatusItems: Array<GuideCopy & { id: string }> = [
  {
    id: "active",
    label: "紫色 · Active",
    description: "最后一条 Prompt 正在执行，父行时长持续更新，默认最多 24 小时。",
  },
  {
    id: "waiting",
    label: "琥珀色 · Waiting",
    description: "最后一条 Prompt 正在等待，父行时长停止更新。",
  },
  {
    id: "complete",
    label: "青绿色 · Complete",
    description: "最后一条 Prompt 已正常完成。",
  },
  {
    id: "failed",
    label: "红色 · Failed",
    description: "最后一条 Prompt 执行失败。",
  },
  {
    id: "terminated",
    label: "红色 · Terminated",
    description: "最后一条 Prompt 已被终止，或运行时长达到全局超时阈值。",
  },
];

export const guideHistoryStatusDescription =
  "父行图标和状态取最后一条 Prompt；没有 Prompt 时回退 Session 状态。";

export const guideHighlightItems: Array<GuideCopy & { id: string }> = [
  {
    id: "selected",
    label: "青色 · Selected",
    description: "当前 Event 对应的原子或路径，优先级高于基础类型色。",
  },
  {
    id: "hover",
    label: "主题高亮 · Hover",
    description: "鼠标悬停路径时使用独立高亮色：暗色主题近白，浅色主题亮蓝。",
  },
  {
    id: "observed",
    label: "紫色边界 · Observed",
    description: "当前 Run 已观测到该原子，表示存在执行事实而非正在运行。",
  },
  {
    id: "active",
    label: "类型色 + 紫色流光 · Active",
    description: "路径保留类型颜色和线型，叠加紫色流光与方向动画。",
  },
  {
    id: "complete",
    label: "类型色增强 · Complete",
    description: "完成路径保留类型颜色和线型，仅提高线宽与不透明度。",
  },
];

export const guideObservabilityItems = [
  "LOG 只展示功能事件；选择事件会同步定位原子与 Inspector 数据。",
  "Replay 按事件序列折叠历史，Live 仅跟随最新且仍在执行的 Session。",
  "运行原子依据最新事件映射，历史 Session 不显示 Active 高亮。",
  "Trace 保存规范化执行事实，Trajectory 生成面向诊断的可读投影。",
  "原始 Payload、输入和输出均可在 Inspector 中独立检查。",
  "失败与终止状态保留在 History，不会被后续 Session 覆盖。",
];
