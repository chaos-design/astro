import assert from "node:assert/strict";
import test from "node:test";
import {
  collectPayloadFields,
  contentToMarkdown,
  fallbackPayloadMarkdown,
  fenceCode,
  hasListPayload,
  inferCodeLanguage,
  isFoldableRelatedValue,
  isPayloadMetaKey,
  orderRelated,
  payloadBodyOf,
  RELATED_VALUE_MAX_CHARS,
  splitPayloadPreview,
} from "../src/lib/payload-preview.ts";
import { payloadToMarkdown } from "../src/lib/payload-markdown.ts";

test("metadata key matching uses whole words, not substrings", () => {
  // A substring test silently dropped real prose: "id" hid `guidelines`,
  // "user" hid `userMessage`, "source" hid `sourceCode`. Genuine metadata
  // still matches through an exact token.
  for (const key of [
    "width", "valid", "hidden", "identity", "guidelines", "userMessage", "sourceCode",
  ]) {
    assert.equal(isPayloadMetaKey(key), false, key);
  }
  for (const key of [
    "createdAt", "tool_use_id", "tool_name", "status", "sessionId", "meta",
  ]) {
    assert.equal(isPayloadMetaKey(key), true, key);
  }
});

test("a code fence grows past a backtick run in the captured body", () => {
  // A diff of a Markdown file carries context lines that are themselves ```
  // fences; a fixed three-backtick wrapper would be closed by that line.
  const fenced = fenceCode("@@ -1 +1 @@\n ```\n-old\n+new", "diff");
  assert.match(fenced, /^````diff\n/);
  assert.match(fenced, /\n````$/);
});

test("the fallback JSON dump degrades on a cyclic value instead of throwing", () => {
  const cyclic: Record<string, unknown> = { answer: "still readable" };
  cyclic.self = cyclic;
  const markdown = fallbackPayloadMarkdown({ captured: cyclic });
  assert.match(markdown, /still readable/);
  assert.match(markdown, /circular reference/);
});

test("splits message content from timestamps, paths and annotations", () => {
  const preview = splitPayloadPreview({
    message: "请选择一个主题",
    timestamp: "2026-11-11T02:25:25.256Z",
    transcript_path: "/var/folders/x/transcript.jsonl",
    cwd: "/Users/xcz/project",
    sessionId: "sess_1",
    hookEventName: "UserPromptSubmit",
    explanation: "等待用户选择",
    model: "yolo",
  });
  assert.equal(preview.content, "请选择一个主题");
  const labels = preview.related.map((field) => field.key);
  assert.ok(labels.includes("timestamp"));
  assert.ok(labels.includes("transcript_path"));
  assert.ok(labels.includes("cwd"));
  assert.ok(labels.includes("sessionId"));
  assert.ok(labels.includes("hookEventName"));
  const annotation = preview.related.find((field) => field.key === "explanation");
  assert.equal(annotation?.annotation, true);
});

test("walks the captured wrapper and nested tool response for content", () => {
  const preview = splitPayloadPreview({
    contract: { key: "tool.call" },
    captured: {
      tool_response: {
        content: [{ type: "text", text: "文件内容如下" }],
        tool_use_id: "tu_1",
      },
    },
  });
  assert.match(preview.content, /文件内容如下/);
  assert.ok(preview.related.some((field) => field.value.includes("tu_1")));
});

test("de-duplicates snake_case and camelCase spellings of the same field", () => {
  const preview = splitPayloadPreview({
    transcript_path: "/a/one.jsonl",
    transcriptPath: "/a/two.json",
    message: "hi",
  });
  const paths = preview.related.filter((field) =>
    field.key.toLowerCase().includes("transcript"),
  );
  assert.equal(paths.length, 1);
  assert.match(paths[0].value, /two\.json/);
});

test("fences JSON content so the renderer highlights it as code", () => {
  assert.match(contentToMarkdown('{"a":1}'), /^```json\n/);
  assert.equal(contentToMarkdown("# heading\n\ntext"), "# heading\n\ntext");
  assert.equal(contentToMarkdown("   "), "");
});

test("a Markdown document with a code-like line renders as the document", () => {
  // The regression this pins: one `export type` sketch line inside an agent's
  // plan must not fence the whole reading surface into a monospace code block
  // — the keyword matchers are per-line evidence, not document evidence.
  const plan = [
    "## Plan",
    "",
    "**User's asks:**",
    "",
    "1. 优化 study 页面布局",
    "2. 补充更多学习方式",
    "",
    "### Part A: Study page layout + modes",
    "",
    "Sketching the service shape:",
    "export type ModelServiceSpec = { name, baseUrl, apiKey, mode };",
    "export function parseModelServicesEnv(): SavedModelService[];",
    "",
    "- Route page (`app/workspace/expressions/study/page.tsx`)",
    "- `ExpressionStudyPage` → `ExpressionStudyWorkspace`",
  ].join("\n");
  assert.equal(contentToMarkdown(plan), plan);
});

test("a short code string still fences with its inferred language", () => {
  assert.match(contentToMarkdown('import { X } from "./y";'), /^```typescript\n/);
  assert.match(contentToMarkdown("ls -la\ngit status"), /^```bash\n/);
});

test("shell and Python sources stay fenced even with `#` comments", () => {
  // `#` heads a Markdown heading elsewhere, but in shell / Python it is a
  // comment — it must not read as document evidence there.
  const script = "set -e\n# install deps\npnpm install\ngit push";
  assert.match(contentToMarkdown(script), /^```bash\n/);
  const python = "def main():\n    # setup\n    print(1)";
  assert.match(contentToMarkdown(python), /^```python\n/);
});

test("a single-line shell command fences even without a newline", () => {
  assert.match(contentToMarkdown("git status --short && pnpm test"), /^```bash\n/);
  assert.match(contentToMarkdown("pnpm install --frozen-lockfile"), /^```bash\n/);
  assert.match(contentToMarkdown("ASTRO_PORT=4401 pnpm service:up"), /^```bash\n/);
  assert.match(contentToMarkdown("export FOO=bar; echo $FOO"), /^```bash\n/);
  assert.match(contentToMarkdown("#!/bin/bash\npnpm build"), /^```bash\n/);
});

test("a prose sentence starting with a command name is not code", () => {
  assert.equal(inferCodeLanguage("git status shows the changed files"), null);
  assert.equal(inferCodeLanguage("pnpm is our package manager"), null);
});

test("a Markdown document quoting commands stays a document", () => {
  // The `git push` line alone matches the bash keyword matcher; the
  // document's list structure outranks it.
  const doc = "## Steps\n\n- run `pnpm test`\n\ngit push --force-with-lease\n\nDone.";
  assert.equal(contentToMarkdown(doc), doc);
});

test("orders annotations before the other related fields", () => {
  const preview = splitPayloadPreview({
    timestamp: "2026-11-11T02:25:25.256Z",
    comment: "请检查",
    message: "hi",
  });
  const ordered = orderRelated(preview.related);
  assert.equal(ordered[0].annotation, true);
  assert.equal(ordered[0].key, "comment");
});

test("a single-element array of records shows the records' own fields", () => {
  // One entry needs no `[0]` header — there is no index ambiguity — and its
  // fields walk directly under the array key.
  const fields = collectPayloadFields({
    questions: [{ header: "方式", note: "逐块渲染" }],
  });
  const byKey = new Map(fields.map((field) => [field.key, field.value]));
  assert.equal(byKey.get("questions.header"), "方式");
  const note = fields.find((field) => field.key === "questions.note");
  assert.equal(note?.annotation, true, "the note stays an annotation");
  assert.ok(!fields.some((field) => field.groupHeader), "no index header for one element");
});

test("a single-entry array whose record is mostly one text field shows that value", () => {
  // A tool response shaped `{type, text}` is its `text`: the `type` / index
  // scaffolding around one string made the row read twice.
  const fields = collectPayloadFields({
    tool_response: { content: [{ type: "text", text: "Read file /tmp/x" }] },
  });
  const byKey = new Map(fields.map((field) => [field.key, field.value]));
  assert.equal(byKey.get("tool_response.content"), "Read file /tmp/x");
  assert.ok(!fields.some((field) => field.key === "tool_response.content[0]"));
});

test("only values past the limit fold, each on its own", () => {
  assert.equal(isFoldableRelatedValue("a".repeat(RELATED_VALUE_MAX_CHARS)), false);
  assert.equal(isFoldableRelatedValue("a".repeat(RELATED_VALUE_MAX_CHARS + 1)), true);
  assert.equal(isFoldableRelatedValue("2026-11-11T02:25:25.256Z"), false);
});

test("the field inventory shows every field, including content, empty and nested values", () => {
  const fields = collectPayloadFields({
    message: "hi",
    prompt: "do it",
    empty: "",
    nil: null,
    flag: false,
    zero: 0,
    tool_response: { tool_use_id: "tu_1", content: [{ type: "text", text: "result" }] },
  });
  const byKey = new Map(fields.map((field) => [field.key, field.value]));
  assert.equal(byKey.get("message"), "hi", "content keys appear in the field list");
  assert.equal(byKey.get("prompt"), "do it");
  assert.equal(byKey.get("empty"), '""', "empty strings stay visible");
  assert.equal(byKey.get("nil"), "null", "null stays visible");
  assert.equal(byKey.get("flag"), "false", "false stays visible");
  assert.equal(byKey.get("zero"), "0", "zero stays visible");
  assert.equal(byKey.get("tool_response.tool_use_id"), "tu_1", "nested paths qualified");
  // A one-entry text record shows its main value directly (see the
  // single-entry test above); the `type` stamp is envelope data around it.
  assert.equal(byKey.get("tool_response.content"), "result");
});

test("an array of objects opens each element with an indexed group row", () => {
  // The related-data pane reads element members beneath their header, so a
  // repeated bare key (`label`, `description`) still knows its element.
  const fields = collectPayloadFields({
    questions: [
      {
        header: "内容区分方式",
        multiple: false,
        options: [
          { label: "A", description: "第一项" },
          { label: "B", description: "第二项" },
        ],
      },
    ],
  });
  // One element, so no `questions[0]` header: the element's own array of
  // options still opens with its indexed rows.
  const headers = fields.filter((field) => field.groupHeader);
  assert.deepEqual(
    headers.map((field) => field.key),
    ["questions.options[0]", "questions.options[1]"],
    "one header row per element, walk order",
  );
  assert.deepEqual(
    headers.map((field) => field.label),
    ["options[0]", "options[1]"],
    "the header label is the relative indexed path",
  );
  assert.deepEqual(
    headers.map((field) => field.level),
    [1, 1],
    "arrays inside the single element nest one step",
  );
  const member = fields.find((field) => field.key === "questions.options[1].description");
  assert.equal(member?.value, "第二项");
  assert.equal(member?.label, "description", "members keep their bare key");
  assert.equal(member?.level, 1);
  assert.equal(member?.groupHeader, undefined);
  // The record's scalar members keep their path under the array key (the
  // `false` value stays visible per the inventory rule).
  const multiple = fields.find((field) => field.key === "questions.multiple");
  assert.equal(multiple?.value, "false");
  assert.equal(multiple?.level, 0, "scalar members carry their element's level");
});

test("the field inventory handles cycles without recursing forever", () => {
  const cyclic: Record<string, unknown> = { id: "root" };
  cyclic.self = cyclic;
  const fields = collectPayloadFields(cyclic);
  assert.deepEqual(fields, [{ key: "id", label: "id", value: "root", annotation: false }]);
});

test("a scalar array carries its items so the pane can render a list", () => {
  const fields = collectPayloadFields({
    todos: ["first", "second"],
  });
  const row = fields.find((field) => field.key === "todos");
  assert.deepEqual(row?.items, ["first", "second"], "the items are kept for one-per-line");
  assert.equal(row?.value, "first, second", "the joined value still copies verbatim");
});

test("envelope identity is dropped while a tool's own version field is kept", () => {
  const fields = collectPayloadFields({
    client: "WorkBuddy",
    version: "5.11.3",
    sourceVersion: "5.11.3",
    sourceClient: "WorkBuddy",
    locator: "trace://workbuddy/s1/e1",
    schemaVersion: 2,
    tool_response: { version: "1.0.0", client: "the captured SDK name" },
  });
  const keys = fields.map((field) => field.key);
  assert.ok(!keys.includes("client"), "the agent name does not leak into the list");
  assert.ok(!keys.includes("version"), "the recorder version does not leak");
  assert.ok(!keys.includes("sourceVersion"), "the recorder version spelling does not leak");
  assert.ok(!keys.includes("sourceClient"), "the client spelling does not leak");
  assert.ok(!keys.includes("locator"), "the trace locator is not a field of the event");
  assert.ok(!keys.includes("schemaVersion"), "the schema stamp is envelope data");
  assert.ok(
    !keys.includes("tool_response.client"),
    "the client stamp is identity at any depth",
  );
  assert.ok(keys.includes("tool_response.version"), "a deeper version field is genuine data");
});

test("an envelope-only payload has no preview body", () => {
  // A Stop / SessionStart event carries timestamps, the client identity and a
  // trace locator — no prose. It used to preview that locator as the body, so
  // the pane showed a bare `trace://…` URL where the answer should be.
  assert.equal(
    payloadToMarkdown({
      start_time: 1795706182594,
      client: "WorkBuddy",
      version: "5.11.3",
      locator: "trace://workbuddy/s1/e1",
    }),
    "",
  );
  assert.equal(fallbackPayloadMarkdown({ client: "WorkBuddy", locator: "trace://x/y/z" }), "");
  assert.deepEqual(
    splitPayloadPreview({ client: "WorkBuddy", locator: "trace://x/y/z" }).related,
    [],
  );
});

test("a tool result that echoes its inputs back is shown once", () => {
  // `tool_input.description` and the response's copy of it read as the same
  // bare `description` with the same value; the inventory keeps one row.
  const fields = collectPayloadFields({
    tool_input: { description: "on hover show the full list" },
    tool_response: { task: { description: "on hover show the full list" } },
  });
  const descriptions = fields.filter(
    (field) => field.label === "description",
  );
  assert.equal(descriptions.length, 1, "the echoed value is not printed twice");
});

test("a numbered file dump is fenced in the language its path declares", () => {
  const dump = "   1→const x: number = 1;\n   2→export default x;";
  const markdown = contentToMarkdown(dump, "/work/tests/index.test.ts");
  assert.match(markdown, /^```typescript\n/);
  assert.match(markdown, /1→const x: number = 1;/);
  // Without a path the stripped source still infers TypeScript.
  assert.match(contentToMarkdown(dump), /^```typescript\n/);
  // An ordinary multi-line string with one arrow note is not a numbered file.
  assert.equal(
    contentToMarkdown("a note 1→about steps\nand another line"),
    "a note 1→about steps\nand another line",
  );
});

test("a todos-style array is detected as a list payload", () => {
  assert.equal(
    hasListPayload({
      tool_response: {
        todos: [
          { id: "1", content: "Do A", status: "completed", createdAt: 1 },
          { id: "2", content: "Do B", status: "pending", createdAt: 2 },
        ],
      },
    }),
    true,
  );
  assert.equal(hasListPayload({ message: "plain text" }), false);
});

test("a captured source path fences code even when JSDoc looks like Markdown", () => {
  const body = "/**\n * A note.\n */\nexport const x = 1;";
  assert.match(contentToMarkdown(body, "/work/src/thing.ts"), /^```typescript\n/);
  // Without a path the prose/document guard still applies.
  assert.equal(contentToMarkdown(body), body);
});

test("an event envelope previews only its payload, never its stamps", () => {
  // The overlay's rail can hand the whole `TraceEvent` to the Preview pane.
  // Its envelope (source / cwd / toolName / sequence …) is a record *about*
  // the capture, not content: previewing it printed the agent name as a
  // paragraph and listed a dozen envelope keys as "related data".
  const event = {
    schemaVersion: 2,
    id: "code-1",
    capturedAt: "2026-11-26T16:26:07.451Z",
    source: "workbuddy",
    sourceVersion: "5.11.3",
    workspaceId: "ws",
    sessionId: "code-demo",
    turnId: "turn-1",
    parentId: null,
    eventName: "PostToolUse",
    nativeEventName: "PostToolUse",
    toolUseId: "t1",
    toolName: "Bash",
    cwd: "/tmp/x",
    status: null,
    sequence: null,
    payload: {
      tool_input: { command: "pnpm install-plugins" },
      tool_response: { exitCode: 0, stdout: "ok" },
    },
    locator: "trace://workbuddy/code-demo/code-1",
  };
  const body = payloadBodyOf(event);
  assert.deepEqual(Object.keys(body as object), ["tool_input", "tool_response"]);
  const split = splitPayloadPreview(body);
  assert.equal(split.content.trim(), "ok");
  const keys = split.related.map((field) => field.key);
  for (const envelopeKey of ["source", "cwd", "toolName", "sessionId", "locator"]) {
    assert.ok(!keys.includes(envelopeKey), `${envelopeKey} is envelope data`);
  }
  assert.ok(keys.includes("command"));
  // A payload that merely looks similar is not unwrapped.
  assert.deepEqual(payloadBodyOf({ eventName: "X", payload: { a: 1 } }), {
    eventName: "X",
    payload: { a: 1 },
  });
  assert.equal(payloadBodyOf("plain text"), "plain text");
});
