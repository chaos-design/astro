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

test("the generic view is content-only: metadata keys and scalars stay out", () => {
  const markdown = payloadToMarkdown({
    message: "Here is the plan",
    meta: { turns: 2 },
    count: 3,
    ok: true,
  });
  // The message is the content; the field-name heading, the metadata object
  // and the plain scalar values do not belong in the preview pane.
  assert.equal(markdown, "Here is the plan");
  assert.doesNotMatch(markdown, /###|turns|count|`3`|`true`/);
});

test("arrays of plain values render as a list and other scalars stay readable", () => {
  assert.equal(payloadToMarkdown(["one", "two"]), "- one\n- two");
  assert.equal(payloadToMarkdown(42), "42");
  assert.equal(payloadToMarkdown(null), "");
  assert.equal(payloadToMarkdown({ blank: "", kept: "yes" }), "yes");
});

test("an Edit-style old/new string pair previews as the diff it is", () => {
  const markdown = payloadToMarkdown({
    tool_input: {
      file_path: "/tmp/project/file.test.tsx",
      old_string: 'import { IMPERIAL_EXAM_LADDER } from "./ladder";',
      new_string: 'import { EXAM_STAGES } from "./ladder";',
      replace_all: false,
    },
  });
  // The change is the result the reader came to see: one highlighted diff
  // (the old line as a deletion, the new one as an addition), with the
  // metadata (file_path, replace_all) staying out.
  assert.match(markdown, /```diff\n--- a\/\/tmp\/project\/file\.test\.tsx\n\+\+\+ b\/\/tmp\/project\/file\.test\.tsx\n@@ -1,1 \+1,1 @@\n-import \{ IMPERIAL_EXAM_LADDER \} from "\.\/ladder";\n\+import \{ EXAM_STAGES \} from "\.\/ladder";\n```$/);
  assert.doesNotMatch(markdown, /###|replace_all|```typescript/);
});

test("an Edit input in ZCode's camel spelling previews as the same diff", () => {
  const markdown = payloadToMarkdown({
    tool_input: {
      filePath: "src/lib/agent-view.ts",
      oldString: "const a = 1;",
      newString: "const a = 2;",
    },
  });
  assert.match(markdown, /--- a\/src\/lib\/agent-view\.ts/);
  assert.match(markdown, /-const a = 1;/);
  assert.match(markdown, /\+const a = 2;/);
});

test("an Edit input with trailing newlines previews a minimal diff", () => {
  const markdown = payloadToMarkdown({
    tool_input: {
      file_path: "src/lib/agent-view.ts",
      old_string: "line1\n",
      new_string: "line2\n",
    },
  });
  // The trailing newline is a terminator, not a blank line: the hunk stays
  // 1→1 with no ghost empty deletion/addition.
  assert.match(markdown, /@@ -1,1 \+1,1 @@/);
  assert.match(markdown, /-line1\n\+line2/);
  assert.doesNotMatch(markdown, /-\n\+\n/);
});

test("a todos array renders as a GFM checklist, not a JSON dump", () => {
  const markdown = payloadToMarkdown({
    todos: [
      { content: "pnpm test", status: "completed", priority: "high" },
      { content: "pnpm build", status: "in_progress", priority: "high" },
      { content: "push the branch", status: "pending", priority: "low" },
    ],
  });
  assert.equal(
    markdown,
    "- [x] pnpm test — priority=high\n- [ ] pnpm build — priority=high\n- [ ] push the branch — priority=low",
  );
  assert.doesNotMatch(markdown, /```json/);
});

test("a boolean status drives the todo checkbox too", () => {
  const markdown = payloadToMarkdown({
    todos: [
      { content: "A", done: true },
      { content: "B", done: false },
    ],
  });
  // `done` is a status key; boolean true maps to the done value "true".
  assert.equal(markdown, "- [x] A\n- [ ] B");
});

test("a lone array field is a list, not an unwrapped document", () => {
  // A `{ todos }` payload has one key, but unwrapping would join the
  // checklist rows into prose; the list keeps its shape.
  const markdown = payloadToMarkdown({
    todos: [
      { content: "fix the bug", status: "completed" },
      { content: "ship it", status: "pending" },
    ],
  });
  assert.equal(markdown, "- [x] fix the bug\n- [ ] ship it");
});

test("a captured shell command is fenced instead of rendered as prose", () => {
  // The result extractor used to return raw text (or fence only JSON), so a
  // tool command arrived at the preview as a paragraph with its URL linked.
  assert.match(
    payloadToMarkdown({ tool_input: { command: "git status --short && pnpm test" } }),
    /^```bash\ngit status --short && pnpm test\n```$/,
  );
  assert.match(
    payloadToMarkdown({ command: "ASTRO_PORT=4401 pnpm service:up" }),
    /^```bash\nASTRO_PORT=4401 pnpm service:up\n```$/,
  );
  assert.equal(
    payloadToMarkdown({ message: "# Deploy\n\nRun `pnpm build`." }),
    "# Deploy\n\nRun `pnpm build`.",
  );
});

test("a Markdown message field renders as itself, not one code fence", () => {
  // The generic view shares the one fence decision with the content
  // extractor: an agent message that sketches `export type` lines inside a
  // document stays a document (the inspector's generic view included).
  const markdown = payloadToMarkdown({
    eventName: "Reasoning",
    message: "## Plan\n\n**Layout:** two columns\n\nexport type Spec = { id: string };\n",
  });
  assert.match(markdown, /## Plan/);
  assert.match(markdown, /\*\*Layout:\*\*/);
  assert.doesNotMatch(markdown, /```typescript\n## Plan/);
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

test("the inspector wrapper previews the captured content, not the contract metadata", () => {
  const markdown = payloadToMarkdown({
    contract: { label: "user.prompt", input: {} },
    captured: { prompt: "Trace this run", turn: 1, turn_id: "turn-1" },
  });
  assert.equal(markdown, "Trace this run");
  assert.doesNotMatch(markdown, /contract|captured|```json/);
});

test("a structured captured result reads as its values instead of a JSON dump", () => {
  const markdown = payloadToMarkdown({
    contract: { label: "tool.result", output: {} },
    captured: {
      tool_use_id: "tool-read",
      tool_name: "Read",
      tool_response: { status: "ok", bytes: 18420 },
    },
  });
  // Values only — the metadata keys (tool_use_id, tool_name, status) are
  // labelled in the related-data pane, not in the preview.
  assert.equal(markdown, "- 18420");
  assert.doesNotMatch(markdown, /\*\*status\*\*|\*\*bytes\*\*|```json|tool_use_id|tool_name|ok/);
});

test("a nested tool_input plan previews as markdown, not field labels", () => {
  const markdown = payloadToMarkdown({
    contract: { label: "harness.user-question", input: {} },
    captured: { tool_input: { plan: "# Plan\n\n1. Do A" }, tool_name: "ExitPlanMode" },
  });
  assert.equal(markdown, "# Plan\n\n1. Do A");
});

test("a multi-field tool response with nested content previews its text", () => {
  const markdown = payloadToMarkdown({
    contract: { label: "tool.result", output: {} },
    captured: {
      role: "assistant",
      content: [{ type: "text", text: "## Deploy\n\n- step one" }],
      stop_reason: "end_turn",
    },
  });
  assert.equal(markdown, "## Deploy\n\n- step one");
});

test("circular payloads fall back instead of throwing", () => {
  const circular: Record<string, unknown> = { label: "loop" };
  circular.self = circular;
  const markdown = payloadToMarkdown(circular);
  assert.match(markdown, /unserializable|\[circular reference\]/);
});

test("the recorder identity stays out of the generic preview but a nested version is kept", () => {
  const markdown = payloadToMarkdown({
    tool_input: { command: "cd /work && echo hi" },
    client: "WorkBuddy",
    version: "5.11.3",
    captured: { version: "1.0.0" },
  });
  // The agent name and client version belong in the dialog header, never as
  // content lines in the preview body.
  assert.doesNotMatch(markdown, /WorkBuddy/);
  assert.doesNotMatch(markdown, /5\.11\.3/);
  assert.match(markdown, /cd \/work && echo hi/);
  // A genuine version field deeper in the payload is still captured data.
  assert.match(markdown, /1\.0\.0/);
});

test("a numbered Read result keeps its captured file path when the split has no content", () => {
  // A WorkBuddy Read result carries the dump on `tool_response`, which the
  // generic split leaves empty — so the preview falls to payloadToMarkdown.
  // The file extension must still select TypeScript, not bash (an `export`
  // line inside a source file is not a shell assignment).
  const markdown = payloadToMarkdown({
    hook_event_name: "PostToolUse",
    tool_name: "Read",
    tool_input: { file_path: "/work/tests/index.test.ts", limit: 30, offset: 1 },
    tool_response: "   1→export function go() {}\n   2→const x = 1;",
    client: "WorkBuddy",
    version: "5.11.3",
  });
  assert.match(markdown, /^```typescript\n/);
  assert.doesNotMatch(markdown, /WorkBuddy/);
  assert.doesNotMatch(markdown, /5\.11\.3/);
});
