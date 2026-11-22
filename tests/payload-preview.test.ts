import assert from "node:assert/strict";
import test from "node:test";
import {
  collectPayloadFields,
  contentToMarkdown,
  isFoldableRelatedValue,
  orderRelated,
  RELATED_VALUE_MAX_CHARS,
  splitPayloadPreview,
} from "../src/lib/payload-preview.ts";

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
  assert.equal(byKey.get("tool_response.content[0].type"), "text", "array objects walked by index");
});

test("the field inventory handles cycles without recursing forever", () => {
  const cyclic: Record<string, unknown> = { id: "root" };
  cyclic.self = cyclic;
  const fields = collectPayloadFields(cyclic);
  assert.deepEqual(fields, [{ key: "id", label: "id", value: "root", annotation: false }]);
});
