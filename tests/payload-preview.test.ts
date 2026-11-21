import assert from "node:assert/strict";
import test from "node:test";
import {
  contentToMarkdown,
  orderRelated,
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
