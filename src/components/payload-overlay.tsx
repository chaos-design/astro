import {
  Bot,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Code2,
  Crosshair,
  Eye,
  Radio,
  Search,
  X,
} from "lucide-react";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  memo,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type UIEvent,
} from "react";
import { AgentTranscript } from "@/components/agent-transcript";
import { JsonViewer } from "@/components/json-viewer";
import { PairLinkMarker } from "@/components/pair-link-marker";
import { PlatformIcon } from "@/components/platform-icon";
import { hookPhaseOf } from "@/lib/trace-event-kind";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
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
import { getAtomPlatformConfig } from "@/config/atom-platforms";
import type {
  PlatformId,
  RunTerminalReason,
  TraceRunStatus,
} from "@/types/trace";
import { renderMarkdownPreview } from "@/lib/markdown-preview";
import {
  contentToMarkdown,
  fallbackPayloadMarkdown,
  collectPayloadFields,
  hasListPayload,
  orderRelated,
  payloadBodyOf,
  splitPayloadPreview,
} from "@/lib/payload-preview";
import { findPayloadFilePath } from "@/lib/numbered-code";
import { markdownWithEmbeddedImages } from "@/lib/embedded-image";
import { payloadToMarkdown } from "@/lib/payload-markdown";
import { parseUserQuestionContent } from "@/lib/user-question-content";
import { getEventSummary, type TracePairLink } from "@/lib/trace-model";
import type { TracePromptRun } from "@/types/trace";
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

/** Past this length the card clamps its summary and offers an explicit fold. */
const HOVER_SUMMARY_CHARS = 220;

/**
 * One controlled hover card serves the whole rail. A tooltip root per row
 * would multiply into hundreds of portals that re-render on every stream tick;
 * a single layer that follows the hovered row swaps its content in place and
 * stays open while the pointer moves onto it, so long summaries can be read.
 */
const AtomHoverCardLayer = memo(function AtomHoverCardLayer({
  anchorRef,
  card,
  cardRef,
  onCardPointerEnter,
  onCardPointerLeave,
  onSelectAtom,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  card: PayloadOverlayAtom | null;
  cardRef: RefObject<HTMLDivElement | null>;
  onCardPointerEnter: () => void;
  onCardPointerLeave: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onSelectAtom: (atomId: string, eventId: string) => void;
}) {
  // One atom at a time: a fold opened on row #095 must not stay open when the
  // pointer moves to #096, and closing the card resets it for the next hover.
  const [summaryExpanded, setSummaryExpanded] = useState(false);
  useEffect(() => {
    setSummaryExpanded(false);
  }, [card?.id]);
  useLayoutEffect(() => {
    if (!card) {
      return undefined;
    }
    const element = cardRef.current;
    if (!element) {
      return undefined;
    }
    let frame = 0;
    const place = () => {
      frame = 0;
      const anchor = anchorRef.current;
      if (!anchor || !anchor.isConnected) {
        element.style.visibility = "hidden";
        return;
      }
      // Hide once the anchored row scrolls out of the rail's own viewport.
      const listBounds = anchor
        .closest(".payload-overlay__atom-list")
        ?.getBoundingClientRect();
      const anchorBounds = anchor.getBoundingClientRect();
      if (
        listBounds &&
        (anchorBounds.bottom < listBounds.top ||
          anchorBounds.top > listBounds.bottom)
      ) {
        element.style.visibility = "hidden";
        return;
      }
      const cardBounds = element.getBoundingClientRect();
      const gap = 8;
      // The rail sits at the window's left edge, so always open to its right;
      // clamp vertically so a tall card never leaves the viewport.
      const left = Math.min(
        anchorBounds.right + gap,
        Math.max(gap, window.innerWidth - gap - cardBounds.width),
      );
      const top = Math.min(
        Math.max(gap, anchorBounds.top),
        Math.max(gap, window.innerHeight - gap - cardBounds.height),
      );
      element.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
      element.style.visibility = "visible";
    };
    const schedule = () => {
      if (frame) {
        return;
      }
      frame = window.requestAnimationFrame(place);
    };
    place();
    document.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    return () => {
      if (frame) {
        window.cancelAnimationFrame(frame);
      }
      document.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
    };
  }, [anchorRef, card, cardRef, summaryExpanded]);

  if (!card) {
    return null;
  }
  return (
    <div
      className="payload-overlay__atom-hover"
      onClick={() => onSelectAtom(card.atomId, card.id)}
      onPointerEnter={onCardPointerEnter}
      onPointerLeave={onCardPointerLeave}
      ref={cardRef}
      role="tooltip"
    >
      <div className="payload-overlay__atom-hover-card">
        <div className="payload-overlay__atom-hover-head">
          <span className="payload-overlay__atom-hover-sequence">{card.sequence}</span>
          <span className="payload-overlay__atom-hover-turn">Turn {card.turn}</span>
          <span className="payload-overlay__atom-hover-event">{card.eventName}</span>
        </div>
        <dl className="payload-overlay__atom-hover-fields">
          {card.type?.trim() ? (
            <div>
              <dt>TYPE</dt>
              <dd>{card.type}</dd>
            </div>
          ) : null}
          <div>
            <dt>KEY</dt>
            <dd>{card.key}</dd>
          </div>
          <div>
            <dt>STATUS</dt>
            <dd>{card.status}</dd>
          </div>
          <div>
            <dt>ACTION</dt>
            <dd>{card.action}</dd>
          </div>
          <div>
            <dt>TIME</dt>
            <dd>
              {card.dateLabel} {card.clockLabel}
            </dd>
          </div>
          {card.durationLabel !== null ? (
            <div>
              <dt>DURATION</dt>
              <dd>{card.durationLabel}</dd>
            </div>
          ) : null}
          {card.pairLink ? (
            <div>
              <dt>PAIR</dt>
              <dd>{card.pairLink.label}</dd>
            </div>
          ) : null}
        </dl>
        {card.summary ? (
          <>
            <p
              className={cn(
                "payload-overlay__atom-hover-summary",
                card.summary.length > HOVER_SUMMARY_CHARS &&
                  (summaryExpanded ? "is-expanded" : "is-clamped"),
              )}
            >
              {card.summary}
            </p>
            {card.summary.length > HOVER_SUMMARY_CHARS ? (
              <button
                aria-expanded={summaryExpanded}
                className="payload-overlay__atom-hover-toggle"
                onClick={(event) => {
                  // Folding the text is not a jump: keep the pointer on the
                  // card and let the layout effect re-place the grown card.
                  event.stopPropagation();
                  setSummaryExpanded((current) => !current);
                }}
                type="button"
              >
                {summaryExpanded
                  ? "收起"
                  : `展开（${card.summary.length} 字符）`}
              </button>
            ) : null}
          </>
        ) : null}
        <p className="payload-overlay__atom-hover-hint">
          {summaryExpanded
            ? "展开内容可在卡片内滚动 · 点击卡片跳转到此原子"
            : "点击卡片跳转到此原子"}
        </p>
      </div>
    </div>
  );
});

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
  raw: unknown,
  variant: "default" | "question",
): PreparedPreview {
  // The rail can hand over the whole event (an atom row whose tab resolves to
  // the raw capture). Only its `payload` is content: without this unwrap the
  // pane printed the event's `source` (the agent name) as the body and listed
  // `cwd` / `toolName` / `sequence` as related data.
  const payload = payloadBodyOf(raw);
  const split = splitPayloadPreview(payload);
  // A Read result's numbered body is rendered with a line-number gutter; the
  // captured file path selects its highlight language when one is available.
  // A todos / checklist payload carries its meaning in the list structure.
  // Let the list renderer build the rows (with status checkboxes) instead of
  // flattening its `content` leaves into loose paragraphs.
  const textSource = hasListPayload(payload)
    ? payloadToMarkdown(payload)
    : split.content.trim()
      ? contentToMarkdown(split.content, findPayloadFilePath(payload))
      : payloadToMarkdown(payload) || fallbackPayloadMarkdown(payload);
  // Inline image resources belong in the preview as images: the shared helper
  // swaps raw base64 blobs for a short label and appends the distinct sources
  // as Markdown images — the renderer's sanitizer already allows data:image
  // sources only.
  const source = markdownWithEmbeddedImages(textSource, payload);
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
/**
 * ‹ n/N › message stepping, mounted in the overlay's header beside the agent
 * name: the dialog is the "global popup" the reader switches messages from,
 * so the stepper lives with the view it drives. The parent owns the
 * navigation; the LOG lands on the target's anchor event.
 */
function MessageStepper({
  activeKey,
  onStep,
  runs,
}: {
  activeKey: string;
  onStep: (delta: 1 | -1) => void;
  runs: readonly TracePromptRun[];
}) {
  // An unset selection counts as the newest message: the stepper renders as
  // soon as the session has two messages, not only after the first pick.
  const found = runs.findIndex((run) => run.key === activeKey);
  const index = found >= 0 ? found : runs.length - 1;
  if (runs.length < 2) {
    return null;
  }
  const earlier = index > 0 ? runs[index - 1] : null;
  const later = index < runs.length - 1 ? runs[index + 1] : null;
  const titleFor = (run: TracePromptRun | null) =>
    run
      ? getEventSummary(run.prompt).slice(0, 120).replace(/\s+/g, " ")
      : "";
  return (
    <span className="run-stepper">
      <button
        aria-label="上一条消息"
        className="run-stepper__button"
        disabled={!earlier}
        onClick={() => {
          if (earlier) {
            onStep(-1);
          }
        }}
        title={earlier ? `上一条：${titleFor(earlier)}` : undefined}
        type="button"
      >
        <ChevronLeft aria-hidden="true" />
      </button>
      <span className="run-stepper__count">
        {index + 1}/{runs.length}
      </span>
      <button
        aria-label="下一条消息"
        className="run-stepper__button"
        disabled={!later}
        onClick={() => {
          if (later) {
            onStep(1);
          }
        }}
        title={later ? `下一条：${titleFor(later)}` : undefined}
        type="button"
      >
        <ChevronRight aria-hidden="true" />
      </button>
    </span>
  );
}

export function PayloadOverlay({
  atoms,
  agentView,
  agentRunDurationMs = null,
  agentRunExecuting = false,
  agentRunState = null,
  apiBase,
  messageStepper = null,
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
  platform = "chatgpt",
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
   * The displayed message's own status and, when it ended abnormally, why —
   * read by the Agent view's header hover card.
   */
  agentRunState?: {
    status: TraceRunStatus;
    reason: RunTerminalReason | null;
    detail: string | null;
  } | null;
  /** The service base, for the image preview window's file endpoint. */
  apiBase: string;
  /** ‹ n/N › message stepping; rendered beside the agent name in the header. */
  messageStepper?: {
    activeKey: string;
    onStep: (delta: 1 | -1) => void;
    runs: readonly TracePromptRun[];
  } | null;
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
  /** The agent that produced the run — the dialog header's brand mark. */
  platform?: PlatformId;
}) {
  const [viewMode, setViewMode] = useState<PayloadViewMode>("agent");
  // The Agent view reports the event at its reading line. The rail marks that
  // atom (and scrolls it into view) so a reader can see which captured atom
  // produced the card they are on — the two panes stay in step while reading.
  const [contentActiveEventId, setContentActiveEventId] = useState<string | null>(null);
  const contentActiveRowRef = useRef<HTMLButtonElement | null>(null);
  // Bumped when the reader clicks an Agent step so the rail reveal runs even
  // if the selected id did not change (clicking the already-selected card).
  const [railRevealRequest, setRailRevealRequest] = useState(0);
  // Only an explicit rail / step / pair pick locates the Agent transcript.
  // Live follow changes the selected event without bumping this, so a reader
  // who scrolled back through the chain is not yanked to the newest step.
  const [agentLocateRequest, setAgentLocateRequest] = useState(0);
  // Bumped by the Preview / Code "locate source" affordance: it reveals the
  // atom the pane is showing in the rail and, like the step pick, wins over
  // Live follow for one pass so the reader always sees the source land.
  const [railLocateRequest, setRailLocateRequest] = useState(0);
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
  }, [atoms, deferredQuery, searchEvent]);
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
  // The rail's one hover card: the anchor follows the hovered row and the card
  // holds that row's atom. A debounce timer lets the pointer travel from the
  // row onto the card itself without the card vanishing mid-read.
  const [hoveredAtom, setHoveredAtom] = useState<PayloadOverlayAtom | null>(null);
  const atomAnchorRef = useRef<HTMLElement | null>(null);
  const atomCardRef = useRef<HTMLDivElement | null>(null);
  const atomHoverTimerRef = useRef<number | null>(null);
  const openAtomHover = useCallback((atom: PayloadOverlayAtom, anchor: HTMLElement) => {
    if (atomHoverTimerRef.current !== null) {
      window.clearTimeout(atomHoverTimerRef.current);
      atomHoverTimerRef.current = null;
    }
    atomAnchorRef.current = anchor;
    setHoveredAtom((current) => (current?.id === atom.id ? current : atom));
  }, []);
  const closeAtomHover = useCallback(() => {
    if (atomHoverTimerRef.current !== null) {
      window.clearTimeout(atomHoverTimerRef.current);
    }
    atomHoverTimerRef.current = window.setTimeout(() => {
      atomHoverTimerRef.current = null;
      setHoveredAtom(null);
    }, 180);
  }, []);
  const cancelAtomHoverClose = useCallback(() => {
    if (atomHoverTimerRef.current !== null) {
      window.clearTimeout(atomHoverTimerRef.current);
      atomHoverTimerRef.current = null;
    }
  }, []);
  useEffect(
    () => () => {
      if (atomHoverTimerRef.current !== null) {
        window.clearTimeout(atomHoverTimerRef.current);
      }
    },
    [],
  );
  // Escape (or any close that happens while the pointer is over a rail row)
  // does not fire pointerleave, so the 120ms close timer never runs. Clear the
  // hover on close: otherwise the fixed card stays over the console, still
  // anchored to a row that has just unmounted.
  useEffect(() => {
    if (!open) {
      if (atomHoverTimerRef.current !== null) {
        window.clearTimeout(atomHoverTimerRef.current);
        atomHoverTimerRef.current = null;
      }
      setHoveredAtom(null);
      return;
    }
    // Filtering (or a stream reset) can unmount the hovered row while the
    // pointer sits still — no pointerleave fires, so the fixed card would stay
    // anchored to a row that is no longer in the rail.
    if (hoveredAtom && !atoms.some((atom) => atom.id === hoveredAtom.id)) {
      setHoveredAtom(null);
    }
  }, [open, atoms, hoveredAtom]);
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
  // The locate token's last observed value, so the reveal effect can tell an
  // explicit 定位 (animate) apart from a live/stream follow (instant).
  const lastLocateRequestRef = useRef(0);
  // The same observation from the content-active follow effect's side, so it
  // can yield to the animated locate reveal for one pass instead of racing it.
  const lastFollowLocateRef = useRef(0);
  // Bring a rail row into the visible band of the atom list. Returns the
  // target scrollTop, or null when the row is already comfortably in view.
  const revealTarget = (
    list: HTMLElement,
    rowTop: number,
    rowBottom: number,
    pad: number,
  ): number | null => {
    if (rowTop < list.scrollTop + pad) {
      return Math.max(0, rowTop - pad);
    }
    if (rowBottom > list.scrollTop + list.clientHeight - pad) {
      return rowBottom - list.clientHeight + pad;
    }
    return null;
  };
  // A rail row is `position: relative`, so its `offsetTop` is measured from the
  // nearest positioned ancestor (the fixed dialog), not from the list that
  // actually scrolls — the rail itself establishes no containing block. Using
  // it directly here scrolled the list by roughly the header height. Convert
  // through viewport rects so the value shares `list.scrollTop`'s origin.
  const railRowTop = (list: HTMLElement, row: HTMLElement): number =>
    row.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop;
  // A short, eased tween over the list's own scrollTop. Only the rail list
  // may move — revealing the row by hand keeps a content-paned horizontal
  // scroll from being dragged along by a walk up the scrollable ancestors.
  const railTweenRef = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (railTweenRef.current !== null) {
        cancelAnimationFrame(railTweenRef.current);
      }
    },
    [],
  );
  const animateRailTo = (list: HTMLElement, target: number) => {
    // A second locate before the first tween finishes must replace it, not
    // race it: concurrent rAF loops write the same scrollTop each frame.
    if (railTweenRef.current !== null) {
      cancelAnimationFrame(railTweenRef.current);
      railTweenRef.current = null;
    }
    const start = list.scrollTop;
    const delta = target - start;
    if (Math.abs(delta) < 1) {
      list.scrollTop = target;
      return;
    }
    const duration = 320;
    const begin = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - begin) / duration);
      const eased = 1 - (1 - t) * (1 - t) * (1 - t);
      list.scrollTop = start + delta * eased;
      if (t < 1) {
        railTweenRef.current = requestAnimationFrame(step);
      } else {
        railTweenRef.current = null;
      }
    };
    railTweenRef.current = requestAnimationFrame(step);
  };
  useEffect(() => {
    if (!open) {
      return;
    }
    // In the Agent pane the rail follows the *reading line* instead (the
    // effect below): the reader scrolls the transcript, not the rail, so the
    // newest-event selection is not where their eyes are. Preview / Code keep
    // this selection-driven reveal — there the selected row is the content.
    if (viewMode === "agent") {
      return;
    }
    const row = selectedRowRef.current;
    const list = row?.closest<HTMLElement>(".payload-overlay__atom-list");
    if (!row || !list) {
      return;
    }
    const rowTop = railRowTop(list, row);
    const target = revealTarget(list, rowTop, rowTop + row.offsetHeight, 0);
    if (target === null) {
      return;
    }
    // A bump to the locate token is the only explicit "show me the source"
    // signal — animate it. Live follow / stream batches jump instantly.
    const animate = railLocateRequest !== lastLocateRequestRef.current;
    lastLocateRequestRef.current = railLocateRequest;
    if (animate) {
      animateRailTo(list, target);
    } else {
      list.scrollTop = target;
    }
  }, [atoms.length, following, open, railRevealRequest, selectedEventId, railLocateRequest, viewMode]);
  // The Agent pane's reading line moves through the chain as the reader
  // scrolls; the rail follows it: when the reading line lands on an atom that
  // drifted out of the rail's visible band, that row is scrolled back in —
  // even when it is the selected one, because reading the selected step by
  // scrolling is still a scroll move, not a pick. This runs while Live follow
  // is armed too: following advances the *selection* to the newest event, but
  // a reader who scrolled up through the transcript is looking at an older
  // card, and the rail must show the atom behind that card. An explicit
  // locate just fired is animated by the reveal above, so it is yielded to
  // here instead of raced.
  useEffect(() => {
    if (!open || !contentActiveEventId) {
      return;
    }
    if (railLocateRequest !== lastFollowLocateRef.current) {
      lastFollowLocateRef.current = railLocateRequest;
      return;
    }
    const row = contentActiveRowRef.current;
    const list = row?.closest<HTMLElement>(".payload-overlay__atom-list");
    if (!row || !list) {
      return;
    }
    const rowTop = railRowTop(list, row);
    const target = revealTarget(list, rowTop, rowTop + row.offsetHeight, 8);
    if (target === null) {
      return;
    }
    list.scrollTop = target;
  }, [contentActiveEventId, open, railLocateRequest, viewMode]);
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
  // The Preview / Code panes show one atom at a time (the selected event). A
  // reader who has scrolled the pane away from where it was opened can bring
  // the source atom back into the rail with this: it marks the atom the pane
  // is showing and forces the selected-row reveal to run over the rail.
  const handleLocateAtom = () => {
    if (selectedEventId) {
      setContentActiveEventId(selectedEventId);
    }
    setRailLocateRequest((value) => value + 1);
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
  // Stable per batch ( rowCount moves only with the chain ): the memoized rail
  // rows below key on these identities, so a per-second re-render reuses the
  // same row elements and React bails out of re-diffing the whole rail.
  const handleAtomKeyDown = useCallback(
    (keyEvent: KeyboardEvent<HTMLButtonElement>, position: number) => {
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
    },
    [rowCount],
  );
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
  const handleLocatePartner = useCallback(
    (partnerId: string) => {
      const partner = atoms.find((atom) => atom.id === partnerId);
      if (partner) {
        selectAtom(partner.atomId, partner.id);
      }
    },
    [atoms, selectAtom],
  );
  // Agent steps and the rail commit through the same selection state: a step
  // only knows an event id and resolves its atom here, never a second store.
  const handleAgentSelectEvent = useCallback(
    (eventId: string) => {
      handleLocatePartner(eventId);
      setRailRevealRequest((current) => current + 1);
    },
    [handleLocatePartner],
  );

  // Switching from the Agent pane into Preview / Code must carry the atom the
  // reader was on: otherwise those panes keep showing an older selection and
  // the rail cannot say which atom a preview belongs to. Commit the reading
  // line as the selection, then the single shared selection drives all views.
  const committedViewRef = useRef<PayloadViewMode>(viewMode);
  useEffect(() => {
    const previous = committedViewRef.current;
    committedViewRef.current = viewMode;
    if (previous !== "agent" || viewMode === "agent") {
      return;
    }
    if (!contentActiveEventId || contentActiveEventId === selectedEventId) {
      return;
    }
    const atom = atoms.find((item) => item.id === contentActiveEventId);
    if (atom) {
      onSelectAtom(atom.atomId, atom.id);
    }
  }, [atoms, contentActiveEventId, onSelectAtom, selectedEventId, viewMode]);

  // Outside the Agent pane nothing reports a reading line, so the inspected
  // event is the one the reader picked in the rail (or carried over above).
  useEffect(() => {
    if (viewMode === "agent") {
      return;
    }
    setContentActiveEventId(selectedEventId || null);
  }, [selectedEventId, viewMode]);

  // The rail is one element per run event — with a 20k-event run that is the
  // largest DOM subtree in the console, and a per-second root re-render used
  // to re-diff all of it while nothing had changed. Memoize the element array
  // on its batch-stable inputs: the root's `now` tick then re-renders the
  // wrapper, React sees identical child elements and bails out per row. The
  // bodies carry no per-tick state — timestamps and durations are recorded
  // values, and the clock chip lives in the transcript head.
  const railRows = useMemo(
    () =>
      railItems.map((item, railIndex) => {
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
        const hookPhase = hookPhaseOf(atom.eventName);
        const selected = atom.id === selectedEventId;
        const contentActive = atom.id === contentActiveEventId;
        const running = atom.id === runningEventId;
        const partnerSelected =
          atom.pairLink?.partnerId === selectedEventId;
        const rowPosition = item.row;
        return (
          <li key={atom.id}>
            <button
              aria-current={selected ? "true" : undefined}
              aria-label={`${atom.sequence} 第 ${atom.turn} 轮 ${atom.key} ${atom.action} ${atom.summary}`}
              className={cn(
                "atomic-log__row payload-overlay__atom",
                `tone-${atom.tone || "unknown"}`,
                hookPhase && `hook-${hookPhase}`,
                running && "is-running",
                selected && !running && "is-selected",
                !selected && contentActive && "is-content-active",
                partnerSelected && !selected && "is-pair-partner",
              )}
              onClick={() => {
                railPickedEventRef.current = atom.id;
                selectAtom(atom.atomId, atom.id);
              }}
              onKeyDown={(keyEvent) =>
                handleAtomKeyDown(keyEvent, rowPosition)
              }
              onPointerEnter={(pointerEvent) =>
                openAtomHover(atom, pointerEvent.currentTarget)
              }
              onPointerLeave={closeAtomHover}
              ref={(node) => {
                if (selected) {
                  selectedRowRef.current = node;
                }
                if (contentActive) {
                  contentActiveRowRef.current = node;
                } else if (contentActiveRowRef.current === node) {
                  // The reading line moved on: drop the stale anchor so
                  // the follow effect can never scroll to a row that no
                  // longer represents the card on screen.
                  contentActiveRowRef.current = null;
                }
                atomRefs.current[rowPosition] = node;
              }}
              type="button"
            >
              <span className="log-sequence">{atom.sequence}</span>
              <i aria-hidden="true" className="phase-dot" />
              <strong className="atomic-log__name">
                {atom.type?.trim() ? (
                  <span className="atomic-log__type payload-overlay__atom-type">
                    {atom.type}
                  </span>
                ) : null}
                <span className="atomic-log__key">{atom.key}</span>
              </strong>
              <time dateTime={atom.timestamp}>
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
      }),
    [
      railItems,
      selectedEventId,
      contentActiveEventId,
      runningEventId,
      selectAtom,
      handleAtomKeyDown,
      openAtomHover,
      closeAtomHover,
      handleLocatePartner,
    ],
  );

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="payload-overlay">
        <header className="payload-overlay__head">
          <div className="payload-overlay__copy">
            <span className="eyebrow">
              {variant === "question" ? "USER QUESTION" : "CAPTURED PAYLOAD"}
            </span>
            {/* The stepper belongs with the run it steps through: it sits in
                the same row as the producing agent's name, not at the far edge
                of the header next to the close button. */}
            <span className="payload-overlay__identity">
              <span className="payload-overlay__agent">
                <PlatformIcon platform={platform} width={20} height={20} />
                <span className="payload-overlay__agent-name">
                  {getAtomPlatformConfig(platform).label}
                </span>
              </span>
              {messageStepper ? <MessageStepper {...messageStepper} /> : null}
            </span>

            <DialogTitle className="sr-only">{label}</DialogTitle>
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
                {railRows}
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
                apiBase={apiBase}
                locateRequest={agentLocateRequest}
                runDurationMs={agentRunDurationMs}
                runState={agentRunState}
                onActiveEventChange={setContentActiveEventId}
              />
            ) : viewMode === "preview" ? (
              <div className="payload-overlay__preview-grid">
                {preview.showQuestion ? (
                  <section className="payload-overlay__pane payload-overlay__pane--content">
                    <h4 className="payload-overlay__pane-title">原子内容</h4>
                    <div className="preview-mac-frame">
                      <div className="preview-mac-frame__bar">
                        <span className="preview-mac-frame__dots" aria-hidden="true">
                          <i />
                          <i />
                          <i />
                        </span>
                        <span className="preview-mac-frame__label">
                          {activeRow?.eventName || activeRow?.key || "Preview"}
                        </span>
                        <button
                          className="preview-mac-frame__locate"
                          onClick={handleLocateAtom}
                          type="button"
                        >
                          <Crosshair data-icon="inline-start" />
                          定位
                        </button>
                      </div>
                      <div
                        className="preview-mac-frame__scroll"
                        onScroll={handleContentScroll}
                        ref={contentBodyRef}
                      >
                        <QuestionPreview
                          payload={payloadBodyOf(activePayload) as TracePayload}
                        />
                      </div>
                    </div>
                  </section>
                ) : (
                  <section className="payload-overlay__pane payload-overlay__pane--content">
                    <h4 className="payload-overlay__pane-title">原子内容</h4>
                    <div className="preview-mac-frame">
                      <div className="preview-mac-frame__bar">
                        <span className="preview-mac-frame__dots" aria-hidden="true">
                          <i />
                          <i />
                          <i />
                        </span>
                        <span className="preview-mac-frame__label">
                          {activeRow?.eventName || activeRow?.key || "Preview"}
                        </span>
                        <button
                          className="preview-mac-frame__locate"
                          onClick={handleLocateAtom}
                          type="button"
                        >
                          <Crosshair data-icon="inline-start" />
                          定位
                        </button>
                      </div>
                      <div
                        className="preview-mac-frame__scroll"
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
                <div className="preview-mac-frame preview-mac-frame--code">
                  <div className="preview-mac-frame__bar">
                    <span className="preview-mac-frame__dots" aria-hidden="true">
                      <i />
                      <i />
                      <i />
                    </span>
                    <span className="preview-mac-frame__label">
                      {activeRow?.eventName || activeRow?.key || "原始载荷"}
                    </span>
                    <button
                      className="preview-mac-frame__locate"
                      onClick={handleLocateAtom}
                      type="button"
                    >
                      <Crosshair data-icon="inline-start" />
                      定位
                    </button>
                  </div>
                  <div className="preview-mac-frame__scroll">
                    <JsonViewer value={activePayload} />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
      <AtomHoverCardLayer
        anchorRef={atomAnchorRef}
        card={open ? hoveredAtom : null}
        cardRef={atomCardRef}
        onCardPointerEnter={cancelAtomHoverClose}
        onCardPointerLeave={closeAtomHover}
        onSelectAtom={onSelectAtom}
      />
    </Dialog>
  );
}
