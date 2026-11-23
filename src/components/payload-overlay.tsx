import { Bot, ChevronDown, ChevronUp, Code2, Eye, Radio, Search, X } from "lucide-react";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type UIEvent,
} from "react";
import { AgentTranscript } from "@/components/agent-transcript";
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
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  QuestionPreview,
  type QuestionAnswerBinding,
} from "@/components/question-content";
import { RelatedFields } from "@/components/related-fields";
import type { AgentView } from "@/lib/agent-view";
import { renderMarkdownPreview } from "@/lib/markdown-preview";
import {
  contentToMarkdown,
  fallbackPayloadMarkdown,
  collectPayloadFields,
  orderRelated,
  splitPayloadPreview,
} from "@/lib/payload-preview";
import { payloadToMarkdown } from "@/lib/payload-markdown";
import { parseUserQuestionContent } from "@/lib/user-question-content";
import type { TracePairLink } from "@/lib/trace-model";
import type { TracePayload } from "@/types/trace";

type PayloadViewMode = "agent" | "preview" | "code";

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
  question: ReturnType<typeof parseUserQuestionContent>;
  showQuestion: boolean;
};

/**
 * Prepare one row's preview exactly once. Markdown rendering (parsing plus a
 * DOM sanitizer pass) is the expensive part of switching rows in the global
 * layer; the cache lives in the dialog instance so going back to a row is a
 * lookup, not a re-render of the same Markdown. The pane shows the payload's
 * *core* information, not its envelope: a split with prose renders as Markdown
 * (lists, fenced code — highlighted by data type), one without falls to the
 * shared core extractor (`payloadToMarkdown` — the tool result, prompt,
 * message content, a structured patch as a diff), and only a payload with
 * nothing to say falls back to highlighted JSON.
 */
function preparePreview(
  payload: unknown,
  variant: "default" | "question",
): PreparedPreview {
  const split = splitPayloadPreview(payload);
  const source = split.content.trim()
    ? contentToMarkdown(split.content)
    : payloadToMarkdown(payload) || fallbackPayloadMarkdown(payload);
  const rendered = renderMarkdownPreview(source);
  // Parsed for every row: a payload carrying a structured `questions` list is
  // the question list itself, whether or not the classifier named the event a
  // user question (OpenCode writes it as a plain `question` tool call). The
  // list wins over the flattened `### Questions` Markdown so the reader sees
  // the same shape the client asked. Free-form message / plan text keeps the
  // Markdown path unless the row is already question-keyed — a prompt or
  // command payload must not be swallowed by the Question heading.
  const question = parseUserQuestionContent(payload as TracePayload);
  return {
    contentHtml: rendered.html,
    hasContent: rendered.valid,
    // Every captured field, not just metadata: the related-data pane is a
    // complete inventory of the payload (content keys, empty values, nested
    // paths included). The content pane still renders the real content above.
    related: orderRelated(collectPayloadFields(payload)),
    question,
    showQuestion: Boolean(
      question &&
        (question.prompts.length ||
          (variant === "question" &&
            (question.message.trim() || question.plan.trim()))),
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
  agentView,
  agentRunDurationMs = null,
  agentRunExecuting = false,
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
  questionBinding = null,
  questionEventId = null,
  runningEventId = "",
  searchEvent,
  selectedEventId,
  variant = "default",
  variantForAtom,
}: {
  atoms: PayloadOverlayAtom[];
  /** Derived Agent view of the same event sequence as the rail. */
  agentView: AgentView;
  /**
   * The displayed message's execution time for the Agent view's header:
   * advancing while the message executes, the recorded total once it ends.
   * `null` when the message has no clock of its own.
   */
  agentRunDurationMs?: number | null;
  /**
   * Whether the selected *message* is still executing. Distinct from
   * `followAvailable` (a session-level capability): the Agent view's loading
   * state and scroll-to-bottom control follow this message execution status.
   */
  agentRunExecuting?: boolean;
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
  /** The live answer binding, only for the question matching the current view. */
  questionBinding?: QuestionAnswerBinding | null;
  /** Event id of that question; the transcript must not answer an older one. */
  questionEventId?: string | null;
  /** The event the LOG marks as executing right now (its START row). */
  runningEventId?: string;
  /**
   * Deep content match for the rail's search: the caller resolves the row's
   * event against the shared per-event search haystacks (the LOG warms the
   * same cache), so a keyword matches payload content and not just the row's
   * own display fields.
   */
  searchEvent?: (eventId: string, needle: string) => boolean;
  /** The console's selected event — the rail highlights and previews that row. */
  selectedEventId: string;
  variant?: "default" | "question";
  /** Per-row variant so a question row keeps its QuestionPreview after a switch. */
  variantForAtom?: (atomId: string, eventId: string) => "default" | "question";
}) {
  const [viewMode, setViewMode] = useState<PayloadViewMode>("agent");
  // Only an explicit rail / step / pair pick locates the Agent transcript.
  // Live follow changes the selected event without bumping this, so a reader
  // who scrolled back through the chain is not yanked to the newest step.
  const [agentLocateRequest, setAgentLocateRequest] = useState(0);
  // The rail's search box is rail-local state (the LOG's own search pattern):
  // a keystroke re-renders only the rail, not the studio. The needle matches
  // the rows' display fields AND the row event's payload content (the caller
  // resolves the shared per-event haystacks); a surviving row keeps its turn
  // separator, and a turn whose rows all miss simply disappears.
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  // Reverse execution order: the newest / last event sits at the top so the
  // first step of the run is at the bottom, like RUN HISTORY and the LOG.
  // Turn separators split the flat list wherever the turn changes — newest
  // first means the separators run high-to-low, mirroring the LOG's groups.
  const railItems = useMemo<PayloadOverlayRailItem[]>(() => {
    const needle = deferredQuery.trim().toLowerCase();
    const source = needle
      ? atoms.filter(
          (atom) =>
            `${atom.sequence} T${atom.turn} ${atom.key} ${atom.eventName} ${atom.action} ${atom.summary}`
              .toLowerCase()
              .includes(needle) ||
            (searchEvent?.(atom.id, needle) ?? false),
        )
      : atoms;
    const items: PayloadOverlayRailItem[] = [];
    let previousTurn: number | null = null;
    let row = 0;
    for (const atom of [...source].reverse()) {
      if (atom.turn !== previousTurn) {
        previousTurn = atom.turn;
        items.push({ kind: "turn", turn: atom.turn });
      }
      items.push({ atom, kind: "atom", row });
      row += 1;
    }
    return items;
  }, [atoms, deferredQuery]);
  // Jump-to-edge controls for the chain, mounted beside the rail's search box.
  // Both stay mounted with the width reserved so the search box never resizes
  // while the list scrolls; an unreachable edge is disabled, not unmounted.
  const railListRef = useRef<HTMLUListElement | null>(null);
  const [railEdges, setRailEdges] = useState({
    canScrollDown: false,
    canScrollUp: false,
  });
  const railEdgesRef = useRef(railEdges);
  railEdgesRef.current = railEdges;
  const syncRailEdges = useCallback(() => {
    const list = railListRef.current;
    if (!list) {
      return;
    }
    const next = {
      canScrollDown:
        list.scrollHeight - list.clientHeight - list.scrollTop > 2,
      canScrollUp: list.scrollTop > 2,
    };
    const current = railEdgesRef.current;
    if (
      next.canScrollDown === current.canScrollDown &&
      next.canScrollUp === current.canScrollUp
    ) {
      return;
    }
    railEdgesRef.current = next;
    setRailEdges(next);
  }, []);
  // Filtering the chain (or a new live event) changes the list's scrollable
  // height without a scroll gesture, so re-check the edges after the commit.
  useEffect(() => {
    const frame = window.requestAnimationFrame(syncRailEdges);
    return () => window.cancelAnimationFrame(frame);
  }, [railItems, syncRailEdges]);
  const scrollRailToEdge = (edge: "top" | "bottom") => {
    const list = railListRef.current;
    if (!list) {
      return;
    }
    list.scrollTo({
      behavior: "smooth",
      top: edge === "top" ? 0 : list.scrollHeight,
    });
  };
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
  // The wrapper object must be as stable as the html string: React compares
  // `dangerouslySetInnerHTML` by object identity, not by the string inside,
  // so an inline literal re-set the same markup on every app tick (the
  // console re-renders each second while the dialog is open) and every
  // rewrite recreated the children — a reader's horizontal scroll inside a
  // wide code block, or a fenced block's badge row, snapped back to 0 about
  // once a second. Memoizing on the string lets React skip identical markup.
  const previewHtml = useMemo(
    () => ({ __html: preview.contentHtml }),
    [preview.contentHtml],
  );
  // While following, keep the selected row in view: a live batch selects the
  // newest event, which sits at (or near) the top of this newest-first list,
  // so the reader watching the chain sees each step land without scrolling.
  // Deliberately scroll-only — never a selection change, that is the reader's.
  // Scroll the rail list directly rather than asking the browser to reveal the
  // row: that walks every scrollable ancestor, so a live batch yanked the
  // content pane's horizontal (and vertical) scroll back to the start while
  // the reader was reading a long wrapped line. Only the rail's own scrollTop
  // may move here.
  const selectedRowRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!open || !following) {
      return;
    }
    const row = selectedRowRef.current;
    const list = row?.closest<HTMLElement>(".payload-overlay__atom-list");
    if (!row || !list) {
      return;
    }
    const rowTop = row.offsetTop;
    const rowBottom = rowTop + row.offsetHeight;
    if (rowTop < list.scrollTop) {
      list.scrollTop = rowTop;
    } else if (rowBottom > list.scrollTop + list.clientHeight) {
      list.scrollTop = rowBottom - list.clientHeight;
    }
  }, [atoms.length, following, open, selectedEventId]);
  const atomRefs = useRef<Array<HTMLButtonElement | null>>([]);
  // The reader's scroll position in the two preview panes, written by their
  // onScroll handlers (ref writes only — a streamed batch must not re-render).
  // While a live run executes, following advances the selection to every new
  // event, and a streamed message arrives as a new event every ~800ms: the
  // preview switches content under the reader, and replacing the rendered HTML
  // clamps the panes' scroll back to the start whenever the new content is
  // narrower or shorter. The memo restores the position, so the line the
  // reader was on stays put while the message grows underneath it.
  const readerScrollRef = useRef({
    contentTop: 0,
    contentLeft: 0,
    relatedTop: 0,
    relatedLeft: 0,
  });
  // The rail row the reader picked themselves. That switch opens the payload
  // from its top; every other selection change (the follow advance, a LOG /
  // canvas pick while the layer is open) preserves the memo instead — the
  // reader's position belongs to the reader.
  const railPickedEventRef = useRef("");
  const contentBodyRef = useRef<HTMLDivElement | null>(null);
  const relatedBodyRef = useRef<HTMLDivElement | null>(null);
  const handleContentScroll = (event: UIEvent<HTMLDivElement>) => {
    const el = event.currentTarget;
    readerScrollRef.current.contentTop = el.scrollTop;
    readerScrollRef.current.contentLeft = el.scrollLeft;
  };
  const handleRelatedScroll = (event: UIEvent<HTMLDivElement>) => {
    const el = event.currentTarget;
    readerScrollRef.current.relatedTop = el.scrollTop;
    readerScrollRef.current.relatedLeft = el.scrollLeft;
  };
  // Runs after each preview change commits. An explicit rail pick anchors the
  // panes to the top; anything else restores the memo (the browser clamps
  // whatever the new content cannot honour, so a shorter payload never leaves
  // the reader stranded past its end). The pick mark is consumed on every run,
  // and a switch into the Code view unmounts both panes and starts the memo
  // over, so coming back opens from the top.
  useLayoutEffect(() => {
    const picked = railPickedEventRef.current;
    railPickedEventRef.current = "";
    const content = contentBodyRef.current;
    const related = relatedBodyRef.current;
    if (!content) {
      readerScrollRef.current = { contentTop: 0, contentLeft: 0, relatedTop: 0, relatedLeft: 0 };
      return;
    }
    if (picked && picked === selectedEventId) {
      readerScrollRef.current = { contentTop: 0, contentLeft: 0, relatedTop: 0, relatedLeft: 0 };
      content.scrollTop = 0;
      content.scrollLeft = 0;
      if (related) {
        related.scrollTop = 0;
        related.scrollLeft = 0;
      }
      return;
    }
    const memo = readerScrollRef.current;
    content.scrollTop = memo.contentTop;
    content.scrollLeft = memo.contentLeft;
    if (related) {
      related.scrollTop = memo.relatedTop;
      related.scrollLeft = memo.relatedLeft;
    }
  }, [preview.contentHtml, selectedEventId, viewMode]);
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
  const selectAtom = useCallback(
    (atomId: string, eventId: string) => {
      onSelectAtom(atomId, eventId);
      setAgentLocateRequest((current) => current + 1);
    },
    [onSelectAtom],
  );
  const handleLocatePartner = (partnerId: string) => {
    const partner = atoms.find((atom) => atom.id === partnerId);
    if (partner) {
      selectAtom(partner.atomId, partner.id);
    }
  };
  // Agent steps and the rail commit through the same selection state: a step
  // only knows an event id and resolves its atom here, never a second store.
  const handleAgentSelectEvent = (eventId: string) => {
    handleLocatePartner(eventId);
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
                ? "Agent 按真实产出展示思考、回复、工具结果与提问；Preview 展示问题、选项与答案；Code 查看原始载荷。"
                : "Agent 按真实产出展示思考、回复、工具结果与提问；Preview 分两块展示原子内容与相关数据；Code 查看原始载荷。"}
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
            <ToggleGroupItem aria-label="Agent data view" value="agent">
              <Bot data-icon="inline-start" />
              Agent
            </ToggleGroupItem>
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
                <InputGroup
                  className="payload-overlay__rail-search"
                  aria-label="搜索消息链路"
                >
                  <InputGroupInput
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="搜索事件或内容"
                    value={query}
                  />
                  <InputGroupAddon align="inline-start">
                    <Search aria-hidden="true" />
                  </InputGroupAddon>
                  {query ? (
                    <InputGroupAddon align="inline-end">
                      <InputGroupButton
                        aria-label="清空搜索"
                        onClick={() => setQuery("")}
                      >
                        <X aria-hidden="true" />
                      </InputGroupButton>
                    </InputGroupAddon>
                  ) : null}
                </InputGroup>
                {/* Jump to either end of the chain without arming Live. These
                    live in the header, never over the list where a chevron
                    would cover a row; both stay mounted with their width
                    reserved so the search box beside them never shifts. */}
                <div className="payload-overlay__rail-scroll-controls">
                  <button
                    aria-label="滚动到顶部"
                    className="payload-overlay__rail-scroll-button"
                    disabled={!railEdges.canScrollUp}
                    onClick={() => scrollRailToEdge("top")}
                    title="滚动到顶部"
                    type="button"
                  >
                    <ChevronUp aria-hidden="true" />
                  </button>
                  <button
                    aria-label="滚动到底部"
                    className="payload-overlay__rail-scroll-button"
                    disabled={!railEdges.canScrollDown}
                    onClick={() => scrollRailToEdge("bottom")}
                    title="滚动到底部"
                    type="button"
                  >
                    <ChevronDown aria-hidden="true" />
                  </button>
                </div>
                {onFollowingChange ? (
                  <button
                    aria-pressed={following}
                    className={cn(
                      "payload-overlay__follow",
                      following && "is-armed",
                    )}
                    disabled={!followAvailable}
                    onClick={() => onFollowingChange(!following)}
                    title={
                      following
                        ? "正在实时跟随执行中的消息，点击暂停跟随"
                        : followAvailable
                          ? "跳到最新事件并跟随执行中的消息"
                          : "运行结束后无可跟随的实时消息"
                    }
                    type="button"
                  >
                    <Radio aria-hidden="true" />
                    Live
                  </button>
                ) : null}
              </header>
              <ul
                className="payload-overlay__atom-list"
                onScroll={syncRailEdges}
                ref={railListRef}
              >
                {railItems.length === 0 ? (
                  <output className="payload-overlay__rail-empty">
                    没有匹配的事件
                  </output>
                ) : null}
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
                        onClick={() => {
                          railPickedEventRef.current = atom.id;
                          selectAtom(atom.atomId, atom.id);
                        }}
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
            {viewMode === "agent" ? (
              <AgentTranscript
                view={agentView}
                selectedEventId={selectedEventId || null}
                onSelectEvent={handleAgentSelectEvent}
                questionBinding={questionBinding}
                questionEventId={questionEventId}
                live={agentRunExecuting}
                locateRequest={agentLocateRequest}
                runDurationMs={agentRunDurationMs}
              />
            ) : viewMode === "preview" ? (
              <div className="payload-overlay__preview-grid">
                {preview.showQuestion ? (
                  <section className="payload-overlay__pane payload-overlay__pane--content">
                    <h4 className="payload-overlay__pane-title">原子内容</h4>
                    <div
                      className="payload-overlay__body"
                      onScroll={handleContentScroll}
                      ref={contentBodyRef}
                    >
                      <QuestionPreview payload={activePayload as TracePayload} />
                    </div>
                  </section>
                ) : (
                  <section className="payload-overlay__pane payload-overlay__pane--content">
                    <h4 className="payload-overlay__pane-title">原子内容</h4>
                    <div
                      className="payload-overlay__body"
                      onScroll={handleContentScroll}
                      ref={contentBodyRef}
                    >
                      {preview.hasContent ? (
                        <div
                          className="markdown-preview"
                          dangerouslySetInnerHTML={previewHtml}
                        />
                      ) : (
                        <p className="payload-overlay__empty">
                          没有可预览的文本。切到 Code 查看原始载荷。
                        </p>
                      )}
                    </div>
                  </section>
                )}
                <section className="payload-overlay__pane payload-overlay__pane--related">
                  <div className="payload-overlay__pane-head">
                    <h4 className="payload-overlay__pane-title">相关数据</h4>
                  </div>
                  <div
                    className="payload-overlay__body payload-overlay__related-body"
                    onScroll={handleRelatedScroll}
                    ref={relatedBodyRef}
                  >
                    <RelatedFields fields={preview.related} resetToken={selectedEventId} />
                  </div>
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
