import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import diff from "highlight.js/lib/languages/diff";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import { Marked } from "marked";

// Only the languages a captured payload realistically carries. The docs site
// can afford `highlight.js/lib/common`; the console ships in the main bundle,
// so registering a focused set keeps its code out of the first paint.
const highlightedLanguages: Record<string, Parameters<typeof hljs.registerLanguage>[1]> = {
  bash,
  diff,
  javascript,
  js: javascript,
  jsx: javascript,
  json,
  markdown,
  md: markdown,
  python,
  py: python,
  typescript,
  ts: typescript,
  tsx: typescript,
  xml,
  html: xml,
  yaml,
  yml: yaml,
  shell: bash,
};
for (const [name, grammar] of Object.entries(highlightedLanguages)) {
  hljs.registerLanguage(name, grammar);
}

/**
 * Rendering captured question text as the rich text the reader would have
 * seen in their client, so a markdown source is parsed here instead of being
 * shown raw. Capture is local data, but it quotes agent and repository
 * content the console does not control, so the rendered HTML is reduced to a
 * safe subset before it is ever injected — a preview must not gain the powers
 * of the page that renders it.
 */

const markdownParser = new Marked({ breaks: true, gfm: true });

/**
 * Fenced code is a common carrier of captured commands, JSON and diffs. Give
 * it the same token colours the docs site uses so a Preview reads like the
 * source the agent produced. highlight.js emits only `<span class="hljs-*">`
 * tokens — no inline styles or event handlers — so the sanitizer below keeps
 * them and the theme stays entirely in `styles.css`.
 *
 * A fence that names its language is wrapped in a `.md-code` header div: the
 * language badge lives **outside** the scrolling `<pre>`, so it stays put
 * while wide code pans and never sits under the first line. An unnamed fence
 * stays a plain `<pre>` — nothing to label. The language is the sanitized
 * identifier only, so both the `data-lang` attribute and the badge text are
 * inert before the sanitizer ever sees them.
 */
markdownParser.use({
  renderer: {
    code(token: unknown) {
      const fence = token as { text?: string; lang?: string };
      const code = fence.text ?? "";
      // A language is a class name, never raw source: strip anything that is
      // not a language identifier before it reaches the HTML string.
      const language = (fence.lang ?? "").trim().split(/\s+/)[0].replace(/[^a-zA-Z0-9_+-]/g, "");
      const body =
        language && SHELL_LANGUAGES.has(language)
          ? highlightShell(code)
          : language && hljs.getLanguage(language)
            ? hljs.highlight(code, { language, ignoreIllegals: true }).value
            : escapeHtml(code);
      const classes = language ? `hljs language-${language}` : "hljs";
      if (!language) {
        return `<pre><code class="${classes}">${body}</code></pre>`;
      }
      return (
        `<div class="md-code" data-lang="${language}">` +
        `<span class="md-code__lang" aria-hidden="true">${language}</span>` +
        `<pre><code class="${classes}">${body}</code></pre>` +
        `</div>`
      );
    },
  },
});

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * The registered bash grammar only colours a handful of builtins, so a real
 * captured command (`ASTRO_PORT=4401 pnpm service:up && curl …`) came back
 * almost monochrome — the exact "highlight looks wrong" a reader sees in the
 * atom-content pane. Shell lines have a small, fixed vocabulary, so render
 * them with one explicit tokenizer: command names, flags, assignments and
 * variables each get a stable token class the shared theme already colours.
 * Every token is escaped, so a captured command can never inject markup.
 */
const SHELL_LANGUAGES = new Set(["bash", "sh", "shell", "zsh", "console"]);
const SHELL_TOKEN =
  /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`[^`]*`|\$\{[^}]*\}|\$[A-Za-z_]\w*|--?[A-Za-z0-9][\w-]*|[A-Za-z_]\w*=[^\s"'&|;]*|[A-Za-z_][\w./-]*|[;&|]+|\s+|.)/g;

function highlightShell(code: string): string {
  // A heredoc body is data, not a sequence of commands: colouring its lines
  // as commands was the other half of the "shell looks wrong" report.
  let heredoc = "";
  return code
    .split("\n")
    .map((line) => {
      if (heredoc) {
        if (line.trim() === heredoc) {
          heredoc = "";
        }
        return escapeHtml(line);
      }
      // A here-doc operator is a separate token: it must follow whitespace or
      // a shell operator, never a quote or a word character. Matching `<<`
      // anywhere made `echo "<<EOF"` and `echo $((1 << SHIFT))` open a phantom
      // here-doc, so the following real commands lost their colouring.
      const marker = line.match(
        /(?:^|[\s;&|(])<<-?[ \t]*(?:'([^']*)'|"([^"]*)"|([A-Za-z_]\w*))/,
      );
      if (marker) {
        // `((x << y))` and `$((x << y))` are arithmetic shifts, not here-docs.
        // An unmatched `((` before the operator means the `<<` is arithmetic.
        const before = line.slice(0, marker.index! + 1);
        const arithmeticOpens = (before.match(/\$?\(\(/g) ?? []).length;
        const arithmeticCloses = (before.match(/\)\)/g) ?? []).length;
        if (arithmeticOpens <= arithmeticCloses) {
          heredoc = marker[1] || marker[2] || marker[3] || "";
        }
      }
      if (/^\s*#/.test(line)) {
        return `<span class="hljs-comment">${escapeHtml(line)}</span>`;
      }
      let commandStart = true;
      let html = "";
      for (const match of line.matchAll(SHELL_TOKEN)) {
        const token = match[0];
        if (/^\s+$/.test(token)) {
          html += escapeHtml(token);
          continue;
        }
        if (
          token.startsWith("#") &&
          (match.index === 0 || /[\s;&|]/.test(line[match.index! - 1]))
        ) {
          // A trailing comment runs to end of line; the tokenizer's `.`
          // fallback would otherwise paint each word as a command. In a shell
          // `#` only opens a comment at a word boundary, so a `#` inside a
          // token (a URL fragment such as `https://x/y#frag`) stays literal.
          html += `<span class="hljs-comment">${escapeHtml(line.slice(match.index))}</span>`;
          break;
        }
        if (/^[;&|]+$/.test(token)) {
          commandStart = true;
          html += `<span class="hljs-punctuation">${escapeHtml(token)}</span>`;
          continue;
        }
        let tokenClass = "";
        if (/^[A-Za-z_]\w*=/.test(token)) {
          tokenClass = "hljs-property";
        } else if (commandStart && /^[A-Za-z_./]/.test(token)) {
          tokenClass = "hljs-keyword";
          commandStart = false;
        } else if (/^--?[A-Za-z0-9]/.test(token)) {
          tokenClass = "hljs-attr";
        } else if (/^\$/.test(token)) {
          tokenClass = "hljs-variable";
        } else if (/^["'`]/.test(token)) {
          tokenClass = "hljs-string";
        }
        html += tokenClass
          ? `<span class="${tokenClass}">${escapeHtml(token)}</span>`
          : escapeHtml(token);
      }
      return html;
    })
    .join("\n");
}

export interface MarkdownRender {
  /** Rendered HTML for a valid source; empty when the source is invalid. */
  html: string;
  /** False when the source is empty, unrenderable, or renders to nothing. */
  valid: boolean;
}

/**
 * Validate and render a markdown source. Validation is deliberately shallow:
 * a source is invalid when it is empty, when the parser refuses it, or when
 * nothing survives rendering — the preview falls back to the raw text rather
 * than guessing what a half-valid document "meant" to look like.
 */
export function renderMarkdownPreview(source: string): MarkdownRender {
  const text = typeof source === "string" ? source : "";
  if (!text.trim()) {
    return { html: "", valid: false };
  }
  let html = "";
  try {
    html = markdownParser.parse(text, { async: false }) as string;
  } catch {
    // The parser rejected the source: the caller shows the raw text instead.
    return { html: "", valid: false };
  }
  const safe = sanitizeMarkdownHtml(html);
  if (!safe.trim()) {
    return { html: "", valid: false };
  }
  return { html: safe, valid: true };
}

/** Elements whose presence alone can act, regardless of their attributes. */
const dangerousElements = new Set([
  "base",
  "embed",
  "form",
  "iframe",
  "link",
  "meta",
  "object",
  "script",
  "style",
]);

function isDangerousUrl(value: string): boolean {
  const scheme = value.trim().toLowerCase().replace(/\s+/g, "");
  if (scheme.startsWith("javascript:") || scheme.startsWith("vbscript:")) {
    return true;
  }
  // Image data URLs are inert; every other data URL is a smuggling channel.
  return scheme.startsWith("data:") && !scheme.startsWith("data:image/");
}

/**
 * Strip acting markup from rendered markdown. The output is only ever consumed
 * by a browser `dangerouslySetInnerHTML`, so the DOM walk is the definition of
 * safe here: event handlers and acting elements go, ordinary text stays.
 */
function sanitizeMarkdownHtml(html: string): string {
  if (typeof DOMParser === "undefined") {
    // Non-DOM host (the node test runner parses sources there). The walk runs
    // wherever the HTML is actually rendered, which is always a browser.
    return html;
  }
  const document = new DOMParser().parseFromString(
    `<html><body>${html}</body></html>`,
    "text/html",
  );
  for (const element of [...document.querySelectorAll("*")]) {
    if (dangerousElements.has(element.tagName.toLowerCase())) {
      element.remove();
      continue;
    }
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith("on")) {
        element.removeAttribute(attribute.name);
        continue;
      }
      if (
        (name === "href" || name === "src" || name === "xlink:href") &&
        isDangerousUrl(attribute.value)
      ) {
        element.removeAttribute(attribute.name);
      }
    }
  }
  return document.body.innerHTML;
}
