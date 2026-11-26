import assert from "node:assert/strict";
import test from "node:test";

import {
  hasPlanContent,
  mergeQuestionAnswers,
  parseUserQuestionContent,
  userQuestionSummary,
} from "../src/lib/user-question-content.ts";
import type { TracePayload } from "../src/types/trace.ts";

test("structured AskUserQuestion payloads render per question with options", () => {
  const content = parseUserQuestionContent({
    tool_input: {
      questions: [
        {
          header: "Deploy",
          question: "Deploy **tonight**?",
          options: [
            { label: "Yes", description: "ship it" },
            { label: "No", description: "wait for CI" },
          ],
        },
      ],
    },
  } as TracePayload);
  assert.equal(content.hasContent, true);
  assert.equal(content.prompts.length, 1);
  assert.equal(content.prompts[0].title, "Deploy");
  assert.equal(content.prompts[0].question, "Deploy **tonight**?");
  assert.deepEqual(content.prompts[0].options, [
    { label: "Yes", description: "ship it" },
    { label: "No", description: "wait for CI" },
  ]);
  // The structured shape replaces the free-form message, not stacks with it.
  assert.equal(content.message, "");
});

test("an empty tool_input placeholder does not hide camelCase questions", () => {
  // The recorder writes `tool_input: {}` when only `toolInput` carries the
  // arguments. Reading that placeholder as "present" left the question card
  // empty even though the capture contained a complete AskUserQuestion.
  const content = parseUserQuestionContent({
    tool_input: {},
    toolInput: {
      questions: [
        {
          question: "Which region?",
          options: [{ label: "CN", description: "Beijing" }],
        },
      ],
    },
  } as TracePayload);
  assert.equal(content.hasContent, true);
  assert.equal(content.prompts.length, 1);
  assert.equal(content.prompts[0].question, "Which region?");
});

test("questions sitting directly on the payload resolve the same way", () => {
  // The inspector's input tab hands the tool_input object to the preview for
  // question tools, so the extractor accepts both nestings.
  const content = parseUserQuestionContent({
    questions: [
      {
        question: "Approve the write to `src/app.tsx`?",
        options: ["Allow", "Deny"],
      },
    ],
  } as unknown as TracePayload);
  assert.equal(content.prompts.length, 1);
  // No header: the component titles the section "Question 1".
  assert.equal(content.prompts[0].title, "");
  assert.deepEqual(content.prompts[0].options, [
    { label: "Allow" },
    { label: "Deny" },
  ]);
});

test("free-form payloads fall back to the message field", () => {
  const content = parseUserQuestionContent({
    notification_type: "idle_prompt",
    message: "Agent completed the task.",
  } as TracePayload);
  assert.equal(content.hasContent, true);
  assert.deepEqual(content.prompts, []);
  assert.equal(content.message, "Agent completed the task.");
});

test("the free-form lookup also reads the nested tool_input", () => {
  const content = parseUserQuestionContent({
    llm_tool_name: "request_user_input",
    tool_input: { content: "需要确认目标分支" },
  } as unknown as TracePayload);
  assert.equal(content.hasContent, true);
  assert.equal(content.message, "需要确认目标分支");
});

test("an empty payload reports nothing displayable", () => {
  assert.equal(parseUserQuestionContent({}).hasContent, false);
  assert.equal(parseUserQuestionContent(null).hasContent, false);
  assert.equal(parseUserQuestionContent(undefined).hasContent, false);
});

test("string options and unrecognized option shapes keep the labels they have", () => {
  const content = parseUserQuestionContent({
    questions: [
      {
        question: "Pick one",
        options: ["alpha", { value: "beta" }, 42, null],
      },
    ],
  } as unknown as TracePayload);
  // Plain strings and value-shaped objects become labels; everything else
  // drops instead of rendering "[object Object]".
  assert.deepEqual(content.prompts[0].options, [
    { label: "alpha" },
    { label: "beta" },
  ]);
});

// ZCode (and Claude Code) report plan approval as PermissionRequest with
// toolName "ExitPlanMode". The only readable text is the Markdown plan in
// tool_input, not questions/message/content.
const zcodePlanApproval = {
  eventName: "PermissionRequest",
  hook_event_name: "PermissionRequest",
  reason: "Tool ExitPlanMode requires user interaction",
  toolName: "ExitPlanMode",
  tool_name: "ExitPlanMode",
  toolUseId: "call_plan_1",
  tool_use_id: "call_plan_1",
  tool_input: {
    plan: "# 新增「对话验证」页\n\n## 目标\n新增一个页面\n\n1. 步骤一\n2. 步骤二",
    allowedPrompts: [{ tool: "Bash", prompt: "run tests" }],
  },
} as unknown as TracePayload;

test("ZCode plan approval renders the ExitPlanMode plan as Markdown", () => {
  const content = parseUserQuestionContent(zcodePlanApproval);
  assert.equal(content.hasContent, true);
  assert.deepEqual(content.prompts, []);
  assert.equal(content.message, "");
  assert.equal(
    content.plan,
    "# 新增「对话验证」页\n\n## 目标\n新增一个页面\n\n1. 步骤一\n2. 步骤二",
  );
});

test("camelCase toolInput plans resolve for raw hook payloads", () => {
  const content = parseUserQuestionContent({
    reason: "Tool ExitPlanMode requires user interaction",
    toolInput: { plan: "## Step 1\n\nShip it." },
  } as unknown as TracePayload);
  assert.equal(content.hasContent, true);
  assert.equal(content.plan, "## Step 1\n\nShip it.");
});

test("an approved plan in tool_response is still displayable", () => {
  const content = parseUserQuestionContent({
    eventName: "PostToolUse",
    tool_name: "ExitPlanMode",
    tool_response: { plan: "## Approved plan\n\nRun the tests." },
  } as unknown as TracePayload);
  assert.equal(content.hasContent, true);
  assert.equal(content.plan, "## Approved plan\n\nRun the tests.");
});

test("structured questions keep priority over a plan", () => {
  const content = parseUserQuestionContent({
    questions: [{ question: "Which branch?", options: ["main", "dev"] }],
    tool_input: { plan: "## Plan" },
  } as unknown as TracePayload);
  assert.equal(content.prompts.length, 1);
  assert.equal(content.message, "");
  assert.equal(content.plan, "");
});

test("a plan approval without readable text stays truthfully empty", () => {
  const content = parseUserQuestionContent({
    reason: "Tool ExitPlanMode requires user interaction",
    tool_input: { plan: "   " },
  } as unknown as TracePayload);
  assert.equal(content.hasContent, false);
  assert.equal(content.plan, "");
  assert.equal(content.message, "");
});

test("hasPlanContent widens the preview only for plan-shaped payloads", () => {
  assert.equal(hasPlanContent(zcodePlanApproval), true);
  assert.equal(
    hasPlanContent({ toolInput: { plan: "## Step 1" } } as unknown as TracePayload),
    true,
  );
  assert.equal(hasPlanContent({ questions: [{ question: "Pick one" }] } as unknown as TracePayload), false);
  assert.equal(hasPlanContent({ message: "Agent completed." } as TracePayload), false);
  assert.equal(hasPlanContent({}), false);
  assert.equal(hasPlanContent(null), false);
});

test("an auto-approve hook's answers are visible beside the question", () => {
  const content = parseUserQuestionContent({
    tool_input: {
      questions: [
        { question: "Which framework?", options: ["React", "Vue"] },
      ],
      answers: { "Which framework?": "React" },
    },
  } as unknown as TracePayload);
  assert.equal(content.prompts.length, 1);
  assert.equal(content.hasContent, true);
  assert.deepEqual(content.answers, [
    { question: "Which framework?", answer: "React" },
  ]);
});

test("an answers-only tool result stays displayable", () => {
  const content = parseUserQuestionContent({
    eventName: "PostToolUse",
    tool_response: { answers: { "Deploy tonight?": "Yes, No" } },
  } as unknown as TracePayload);
  assert.equal(content.hasContent, true);
  assert.deepEqual(content.prompts, []);
  assert.equal(content.message, "");
  assert.equal(content.plan, "");
  assert.deepEqual(content.answers, [
    { question: "Deploy tonight?", answer: "Yes, No" },
  ]);
});

test("camelCase answers resolve and non-string values are ignored", () => {
  const content = parseUserQuestionContent({
    toolInput: {
      answers: { "Pick one": "alpha", "Bad: number": 42, "Bad: null": null },
    },
    toolResponse: ["not an object"],
  } as unknown as TracePayload);
  assert.deepEqual(content.answers, [{ question: "Pick one", answer: "alpha" }]);
  assert.equal(content.hasContent, true);
});

test("the display summary names the question, not its tool", () => {
  assert.equal(
    userQuestionSummary({
      tool_name: "AskUserQuestion",
      tool_input: {
        questions: [
          { question: "Which framework?" },
          { question: "Which database?" },
        ],
      },
    } as unknown as TracePayload),
    "Which framework? · Which database?",
  );
  assert.equal(
    userQuestionSummary({ message: "Need a decision on rollout" } as unknown as TracePayload),
    "Need a decision on rollout",
  );
  assert.equal(
    userQuestionSummary({ tool_input: { plan: "# Plan\n\nShip it" } } as unknown as TracePayload),
    "# Plan",
  );
  assert.equal(userQuestionSummary({ tool_name: "AskUserQuestion" } as unknown as TracePayload), "");
});

test("answers are independent of plan detection", () => {
  const content = parseUserQuestionContent({
    tool_input: { plan: "# Plan", answers: { "Approve?": "Yes" } },
  } as unknown as TracePayload);
  assert.equal(content.plan, "# Plan");
  assert.deepEqual(content.answers, [{ question: "Approve?", answer: "Yes" }]);
  assert.equal(hasPlanContent({ tool_input: { plan: "# Plan" } } as unknown as TracePayload), true);
});

test("mergeQuestionAnswers joins the two captured halves without duplicating", () => {
  const own = [{ question: "Which db?", answer: "sqlite" }];
  const recorded = [
    { question: "Which db?", answer: "sqlite" },
    { question: "Ship it?", answer: "yes" },
  ];
  assert.deepEqual(mergeQuestionAnswers(own, recorded), [
    { question: "Which db?", answer: "sqlite" },
    { question: "Ship it?", answer: "yes" },
  ]);
  // Nothing recorded: the own answers stay, as a fresh array.
  const empty = mergeQuestionAnswers(own, []);
  assert.deepEqual(empty, own);
  assert.notEqual(empty, own);
});
