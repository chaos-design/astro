import assert from "node:assert/strict";
import test from "node:test";

import { parseUserQuestionContent } from "../src/lib/user-question-content.ts";
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
  assert.deepEqual(content.prompts[0].options, ["Yes", "No"]);
  // The structured shape replaces the free-form message, not stacks with it.
  assert.equal(content.message, "");
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
  assert.deepEqual(content.prompts[0].options, ["Allow", "Deny"]);
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
  assert.deepEqual(content.prompts[0].options, ["alpha", "beta"]);
});
