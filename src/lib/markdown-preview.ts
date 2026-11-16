import { Marked } from "marked";

/**
 * Rendering captured question text as the rich text the reader would have
 * seen in their client, so a markdown source is parsed here instead of being
 * shown raw. Capture is local data, but it quotes agent and repository
 * content the console does not control, so the rendered HTML is reduced to a
 * safe subset before it is ever injected — a preview must not gain the powers
 * of the page that renders it.
 */

const markdownParser = new Marked({ breaks: true, gfm: true });

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
