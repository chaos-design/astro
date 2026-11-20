import { Code2, Eye } from "lucide-react";
import { useMemo, useState } from "react";
import { JsonViewer } from "@/components/json-viewer";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group";
import { QuestionPreview } from "@/components/question-content";
import { renderMarkdownPreview } from "@/lib/markdown-preview";
import { payloadToMarkdown } from "@/lib/payload-markdown";
import { parseUserQuestionContent } from "@/lib/user-question-content";
import type { TracePayload } from "@/types/trace";

type PayloadViewMode = "preview" | "code";

/** A row in the overlay's left rail: display-only fields for one run atom. */
export type PayloadOverlayAtom = {
  id: string;
  index: number;
  key: string;
  label: string;
  status: string;
};

/**
 * The inspector's wide surface for one Input / Output / Raw payload. It is a
 * Dialog, so Radix portals it to the document body: the layer is global no
 * matter which panel mounted it, and Escape / outside-click close it like the
 * other console dialogs. The toggle keeps both readings available: `Preview`
 * follows the atom's type — a user.question payload renders as the question /
 * option / answer list the reader saw, while every other payload reads as
 * Markdown (headings, task lists, highlighted code) — and `Code` keeps the
 * untouched structured payload with type colours.
 *
 * The left rail lists every atom of the current run. It is a view of the single
 * console selection, not a second one: picking a row calls `onSelectAtom`, which
 * commits through the same handler the canvas / LOG use, and the payload on the
 * right follows the new selection reactively.
 */
export function PayloadOverlay({
  atoms,
  label,
  onOpenChange,
  onSelectAtom,
  open,
  payload,
  selectedAtomId,
  variant = "default",
}: {
  atoms: PayloadOverlayAtom[];
  label: string;
  onOpenChange: (open: boolean) => void;
  onSelectAtom: (atomId: string) => void;
  open: boolean;
  payload: unknown;
  selectedAtomId: string;
  variant?: "default" | "question";
}) {
  const [viewMode, setViewMode] = useState<PayloadViewMode>("preview");
  const markdown = useMemo(() => payloadToMarkdown(payload), [payload]);
  const preview = useMemo(() => renderMarkdownPreview(markdown), [markdown]);
  // An answers-only question has no question / plan for QuestionPreview to
  // render (StaticQuestionContent returns null there), so it uses the Markdown
  // answer preview instead of an empty surface.
  const question = useMemo(
    () =>
      variant === "question"
        ? parseUserQuestionContent(payload as TracePayload)
        : null,
    [variant, payload],
  );
  const showQuestion = Boolean(
    question && (question.prompts.length || question.message.trim() || question.plan.trim()),
  );

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
                ? "Preview 按用户问题的形态展示问题、选项与答案；Code 查看原始载荷。"
                : "Preview 将结果渲染成 Markdown（任务列表、代码高亮等）；Code 查看原始载荷。"}
            </DialogDescription>
          </div>
          <ToggleGroup
            aria-label="Payload view"
            className="prompt-input__mode"
            onValueChange={(value) => {
              if (value) {
                setViewMode(value as PayloadViewMode);
              }
            }}
            spacing={0}
            type="single"
            value={viewMode}
            variant="outline"
          >
            <ToggleGroupItem aria-label="Preview as markdown" value="preview">
              <Eye data-icon="inline-start" />
              Preview
            </ToggleGroupItem>
            <ToggleGroupItem aria-label="View raw code" value="code">
              <Code2 data-icon="inline-start" />
              Code
            </ToggleGroupItem>
          </ToggleGroup>
        </header>
        <div className="payload-overlay__main">
          {atoms.length > 0 ? (
            <nav aria-label="运行中的消息原子" className="payload-overlay__rail">
              <div className="payload-overlay__rail-title">
                ATOMS · {atoms.length}
              </div>
              <ul className="payload-overlay__atom-list">
                {atoms.map((atom) => {
                  const selected = atom.id === selectedAtomId;
                  return (
                    <li key={atom.id}>
                      <button
                        aria-current={selected ? "true" : undefined}
                        className={
                          selected
                            ? "payload-overlay__atom is-selected"
                            : "payload-overlay__atom"
                        }
                        onClick={() => onSelectAtom(atom.id)}
                        title={`${atom.label} · ${atom.key}`}
                        type="button"
                      >
                        <span className="payload-overlay__atom-seq">
                          {String(atom.index).padStart(2, "0")}
                        </span>
                        <span className="payload-overlay__atom-copy">
                          <span className="payload-overlay__atom-label">
                            {atom.label}
                          </span>
                          <span className="payload-overlay__atom-key">
                            {atom.key}
                          </span>
                        </span>
                        <span
                          aria-hidden="true"
                          className="payload-overlay__atom-dot"
                          data-status={atom.status}
                        />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </nav>
          ) : null}
          <div className="payload-overlay__content">
            {viewMode === "preview" ? (
              <div className="payload-overlay__body">
                {showQuestion ? (
                  <QuestionPreview payload={payload as TracePayload} />
                ) : preview.valid ? (
                  <div
                    className="markdown-preview"
                    dangerouslySetInnerHTML={{ __html: preview.html }}
                  />
                ) : (
                  <p className="payload-overlay__empty">
                    没有可预览的文本。切到 Code 查看原始载荷。
                  </p>
                )}
              </div>
            ) : (
              <div className="payload-overlay__body payload-overlay__body--code">
                <JsonViewer value={payload} />
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
