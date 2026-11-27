import { contentToMarkdown } from "@/lib/payload-preview";
import { MarkdownView } from "@/components/markdown-view";
import { cn } from "@/lib/utils";

/**
 * One array entry as its own block. Strings keep the shared content decision
 * (code fences, prose stays a document); objects render as a quiet key/value
 * grid instead of a JSON dump followed by a `key=value · key=value` echo —
 * the dump repeated every field twice, which is what made an array of records
 * read as noise.
 */
function PayloadItemContent({ item }: { item: unknown }) {
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
  const markdown = contentToMarkdown(String(item));
  return <MarkdownView source={markdown} />;
}

/**
 * An array payload rendered as a stack of blocks, one per item: the "item"
 * rendering the array preview asks for — no bullet list, no JSON wall, every
 * entry visually its own record with a left accent, and code inside an entry
 * keeps its fence through the shared markdown path.
 */
export function PayloadItemBlocks({
  items,
  className,
}: {
  items: readonly unknown[];
  className?: string;
}) {
  return (
    <div className={cn("payload-item-list", className)}>
      {items.map((item, position) => (
        <div className="payload-item" key={position}>
          <PayloadItemContent item={item} />
        </div>
      ))}
    </div>
  );
}
