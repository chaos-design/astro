import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFlow,
  buildHarnessFlow,
  buildSessionPromptRuns,
  buildSessions,
  createDemoEvents,
  formatDuration,
  getExecutionInstruction,
  getFlowNodeIdForEvent,
  getSessionDisplayState,
  getSessionDuration,
  parseImportedTrace,
  searchTraceEvents,
} from "../src/lib/trace-model.ts";

test("groups events by session and calculates duration", () => {
  const events = createDemoEvents(2_000_000_000_000);
  const sessions = buildSessions(events);

  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].toolCount, 4);
  assert.equal(sessions[0].status, "complete");
  assert.equal(sessions[0].duration, 9200);
});

test("only marks explicitly ended or interrupted sessions as terminated", () => {
  const base = {
    source: "trae",
    workspaceId: "workspace",
    cwd: "/tmp/workspace",
    payload: {},
  };
  const sessions = buildSessions([
    {
      ...base,
      id: "old-start",
      sessionId: "old",
      eventName: "SessionStart",
      capturedAt: "2026-09-08T08:00:00.000Z",
    },
    {
      ...base,
      id: "new-start",
      sessionId: "new",
      eventName: "SessionStart",
      capturedAt: "2026-09-08T09:00:00.000Z",
    },
    {
      ...base,
      id: "new-end",
      sessionId: "new",
      eventName: "SessionEnd",
      capturedAt: "2026-09-08T09:01:00.000Z",
    },
  ]);

  assert.equal(sessions.find((session) => session.id === "old")?.status, "active");
  assert.equal(sessions.find((session) => session.id === "new")?.status, "terminated");
});

test("classifies permission and rate-limit hooks as waiting", () => {
  const base = {
    source: "claude",
    workspaceId: "workspace",
    cwd: "/tmp/workspace",
  };
  const session = (sessionId: string, terminal: Record<string, unknown>) => [
    {
      ...base,
      id: `${sessionId}-prompt`,
      sessionId,
      eventName: "UserPromptSubmit",
      capturedAt: "2026-09-08T08:00:00.000Z",
      payload: { prompt: "Continue" },
    },
    {
      ...base,
      id: `${sessionId}-state`,
      sessionId,
      capturedAt: "2026-09-08T08:00:01.000Z",
      ...terminal,
    },
  ];
  const sessions = buildSessions([
    ...session("permission", {
      eventName: "PermissionRequest",
      payload: { tool_name: "Bash" },
    }),
    ...session("rate-limit", {
      eventName: "StopFailure",
      status: "failed",
      payload: { reason: "rate_limit", retry_after: 3 },
    }),
    ...session("auth-failure", {
      eventName: "StopFailure",
      status: "failed",
      payload: { reason: "authentication_failed" },
    }),
  ]);

  assert.equal(
    sessions.find((item) => item.id === "permission")?.status,
    "waiting",
  );
  assert.equal(
    sessions.find((item) => item.id === "rate-limit")?.status,
    "waiting",
  );
  assert.equal(
    sessions.find((item) => item.id === "auth-failure")?.status,
    "failed",
  );
});

test("returns a waiting session to active when execution resumes", () => {
  const events = [
    {
      source: "workbuddy",
      workspaceId: "workspace",
      sessionId: "waiting-session",
      id: "prompt",
      eventName: "UserPromptSubmit",
      capturedAt: "2026-09-08T08:00:00.000Z",
      payload: { prompt: "Continue" },
    },
    {
      source: "workbuddy",
      workspaceId: "workspace",
      sessionId: "waiting-session",
      id: "waiting",
      eventName: "Elicitation",
      capturedAt: "2026-09-08T08:00:01.000Z",
      payload: { message: "Choose an option" },
    },
    {
      source: "workbuddy",
      workspaceId: "workspace",
      sessionId: "waiting-session",
      id: "resumed",
      eventName: "ElicitationResult",
      capturedAt: "2026-09-08T08:00:02.000Z",
      payload: { message: "Approved" },
    },
  ];

  assert.equal(buildSessions(events)[0].status, "active");
});

test("reactivates a session when a new prompt follows a completed turn", () => {
  const events = createDemoEvents(2_000_000_000_000);
  const nextPrompt = {
    ...events[1],
    id: "next-prompt",
    capturedAt: new Date(2_000_000_001_000).toISOString(),
    payload: { prompt: "Continue" },
  };

  assert.equal(buildSessions([...events, nextPrompt])[0].status, "active");
});

test("classifies the first and follow-up prompts within one session", () => {
  const events = createDemoEvents(2_000_000_000_000);
  const firstPrompt = events.find(
    (event) => event.eventName === "UserPromptSubmit",
  );
  assert.ok(firstPrompt);
  const nextPrompt = {
    ...firstPrompt,
    id: "follow-up-prompt",
    capturedAt: new Date(2_000_000_001_000).toISOString(),
    payload: { prompt: "Continue with the second request." },
  };

  const session = buildSessions([...events, nextPrompt])[0];
  const promptRuns = buildSessionPromptRuns(session);

  assert.deepEqual(
    promptRuns.map(({ prompt, index, role, title, status }) => ({
      id: prompt.id,
      index,
      role,
      title,
      status,
    })),
    [
      {
        id: firstPrompt.id,
        index: 0,
        role: "initial",
        title: "Trace this agent run and render the execution topology.",
        status: "complete",
      },
      {
        id: "follow-up-prompt",
        index: 1,
        role: "follow-up",
        title: "Continue with the second request.",
        status: "active",
      },
    ],
  );
  assert.equal(promptRuns[0].events.at(-1)?.eventName, "Stop");
  assert.deepEqual(
    promptRuns[1].events.map((event) => event.id),
    ["follow-up-prompt"],
  );
});

test("splits every prompt into an isolated full-flow event range", () => {
  const events = createDemoEvents(2_000_000_000_000);
  const firstPrompt = events.find(
    (event) => event.eventName === "UserPromptSubmit",
  );
  const toolStart = events.find(
    (event) => event.eventName === "PreToolUse",
  );
  assert.ok(firstPrompt);
  assert.ok(toolStart);
  const followUp = {
    ...firstPrompt,
    id: "follow-up-without-stop",
    capturedAt: new Date(
      Date.parse(toolStart.capturedAt) + 1_000,
    ).toISOString(),
    payload: { prompt: "Start the next complete flow." },
  };
  const followUpResult = {
    ...events.at(-1)!,
    id: "follow-up-result",
    capturedAt: new Date(
      Date.parse(followUp.capturedAt) + 1_000,
    ).toISOString(),
    eventName: "Stop",
    payload: { last_assistant_message: "Second flow complete." },
  };
  const session = buildSessions([
    firstPrompt,
    toolStart,
    followUp,
    followUpResult,
  ])[0];

  const promptRuns = buildSessionPromptRuns(session);

  assert.deepEqual(
    promptRuns.map((run) => ({
      events: run.events.map((event) => event.id),
      status: run.status,
      toolCount: run.toolCount,
    })),
    [
      {
        events: [firstPrompt.id, toolStart.id],
        status: "complete",
        toolCount: 1,
      },
      {
        events: ["follow-up-without-stop", "follow-up-result"],
        status: "complete",
        toolCount: 0,
      },
    ],
  );
});

test("formats run durations with second, minute, and hour precision", () => {
  assert.equal(formatDuration(8_600), "9s");
  assert.equal(formatDuration(125_000), "2m 5s");
  assert.equal(formatDuration(3_725_000), "1h 2m 5s");
  assert.equal(formatDuration(59_600), "1m 0s");
  assert.equal(formatDuration(4_379_600), "1h 13m 0s");
});

test("updates active and waiting session durations against the current time", () => {
  const base = {
    duration: 12_000,
    start: 1_000,
  };

  assert.equal(
    getSessionDuration({ ...base, status: "active" }, 21_000),
    20_000,
  );
  assert.equal(
    getSessionDuration({ ...base, status: "waiting" }, 21_000),
    20_000,
  );
  assert.equal(
    getSessionDuration({ ...base, status: "complete" }, 21_000),
    12_000,
  );
});

test("terminates and caps advancing runs at the configured timeout", () => {
  const timeout = 24 * 60 * 60 * 1_000;
  const active = {
    duration: 12_000,
    start: 1_000,
    status: "active",
  } as const;

  assert.deepEqual(
    getSessionDisplayState(active, active.start + timeout - 1, timeout),
    {
      duration: timeout - 1,
      status: "active",
    },
  );
  assert.deepEqual(
    getSessionDisplayState(active, active.start + timeout, timeout),
    {
      duration: timeout,
      status: "terminated",
    },
  );
  assert.deepEqual(
    getSessionDisplayState(active, active.start + timeout * 2, timeout),
    {
      duration: timeout,
      status: "terminated",
    },
  );
  assert.deepEqual(
    getSessionDisplayState(
      { ...active, duration: timeout + 1 },
      active.start,
      timeout,
    ),
    {
      duration: timeout,
      status: "terminated",
    },
  );
  assert.equal(
    getSessionDuration(active, active.start + timeout * 2, timeout),
    timeout,
  );
});

test("preserves terminal durations and supports a custom live timeout", () => {
  const complete = {
    duration: 48_000,
    start: 1_000,
    status: "complete",
  } as const;

  assert.deepEqual(getSessionDisplayState(complete, 100_000, 10_000), {
    duration: 48_000,
    status: "complete",
  });
  assert.deepEqual(
    getSessionDisplayState(
      { ...complete, duration: 1_000, status: "waiting" },
      11_000,
      10_000,
    ),
    {
      duration: 10_000,
      status: "terminated",
    },
  );
});

test("shows the complete normalized command for paired tool events", () => {
  const events = createDemoEvents(2_000_000_000_000);
  const start = events.find(
    (event) =>
      event.eventName === "PreToolUse" && event.toolUseId === "tool-test",
  );
  const end = events.find(
    (event) =>
      event.eventName === "PostToolUse" && event.toolUseId === "tool-test",
  );

  assert.equal(
    getExecutionInstruction(end || null, start || null),
    "pnpm test && pnpm build",
  );
});

test("combines pre and post hook events into one tool node", () => {
  const events = createDemoEvents(2_000_000_000_000);
  const flow = buildFlow(events);
  const toolNodes = flow.nodes.filter(
    (node) => node.data.eventName === "PreToolUse",
  );

  assert.equal(toolNodes.length, 4);
  assert.ok(toolNodes.every((node) => node.data.endEvent));
  assert.ok(toolNodes.every((node) => node.data.duration > 0));
  assert.equal(flow.edges.length, flow.nodes.length - 1);
});

test("parses JSONL hook payloads and normalized trace events", () => {
  const text = [
    JSON.stringify({
      session_id: "s1",
      hook_event_name: "SessionStart",
    }),
    JSON.stringify({
      schemaVersion: 1,
      id: "e2",
      capturedAt: "2026-09-07T00:00:01.000Z",
      sessionId: "s1",
      eventName: "Stop",
      payload: { last_assistant_message: "Done" },
    }),
  ].join("\n");

  const events = parseImportedTrace(text);
  assert.equal(events.length, 2);
  assert.equal(events[0].sessionId, "s1");
  assert.equal(events[1].eventName, "Stop");
});

test("keeps identical native session IDs separate across sources", () => {
  const base = {
    capturedAt: "2026-09-07T00:00:00.000Z",
    sessionId: "shared-id",
    workspaceId: "workspace",
    eventName: "SessionStart",
    payload: {},
  };
  const sessions = buildSessions([
    { ...base, id: "claude-event", source: "claude" },
    { ...base, id: "codex-event", source: "codex" },
  ]);

  assert.equal(sessions.length, 2);
  assert.notEqual(sessions[0].key, sessions[1].key);
});

test("searches nested payload content and returns an atomic event match", () => {
  const events = createDemoEvents(2_000_000_000_000);
  const results = searchTraceEvents(events, "changedLines");

  assert.equal(results.length, 1);
  assert.equal(results[0].path, "payload.tool_response.changedLines");
  assert.match(results[0].locator, /^trace:\/\/codex\//);
});

test("maps a tool result back to its paired flow node", () => {
  const events = createDemoEvents(2_000_000_000_000);
  const result = events.find(
    (event) =>
      event.eventName === "PostToolUse" && event.toolUseId === "tool-test",
  );

  assert.equal(getFlowNodeIdForEvent(result), "tool-tool-test");
  const partialFlow = buildFlow(
    events.slice(0, events.indexOf(result)),
  );
  assert.equal(
    partialFlow.nodes.find((node) => node.id === "tool-tool-test").data.status,
    "running",
  );
});

test("builds an agent execute chain without a standalone COT atom", () => {
  const flow = buildHarnessFlow(createDemoEvents(2_000_000_000_000));
  const keys = new Set(flow.nodes.map((node) => node.data.key));

  assert.equal(flow.nodes.length, 27);
  assert.equal(flow.edges.length, 28);
  assert.ok(keys.has("prompt.input"));
  assert.ok(keys.has("run"));
  assert.ok(keys.has("agent.select"));
  assert.ok(keys.has("model.invoke"));
  assert.ok(keys.has("action.gate"));
  assert.ok(keys.has("tool.call"));
  assert.ok(keys.has("tool.result"));
  assert.ok(keys.has("observation"));
  assert.ok(keys.has("reply.final"));
  assert.ok(keys.has("output.commit"));
  assert.ok(!keys.has("cot.reason"));

  const reasoningEdges = flow.edges.filter((edge) =>
    edge.className.includes("--reasoning"),
  );
  assert.ok(
    reasoningEdges.some(
      (edge) =>
        edge.source === "harness-model-invoke" &&
        edge.target === "harness-action-gate",
    ),
  );
  assert.equal(flow.layers.length, 6);
  assert.equal(
    flow.layers.find((layer) => layer.id === "agent-execute").label,
    "Agent Execute",
  );
  assert.ok(flow.nodes.every((node) => node.data.layer));
  assert.ok(flow.edges.every((edge) => edge.type === "signal"));
  assert.ok(
    flow.edges.every((edge) => Array.isArray(edge.data.waypoints)),
  );
});

test("creates a complete execution layer for each observed subagent", () => {
  const events = createDemoEvents(2_000_000_000_000);
  const start = {
    ...events[0],
    id: "subagent-start",
    capturedAt: new Date(2_000_000_000_500).toISOString(),
    eventName: "SubagentStart",
    parentId: "worker-17",
    payload: { agent_id: "worker-17" },
  };
  const stop = {
    ...start,
    id: "subagent-stop",
    capturedAt: new Date(2_000_000_001_500).toISOString(),
    eventName: "SubagentStop",
  };
  const flow = buildHarnessFlow([...events, start, stop]);
  const subagentLayer = flow.layers.find(
    (layer) => layer.id === "subagent-worker-17",
  );
  const subagentNodes = flow.nodes.filter(
    (node) => node.data.subagentId === "worker-17",
  );

  assert.ok(subagentLayer);
  assert.equal(flow.meta.subagentCount, 1);
  assert.deepEqual(
    subagentNodes.map((node) => node.data.label),
    [
      "Subagent Spawn",
      "Run",
      "Agent Select",
      "Model Invoke",
      "Action Gate",
      "Tool Call",
      "Observation",
      "Agent Result",
    ],
  );
});

test("does not count child tool events as main-agent tool calls", () => {
  const events = createDemoEvents(2_000_000_000_000);
  const start = {
    ...events[0],
    id: "subagent-start-tools",
    eventName: "SubagentStart",
    parentId: "worker-tools",
    payload: { agent_id: "worker-tools" },
  };
  const childTool = {
    ...events[2],
    id: "subagent-tool",
    parentId: "worker-tools",
    toolUseId: "child-tool",
    payload: { ...events[2].payload, agent_id: "worker-tools" },
  };
  const flow = buildHarnessFlow([...events, start, childTool]);
  const mainTool = flow.nodes.find((node) => node.data.key === "tool.call");

  assert.equal(mainTool.data.count, 4);
  assert.equal(flow.meta.toolCount, 4);
});

test("keeps atom semantics stable across platform configurations", () => {
  const events = createDemoEvents(2_000_000_000_000);
  const codex = buildHarnessFlow(events, "codex");
  const claude = buildHarnessFlow(events, "claude");
  const deepseek = buildHarnessFlow(events, "deepseek");
  const trae = buildHarnessFlow(events, "trae");
  const workbuddy = buildHarnessFlow(events, "workbuddy");
  const labels = (flow) => flow.nodes.map((node) => node.data.label);

  assert.deepEqual(labels(codex), labels(claude));
  assert.deepEqual(labels(codex), labels(deepseek));
  assert.deepEqual(labels(codex), labels(trae));
  assert.deepEqual(labels(codex), labels(workbuddy));
  assert.equal(codex.platform.id, "codex");
  assert.equal(claude.platform.id, "claude");
  assert.equal(deepseek.platform.id, "deepseek");
  assert.equal(trae.platform.id, "trae");
  assert.equal(workbuddy.platform.id, "workbuddy");
  assert.ok(codex.edges.every((edge) => edge.data.active === false));
  assert.ok(claude.nodes.every((node) => node.data.platform === "claude"));
  assert.ok(
    deepseek.nodes.every((node) => node.data.platform === "deepseek"),
  );
});
