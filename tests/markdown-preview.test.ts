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

test("GFM task lists render as checkboxes so a plan reads as a task list", () => {
  const render = renderMarkdownPreview(
    "### Plan\n\n- [x] inspect the trace\n- [ ] answer the question",
  );
  assert.equal(render.valid, true);
  assert.match(render.html, /type="checkbox"/);
  assert.match(render.html, /checked/);
  assert.match(render.html, /inspect the trace/);
  assert.match(render.html, /answer the question/);
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

test("fenced code is highlighted without losing the sanitizer's protection", () => {
  const render = renderMarkdownPreview(
    "```js\nconst answer = 42; // done\n```",
  );
  assert.equal(render.valid, true);
  // A known language becomes hljs tokens the theme CSS can colour, wrapped
  // in a badge div so the language name reads above the block.
  assert.match(render.html, /<div class="md-code" data-lang="js">/);
  assert.match(render.html, /<span class="md-code__lang"[^>]*>js<\/span>/);
  assert.match(render.html, /<code class="hljs language-js">/);
  assert.match(render.html, /hljs-keyword/);
  assert.match(render.html, /hljs-number/);
  assert.match(render.html, /hljs-comment/);
});

test("a shell command fence colours commands, flags and assignments", () => {
  const render = renderMarkdownPreview(
    "```bash\nASTRO_PORT=4401 pnpm service:up --quiet | head -20\n```",
  );
  assert.equal(render.valid, true);
  assert.match(render.html, /data-lang="bash"/);
  assert.match(render.html, /<span class="hljs-keyword">pnpm<\/span>/);
  assert.match(render.html, /<span class="hljs-attr">--quiet<\/span>/);
  assert.match(render.html, /<span class="hljs-property">ASTRO_PORT=4401<\/span>/);
  // A captured command is untrusted text: the tokenizer still escapes it.
  const hostile = renderMarkdownPreview("```bash\necho <img src=x onerror=bad>\n```");
  assert.doesNotMatch(hostile.html, /<img/i);
  assert.match(hostile.html, /&lt;img/);
});

test("the registered language set covers the file types a trace carries", () => {
  const cases: Array<[string, string]> = [
    ["go", "func main() { println(1) }"],
    ["rust", "fn add(a: u32) -> u32 { a + 1 }"],
    ["java", "public class A { int x; }"],
    ["sql", "SELECT id FROM t WHERE id = 1"],
    ["css", ".a { color: red }"],
    ["kotlin", "fun main() { }"],
  ];
  for (const [language, source] of cases) {
    const render = renderMarkdownPreview(`\`\`\`${language}\n${source}\n\`\`\``);
    assert.match(
      render.html,
      new RegExp(`<code class="hljs language-${language}"`),
      `${language} fences with its own language class`,
    );
    // A real grammar ran: its output is at least one `hljs-*` token span,
    // whereas the unregistered fallback would be a single bare text node.
    assert.match(render.html, /<span class="hljs-/);
  }
});

test("shell comments and heredoc bodies are not painted as commands", () => {
  const render = renderMarkdownPreview(
    "```bash\npnpm build # ship it\ncat <<EOF\nplain data\nEOF\n```",
  );
  assert.match(render.html, /<span class="hljs-comment"># ship it<\/span>/);
  assert.match(render.html, /<span class="hljs-keyword">pnpm<\/span>/);
  assert.match(render.html, /plain data/);
  // The heredoc line is data, so no command token is emitted for it.
  assert.doesNotMatch(render.html, /<span class="hljs-keyword">plain<\/span>/);
});

test("a `#` inside a word and a quoted `<<` do not open a comment or here-doc", () => {
  const fragment = renderMarkdownPreview(
    "```bash\ncurl https://example.com/path#section\n```",
  );
  assert.match(fragment.html, /path#section/);
  assert.doesNotMatch(fragment.html, /hljs-comment/);

  for (const opening of [
    'echo "<<EOF"',
    "echo $((1 << SHIFT))",
    "((1 << SHIFT))",
  ]) {
    const quoted = renderMarkdownPreview(
      `\`\`\`bash\n${opening}\nls -la\nEOF\n\`\`\``,
    );
    // A quoted `<<EOF` or an arithmetic shift (`$((…))` and `((…))`) is not a
    // here-doc, so `ls` is still a real command; only a genuine here-doc makes
    // the next lines data.
    assert.match(quoted.html, /<span class="hljs-keyword">ls<\/span>/, opening);
  }
  const quoted = renderMarkdownPreview('```bash\necho "<<EOF"\nls -la\nEOF\n```');
  assert.match(quoted.html, /<span class="hljs-string">.*&lt;&lt;EOF.*<\/span>/);
});

test("a fence without a language stays a plain pre without a badge", () => {
  const render = renderMarkdownPreview("```\nplain captured text\n```");
  assert.equal(render.valid, true);
  assert.match(render.html, /<pre><code class="hljs">plain captured text<\/code><\/pre>/);
  assert.doesNotMatch(render.html, /md-code/);
});

test("an unknown fenced language is escaped, never trusted as a class or markup", () => {
  const render = renderMarkdownPreview(
    '```lang" onmouseover="pwned\n<script>alert(1)</script>\n```',
  );
  assert.equal(render.valid, true);
  assert.doesNotMatch(render.html, /onmouseover/i);
  assert.doesNotMatch(render.html, /<script/i);
  // The badge label carries the sanitized identifier only — marked cuts the
  // info string at the first space, and the identifier strips everything
  // that is not a language character.
  assert.match(render.html, /data-lang="lang"/);
  assert.doesNotMatch(render.html, /data-lang="[^"]*pwned/i);
  assert.match(render.html, /&lt;script&gt;/);
});

test("a numbered Read dump renders its line numbers in a separate gutter", () => {
  const render = renderMarkdownPreview(
    "```typescript\n" +
      '1→import assert from "node:assert/strict";\n' +
      "2→const x = 1;\n" +
      "10→\n" +
      "11→function go() { return x; }\n" +
      "```",
  );
  assert.equal(render.valid, true);
  assert.match(render.html, /md-code--numbered/);
  // The captured prefixes are gone from the highlighted source, the numbers
  // (including the non-1 start offset and the blank line) live in the gutter.
  assert.doesNotMatch(render.html, /1→import/);
  assert.match(render.html, /md-code__gutter[^>]*><code>1\n2\n10\n11<\/code>/);
  assert.match(render.html, /hljs-keyword">import<\/span>/);
});
