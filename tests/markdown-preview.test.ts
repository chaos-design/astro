import assert from "node:assert/strict";
import test from "node:test";

// The sanitizer walks rendered HTML through DOMParser, which the browser has
// and plain Node does not: the preview always renders in a browser, so the
// tests provide the same standards-compliant parser (linkedom) the walk
// expects before any rendering happens.
import { DOMParser } from "linkedom";
if (typeof globalThis.DOMParser === "undefined") {
  globalThis.DOMParser = DOMParser as unknown as typeof globalThis.DOMParser;
}

import { renderMarkdownPreview } from "../src/lib/markdown-preview.ts";

test("valid markdown renders to the rich text the client showed", () => {
  const render = renderMarkdownPreview("# Deploy\n\nRun `pnpm build` **now**.");
  assert.equal(render.valid, true);
  assert.match(render.html, /<h1[^>]*>Deploy<\/h1>/);
  assert.match(render.html, /<strong>now<\/strong>/);
  assert.match(render.html, /<code>pnpm build<\/code>/);
});

test("lists, quotes and tables survive the GFM pipeline", () => {
  const render = renderMarkdownPreview(
    "- one\n- two\n\n> quoted\n\n| a | b |\n| - | - |\n| 1 | 2 |",
  );
  assert.equal(render.valid, true);
  assert.match(render.html, /<ul>/);
  assert.match(render.html, /<blockquote>/);
  assert.match(render.html, /<table>/);
});

test("an empty source is invalid so the caller falls back to raw text", () => {
  assert.equal(renderMarkdownPreview("").valid, false);
  assert.equal(renderMarkdownPreview("   \n\t ").valid, false);
});

test("acting markup never survives the render", () => {
  // Capture quotes repository and agent content the console does not control,
  // so a preview must not gain the powers of the page that renders it.
  const hostile =
    "hello\n\n<script>window.__pwned = true;</script>\n\n" +
    '<img src=x onerror="window.__pwned = true">\n' +
    '<a href="javascript:window.__pwned = true">click</a>\n' +
    "<iframe src=\"https://example.test\"></iframe>";
  const render = renderMarkdownPreview(hostile);
  assert.equal(render.valid, true);
  assert.doesNotMatch(render.html, /<script/i);
  assert.doesNotMatch(render.html, /onerror/i);
  assert.doesNotMatch(render.html, /javascript:/i);
  assert.doesNotMatch(render.html, /<iframe/i);
  // The benign text around the hostile blocks still renders.
  assert.match(render.html, /hello/);
});

test("non-image data URLs are stripped while image data URLs stay", () => {
  const render = renderMarkdownPreview(
    '<a href="data:text/html,<b>x</b>">link</a> and <img src="data:image/png;base64,AAAA">',
  );
  assert.equal(render.valid, true);
  assert.doesNotMatch(render.html, /data:text\/html/);
  assert.match(render.html, /data:image\/png/);
});
