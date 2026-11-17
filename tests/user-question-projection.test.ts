import assert from "node:assert/strict";
import test from "node:test";
import { getAtomIdForEvent } from "../src/config/atom-platforms.ts";
import { projectTraceEvents } from "../src/lib/atomic-projection.ts";
import { buildExecutionTopology } from "../src/lib/execution-topology.ts";
import {
  getTraceEventKey,
  hasQuestionParameters,
  isBlockingUserQuestionStartEvent,
  isSystemAuthorizationEvent,
  isUserQuestionEvent,
  isUserQuestionStartEvent,
  isUserQuestionToolEvent,
} from "../src/lib/trace-event-kind.ts";
import {
  buildSessions,
  getEventSummary,
  normalizeTraceEvent,
} from "../src/lib/trace-model.ts";
import { isWaitingTraceEvent } from "../src/lib/trace-status.ts";
import {
  hasPlanContent,
  parseUserQuestionContent,
} from "../src/lib/user-question-content.ts";

function questionToolEvent(eventName: "PreToolUse" | "PostToolUse") {
  return normalizeTraceEvent({
    capturedAt:
      eventName === "PreToolUse"
        ? "2026-09-10T10:00:00.000Z"
        : "2026-09-10T10:00:01.000Z",
    eventName,
    id: eventName,
    payload: {
      llm_tool_name: "request_user_input",
      tool_name: "AskUserQuestion",
      tool_use_id: "question-1",
    },
    sessionId: "session",
    source: "trae",
    toolName: "AskUserQuestion",
    toolUseId: "question-1",
    workspaceId: "workspace",
  });
}

test("recognizes explicit and tool-based user question events", () => {
  const toolStart = questionToolEvent("PreToolUse");
  const explicit = normalizeTraceEvent({
    eventName: "UserQuestion",
    id: "explicit",
    payload: {},
    sessionId: "session",
    source: "trae",
    workspaceId: "workspace",
  });

  assert.equal(isUserQuestionEvent(toolStart), true);
  assert.equal(isUserQuestionStartEvent(toolStart), true);
  assert.equal(isWaitingTraceEvent(toolStart), true);
  assert.equal(explicit.eventName, "PermissionRequest");
  assert.equal(getAtomIdForEvent(toolStart, "trae"), "harness-user-question");
});

test("labels Notification events as AskUserQuestion activity", () => {
  const notification = normalizeTraceEvent({
    eventName: "Notification",
    id: "notification",
    payload: {},
    sessionId: "session",
    source: "trae",
    workspaceId: "workspace",
  });

  assert.equal(getTraceEventKey(notification), "user.question");
});

test("a WorkBuddy permission prompt is system authorization, not a blocking question", () => {
  // WorkBuddy fires no PermissionRequest hook. While the host asks permission
  // to call AskUserQuestion it only writes this Notification; the tool's real
  // questions arrive later. With no answerable parameters there is nothing to
  // type into the console, so the run must not turn `waiting` and the Flow
  // must not claim a pending question.
  const prompt = normalizeTraceEvent({
    capturedAt: "2026-09-10T10:00:00.000Z",
    eventName: "Notification",
    id: "permission-prompt",
    payload: {
      message: "needs your permission to use AskUserQuestion",
      notification_type: "permission_prompt",
    },
    sessionId: "workbuddy-session",
    source: "workbuddy",
    workspaceId: "workspace",
  });

  assert.equal(isSystemAuthorizationEvent(prompt), true);
  assert.equal(isUserQuestionEvent(prompt), true);
  assert.equal(isUserQuestionStartEvent(prompt), true);
  assert.equal(isBlockingUserQuestionStartEvent(prompt), false);
  assert.equal(isWaitingTraceEvent(prompt), false);
  assert.equal(getTraceEventKey(prompt), "permission.request");
  // It stays on the question atom so the canvas is already at User Question
  // when the real questions arrive — only the blocking/answer half is off.
  assert.equal(
    getAtomIdForEvent(prompt, "workbuddy"),
    "harness-user-question",
  );
  assert.match(getEventSummary(prompt), /AskUserQuestion/);

  const projected = projectTraceEvents([prompt], "workbuddy").events.filter(
    (event) => event.atom.key === "user.question",
  );
  assert.deepEqual(
    projected.map((event) => event.phase),
    ["delta"],
  );

  const topology = buildExecutionTopology([prompt], "workbuddy");
  const question = topology.nodes.find(
    (node) => node.id === "harness-user-question",
  );
  assert.equal(question?.data.count, 1);
  assert.equal(question?.data.status, "running");
});

test("the parameterized question takes over the atom from WorkBuddy's permission prompt", () => {
  const prompt = normalizeTraceEvent({
    capturedAt: "2026-09-10T10:00:00.000Z",
    eventName: "Notification",
    id: "permission-prompt",
    payload: {
      message: "needs your permission to use AskUserQuestion",
      notification_type: "permission_prompt",
    },
    sessionId: "workbuddy-session",
    source: "workbuddy",
    workspaceId: "workspace",
  });
  const question = normalizeTraceEvent({
    capturedAt: "2026-09-10T10:01:00.000Z",
    eventName: "PreToolUse",
    id: "real-question",
    payload: {
      tool_name: "AskUserQuestion",
      tool_input: { questions: [{ question: "Which option?" }] },
    },
    sessionId: "workbuddy-session",
    source: "workbuddy",
    toolName: "AskUserQuestion",
    workspaceId: "workspace",
  });

  const topology = buildExecutionTopology([prompt, question], "workbuddy");
  const node = topology.nodes.find(
    (candidate) => candidate.id === "harness-user-question",
  );
  assert.equal(node?.data.event?.id, question.id);
  assert.equal(node?.data.status, "waiting");
  assert.equal(node?.data.count, 2);
});

test("only permission requests carrying question parameters block the run", () => {
  const gate = (
    id: string,
    toolName: string,
    toolInput: Record<string, unknown>,
  ) =>
    normalizeTraceEvent({
      capturedAt: "2026-09-10T10:00:00.000Z",
      eventName: "PermissionRequest",
      id,
      payload: { tool_name: toolName, tool_input: toolInput },
      sessionId: "zcode-session",
      source: "zcode",
      toolName,
      workspaceId: "workspace",
    });
  // The real ZCode log has dozens of these: the host wants authorization for
  // an ordinary tool and there is no question for the reader to answer.
  const bash = gate("bash", "Bash", { command: "ls" });
  const question = gate("ask", "AskUserQuestion", {
    questions: [{ question: "Which one?", options: [{ label: "A" }] }],
  });
  const plan = gate("plan", "ExitPlanMode", { plan: "# Plan\n\nStep 1" });

  for (const event of [bash]) {
    assert.equal(isSystemAuthorizationEvent(event), true);
    assert.equal(isBlockingUserQuestionStartEvent(event), false);
    assert.equal(isWaitingTraceEvent(event), false);
    assert.equal(isWaitingTraceEvent(event, ["PermissionRequest"]), false);
    assert.equal(getTraceEventKey(event), "permission.request");
    assert.equal(getAtomIdForEvent(event, "zcode"), "harness-action-gate");
  }
  for (const event of [question, plan]) {
    assert.equal(isBlockingUserQuestionStartEvent(event), true);
    assert.equal(isWaitingTraceEvent(event), true);
    assert.equal(isWaitingTraceEvent(event, ["PermissionRequest"]), true);
    assert.equal(getTraceEventKey(event), "user.question");
    assert.equal(getAtomIdForEvent(event, "zcode"), "harness-user-question");
  }

  const projected = projectTraceEvents([bash], "zcode").events;
  assert.equal(
    projected.some((event) => event.atom.key === "user.question"),
    false,
  );
  const topology = buildExecutionTopology([bash, question], "zcode");
  assert.equal(
    topology.nodes.find((node) => node.id === "harness-user-question")?.data.count,
    1,
  );
});

test("generic and non-question permission notifications stay signals", () => {
  const notification = (payload: Record<string, unknown>) =>
    normalizeTraceEvent({
      eventName: "Notification",
      id: `notification-${String(payload.message)}`,
      payload,
      sessionId: "workbuddy-session",
      source: "workbuddy",
      workspaceId: "workspace",
    });
  const signals = [
    notification({
      message: "CodeBuddy is waiting for your input",
      notification_type: "idle_prompt",
    }),
    notification({
      message: "auth_success: 175****2604",
      notification_type: "auth_success",
    }),
    notification({
      message: "needs your permission to use DeferExecuteTool",
      notification_type: "permission_prompt",
    }),
    notification({
      message: "needs your permission to use Bash",
      notification_type: "permission_prompt",
    }),
  ];

  for (const event of signals) {
    assert.equal(isUserQuestionEvent(event), false);
    assert.notEqual(
      getAtomIdForEvent(event, "workbuddy"),
      "harness-user-question",
    );
  }

  // A host that reports the tool in a structured field is accepted as well.
  const structured = notification({
    notification_type: "permission_prompt",
    tool_name: "AskUserQuestion",
  });
  assert.equal(isUserQuestionEvent(structured), true);
});

test("projects a question tool lifecycle to one user question instance", () => {
  const start = questionToolEvent("PreToolUse");
  const end = questionToolEvent("PostToolUse");
  const projected = projectTraceEvents([start, end], "trae").events.filter(
    (event) => event.atom.key === "user.question",
  );

  assert.deepEqual(
    projected.map((event) => event.phase),
    ["waiting", "end"],
  );
  assert.equal(projected[0]?.instance.id, projected[1]?.instance.id);
});

test("shows question tools on the dedicated topology atom", () => {
  const topology = buildExecutionTopology(
    [questionToolEvent("PreToolUse")],
    "trae",
  );
  const question = topology.nodes.find(
    (node) => node.id === "harness-user-question",
  );
  const tool = topology.nodes.find((node) => node.id === "harness-tool-call");

  assert.equal(question?.data.count, 1);
  assert.equal(question?.data.status, "waiting");
  assert.equal(tool?.data.count, 0);
});

test("marks a completed question tool as complete", () => {
  const topology = buildExecutionTopology(
    [questionToolEvent("PreToolUse"), questionToolEvent("PostToolUse")],
    "trae",
  );
  const question = topology.nodes.find(
    (node) => node.id === "harness-user-question",
  );

  assert.equal(question?.data.count, 2);
  assert.equal(question?.data.status, "complete");
});

test("a completed user-question atom binds the question, not its answer", () => {
  const question = "Which framework should we use?";
  const start = normalizeTraceEvent({
    capturedAt: "2026-09-10T10:00:00.000Z",
    eventName: "PermissionRequest",
    id: "question-start",
    payload: {
      tool_use_id: "q-1",
      questions: [{ question, options: [{ label: "React" }, { label: "Vue" }] }],
    },
    sessionId: "session",
    source: "zcode",
    toolName: "AskUserQuestion",
    toolUseId: "q-1",
    workspaceId: "workspace",
  });
  const answer = normalizeTraceEvent({
    capturedAt: "2026-09-10T10:00:01.000Z",
    eventName: "ElicitationResult",
    id: "question-answer",
    payload: { answers: { [question]: "React" } },
    sessionId: "session",
    source: "zcode",
    toolName: "AskUserQuestion",
    toolUseId: "q-1",
    workspaceId: "workspace",
  });

  const topology = buildExecutionTopology([start, answer], "zcode");
  const node = topology.nodes.find(
    (candidate) => candidate.id === "harness-user-question",
  );

  assert.equal(node?.data.event?.id, "question-start");
  assert.equal(node?.data.startEvent?.id, "question-start");
  assert.equal(node?.data.endEvent, null, "node selection keeps the question");
  assert.equal(node?.data.status, "complete", "the answer still closes the atom");
  assert.equal(node?.data.count, 2);
  assert.equal(getTraceEventKey(node?.data.event || null), "user.question");
  assert.match(getEventSummary(start), /Which framework/);
});

test("a repeated question binds the newest asking event", () => {
  const ask = (id: string, question: string) =>
    normalizeTraceEvent({
      capturedAt: "2026-09-10T10:00:00.000Z",
      eventName: "PermissionRequest",
      id,
      payload: { questions: [{ question }] },
      sessionId: "session",
      source: "zcode",
      workspaceId: "workspace",
    });
  const answer = normalizeTraceEvent({
    capturedAt: "2026-09-10T10:00:02.000Z",
    eventName: "ElicitationResult",
    id: "answer-2",
    payload: {},
    sessionId: "session",
    source: "zcode",
    workspaceId: "workspace",
  });
  const topology = buildExecutionTopology(
    [ask("ask-1", "First question?"), ask("ask-2", "Second question?"), answer],
    "zcode",
  );
  const node = topology.nodes.find(
    (candidate) => candidate.id === "harness-user-question",
  );
  assert.equal(node?.data.event?.id, "ask-2");
  assert.equal(node?.data.status, "complete");
});

test("treats a denied question as failed unless it is retryable", () => {
  const denied = normalizeTraceEvent({
    eventName: "PermissionDenied",
    id: "denied",
    payload: {},
    sessionId: "denied-session",
    source: "trae",
    workspaceId: "workspace",
  });
  const retryable = normalizeTraceEvent({
    eventName: "PermissionDenied",
    id: "retryable",
    payload: { retry: true },
    sessionId: "retryable-session",
    source: "trae",
    workspaceId: "workspace",
  });

  assert.equal(buildSessions([denied])[0]?.status, "failed");
  assert.equal(buildSessions([retryable])[0]?.status, "waiting");
});

/**
 * AskUserQuestion's input types, catalogued against the classifier.
 *
 * A question tool event reaches the `user.question` atom when its tool name is
 * recognisable. The name can sit under several spellings — the canonical
 * recorder's snake `tool_name`, ZCode's camel `toolName` twin, or nested inside
 * the tool-input object (`tool_input.name` / `toolInput.name`) — and any of the
 * three question event names. Tool lifecycle rows light the question atom; a
 * PermissionRequest with only an empty `questions` array is a host
 * authorization gate and belongs on Action Gate instead. A row that falls
 * through to a generic `tool.call` would leave the question's node dark.
 */
function questionRaw(
  eventName: "PreToolUse" | "PostToolUse" | "PermissionRequest",
  payload: Record<string, unknown>,
) {
  return normalizeTraceEvent({
    capturedAt: "2026-09-10T10:00:00.000Z",
    eventName,
    id: `raw-${eventName}`,
    payload,
    sessionId: "session",
    source: "zcode",
    workspaceId: "workspace",
  });
}

const questionNameSpells: Array<
  [string, Record<string, unknown>, "PreToolUse" | "PostToolUse"]
> = [
  [
    "top-level toolName (normalized host)",
    { toolName: "AskUserQuestion", tool_input: { questions: [] } },
    "PermissionRequest",
  ],
  [
    "snake payload.tool_name",
    { tool_name: "AskUserQuestion" },
    "PostToolUse",
  ],
  [
    "camel payload.toolName only",
    { toolName: "AskUserQuestion" },
    "PreToolUse",
  ],
  [
    "snake tool_input.name",
    { tool_input: { name: "AskUserQuestion" } },
    "PreToolUse",
  ],
  [
    "snake tool_input.tool_name",
    { tool_input: { tool_name: "AskUserQuestion" } },
    "PreToolUse",
  ],
  [
    "camel toolInput.name",
    { toolInput: { name: "AskUserQuestion" } },
    "PreToolUse",
  ],
  [
    "camel toolInput.toolName",
    { toolInput: { toolName: "AskUserQuestion" } },
    "PreToolUse",
  ],
];

test("every AskUserQuestion tool-name spelling is classified; only answerable ones get the question atom", () => {
  for (const [label, payload, eventName] of questionNameSpells) {
    const event = questionRaw(eventName, payload);
    // Tool-lifecycle rows (Pre/PostToolUse) are recognised by their tool name;
    // an explicit `PermissionRequest` row is recognised by its event name, so
    // the tool-name predicate is only asserted for the former.
    if (eventName !== "PermissionRequest") {
      assert.equal(
        isUserQuestionToolEvent(event),
        true,
        `spelling "${label}" should be recognised as a question tool`,
      );
    }
    assert.equal(
      isUserQuestionEvent(event),
      true,
      `spelling "${label}" should be a user question event`,
    );
    assert.equal(
      getAtomIdForEvent(event, "zcode"),
      isSystemAuthorizationEvent(event) && !hasQuestionParameters(event)
        ? "harness-action-gate"
        : "harness-user-question",
      `spelling "${label}" should match the dedicated atom`,
    );
  }
});

test("non-question tool events keep their generic tool atoms", () => {
  const bash = questionRaw("PreToolUse", {
    toolName: "Bash",
    tool_input: { command: "ls" },
  });
  const nameless = questionRaw("PreToolUse", { tool_input: { questions: [] } });
  assert.equal(isUserQuestionToolEvent(bash), false);
  assert.equal(isUserQuestionToolEvent(nameless), false);
  assert.equal(getTraceEventKey(bash), "tool.call");
  assert.equal(getAtomIdForEvent(bash, "zcode"), "harness-tool-call");
});

test("question start and answer are split by event, not by tool name", () => {
  const start = questionRaw("PreToolUse", { toolName: "AskUserQuestion" });
  const answer = questionRaw("PostToolUse", { toolName: "AskUserQuestion" });
  assert.equal(isUserQuestionStartEvent(start), true);
  assert.equal(isUserQuestionStartEvent(answer), false);
  assert.equal(getTraceEventKey(start), "user.question");
  assert.equal(getTraceEventKey(answer), "user.answer");
});

test("a ZCode ExitPlanMode approval is a user.question whose plan is displayable", () => {
  // The inspector picks the event by its display key and hands its full
  // payload to the question preview. Plan approval has no `questions` array:
  // the Markdown in tool_input.plan is the message content.
  const approval = normalizeTraceEvent({
    eventName: "PermissionRequest",
    id: "plan-approval",
    payload: {
      reason: "Tool ExitPlanMode requires user interaction",
      tool_name: "ExitPlanMode",
      tool_input: {
        plan: "# Plan\n\n## Step 1\n\nRun the test suite before merging.",
        allowedPrompts: [{ tool: "Bash", prompt: "run tests" }],
      },
    },
    sessionId: "zcode-plan-session",
    source: "zcode",
    toolName: "ExitPlanMode",
    workspaceId: "workspace",
  });

  assert.equal(getTraceEventKey(approval), "user.question");
  assert.equal(isWaitingTraceEvent(approval), true);
  const content = parseUserQuestionContent(approval.payload);
  assert.equal(content.hasContent, true);
  assert.match(content.plan, /^# Plan/);
  assert.deepEqual(content.prompts, []);
});

test("plan approval tool rows stay tool events but are previewable", () => {
  // The inspector's content fallback renders the plan on Pre/PostToolUse rows
  // without reclassifying them. Keeping the tool.* keys preserves projection,
  // waiting state and topology counts.
  const toolEvent = (eventName: "PreToolUse" | "PostToolUse") =>
    normalizeTraceEvent({
      eventName,
      id: `plan-${eventName}`,
      payload: {
        tool_name: "ExitPlanMode",
        tool_input: { plan: "# Plan\n\n## Step 1\n\nRun the tests." },
      },
      sessionId: "zcode-plan-session",
      source: "zcode",
      toolName: "ExitPlanMode",
      workspaceId: "workspace",
    });

  const start = toolEvent("PreToolUse");
  const end = toolEvent("PostToolUse");
  assert.equal(getTraceEventKey(start), "tool.call");
  assert.equal(getTraceEventKey(end), "tool.result");
  assert.equal(isUserQuestionEvent(start), false);
  assert.equal(isUserQuestionEvent(end), false);
  assert.equal(hasPlanContent(start.payload), true);
  assert.equal(hasPlanContent(end.payload), true);
});
