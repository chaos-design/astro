import { useState } from "react";
import { contentToMarkdown } from "@/lib/payload-preview";
import { resolveCapturedImage } from "@/lib/captured-image";
import { MarkdownView } from "@/components/markdown-view";
import { cn } from "@/lib/utils";

/** Long plain text folds: a result dump of fifty lines collapses to its head
 * until the reader opens it. Code and images never fold — they are why the
 * reader is looking. */
const FOLD_TEXT_CHARS = 600;

function FoldableText({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  if (text.length <= FOLD_TEXT_CHARS) {
    return <MarkdownView source={contentToMarkdown(text)} />;
  }
  return (
    <div className="payload-item__fold">
      {expanded ? (
        <MarkdownView source={contentToMarkdown(text)} />
      ) : (
        <MarkdownView source={contentToMarkdown(`${text.slice(0, FOLD_TEXT_CHARS)}…`)} />
      )}
      <button
        aria-expanded={expanded}
        className="payload-item__fold-toggle"
        onClick={() => setExpanded((current) => !current)}
        type="button"
      >
        {expanded ? "收起" : `展开（${text.length} 字符）`}
      </button>
    </div>
  );
}

/**
 * One array entry as its own block. Strings keep the shared content decision
 * (code fences, prose stays a document); objects render as a quiet key/value
 * grid instead of a JSON dump followed by a `key=value · key=value` echo —
 * the dump repeated every field twice, which is what made an array of records
 * read as noise.
 */
function PayloadItemContent({
  apiBase,
  item,
}: {
  apiBase: string;
  item: unknown;
}) {
  // An image resource renders as the image, whatever shape carried it.
  const image = resolveCapturedImage(item, apiBase);
  if (image) {
    return (
      <img
        alt="捕获的图片资源"
        className="payload-item__image"
        loading="lazy"
        src={image.src}
      />
    );
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
  return <FoldableText text={String(item)} />;
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
  // A single entry needs no block wrapper: the important content renders
  // directly (the key/value grid or the fenced value), and only a stack of
  // records earns the per-item blocks.
  if (items.length === 1) {
    return (
      <div className={cn("payload-item-list is-single", className)}>
        <PayloadItemContent apiBase={apiBase} item={items[0]} />
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
