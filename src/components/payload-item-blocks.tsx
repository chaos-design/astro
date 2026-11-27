import { useState, type ReactNode } from "react";
import { contentToMarkdown, splitPayloadPreview } from "@/lib/payload-preview";
import { findPayloadFilePath } from "@/lib/numbered-code";
import { payloadToMarkdown } from "@/lib/payload-markdown";
import {
  classifyCapturedResource,
  type CapturedResource,
} from "@/lib/captured-image";
import { markdownWithEmbeddedImages } from "@/lib/embedded-image";
import { MarkdownView } from "@/components/markdown-view";
import { cn } from "@/lib/utils";

/** Long plain text folds: a result dump of fifty lines collapses to its head
 * until the reader opens it. Code and images never fold — they are why the
 * reader is looking. */
const FOLD_TEXT_CHARS = 600;

function FoldableMarkdown({
  source,
  length,
}: {
  source: string;
  length: number;
}) {
  const [expanded, setExpanded] = useState(false);
  if (length <= FOLD_TEXT_CHARS) {
    return <MarkdownView source={source} />;
  }
  // Fold by source length, not raw characters: a fenced source is the text the
  // reader sees, and folding on the raw value could cut a fence mid-line.
  const head = expanded
    ? source
    : `${source.slice(0, FOLD_TEXT_CHARS)}\n\n…`;
  return (
    <div className="payload-item__fold">
      <MarkdownView source={head} />
      <button
        aria-expanded={expanded}
        className="payload-item__fold-toggle"
        onClick={() => setExpanded((current) => !current)}
        type="button"
      >
        {expanded ? "收起" : `展开（${length} 字符）`}
      </button>
    </div>
  );
}

/** A non-image attachment: the browser cannot open a local file and the
 * service only previews images, so the honest rendering is a labelled chip
 * with the captured path — never an <img> that fails to load. */
function FileChip({ resource }: { resource: Extract<CapturedResource, { kind: "file" }> }) {
  return (
    <span className="payload-item__file">
      <span aria-hidden="true" className="payload-item__file-glyph">📎</span>
      <span className="payload-item__file-name">
        {resource.name || resource.path}
      </span>
      <code title={resource.path}>{resource.path}</code>
    </span>
  );
}

/** One array entry's content. Images and files are typed resources; every
 * other value is content and goes through the shared Markdown decision. */
function PayloadItemContent({
  apiBase,
  item,
  bare = false,
}: {
  apiBase: string;
  item: unknown;
  /** A single-element array: render the value itself, never a key/value grid. */
  bare?: boolean;
}): ReactNode {
  const resource = classifyCapturedResource(item, apiBase);
  if (resource.kind === "image") {
    return (
      <img
        alt={resource.name ? `捕获的图片：${resource.name}` : "捕获的图片资源"}
        className="payload-item__image"
        loading="lazy"
        src={resource.src}
      />
    );
  }
  if (resource.kind === "file") {
    return <FileChip resource={resource} />;
  }
  if (bare) {
    // A one-item array is one message: read the field that *is* the content
    // (`text`, `message`, `content`, …) instead of dumping every scalar value.
    // A record with no content field still falls back to the generic view.
    const split = typeof item === "string" ? null : splitPayloadPreview(item);
    const text = split?.content.trim()
      ? contentToMarkdown(split.content, findPayloadFilePath(item))
      : typeof item === "string"
        ? contentToMarkdown(item)
        : payloadToMarkdown(item);
    const source = markdownWithEmbeddedImages(text, item);
    return <FoldableMarkdown length={text.length} source={source} />;
  }
  if (item !== null && typeof item === "object" && !Array.isArray(item)) {
    const entries = Object.entries(item as Record<string, unknown>).filter(
      ([, value]) => value !== null && value !== undefined && value !== "",
    );
    if (!entries.length) {
      return null;
    }
    return (
      <dl className="payload-item__fields">
        {entries.map(([key, value]) => (
          <div className="payload-item__field" key={key}>
            <dt>{key}</dt>
            <dd>{String(value)}</dd>
          </div>
        ))}
      </dl>
    );
  }
  const text = contentToMarkdown(String(item));
  return <FoldableMarkdown length={String(item).length} source={text} />;
}

/**
 * An array payload rendered as a stack of blocks, one per item: the "item"
 * rendering the array preview asks for — no bullet list, no JSON wall, every
 * entry visually its own record with a left accent, and code inside an entry
 * keeps its fence through the shared markdown path.
 */
export function PayloadItemBlocks({
  apiBase,
  items,
  className,
}: {
  apiBase: string;
  items: readonly unknown[];
  className?: string;
}) {
  // A single entry is one message, not a record to tabulate: render what it
  // carried (a string, a record's real content, an image, a file chip) with no
  // `[0]` frame and no key/value grid around it.
  if (items.length === 1) {
    return (
      <div className={cn("payload-item-list is-single", className)}>
        <PayloadItemContent apiBase={apiBase} bare item={items[0]} />
      </div>
    );
  }
  return (
    <div className={cn("payload-item-list", className)}>
      {items.map((item, position) => (
        <div className="payload-item" key={position}>
          <PayloadItemContent apiBase={apiBase} item={item} />
        </div>
      ))}
    </div>
  );
}
