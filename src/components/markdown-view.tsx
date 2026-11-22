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
  // Same identity rule as the overlay's content pane: React rewrites the
  // markup when the `{ __html }` wrapper object differs, so the wrapper must
  // be memoized on the string — the surfaces this renders re-render on the
  // app's one-second tick, and an inline literal reset every horizontal
  // scroll inside their fenced code blocks on each tick.
  const html = useMemo(() => ({ __html: render.html }), [render.html]);
  if (!render.valid) {
    return <p className="prompt-content__text">{source || fallback}</p>;
  }
  return (
    <div
      className="markdown-preview"
      dangerouslySetInnerHTML={html}
    />
  );
}
