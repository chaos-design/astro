import assert from "node:assert/strict";
import test from "node:test";

import { buildAgentView } from "../src/lib/agent-view.ts";
import { formatLogSequence } from "../src/lib/trace-model.ts";
import type { TraceEvent } from "../src/types/trace.ts";
import { createDemoEvents } from "./helpers/demo-fixture.ts";

const NOW = Date.parse("2026-11-23T10:00:00.000Z");

function copyEvents(mutate: (event: TraceEvent, index: number) => void) {
  // Clone the repository sample instead of inlining a second event fixture.
  return createDemoEvents(NOW).map((event, index) => {
    const copy: TraceEvent = {
      ...event,
      payload: { ...(event.payload ?? {}) },
    };
    mutate(copy, index);
    return copy;
  });
}

test("merges two streamed prefixes and the final message into one reply", () => {
  const view = buildAgentView(createDemoEvents(NOW), "chatgpt");
  assert.equal(view.stats.snapshotsMerged, 2);
  assert.equal(view.stats.replies, 1);
  assert.equal(view.stats.questions, 1);
  assert.equal(view.stats.thinking, 3);
  assert.equal(view.diagnostics.length, 0);

  const reply = view.steps.find((step) => step.kind === "reply");
  assert.ok(reply);
  if (reply?.kind !== "reply") return;
  assert.equal(reply.messageId, "demo-message-3");
  assert.equal(reply.snapshotCount, 2);
  assert.equal(reply.eventIds.length, 3);
  assert.match(reply.text, /先补全派生层与回归测试/);
  assert.equal(new Set(reply.eventIds).size, 3);
  // Every merged event is a valid rail anchor for the same step.
  for (const eventId of reply.eventIds) {
    assert.ok(
      view.steps.some(
        (step) => "eventIds" in step && step.eventIds.includes(eventId),
      ),
    );
  }
});

test("keeps every Reasoning event as its own thinking block", () => {
  const view = buildAgentView(createDemoEvents(NOW));
  const thinking = view.steps.filter((step) => step.kind === "thinking");
  assert.equal(thinking.length, 3);
  assert.equal(new Set(thinking.map((step) => step.id)).size, 3);
  assert.ok(thinking.every((step) => step.kind === "thinking" && step.collapsedByDefault));
});

test("a run with no AgentMessage projects its Stop final message as a reply", () => {
  // A host that publishes no AgentMessage (WorkBuddy's ChatGPT capture)
  // carries the assistant's reply on the Stop event's last_assistant_message.
  // Without this projection the 回复 counter reads 0 for such a run.
  const events = createDemoEvents(NOW).filter((event) =>
    !["AgentMessage", "Reasoning"].includes(event.eventName),
  );
  assert.ok(
    events.some((event) => event.eventName === "Stop"),
    "the demo run carries a Stop event",
  );
  const view = buildAgentView(events, "workbuddy");
  const stop = events.find((event) => event.eventName === "Stop")!;
  const reply = view.steps.find(
    (step) => step.kind === "reply" && step.eventId === stop.id,
  );
  assert.ok(reply, "the Stop projects as a reply step");
  if (reply?.kind !== "reply") return;
  assert.match(reply.text, /Implementation complete/);
});

test("parses the question once and binds it to the blocking start event", () => {
  const view = buildAgentView(createDemoEvents(NOW));
  const question = view.steps.find((step) => step.kind === "question");
  assert.ok(question);
  if (question?.kind !== "question") return;
  assert.equal(question.parsed.prompts.length, 1);
  assert.equal(question.parsed.prompts[0].question, "选择部署方式？");
  assert.deepEqual(
    question.parsed.prompts[0].options.map((option) => option.label),
    ["本地", "云端"],
  );
  assert.deepEqual(question.parsed.answers, [
    { question: "选择部署方式？", answer: "本地" },
  ]);
  assert.equal(
    view.steps.find((step) => step.eventId === question.eventId)?.kind,
    "question",
  );
});

test("a broken prefix keeps all steps and records a diagnostic", () => {
  const events = copyEvents((event) => {
    if (
      event.eventName === "AgentMessage" &&
      event.payload.streamed === true &&
      event.payload.message === "我已理解你的需求，建议按以下步骤处理："
    ) {
      event.payload.message = "一条与前缀无关的回复";
    }
  });
  const view = buildAgentView(events);
  assert.equal(view.stats.replies, 3);
  assert.equal(view.stats.snapshotsMerged, 0);
  assert.equal(view.diagnostics.length, 2);
  assert.ok(view.diagnostics.every((item) => item.reason === "prefix-break"));
  assert.equal(view.diagnostics[0].messageId, "demo-message-3");
});

test("tool steps expose the command captured on the paired start event", () => {
  const events = createDemoEvents(NOW);
  const view = buildAgentView(events, "chatgpt");
  const tool = view.steps.find(
    (step) =>
      step.kind === "tool-result" && step.inputs?.command !== null && step.inputs !== null,
  );
  assert.ok(tool);
  if (tool?.kind !== "tool-result") return;
  // A captured shell command is the call's command, with no flattened fields.
  assert.equal(tool.inputs?.command, "pnpm test && pnpm build");
  assert.deepEqual(tool.inputs?.fields, []);
  // The projection is derived: the paired start event keeps its own shape.
  const raw = events.find((event) => event.id === tool.pairLink?.partnerId);
  assert.equal(raw?.payload.tool_input?.cmd, "pnpm test && pnpm build");
  assert.equal("command" in (raw?.payload ?? {}), false);

  // A structured tool (no shell command) carries each short input as its own
  // field — never flattened into `field=value` text — with diff-carrying
  // fields kept out so their patch keeps its own rendering.
  const structured = copyEvents((event) => {
    if (event.eventName === "PreToolUse" && event.toolUseId === "tool-test") {
      event.toolName = "Read";
      event.payload = {
        tool_input: {
          file_path: "/tmp/project/file.test.tsx",
          limit: 100,
          old_string: "a",
          new_string: "b",
        },
        tool_name: "Read",
      };
    }
  });
  const structuredView = buildAgentView(structured, "chatgpt");
  const structuredTool = structuredView.steps.find(
    (step) =>
      step.kind === "tool-result" &&
      step.inputs?.fields.some((field) => field.key === "limit"),
  );
  assert.ok(structuredTool, "the structured tool's result step is projected");
  if (structuredTool?.kind !== "tool-result") return;
  assert.equal(structuredTool.inputs?.command, null);
  assert.deepEqual(structuredTool.inputs?.fields, [
    { key: "file_path", value: "/tmp/project/file.test.tsx", literal: "file_path=/tmp/project/file.test.tsx" },
    { key: "limit", value: "100", literal: "limit=100" },
  ]);
});

test("a tool-call start step opens with its structured call and tool name", () => {
  const view = buildAgentView(createDemoEvents(NOW), "chatgpt");
  // A PreToolUse that is not a user-question tool projects as a generic
  // event step. Its structured call (shell command, else the tool name plus
  // its short inputs) and its tool name surface on the step, so the card
  // opens with the CALL instead of burying it in the related-fields dump.
  const call = view.steps.find(
    (step) => step.kind === "event" && step.eventName === "PreToolUse",
  );
  assert.ok(call, "a PreToolUse start projects as an event step");
  if (call?.kind !== "event") return;
  assert.equal(call.toolName, "Read");
  assert.equal(call.inputs?.command, null);
  assert.deepEqual(call.inputs?.fields, [
    { key: "path", value: "src/app.tsx", literal: "path=src/app.tsx" },
  ]);
  // A non-tool event carries no invented call or tool name.
  const plain = view.steps.find(
    (step) => step.kind === "event" && step.eventName !== "PreToolUse",
  );
  assert.ok(plain, "the run carries a non-tool event step");
  if (plain?.kind !== "event") return;
  assert.equal(plain.toolName, null);
  assert.equal(plain.inputs, null);
});

test("a finished question projects its recorded answers and its result step carries them", () => {
  const view = buildAgentView(createDemoEvents(NOW), "chatgpt");
  const question = view.steps.find((step) => step.kind === "question");
  assert.ok(question, "the demo run carries a user question");
  if (question?.kind !== "question") return;
  // The recorded answer arrives on the paired result event (or is injected
  // on the start); the projection merges both halves through the one join,
  // so a finished question reads as answered instead of 未作答.
  assert.deepEqual(question.answers, [{ question: "选择部署方式？", answer: "本地" }]);

  // The question tool's own result step carries the answers and the option
  // sets of the paired start event, for the shared answer-rows rendering.
  const result = view.steps.find(
    (step) => step.kind === "tool-result" && step.toolName === "AskUserQuestion",
  );
  assert.ok(result, "the question tool's result is its own step");
  if (result?.kind !== "tool-result") return;
  assert.deepEqual(result.answers, [{ question: "选择部署方式？", answer: "本地" }]);
  assert.equal(result.answerQuestions.length, 1);
  assert.equal(result.answerQuestions[0].question, "选择部署方式？");
  assert.deepEqual(
    result.answerQuestions[0].options,
    [
      { label: "本地", description: "在本机运行服务与控制台" },
      { label: "云端", description: "部署静态控制台并连接本地服务" },
    ],
  );
});

test("thinking steps carry the real reasoning text from the capture", () => {
  const events = copyEvents((event) => {
    if (event.eventName === "Reasoning") {
      event.payload = { message: "用户让我审查 PR，先看 diff 再定结论" };
    }
  });
  const view = buildAgentView(events);
  const thinking = view.steps.filter((step) => step.kind === "thinking");
  assert.equal(thinking.length, 3);
  assert.ok(
    thinking.every(
      (step) =>
        step.kind === "thinking" &&
        step.text === "用户让我审查 PR，先看 diff 再定结论",
    ),
  );
});

test("legacy events without messageId still fold adjacent prefixes", () => {
  const events = copyEvents((event) => {
    if (event.eventName === "AgentMessage") {
      delete event.payload.messageId;
    }
  });
  const view = buildAgentView(events);
  assert.equal(view.stats.replies, 1);
  assert.equal(view.stats.snapshotsMerged, 2);
  const reply = view.steps.find((step) => step.kind === "reply");
  assert.ok(reply);
  if (reply?.kind !== "reply") return;
  assert.equal(reply.messageId, null);
  assert.equal(reply.eventIds.length, 3);
});

test("a literal default id is treated as absent so the reply merges once", () => {
  // Producers that fall back to "default" must not split the snapshots from
  // the final message into two replies.
  const events = copyEvents((event) => {
    if (event.eventName === "AgentMessage") {
      event.payload.messageId = "default";
    }
  });
  const view = buildAgentView(events);
  assert.equal(view.stats.replies, 1);
  assert.equal(view.stats.snapshotsMerged, 2);
  const reply = view.steps.find((step) => step.kind === "reply");
  assert.ok(reply);
  if (reply?.kind !== "reply") return;
  assert.equal(reply.messageId, null);
  assert.equal(reply.eventIds.length, 3);
});

test("a subagent reusing a messageId is not folded into the main reply", () => {
  const events = copyEvents((event) => {
    if (event.eventName === "AgentMessage") {
      event.payload.messageId = "shared-id";
    }
  });
  // Pi writes child events under the parent session with their own origin.
  const final = events.find(
    (event) => event.eventName === "AgentMessage" && event.payload.streamed !== true,
  );
  assert.ok(final);
  if (final) {
    (final as TraceEvent & { subagentSessionId?: string }).subagentSessionId =
      "child-session-1";
  }
  const view = buildAgentView(events);
  assert.equal(view.stats.replies, 2);
  const replies = view.steps.filter((step) => step.kind === "reply");
  assert.equal(new Set(replies.map((step) => step.eventId)).size, 2);
});

test("a merged reply's sequence and rail anchor name the same first event", () => {
  const events = createDemoEvents(NOW);
  const view = buildAgentView(events, "chatgpt");
  const reply = view.steps.find((step) => step.kind === "reply");
  assert.ok(reply);
  if (reply?.kind !== "reply") return;
  const anchorIndex = events.findIndex((event) => event.id === reply.eventId);
  assert.ok(anchorIndex >= 0);
  assert.equal(reply.sequence, formatLogSequence(anchorIndex + 1));
  assert.equal(events[anchorIndex].payload.streamed, true);
});
