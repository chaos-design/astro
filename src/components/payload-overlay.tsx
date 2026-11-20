import { useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { QuestionPreview } from "@/components/question-content";
import { renderMarkdownPreview } from "@/lib/markdown-preview";
import { payloadToMarkdown } from "@/lib/payload-markdown";
import type { TracePayload } from "@/types/trace";

/**
 * The inspector's wide, preview-only surface for one Input / Output / Raw
 * payload. It is a Dialog, so Radix portals it to the document body: the layer
 * is global no matter which panel mounted it, and Escape / outside-click close
 * it like the other console dialogs. There is deliberately no raw Code toggle
 * here — the reader asked to see the captured content, not a JSON dump. The
 * untouched payload stays available in the inspector's Raw tab. `Preview`
 * follows the atom's type: a user.question payload renders as the question /
 * option / answer list the reader saw, while every other payload reads as
 * Markdown with code highlighting.
 */
export function PayloadOverlay({
  label,
  onOpenChange,
  open,
  payload,
  variant = "default",
}: {
  label: string;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  payload: unknown;
  variant?: "default" | "question";
}) {
  const markdown = useMemo(() => payloadToMarkdown(payload), [payload]);
  const preview = useMemo(() => renderMarkdownPreview(markdown), [markdown]);

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="payload-overlay">
        <header className="payload-overlay__head">
          <div className="payload-overlay__copy">
            <span className="eyebrow">
              {variant === "question" ? "USER QUESTION" : "CAPTURED PAYLOAD"}
            </span>
            <DialogTitle>{label}</DialogTitle>
            <DialogDescription>
              {variant === "question"
                ? "按用户问题的形态展示问题、选项与答案。"
                : "结果数据渲染成 Markdown（含代码高亮）；原始载荷见检查器的 Raw 标签。"}
            </DialogDescription>
          </div>
        </header>
        <div className="payload-overlay__body">
          {variant === "question" ? (
            <QuestionPreview payload={payload as TracePayload} />
          ) : preview.valid ? (
            <div
              className="markdown-preview"
              dangerouslySetInnerHTML={{ __html: preview.html }}
            />
          ) : (
            <p className="payload-overlay__empty">
              没有可预览的文本。原始载荷见检查器的 Raw 标签。
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
