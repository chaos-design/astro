import assert from "node:assert/strict";
import test from "node:test";

import { payloadToMarkdown } from "../src/lib/payload-markdown.ts";

test("a captured string is the markdown document", () => {
  assert.equal(payloadToMarkdown("# Deploy\n\nRun `pnpm build`."), "# Deploy\n\nRun `pnpm build`.");
});

test("a single text field is unwrapped instead of gaining a redundant heading", () => {
  assert.equal(payloadToMarkdown({ message: "**done**" }), "**done**");
  assert.equal(payloadToMarkdown({ output: "hello" }), "hello");
});

test("multiple fields keep their structure and stringify structured values as JSON", () => {
  const markdown = payloadToMarkdown({
    message: "Here is the plan",
    meta: { turns: 2 },
    count: 3,
    ok: true,
  });
  assert.match(markdown, /### message\n\nHere is the plan/);
  assert.match(markdown, /### meta\n\n```json\n/);
  assert.match(markdown, /"turns": 2/);
  assert.match(markdown, /- \*\*count\*\*: `3`/);
  assert.match(markdown, /- \*\*ok\*\*: `true`/);
});

test("arrays of plain values render as a list and other scalars stay readable", () => {
  assert.equal(payloadToMarkdown(["one", "two"]), "- one\n- two");
  assert.equal(payloadToMarkdown(42), "42");
  assert.equal(payloadToMarkdown(null), "");
  assert.equal(payloadToMarkdown({ blank: "", kept: "yes" }), "### kept\n\nyes");
});

test("an answers map becomes question rows with Markdown answers", () => {
  const markdown = payloadToMarkdown({
    tool_input: {
      answers: {
        "Pick a target": "**Edge**\n\n- low latency",
        "Which framework?": "React",
      },
    },
  });
  assert.match(markdown, /### Answers/);
  assert.match(markdown, /\*\*Pick a target\*\*\n\n\*\*Edge\*\*/);
  assert.match(markdown, /- low latency/);
});

test("a questions list becomes a list with its options", () => {
  const markdown = payloadToMarkdown({
    tool_input: {
      questions: [
        {
          header: "Target",
          question: "Where should we deploy?",
          options: [
            { label: "Edge", description: "low latency" },
            "Origin",
          ],
        },
      ],
    },
  });
  assert.match(markdown, /### Questions/);
  assert.match(markdown, /1\. \*\*Target\*\* — Where should we deploy\?/);
  assert.match(markdown, /   - \*\*Edge\*\* — low latency/);
  assert.match(markdown, /   - \*\*Origin\*\*/);
});

test("nested tool content is flattened to its text", () => {
  assert.equal(
    payloadToMarkdown({
      tool_response: { content: [{ type: "text", text: "hello **world**" }] },
    }),
    "hello **world**",
  );
});

test("a tool result beside metadata previews its markdown, not its field names", () => {
  assert.equal(
    payloadToMarkdown({
      tool_use_id: "call_001",
      tool_name: "Read",
      tool_response: {
        content: [{ type: "text", text: "# Deploy\n\nRun `pnpm build`." }],
      },
    }),
    "# Deploy\n\nRun `pnpm build`.",
  );
});

test("the inspector's captured wrapper previews the captured result", () => {
  const markdown = payloadToMarkdown({
    contract: { label: "tool.result", output: { summary: "ok" } },
    captured: { content: [{ type: "text", text: "## Result\n\n- one\n- two" }] },
  });
  assert.equal(markdown, "## Result\n\n- one\n- two");
});

test("a JSON tool result is fenced so it renders with syntax highlighting", () => {
  const markdown = payloadToMarkdown({ tool_response: '{"ok":true,"count":2}' });
  assert.equal(markdown, '```json\n{"ok":true,"count":2}\n```');
});

test("circular payloads fall back instead of throwing", () => {
  const circular: Record<string, unknown> = { label: "loop" };
  circular.self = circular;
  const markdown = payloadToMarkdown(circular);
  assert.match(markdown, /unserializable|\[circular reference\]/);
});
