import assert from "node:assert/strict";
import test from "node:test";
import { parsePromptContent, safeImageSource } from "../src/lib/prompt-content.ts";
import { projectTraceEvents } from "../src/lib/atomic-projection.ts";
import { normalizeTraceEvent } from "../src/lib/trace-model.ts";

const imageData = "data:image/png;base64,aW1hZ2U=";

test("extracts text, OpenAI image blocks, and quoted browser content without losing fields", () => {
  const payload = {
    prompt: "Inspect this layout.",
    content: [
      { type: "text", text: "Inspect this layout." },
      { type: "image_url", image_url: { url: imageData }, alt: "Layout capture" },
    ],
    selected_browser_item: {
      tag_name: "button",
      outer_html: "<button onclick=\"alert(1)\">Live</button>",
    },
  };
  const result = parsePromptContent(payload);
  assert.equal(result.text, payload.prompt);
  assert.equal(result.images.length, 1);
  assert.equal(result.images[0].src, imageData);
  assert.equal(result.images[0].name, "Layout capture");
  assert.equal(result.references[0].title, "button");
  assert.equal(result.references[0].content, payload.selected_browser_item.outer_html);
});

test("supports Claude base64 images, direct images, and file references", () => {
  const result = parsePromptContent({
    content: [
      { type: "text", text: "Review the image and code." },
      { type: "image", source: { type: "base64", media_type: "image/png", data: "aW1hZ2U=" } },
      { type: "input_image", image_url: "https://example.com/capture.webp" },
    ],
    references: [{
      path: "src/app.tsx",
      startLine: 40,
      endLine: 44,
      content: "const live = true;\nconsole.log(live);",
    }],
  });
  assert.equal(result.images.length, 2);
  assert.equal(result.images[0].src, imageData);
  assert.equal(result.images[1].src, "https://example.com/capture.webp");
  assert.equal(result.references[0].source, "src/app.tsx:40-44");
  assert.equal(result.references[0].content, "const live = true;\nconsole.log(live);");
});

test("deduplicates repeated media and retains unavailable local attachments as metadata", () => {
  const result = parsePromptContent({
    images: [imageData, imageData],
    attachments: [
      { name: "local.png", path: "/tmp/local.png", mimeType: "image/png" },
      { name: "README.md", path: "README.md", content: "Reference content" },
    ],
  });
  assert.equal(result.images.length, 2);
  assert.equal(result.images[1].name, "local.png");
  assert.equal(result.images[1].src, null);
  assert.equal(result.images[1].source, "/tmp/local.png");
  assert.equal(result.references[0].content, "Reference content");
});

test("does not invent image or reference data for text-only hooks", () => {
  assert.deepEqual(parsePromptContent({
    prompt: "Review image 1.",
    session_id: "session",
    workspace_roots: ["/tmp/workspace"],
  }), {
    text: "Review image 1.",
    images: [],
    references: [],
  });
});

test("rejects script, SVG, HTML, credential-bearing, and local-file preview URLs", () => {
  for (const value of [
    "javascript:alert(1)",
    "data:text/html;base64,PHNjcmlwdD4=",
    "data:image/svg+xml;base64,PHN2Zz4=",
    "file:///etc/passwd",
    "https://user:secret@example.com/private.png",
    "/tmp/image.png",
  ]) {
    assert.equal(safeImageSource(value), null);
  }
  assert.equal(safeImageSource(imageData), imageData);
});

test("preserves all multimodal prompt fields in atomic input values", () => {
  const payload = {
    prompt: "Inspect the captured image.",
    images: [{ url: imageData }],
    references: [{ path: "src/app.tsx", content: "const a = 1;" }],
    context: { selected_browser_item: { tag_name: "button", outer_html: "<button>Live</button>" } },
  };
  const event = normalizeTraceEvent({
    id: "multimodal-input",
    source: "trae",
    sessionId: "multimodal-session",
    eventName: "UserPromptSubmit",
    payload,
  });
  const projection = projectTraceEvents([event], "trae");
  const prompt = projection.events.find((item) => item.atom.key === "prompt.input");
  assert.deepEqual(prompt?.payload?.values?.input, payload);
});
