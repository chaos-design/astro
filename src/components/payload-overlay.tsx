import { Code2, Eye, Radio } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { JsonViewer } from "@/components/json-viewer";
import { PairLinkMarker } from "@/components/pair-link-marker";
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
import type { TracePairLink } from "@/lib/trace-model";
import type { TracePayload } from "@/types/trace";

type PayloadViewMode = "preview" | "code";

/**
 * One row of the overlay's left rail: a LOG-standard view of one trace event
 * of the current run. The fields are exactly the ones a LOG row prints — the
 * shared `formatLogSequence` number, the `atomTypeLabel` TYPE badge, the
 * event's display key, the captured time, the action word and summary, the
 * closed-pair duration and the pair's cross-reference marker — plus the turn
 * the event belongs to, so the rail can split the run into turns like the LOG
 * separator does. `atomId` resolves the row's payload through the same harness
 * atom the canvas / inspector commit to.
 */
export type PayloadOverlayAtom = {
  /** Owning harness atom id (`getAtomIdForEvent`), for payload resolution. */
  atomId: string;
  action: string;
  clockLabel: string;
  dateLabel: string;
  /** The event's display key (`user.question`, `tool.call`, …), as LOG prints. */
  key: string;
  durationHeat: string | null;
  durationLabel: string | null;
  eventName: string;
  /** 1-based LOG row number basis; `sequence` is its shared formatting. */
  index: number;
  /** The trace event id — the row identity and the console selection key. */
  id: string;
  pairDuration: number | null;
  pairLink: TracePairLink | null;
  /** `#001` style row number from the shared LOG formatter. */
  sequence: string;
  status: string;
  summary: string;
  timestamp: string;
  tone: string;
  /** Turn of the bound event, from `buildTraceTurnIndex` — the one source. */
  turn: number;
  type: string;
};

/** A rail list item: either a turn separator or one event row. */
type PayloadOverlayRailItem =
  | { atom: PayloadOverlayAtom; kind: "atom"; row: number }
  | { kind: "turn"; turn: number };

type PreparedPreview = {
  contentHtml: string;
  hasContent: boolean;
  related: ReturnType<typeof orderRelated>;
  question: ReturnType<typeof parseUserQuestionContent> | null;
  showQuestion: boolean;
};

/**
 * Prepare one row's preview exactly once. Markdown rendering (parsing plus a
 * DOM sanitizer pass) is the expensive part of switching rows in the global
 * layer; the cache lives in the dialog instance so going back to a row is a
 * lookup, not a re-render of the same Markdown.
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
 * The left rail is the run's message chain in the LOG's own data standard:
 * every event of the run, newest first, split by the same turn separators the
 * LOG prints, each row carrying the LOG row number, TYPE badge, time, action /
 * summary, pair duration and pair marker. Picking a row commits through the
 * same selection the LOG / canvas use, and the payload on the right follows
 * reactively. Each row's preview is prepared once and cached by event id, so
 * switching rows is a cache lookup rather than a full Markdown parse on every
 * click.
 *
 * While the open run executes, the header's 跟随 toggle mirrors the console's
 * live following: armed, new events keep arriving and the rail keeps the
 * selected row in view; picking any row (or disarming) pins the payload so it
 * stops advancing.
 */
export function PayloadOverlay({
  atoms,
  cacheScope = "",
  followAvailable = false,
  following = false,
  label,
  onFollowingChange,
  onOpenChange,
  onSelectAtom,
  open,
  payload,
  payloadForAtom,
  runningEventId = "",
  selectedEventId,
  variant = "default",
  variantForAtom,
}: {
  atoms: PayloadOverlayAtom[];
  /**
   * Scope of the per-row preview cache. The payload of one row also depends
   * on which inspector tab the layer was opened from (Input / Output / Raw
   * resolve differently), so the caller scopes the cache by that tab and a
   * tab switch starts fresh instead of serving the previous tab's Markdown.
   */
  cacheScope?: string;
  /** Whether the open run is executing at all (not replaying a snapshot). */
  followAvailable?: boolean;
  /** Whether the console is currently following the executing run. */
  following?: boolean;
  label: string;
  onFollowingChange?: (following: boolean) => void;
  onOpenChange: (open: boolean) => void;
  onSelectAtom: (atomId: string, eventId: string) => void;
  open: boolean;
  payload: unknown;
  /** Resolve an atom row's payload directly. Enables per-row preview caching. */
  payloadForAtom?: (atomId: string, eventId: string) => unknown;
  /** The event the LOG marks as executing right now (its START row). */
  runningEventId?: string;
  /** The console's selected event — the rail highlights and previews that row. */
  selectedEventId: string;
  variant?: "default" | "question";
  /** Per-row variant so a question row keeps its QuestionPreview after a switch. */
  variantForAtom?: (atomId: string, eventId: string) => "default" | "question";
}) {
  const [viewMode, setViewMode] = useState<PayloadViewMode>("preview");
  // Reverse execution order: the newest / last event sits at the top so the
  // first step of the run is at the bottom, like RUN HISTORY and the LOG.
  // Turn separators split the flat list wherever the turn changes — newest
  // first means the separators run high-to-low, mirroring the LOG's groups.
  const railItems = useMemo<PayloadOverlayRailItem[]>(() => {
    const items: PayloadOverlayRailItem[] = [];
    let previousTurn: number | null = null;
    let row = 0;
    for (const atom of [...atoms].reverse()) {
      if (atom.turn !== previousTurn) {
        previousTurn = atom.turn;
        items.push({ kind: "turn", turn: atom.turn });
      }
      items.push({ atom, kind: "atom", row });
      row += 1;
    }
    return items;
  }, [atoms]);
  // Preview cache keyed by the selected event id. Switching rows in the rail —
  // the action that used to stall the dialog — now reuses an already-prepared
  // preview. The cache is scoped to the dialog instance; payloads are
  // immutable, so a captured row's preview never goes stale within an open run.
  const cacheRef = useRef<Map<string, PreparedPreview>>(new Map());
  const activeRow = atoms.find((atom) => atom.id === selectedEventId) || null;
  const activePayload = activeRow && payloadForAtom
    ? payloadForAtom(activeRow.atomId, activeRow.id)
    : payload;
  const activeVariant = activeRow && variantForAtom
    ? variantForAtom(activeRow.atomId, activeRow.id)
    : variant;
  const getPreview = (rowKey: string, rowPayload: unknown, rowVariant: "default" | "question"): PreparedPreview => {
    const cache = cacheRef.current;
    const cached = cache.get(rowKey);
    if (cached) {
      return cached;
    }
    const prepared = preparePreview(rowPayload, rowVariant);
    cache.set(rowKey, prepared);
    return prepared;
  };
  // The selected row's cached preview, scoped by the caller's tab so a tab
  // switch re-resolves instead of serving the previous tab's Markdown. A
  // selection that is not in the rail (nothing selected yet) falls back to the
  // caller-provided payload.
  const preview = getPreview(
    `${cacheScope}:${activeRow?.id || "current"}`,
    activePayload,
    activeVariant,
  );
  // While following, keep the selected row in view: a live batch selects the
  // newest event, which sits at (or near) the top of this newest-first list,
  // so the reader watching the chain sees each step land without scrolling.
  // Deliberately scroll-only — never a selection change, that is the reader's.
  const selectedRowRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!open || !following) {
      return;
    }
    selectedRowRef.current?.scrollIntoView({ block: "nearest" });
  }, [atoms.length, following, open, selectedEventId]);
  const atomRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const rowCount = useMemo(
    () => railItems.reduce((total, item) => total + (item.kind === "atom" ? 1 : 0), 0),
    [railItems],
  );
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
          ? rowCount - 1
          : (position + step + rowCount) % rowCount;
    atomRefs.current[target]?.focus();
  };
  // Refs are filled in render order; reset the stale tail when the run's row
  // count shrinks (a session switch) so End cannot focus a detached button.
  atomRefs.current.length = rowCount;
  const handleLocatePartner = (partnerId: string) => {
    const partner = atoms.find((atom) => atom.id === partnerId);
    if (partner) {
      onSelectAtom(partner.atomId, partner.id);
    }
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
            <nav aria-label="运行的消息链路" className="payload-overlay__rail">
              <header className="payload-overlay__rail-head">
                <span className="payload-overlay__rail-title">
                  LOG · {atoms.length}
                </span>
                {onFollowingChange ? (
                  <button
                    aria-pressed={following}
                    className={cn(
                      "payload-overlay__follow",
                      following && "is-armed",
                    )}
                    disabled={!followAvailable && !following}
                    onClick={() => onFollowingChange(!following)}
                    title={
                      following
                        ? "正在实时跟随执行中的消息，点击暂停跟随"
                        : followAvailable
                          ? "跟随执行中的最新消息"
                          : "运行结束后无可跟随的实时消息"
                    }
                    type="button"
                  >
                    <Radio aria-hidden="true" />
                    {following ? "跟随中" : "跟随"}
                  </button>
                ) : null}
              </header>
              <ul className="payload-overlay__atom-list">
                {railItems.map((item, railIndex) => {
                  if (item.kind === "turn") {
                    // Key by position, never by the turn value: two groups can
                    // legitimately repeat a number (a source that restarts its
                    // counter), and duplicate keys leave orphaned chips behind.
                    return (
                      <div
                        aria-label={`Turn ${item.turn}`}
                        className="atomic-log__turn payload-overlay__turn"
                        key={`rail-turn-${railIndex}`}
                      >
                        <span>{String(item.turn).padStart(2, "0")}</span>
                      </div>
                    );
                  }
                  const atom = item.atom;
                  const selected = atom.id === selectedEventId;
                  const running = atom.id === runningEventId;
                  const partnerSelected =
                    atom.pairLink?.partnerId === selectedEventId;
                  const details = [
                    `Turn ${atom.turn} · ${atom.sequence}`,
                    atom.eventName,
                    atom.type ? `TYPE ${atom.type}` : "",
                    `STATUS ${atom.status}`,
                  ]
                    .filter(Boolean)
                    .join("\n");
                  const rowPosition = item.row;
                  return (
                    <li key={atom.id}>
                      <button
                        aria-current={selected ? "true" : undefined}
                        aria-label={`${atom.sequence} 第 ${atom.turn} 轮 ${atom.key} ${atom.action} ${atom.summary}`}
                        className={cn(
                          "atomic-log__row payload-overlay__atom",
                          `tone-${atom.tone || "unknown"}`,
                          running && "is-running",
                          selected && !running && "is-selected",
                          partnerSelected && !selected && "is-pair-partner",
                        )}
                        onClick={() => onSelectAtom(atom.atomId, atom.id)}
                        onKeyDown={(keyEvent) =>
                          handleAtomKeyDown(keyEvent, rowPosition)
                        }
                        ref={(node) => {
                          if (selected) {
                            selectedRowRef.current = node;
                          }
                          atomRefs.current[rowPosition] = node;
                        }}
                        title={details}
                        type="button"
                      >
                        <span className="log-sequence">{atom.sequence}</span>
                        <i aria-hidden="true" className="phase-dot" />
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
                        <time dateTime={atom.timestamp} title={atom.timestamp}>
                          <span>{atom.dateLabel}</span>
                          {atom.clockLabel}
                        </time>
                        <small>
                          <span>{atom.action}</span>
                          <span className="atomic-log__summary">
                            {atom.summary}
                          </span>
                          {atom.durationLabel !== null ? (
                            <span
                              className={`atomic-log__duration heat-${atom.durationHeat}`}
                              title={`成对耗时 ${atom.durationLabel}`}
                            >
                              {atom.durationLabel}
                            </span>
                          ) : null}
                          {atom.pairLink ? (
                            <PairLinkMarker
                              link={atom.pairLink}
                              onLocate={handleLocatePartner}
                            />
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
