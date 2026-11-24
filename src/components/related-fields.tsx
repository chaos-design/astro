import { ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";
import {
  isFoldableRelatedValue,
  RELATED_VALUE_MAX_CHARS,
  type RelatedField,
} from "@/lib/payload-preview";

/**
 * One related-data value. Long values fold behind their own control so a
 * single captured path or blob cannot force the whole pane to be expanded —
 * short timestamps and ids beside it stay readable either way. The fold is
 * local to this value; the caller's `resetToken` (the event / step id) scopes
 * the list key so a switch to another row never inherits an expanded field
 * that happens to share the same key.
 */
export function RelatedValue({ value }: { value: string }) {
  const foldable = isFoldableRelatedValue(value);
  const [expanded, setExpanded] = useState(false);
  if (!foldable) {
    return <>{value}</>;
  }
  return (
    <>
      <span
        className={cn(
          "payload-overlay__field-text",
          !expanded && "is-folded",
        )}
      >
        {expanded ? value : `${value.slice(0, RELATED_VALUE_MAX_CHARS)}…`}
      </span>
      <button
        aria-expanded={expanded}
        className="payload-overlay__field-more"
        onClick={() => setExpanded((current) => !current)}
        title={expanded ? "收起该值" : "展开该值全文"}
        type="button"
      >
        {expanded ? "收起" : "展开"}
        {expanded ? (
          <ChevronUp aria-hidden="true" />
        ) : (
          <ChevronDown aria-hidden="true" />
        )}
      </button>
    </>
  );
}

/**
 * The complete captured-field inventory, shared by the overlay's Preview pane
 * and every Agent view step. `orderRelated` stays the one ordering source.
 */
export function RelatedFields({
  fields,
  resetToken = "",
}: {
  fields: readonly RelatedField[];
  /** Stable identity of the row being shown; changes reset per-value folds. */
  resetToken?: string;
}) {
  if (!fields.length) {
    return <p className="payload-overlay__empty">没有关联数据。</p>;
  }
  return (
    <dl className="payload-overlay__fields">
      {fields.map((field) => {
        // Array elements open with their own indexed row (`questions[0]`,
        // `options[1]`) and their members indent beneath it, so a repeated
        // bare key (`description`, `label`) still reads inside the element
        // it belongs to. Headers carry no value.
        const indent = field.groupHeader
          ? field.level ?? 0
          : field.level === undefined
            ? 0
            : field.level + 1;
        return (
          <div
            className={cn(
              "payload-overlay__field",
              field.groupHeader && "payload-overlay__field--group",
              field.annotation && "is-annotation",
            )}
            key={`${resetToken}\u0000${field.key}`}
            style={
              indent > 0 ? { paddingInlineStart: `${indent * 14}px` } : undefined
            }
          >
            <dt title={field.key}>{field.label}</dt>
            {field.groupHeader ? null : field.items ? (
              <dd className="payload-overlay__field-list">
                <ul>
                  {field.items.map((item, index) => (
                    <li key={index} title={item}>
                      {item || "—"}
                    </li>
                  ))}
                </ul>
              </dd>
            ) : (
              <dd>
                <RelatedValue value={field.value} />
              </dd>
            )}
          </div>
        );
      })}
    </dl>
  );
}
