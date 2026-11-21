import { Code2, Eye } from "lucide-react";
import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { JsonViewer } from "@/components/json-viewer";
import { cn } from "@/lib/utils";
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
import { contentToMarkdown, orderRelated, splitPayloadPreview } from "@/lib/payload-preview";
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
  /** Shared TYPE label (`atomTypeLabel`), shown as a LOG-style badge. */
  type?: string;
  /** Atom tone, mapped to the same colours the LOG row uses. */
  tone?: string;
  /** How many events the atom accumulated, when more than one. */
  count?: number;
  /** `#001` style row number from the shared LOG formatter. */
  sequence?: string;
  /** LOG-style captured time of the atom's bound event. */
  timestamp?: string;
  dateLabel?: string;
  clockLabel?: string;
  /** LOG-style action prefix and one-line summary. */
  action?: string;
  summary?: string;
};

type PreparedPreview = {
  contentHtml: string;
  hasContent: boolean;
  related: ReturnType<typeof orderRelated>;
  question: ReturnType<typeof parseUserQuestionContent> | null;
  showQuestion: boolean;
};

/**
 * Prepare one atom's preview exactly once. Markdown rendering (parsing plus a
 * DOM sanitizer pass) is the expensive part of switching atoms in the global
 * layer; the inspector caches this by atom id so going back to an atom is a
 * lookup, not a re-render of the same Markdown. The cache lives in the caller
 * through `prepare` so it survives selection changes.
 */
function preparePreview(
  payload: unknown,
  variant: "default" | "question",
): PreparedPreview {
  const split = splitPayloadPreview(payload);
  const rendered = renderMarkdownPreview(contentToMarkdown(split.content));
  const question =
    variant === "question"
      ? parseUserQuestionContent(payload as TracePayload)
      : null;
  return {
    contentHtml: rendered.html,
    hasContent: rendered.valid,
    related: orderRelated(split.related),
    question,
    showQuestion: Boolean(
      question && (question.prompts.length || question.message.trim() || question.plan.trim()),
    ),
  };
}

/**
 * The inspector's wide surface for one Input / Output / Raw payload. It is a
 * Dialog, so Radix portals it to the document body: the layer is global no
 * matter which panel mounted it, and Escape / outside-click close it like the
 * other console dialogs. The toggle keeps both readings available: `Preview`
 * splits the atom into what it carried (rendered as Markdown with highlighted
 * code) and the related data around it (time, path, annotations) while `Code`
 * keeps the untouched structured payload.
 *
 * The left rail lists every atom of the current run. Picking a row commits
 * through the same handler the canvas / LOG use. Each atom's preview is
 * prepared once and cached by atom id, so switching atoms is a cache lookup
 * rather than a full Markdown parse on every click.
 */
export function PayloadOverlay({
  atoms,
  label,
  onOpenChange,
  onSelectAtom,
  open,
  payload,
  payloadForAtom,
  selectedAtomId,
  variant = "default",
  variantForAtom,
}: {
  atoms: PayloadOverlayAtom[];
  label: string;
  onOpenChange: (open: boolean) => void;
  onSelectAtom: (atomId: string) => void;
  open: boolean;
  payload: unknown;
  /** Resolve an atom's payload directly. Enables per-atom preview caching. */
  payloadForAtom?: (atomId: string) => unknown;
  selectedAtomId: string;
  variant?: "default" | "question";
  /** Per-atom variant so a question atom keeps its QuestionPreview after a switch. */
  variantForAtom?: (atomId: string) => "default" | "question";
}) {
  const [viewMode, setViewMode] = useState<PayloadViewMode>("preview");
  // Reverse execution order: the newest / last atom sits at the top so the
  // first step of the run is at the bottom, like RUN HISTORY and the LOG.
  // The `index` badge keeps its original pipeline number.
  const orderedAtoms = useMemo(() => [...atoms].reverse(), [atoms]);
  // Preview cache keyed by atom id. Switching atoms in the rail — the action
  // that used to stall the dialog — now reuses an already-prepared preview.
  // The cache is scoped to the dialog instance; payloads are immutable, so a
  // captured atom's preview never goes stale within an open run.
  const cacheRef = useRef<Map<string, PreparedPreview>>(new Map());
  const activePayload =
    payloadForAtom && selectedAtomId ? payloadForAtom(selectedAtomId) : payload;
  const activeVariant = variantForAtom && selectedAtomId
    ? variantForAtom(selectedAtomId)
    : variant;
  const getPreview = (atomId: string, atomPayload: unknown, atomVariant: "default" | "question"): PreparedPreview => {
    const cache = cacheRef.current;
    const cached = cache.get(atomId);
    if (cached) {
      return cached;
    }
    const prepared = preparePreview(atomPayload, atomVariant);
    cache.set(atomId, prepared);
    return prepared;
  };
  // The selected atom's cached preview. `payloadForAtom` lets the caller hand
  // us the right payload for an atom without rebuilding the whole tab model.
  const preview = getPreview(selectedAtomId || "current", activePayload, activeVariant);
  const atomRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const handleAtomKeyDown = (
    keyEvent: KeyboardEvent<HTMLButtonElement>,
    position: number,
  ) => {
    const step =
      keyEvent.key === "ArrowDown" ? 1 : keyEvent.key === "ArrowUp" ? -1 : 0;
    if (!step && keyEvent.key !== "Home" && keyEvent.key !== "End") {
      return;
    }
    keyEvent.preventDefault();
    const target =
      keyEvent.key === "Home"
        ? 0
        : keyEvent.key === "End"
          ? orderedAtoms.length - 1
          : (position + step + orderedAtoms.length) % orderedAtoms.length;
    atomRefs.current[target]?.focus();
  };

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
                : "Preview 分两块：原子的真实内容与时间、路径、注释等相关数据；Code 查看原始载荷。"}
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
                {orderedAtoms.map((atom, position) => {
                  const selected = atom.id === selectedAtomId;
                  const running = atom.status === "running" || atom.status === "active";
                  const details = [
                    `TYPE ${atom.type || atom.key}`,
                    `${atom.label} · ${atom.key}`,
                    `STATUS ${atom.status}`,
                    atom.count && atom.count > 1 ? `${atom.count} 个事件` : "",
                  ]
                    .filter(Boolean)
                    .join("\n");
                  return (
                    <li key={atom.id}>
                      <button
                        aria-current={selected ? "true" : undefined}
                        aria-label={`${atom.index} ${atom.label} · ${atom.key}`}
                        className={cn(
                          "atomic-log__row payload-overlay__atom",
                          `tone-${atom.tone || "unknown"}`,
                          selected && "is-selected",
                          running && !selected && "is-running",
                        )}
                        onClick={() => onSelectAtom(atom.id)}
                        onKeyDown={(keyEvent) =>
                          handleAtomKeyDown(keyEvent, position)
                        }
                        ref={(node) => {
                          atomRefs.current[position] = node;
                        }}
                        title={details}
                        type="button"
                      >
                        <span className="log-sequence">
                          {atom.sequence ?? `#${String(atom.index).padStart(3, "0")}`}
                        </span>
                        <i
                          aria-hidden="true"
                          className="phase-dot"
                          data-status={atom.status}
                        />
                        <strong className="atomic-log__name">
                          {atom.type?.trim() ? (
                            <span
                              className="atomic-log__type payload-overlay__atom-type"
                              title={`原子类型 ${atom.type} · ${atom.key}`}
                            >
                              {atom.type}
                            </span>
                          ) : null}
                          <span className="atomic-log__key">{atom.key}</span>
                        </strong>
                        {atom.timestamp ? (
                          <time dateTime={atom.timestamp} title={atom.timestamp}>
                            <span>{atom.dateLabel}</span>
                            {atom.clockLabel}
                          </time>
                        ) : null}
                        <small>
                          <span>{atom.action || atom.status}</span>
                          <span className="atomic-log__summary">
                            {atom.summary || atom.label}
                          </span>
                          {atom.count && atom.count > 1 ? (
                            <span
                              aria-label={`${atom.count} 个事件`}
                              className="payload-overlay__atom-count"
                              title={`${atom.count} 个事件`}
                            >
                              ×{atom.count}
                            </span>
                          ) : null}
                        </small>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </nav>
          ) : null}
          <div className="payload-overlay__content">
            {viewMode === "preview" ? (
              <div className="payload-overlay__preview-grid">
                {preview.showQuestion ? (
                  <section className="payload-overlay__pane payload-overlay__pane--content">
                    <h4 className="payload-overlay__pane-title">原子内容</h4>
                    <div className="payload-overlay__body">
                      <QuestionPreview payload={activePayload as TracePayload} />
                    </div>
                  </section>
                ) : (
                  <section className="payload-overlay__pane payload-overlay__pane--content">
                    <h4 className="payload-overlay__pane-title">原子内容</h4>
                    {preview.hasContent ? (
                      <div
                        className="markdown-preview"
                        dangerouslySetInnerHTML={{ __html: preview.contentHtml }}
                      />
                    ) : (
                      <p className="payload-overlay__empty">
                        没有可预览的文本。切到 Code 查看原始载荷。
                      </p>
                    )}
                  </section>
                )}
                <section className="payload-overlay__pane payload-overlay__pane--related">
                  <h4 className="payload-overlay__pane-title">相关数据</h4>
                  {preview.related.length ? (
                    <dl className="payload-overlay__fields">
                      {preview.related.map((field) => (
                        <div
                          className={cn(
                            "payload-overlay__field",
                            field.annotation && "is-annotation",
                          )}
                          key={field.key}
                        >
                          <dt title={field.key}>{field.label}</dt>
                          <dd>{field.value}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : (
                    <p className="payload-overlay__empty">没有关联数据。</p>
                  )}
                </section>
              </div>
            ) : (
              <div className="payload-overlay__body payload-overlay__body--code">
                <JsonViewer value={activePayload} />
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
