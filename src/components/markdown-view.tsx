import { useMemo } from "react";
import { renderMarkdownPreview } from "../lib/markdown-preview";

/**
 * The one markdown renderer for captured question text and answers. An empty
 * or unrenderable source falls back to the captured text, never to a broken
 * half-rendered document.
 */
export function MarkdownView({
  source,
  fallback = "No content captured.",
}: {
  source: string;
  fallback?: string;
}) {
  const render = useMemo(() => renderMarkdownPreview(source), [source]);
  if (!render.valid) {
    return <p className="prompt-content__text">{source || fallback}</p>;
  }
  return (
    <div
      className="markdown-preview"
      dangerouslySetInnerHTML={{ __html: render.html }}
    />
  );
}
