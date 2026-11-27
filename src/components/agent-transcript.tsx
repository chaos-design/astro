import {
  Activity,
  AlertCircle,
  ArrowDown,
  Bot,
  ChevronDown,
  ChevronsDown,
  ChevronRight,
  CircleStop,
  HelpCircle,
  Layers,
  Lightbulb,
  LoaderCircle,
  MessageSquare,
  Repeat,
  Timer,
  ChevronLeft,
} from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";

import { MarkdownView } from "@/components/markdown-view";
import { AnswerRows } from "@/components/answer-rows";
import { PairLinkMarker } from "@/components/pair-link-marker";
import { QuestionContent, QuestionPreview, type QuestionAnswerBinding } from "@/components/question-content";
import { RelatedFields } from "@/components/related-fields";
import {
  AGENT_SCROLL_HIDDEN_STEP_THRESHOLD,
  isAgentTranscriptAtBottom,
  isLatestStepVisible,
  latestStepHiddenOutside,
} from "@/lib/agent-transcript-scroll";
import { cn } from "@/lib/utils";
import type {
  AgentStep,
  AgentStepStatus,
  AgentView,
  ReplyStep,
  ThinkingStep,
  ToolResultStep,
  QuestionStep,
  GenericStep,
} from "@/lib/agent-view";
import {
  runStatusLabels,
  runTerminalReasonDescriptions,
} from "@/lib/run-history-state";
import { durationHeatClass } from "@/lib/duration-label";
import type { RunTerminalReason, TraceRunStatus } from "@/types/trace";
import {
  collectPayloadFields,
  contentToMarkdown,
  findFirstListPayload,
  hasListPayload,
  inferCodeLanguage,
  orderRelated,
  splitPayloadPreview,
} from "@/lib/payload-preview";
import { payloadToMarkdown } from "@/lib/payload-markdown";
import { markdownWithEmbeddedImages } from "@/lib/embedded-image";
import { classifyCapturedResource } from "@/lib/captured-image";
import { hookPhaseOf } from "@/lib/trace-event-kind";
import { findPayloadFilePath } from "@/lib/numbered-code";
import { PayloadItemBlocks } from "@/components/payload-item-blocks";
import { formatDurationMs } from "@/lib/duration-label";
import {
  formatExecutionClock,
  type ToolCallInputs,
  type ToolInputField,
} from "@/lib/trace-model";
/**
 * What a tool result's *body* should not re-print. The call frame already
 * shows the shell command, and the related-fields pane already labels the
 * metadata, so the body dump feeds from a copy of the payload with:
 *  - the `command` / `cmd` leaves dropped (input containers and top level),
 *    so the command reads once, not twice;
 *  - the top-level client identity (`client` / `version`) dropped, so a
 *    result never re-stamps the agent name and recorder version.
 * The captured event is never mutated — this returns a display copy.
 */
const BODY_INPUT_CONTAINERS = [
  "tool_input", "toolInput", "input", "payload", "arguments", "args",
];
const BODY_ROOT_DROP = new Set(["client", "version"]);
function bodyPayloadOf(payload: unknown, dropCommand: boolean): unknown {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return payload;
  }
  const record = payload as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(record)) {
    const name = key.toLowerCase();
    if (dropCommand && (name === "command" || name === "cmd")) {
      continue;
    }
    if (BODY_ROOT_DROP.has(name)) {
      continue;
    }
    if (
      item !== null &&
      typeof item === "object" &&
      !Array.isArray(item) &&
      BODY_INPUT_CONTAINERS.includes(key)
    ) {
      out[key] = bodyPayloadOf(item, dropCommand);
      continue;
    }
    out[key] = item;
  }
  return out;
}

/**
 * The shell's *output* for a tool result, read from the host-specific shapes
 * without re-classifying the payload: a `tool_response` / `toolResponse`
 * record carries `stdout` (zcode) or an array of `text` parts, and a result
 * body may live on `tool_result` / `toolResult` / `output`. A non-empty
 * value is what the terminal frame shows; `null` means the capture had no
 * readable output and the frame stays out of the way.
 */
const SHELL_OUTPUT_CONTAINERS = [
  "tool_response", "toolResponse",
  "tool_result", "toolResult",
  "output", "result",
];
function shellOutputOf(payload: unknown): string | null {
  if (payload === null || typeof payload !== "object") {
    return null;
  }
  const record = payload as Record<string, unknown>;
  for (const key of SHELL_OUTPUT_CONTAINERS) {
    if (!(key in record)) {
      continue;
    }
    const node = record[key];
    if (typeof node === "string") {
      const text = node.trim();
      if (text) {
        return text;
      }
      break;
    }
    if (Array.isArray(node)) {
      const text = node
        .map((part) => (typeof part === "string" ? part : part && typeof part === "object" && "text" in part ? String((part as { text: unknown }).text ?? "") : ""))
        .join("\n")
        .trim();
      if (text) {
        return text;
      }
      break;
    }
    if (node !== null && typeof node === "object") {
      const text = String((node as Record<string, unknown>).stdout ?? (node as Record<string, unknown>).output ?? "").trim();
      if (text) {
        return text;
      }
    }
  }
  return null;
}

/**
 * A captured execution line in a mac-terminal frame: a title bar with the
 * three window dots, a `$` prompt for real shell commands, and the command
 * itself. The command is rendered by the shared MarkdownView so shell tokens
 * keep their colouring; the frame only wraps it. Long commands wrap at word
 * boundaries (CSS `overflow-wrap`) instead of scrolling off — a reader sees
 * the whole command, broken at a space, not an arbitrary mid-word cut.
 */
/**
 * A structured tool call reads as arguments, not as `field=value` text. The
 * captured shell command still opens with a terminal `$` prompt; otherwise
 * the tool name is a header and each short input is its own labelled row,
 * wrapping at word boundaries. Diff-carrying fields never reach here — the
 * single extractor leaves them out so their patch keeps its own rendering.
 */

/**
 * A call field that names a resource is typed by the shared classifier, not
 * by a second image extension regex: an `image_url` renders as an image, a
 * `file_path` to a PDF as a file chip, and an ordinary `path` holding prose
 * stays plain text. The whitelist lives in `captured-image.ts` together with
 * the item blocks and the Markdown sanitizer, so one value has one meaning.
 */
const RESOURCE_FIELD_KEYS = new Set([
  "image_url", "imageUrl", "image_path", "imagePath",
  "input_image", "image", "img",
  "file", "file_path", "filePath", "attachment", "attachments",
  "url", "uri", "path",
]);

function CallFieldValue({ field }: { field: ToolInputField }) {
  const resource = RESOURCE_FIELD_KEYS.has(field.key)
    ? classifyCapturedResource(field.value, "")
    : ({ kind: "text" } as const);
  if (resource.kind === "image" && resource.origin !== "local") {
    return (
      <span className="agent-step__call-image">
        <img
          alt={resource.name || field.value}
          className="agent-step__call-image__thumb"
          loading="lazy"
          referrerPolicy="no-referrer"
          src={resource.src}
        />
        <code className="agent-step__call-image__src" title={field.value}>
          {field.value}
        </code>
      </span>
    );
  }
  if (resource.kind !== "text") {
    const base = resource.name || field.value.split(/[\\/]/).pop() || field.value;
    return (
      <span className="agent-step__call-image agent-step__call-image--local">
        <span aria-hidden="true" className="agent-step__call-image__glyph">
          {resource.kind === "image" ? "🖼" : "📎"}
        </span>
        <span className="agent-step__call-image__path">
          <strong>{base}</strong>
          <code title={field.value}>{field.value}</code>
        </span>
      </span>
    );
  }
  return <>{field.value}</>;
}

function CallBlock({
  inputs,
  output,
}: {
  inputs: ToolCallInputs;
  /** The shell's captured stdout, when a host provides it — rendered in a
   * terminal frame below the command. Omitted for a call with no output. */
  output?: string | null;
}) {
  if (inputs.command) {
    // The far-right badge reads the language, not the tool name: the reader
    // wants to know *what runs*, and a captured shell line is `bash` even
    // when the host labelled the tool `Bash`. Fall back to the tool name
    // when the language cannot be inferred.
    const language =
      inferCodeLanguage(inputs.command)?.toUpperCase() ||
      inputs.toolName ||
      "BASH";
    return (
      <div className="agent-step__call agent-step__call--shell">
        <div className="agent-step__call-bar" aria-hidden="true">
          <span className="agent-step__command-dots">
            <i />
            <i />
            <i />
          </span>
          <span className="agent-step__command-label">COMMAND</span>
          <span className="agent-step__call-lang">{language}</span>
        </div>
        <div className="agent-step__command-line">
          <MarkdownView source={contentToMarkdown(inputs.command)} />
        </div>
        {output ? (
          <div className="agent-step__terminal">
            <div className="agent-step__terminal-bar" aria-hidden="true">
              <span className="agent-step__command-label">OUTPUT</span>
            </div>
            <pre className="agent-step__terminal-body">
              <code>{output}</code>
            </pre>
          </div>
        ) : null}
      </div>
    );
  }
  return (
    <div className="agent-step__call agent-step__call--fields">
      <div className="agent-step__call-bar" aria-hidden="true">
        <span className="agent-step__command-dots">
          <i />
          <i />
          <i />
        </span>
        <span className="agent-step__call-name">{inputs.toolName}</span>
        <span className="agent-step__command-label">CALL</span>
      </div>
      {inputs.fields.length ? (
        <dl className="agent-step__call-fields">
          {inputs.fields.map((field) => (
            <div className="agent-step__call-field" key={field.key}>
              <dt>{field.key}</dt>
              <dd>
                <CallFieldValue field={field} />
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <div className="agent-step__call-empty">无入参</div>
      )}
    </div>
  );
}

/**
 * A header count that reads as both a summary and a jump target. Hover opens
 * a card naming the steps behind the count (no native `title` — those cannot
 * be read by keyboard or carry a jump); clicking lands on the first step.
 * The whole list lives in one popup per chip, scoped to this header.
 */
/**
 * The kind label one hover-card row shows: the two semantic kinds keep their
 * own name; a tool-result names its tool; a plain event keeps the captured
 * event name. One place decides the row text so the list and the card never
 * drift.
 */
function statCardRowLabel(step: AgentStep): string {
  switch (step.kind) {
    case "reply":
      return "REPLY";
    case "thinking":
      return "THINKING";
    case "question":
      return "QUESTION";
    case "tool-result":
      return step.toolName || step.eventName;
    default:
      return step.eventName;
  }
}

/**
 * A one-line preview that makes a hover-card row readable without jumping in:
 * a tool call shows its captured shell command (or first input field), a
 * thinking / reply step shows the head of its text, and a plain event shows
 * its summary. Empty for a row that has nothing useful to preview, so the
 * card keeps one calm column instead of a blank second line.
 */
function statCardRowHint(step: AgentStep): string {
  const collapse = (value: string): string =>
    value.replace(/\s+/g, " ").trim().slice(0, 72);
  switch (step.kind) {
    case "thinking":
    case "reply":
      return collapse(step.text);
    case "tool-result": {
      // Folded, the reader wants the *result's* own first line — the inputs'
      // key/value pairs (a Read's file_path, a Bash's command) are already
      // visible in the call block header, and a teaser that repeats them
      // made a folded card look like it had no content at all.
      if (step.inputs?.command) {
        const output = shellOutputOf(step.payload);
        const teaser = collapse(output || "");
        if (teaser) {
          return teaser;
        }
        return collapse(step.inputs.command);
      }
      const content = splitPayloadPreview(step.payload).content;
      const teaser = collapse(content || "");
      if (teaser) {
        return teaser;
      }
      if (step.inputs?.fields?.length) {
        return collapse(
          step.inputs.fields
            .map((field) => `${field.key}: ${String(field.value)}`)
            .join("  "),
        );
      }
      return "";
    }
    case "question":
      // A question's text is its own prompt, not a command; leave the row's
      // preview to the name so the card stays one calm line.
      return "";
    case "event":
      if (step.inputs?.command) {
        return collapse(step.inputs.command);
      }
      return collapse(step.summary || "");
  }
}

function StatChip({
  name,
  label,
  icon,
  steps,
  open,
  onOpen,
  onLeave,
  onJump,
}: {
  name: string;
  label: string;
  /** A small leading glyph so the count reads as an icon-tagged stat, not a
   * bare number. Rendered inside the button, before the label text. */
  icon: ReactNode;
  steps: readonly AgentStep[];
  open: boolean;
  /** Opening cancels any pending close — including another chip's. */
  onOpen: (name: string) => void;
  /** Leaving schedules the close on the one shared timer. */
  onLeave: () => void;
  onJump: (eventId: string) => void;
}) {
  return (
    <span
      className={cn("agent-transcript__stat-wrap", open && "is-open")}
      onPointerEnter={() => onOpen(name)}
      onPointerLeave={onLeave}
    >
      <button
        className="agent-transcript__stat agent-transcript__stat-button"
        onClick={() => {
          if (steps[0]) {
            onJump(steps[0].eventId);
          }
        }}
        type="button"
      >
        {icon}
        <span className="agent-transcript__stat-text">{label}</span>
      </button>
      {open && steps.length ? (
        <span className="agent-transcript__stat-card" role="tooltip">
          <span className="agent-transcript__stat-card-title">{label}</span>
          <span className="agent-transcript__stat-card-list">
            {steps.map((step) => {
              const hint = statCardRowHint(step);
              return (
                <button
                  className={cn(
                    "agent-transcript__stat-card-row",
                    hint && "has-hint",
                  )}
                  key={step.id}
                  onClick={() => onJump(step.eventId)}
                  type="button"
                >
                  <span>{step.sequence}</span>
                  <span className="agent-transcript__stat-card-name">
                    <strong>{statCardRowLabel(step)}</strong>
                    {hint ? (
                      <em title={hint}>{hint}</em>
                    ) : null}
                  </span>
                  <span>T{step.turn}</span>
                </button>
              );
            })}
          </span>
        </span>
      ) : null}
    </span>
  );
}

/**
 * The main message's accumulated execution clock. This is a run-level timer,
 * not an atom badge: it has exactly two readings — 执行 while the run is
 * still receiving events, 结束 once it stopped. The host's finer outcome
 * stays in the step badges; hovering here only explains the timer itself.
 */
function RunClockChip({
  durationMs,
  live,
  state,
}: {
  durationMs: number;
  live: boolean;
  state: {
    status: TraceRunStatus;
    reason: RunTerminalReason | null;
    detail: string | null;
  } | null;
}) {
  const reasonText = live
    ? "执行中：仍在接收事件，计时每秒推进"
    : state?.reason
      ? runTerminalReasonDescriptions[state.reason]
      : "已结束：计时停在记录的总时长，不再推进";
  // CSS-hover driven like the step badges: a live run re-renders every second,
  // and a stateful hover card would flash off on each of those renders.
  return (
    <span className="agent-transcript__stat-wrap">
      <span
        aria-label="本条消息的累计执行时间"
        className={cn(
          "agent-transcript__stat",
          "agent-transcript__duration",
          live ? "is-live" : "is-ended",
        )}
        tabIndex={0}
      >
        <Timer aria-hidden="true" className="agent-transcript__stat-icon" />
        <span className="agent-transcript__stat-text">
          {live ? "执行" : "结束"} {formatExecutionClock(durationMs)}
        </span>
      </span>
      <span className="agent-transcript__stat-card" role="tooltip">
        <span className="agent-transcript__stat-card-title">
          本条消息 · {live ? "执行中" : "已结束"}
        </span>
        <span className="agent-transcript__status-reason">{reasonText}</span>
        {!live && state?.detail ? (
          <code className="agent-transcript__status-detail">
            {state.detail}
          </code>
        ) : null}
        <span className="agent-transcript__status-foot">
          累计执行 {formatExecutionClock(durationMs)} · 含本条消息内所有子步骤
        </span>
      </span>
    </span>
  );
}

/**
 * The step's own clock and outcome, as one hover target. A step card answers
 * two questions a bare number cannot: *how long did this step take* (its own
 * span, not the run's accumulated total) and, when it ended abnormally, *why*
 * — a status word plus the classifier's reason sentence plus the host's own
 * detail text. Nothing here invents a cause: the reason comes from
 * `run-history-state`'s one table and the detail from the captured payload.
 */
function StepStatusBadge({
  durationMs,
  label,
  sequence,
  status,
}: {
  durationMs: number | null;
  /** The badge prefix: this step's LOG row number. */
  label: string;
  sequence: string;
  status: AgentStepStatus | null;
}) {
  if (durationMs === null && !status) {
    return null;
  }
  const statusWord = status ? runStatusLabels[status.status] : null;
  const reasonText = status?.reason
    ? runTerminalReasonDescriptions[status.reason]
    : status?.status === "waiting"
      ? "等待：宿主在等待输入或限流，不是失败"
      : status
        ? "异常：宿主报告了非正常结束，未附带更具体的原因"
        : null;
  // The card is CSS-hover driven, not state driven: a React re-render while
  // the pointer rests on the badge replaces the element, and a stateful
  // `mouseenter` never re-fires on the replacement — the card flashed once
  // (moving from a thinking badge onto a reply badge re-renders the list)
  // and then never came back. CSS `:hover` survives every re-render.
  return (
    <span className="agent-step__status-wrap">
      <span
        aria-label={`${label} 耗时与状态`}
        className={cn(
          "agent-step__status",
          status && `is-${status.status}`,
          // The grade colours the whole badge — icon included — so the icon
          // never stays grey inside a coloured chip.
          status ? null : `heat-${durationHeatClass(durationMs ?? 0)}`,
        )}
        tabIndex={0}
      >
        {status ? (
          status.status === "waiting" ? (
            <LoaderCircle aria-hidden="true" className="animate-spin" />
          ) : (
            <CircleStop aria-hidden="true" />
          )
        ) : (
          <Timer aria-hidden="true" />
        )}
        {durationMs !== null ? (
          <span className="atomic-log__duration">
            {formatDurationMs(durationMs)}
          </span>
        ) : null}
        {statusWord ? <span>{statusWord}</span> : null}
      </span>
      <span className="agent-step__status-card" role="tooltip">
        <strong>
          {sequence} · {statusWord ?? "耗时"}
        </strong>
        {reasonText ? <em>{reasonText}</em> : null}
        {status?.detail ? (
          <code className="agent-step__status-detail">{status.detail}</code>
        ) : null}
        <span className="agent-step__status-foot">
          {durationMs !== null
            ? `本步耗时 ${formatDurationMs(durationMs)}`
            : "本步没有可测量的起止跨度"}
          {status ? ` · 范围 ${status.scope}` : ""}
        </span>
      </span>
    </span>
  );
}

/** Half a tick's hit area: the first / last dot stays whole inside the track
 *  instead of being clipped by its overflow window. */
const PROGRESS_TICK_INSET = 7;
/** Keep the pan highlight up for the whole slide, not just the click frame. */
const PROGRESS_PAN_FEEDBACK_MS = 420;

type ProgressTick = {
  /** The turn's first step, for the click-to-jump. */
  firstStepId: string;
  ratio: number;
  /** Steps in this turn. */
  count: number;
  /** The turn's first LOG row, so a hover names where it starts. */
  sequence: string;
  turn: number;
};

function sameTicks(
  previous: readonly ProgressTick[],
  next: readonly ProgressTick[],
): boolean {
  return (
    previous.length === next.length &&
    previous.every((tick, index) => {
      const other = next[index];
      return (
        tick.turn === other.turn &&
        tick.count === other.count &&
        tick.firstStepId === other.firstStepId &&
        Math.abs(tick.ratio - other.ratio) < 0.002
      );
    })
  );
}

/**
 * The Agent chain's scroll progress: a thin bar under the message list whose
 * fill is the scroll completion, with one tick per turn. Hovering a tick
 * states the turn (number, step count, where it starts in the LOG); clicking
 * one scrolls that turn's first card into view. The fill is written straight
 * to the element — a progress state would re-render the whole chain once per
 * scroll frame, exactly the cost the list's memoization exists to avoid.
 */
function ChainProgress({
  scrollRef,
  steps,
  stepRefs,
}: {
  scrollRef: RefObject<HTMLDivElement | null>;
  steps: readonly AgentStep[];
  stepRefs: Map<string, HTMLElement>;
}) {
  const fillRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const progressRef = useRef(1);
  // The tick area pans with the two edge buttons when turns are dense enough
  // to overflow; the strip itself never shows a scrollbar. The layer widens
  // only past a comfortable per-tick spacing, and the pan clamps to it.
  const ticksLayerRef = useRef<HTMLDivElement | null>(null);
  const [canShift, setCanShift] = useState(false);
  const [pan, setPan] = useState(0);
  const panRef = useRef(0);
  // The tick layer is at least as wide as the track and widens to one
  // comfortable slot per turn; the pan window slides over it.
  const [layerWidth, setLayerWidth] = useState(0);
  // Nothing to report until the chain actually overflows: the strip is hidden
  // on first render and only appears once a turn can be placed on it.
  const [visible, setVisible] = useState(false);
  // A brief lit state while the layer slides makes the edge buttons read as
  // a real switch between windows instead of a no-op on a static bar.
  const [panning, setPanning] = useState(false);
  const panTimerRef = useRef<number | null>(null);
  const shiftTicks = useCallback((direction: 1 | -1) => {
    const layer = ticksLayerRef.current;
    if (!layer) {
      return;
    }
    const parentWidth = layer.parentElement?.clientWidth ?? layer.clientWidth;
    const max = layer.offsetWidth - parentWidth;
    if (max <= 0) {
      return;
    }
    const next = Math.min(max, Math.max(0, panRef.current + direction * max * 0.6));
    panRef.current = next;
    setPan(next);
    setPanning(true);
    if (panTimerRef.current !== null) {
      window.clearTimeout(panTimerRef.current);
    }
    panTimerRef.current = window.setTimeout(() => {
      panTimerRef.current = null;
      setPanning(false);
    }, PROGRESS_PAN_FEEDBACK_MS);
  }, []);
  useEffect(
    () => () => {
      if (panTimerRef.current !== null) {
        window.clearTimeout(panTimerRef.current);
      }
    },
    [],
  );
  const [ticks, setTicks] = useState<ProgressTick[]>([]);
  // The last measured geometry, readable from the scroll frame without going
  // through React state or touching the DOM again.
  const ticksRef = useRef<ProgressTick[]>([]);
  // The tick the reader's position has just passed (or sits on) breathes —
  // a rounded state so the animation re-renders once per step, never per
  // scroll frame.
  const [activeTurn, setActiveTurn] = useState<number | null>(null);

  /** Cheap, per-frame work: one scroll read, one style write, one comparison
   *  against the cached ticks. No step geometry is measured here. */
  const updateReading = useCallback(() => {
    const container = scrollRef.current;
    if (!container) {
      return;
    }
    const range = container.scrollHeight - container.clientHeight;
    const progress = range <= 4 ? 1 : Math.min(1, Math.max(0, container.scrollTop / range));
    progressRef.current = progress;
    if (fillRef.current) {
      fillRef.current.style.width = `${progress * 100}%`;
    }
    if (range <= 4) {
      setActiveTurn((previous) => (previous === null ? previous : null));
      return;
    }
    const ticksNow = ticksRef.current;
    let nearest: ProgressTick | null = null;
    for (const tick of ticksNow) {
      if (tick.ratio <= progress + 0.0005 && (!nearest || tick.ratio > nearest.ratio)) {
        nearest = tick;
      }
    }
    // Compared against the rounded position so the state flips once per tick,
    // not once per scroll frame.
    setActiveTurn((previous) =>
      (previous === null ? -1 : previous) === (nearest ? nearest.turn : -1)
        ? previous
        : nearest
          ? nearest.turn
          : null,
    );
  }, [scrollRef]);

  /** Expensive, structural work: one `getBoundingClientRect` per step. Only a
   *  new step, a resize or a live append can change these positions, so it is
   *  deliberately kept off the scroll path. */
  const measureTicks = useCallback(() => {
    const container = scrollRef.current;
    if (!container) {
      return;
    }
    const range = container.scrollHeight - container.clientHeight;
    if (range <= 4) {
      // Everything is on screen: no progress to report, so the whole strip
      // (buttons included) steps aside instead of showing an idle bed.
      ticksRef.current = [];
      setTicks((previous) => (previous.length ? [] : previous));
      setVisible(false);
      setCanShift(false);
      return;
    }
    setVisible(true);
    const containerTop = container.getBoundingClientRect().top;
    const firstByTurn = new Map<number, ProgressTick>();
    for (const step of steps) {
      if (firstByTurn.has(step.turn)) {
        const existing = firstByTurn.get(step.turn);
        if (existing) {
          existing.count += 1;
        }
        continue;
      }
      const element = stepRefs.get(step.id);
      if (!element) {
        continue;
      }
      const top =
        element.getBoundingClientRect().top - containerTop + container.scrollTop;
      firstByTurn.set(step.turn, {
        firstStepId: step.id,
        count: 1,
        ratio: Math.min(1, Math.max(0, top / range)),
        sequence: step.sequence,
        turn: step.turn,
      });
    }
    const next = [...firstByTurn.values()].sort(
      (left, right) => left.ratio - right.ratio,
    );
    ticksRef.current = next;
    setTicks((previous) => (sameTicks(previous, next) ? previous : next));
    // The two pan buttons own fixed slots at the ends; the track takes all
    // the room between them. Dense turns widen the tick layer past that
    // track, and its width eases there instead of snapping.
    const trackWidth = trackRef.current?.clientWidth ?? 0;
    const width = Math.max(trackWidth, next.length * 13);
    setLayerWidth((previous) => (previous === width ? previous : width));
    setCanShift(width > trackWidth + 4);
    updateReading();
  }, [scrollRef, steps, stepRefs, updateReading]);

  // A live append or a new step changes the tick geometry without a scroll
  // event; re-measure on the chain's own growth.
  useEffect(() => {
    measureTicks();
  }, [measureTicks, steps.length, steps.at(-1)?.id]);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) {
      return;
    }
    measureTicks();
    const onScroll = () => {
      if (frameRef.current !== null) {
        return;
      }
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = null;
        updateReading();
      });
    };
    // A resize changes geometry, not just the reading line: it gets its own
    // rAF budget so a scroll frame cannot starve it (or vice versa).
    let resizeFrame: number | null = null;
    const onResize = () => {
      if (resizeFrame !== null) {
        return;
      }
      resizeFrame = window.requestAnimationFrame(() => {
        resizeFrame = null;
        measureTicks();
      });
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    const observer = new ResizeObserver(onResize);
    observer.observe(container);
    return () => {
      container.removeEventListener("scroll", onScroll);
      observer.disconnect();
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      if (resizeFrame !== null) {
        window.cancelAnimationFrame(resizeFrame);
      }
    };
  }, [measureTicks, updateReading, scrollRef]);

  return (
    <div
      aria-hidden={visible ? "false" : "true"}
      className={cn(
        "agent-transcript__progress",
        !visible && "is-hidden",
        panning && "is-panning",
      )}
    >
      {/* The pan buttons sit at the two outer edges and the track fills the
          space between them; dense turns widen the tick layer underneath. */}
      <button
        aria-label="向左平移刻度"
        className={cn(
          "agent-transcript__progress-edge",
          !canShift && "is-idle",
        )}
        onClick={() => shiftTicks(-1)}
        type="button"
      >
        <ChevronLeft aria-hidden="true" />
      </button>
      <div className="agent-transcript__progress-track" ref={trackRef}>
        <div
          className="agent-transcript__progress-ticks"
          ref={ticksLayerRef}
          style={{
            transform: `translateX(${-pan}px)`,
            width: layerWidth > 0 ? `${layerWidth}px` : undefined,
          }}
        >
          {ticks.map((tick) => (
            <button
              aria-label={`跳到第 ${tick.turn} 轮（${tick.count} 步，从第 ${tick.sequence} 行开始）`}
              className={cn(
                "agent-transcript__progress-tick",
                activeTurn !== null && tick.turn < activeTurn && "is-passed",
                tick.turn === activeTurn && "is-active",
              )}
              key={tick.turn}
              onClick={() => {
                const element = stepRefs.get(tick.firstStepId);
                element?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
              style={{
                left:
                  layerWidth > 0
                    ? `${PROGRESS_TICK_INSET + tick.ratio * (layerWidth - 2 * PROGRESS_TICK_INSET)}px`
                    : undefined,
              }}
              type="button"
            >
              <span className="agent-transcript__progress-tip" role="tooltip">
                <strong>第 {tick.turn} 轮</strong>
                <span>
                  {tick.count} 步 · 从 {tick.sequence} 行开始
                </span>
              </span>
            </button>
          ))}
        </div>
        <div className="agent-transcript__progress-fill" ref={fillRef} />
      </div>
      <button
        aria-label="向右平移刻度"
        className={cn(
          "agent-transcript__progress-edge",
          !canShift && "is-idle",
        )}
        onClick={() => shiftTicks(1)}
        type="button"
      >
        <ChevronRight aria-hidden="true" />
      </button>
    </div>
  );
}

/**
 * The Agent view of one run: the captured sequence rendered as the artifacts
 * an Agent produces — thinking, replies, tool results and user questions.
 * It is a pure consumer of `AgentView`; every payload still goes through the
 * shared markdown / question / related-field renderers.
 */
export function AgentTranscript({
  view,
  selectedEventId,
  onSelectEvent,
  questionBinding,
  questionEventId,
  live,
  locateRequest,
  runDurationMs,
  runState = null,
  apiBase,
  onActiveEventChange,
}: {
  view: AgentView;
  selectedEventId: string | null;
  onSelectEvent: (eventId: string) => void;
  questionBinding: QuestionAnswerBinding | null;
  questionEventId: string | null;
  /** The run is still executing: a loading state follows the newest step. */
  live: boolean;
  /** Bumped by an explicit rail / step / pair pick, never by live follow. */
  locateRequest: number;
  /** The service base, for the image preview window's file endpoint. */
  apiBase: string;
  /** The displayed message's execution time: advancing while the run
   * executes, the recorded total once it ended; `null` when the message has
   * no clock of its own. */
  runDurationMs: number | null;
  /**
   * Why the displayed message ended the way it did. The header clock answers
   * "how long did this message run"; hovering it answers "and why did it
   * stop" — including the derived `timeout`, which no captured event records.
   */
  runState?: {
    status: TraceRunStatus;
    reason: RunTerminalReason | null;
    detail: string | null;
  } | null;
  /** The event whose card is currently at the reading line. The caller marks
   * the matching rail atom so the reader can see which atom produced what
   * they are reading. Reported only when it changes — never on every tick. */
  onActiveEventChange?: (eventId: string | null) => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stepRefs = useRef(new Map<string, HTMLElement>());
  const atBottomRef = useRef(true);
  const stepCountRef = useRef(view.steps.length);
  const chainId = view.steps[0]?.id ?? "";
  const initializedChainRef = useRef<string | null>(null);
  const lastLocateRef = useRef(locateRequest);
  const scrollFrameRef = useRef<number | null>(null);
  // The centered pill is a position read, not a gesture latch: it answers
  // whether the newest step has left the viewport, however the reader got
  // there (wheel, programmatic locate or an explicit atom pick).
  const [showJump, setShowJump] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  // The last event reported as the reading line. Comparing before calling
  // keeps the parent's rail highlight stable across the app's one-second
  // ticks and across every scroll frame within the same step.
  const reportedActiveRef = useRef<string | null>(null);

  // Programmatic positioning: the centered affordance is derived from whether
  // the newest step is still on screen, so a programmatic scroll (pin, locate,
  // jump) is judged by the same position rule as a wheel gesture.
  const scrollToTop = useCallback(
    (element: HTMLElement, top: number, smooth = false) => {
      if (smooth) {
        // An explicit pick animates so the reader keeps their place in the
        // chain. Live pinning and streamed appends stay instant — a smooth
        // animation there would fight the re-renders of a running message.
        element.scrollTo({ top, behavior: "smooth" });
      } else {
        element.scrollTop = top;
      }
    },
    [],
  );

  // The scroll handler reads layout at most once per frame: a live stream can
  // append several events a second, but a wheel gesture must not turn every
  // event into a layout read plus a render.
  const syncScrollState = useCallback(() => {
    const container = scrollRef.current;
    if (!container) {
      return;
    }
    // Which atom produced the text at the reading line? Steps are in DOM
    // order, so a binary search over their tops finds the last card above the
    // line in O(log n) layout reads instead of one read per step on every
    // scroll frame of a long run.
    const readingLine = container.getBoundingClientRect().top + 28;
    const steps = view.steps;
    let low = 0;
    let high = steps.length - 1;
    let activeIndex = -1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      const element = stepRefs.current.get(steps[middle].id);
      if (!element) {
        high = middle - 1;
        continue;
      }
      if (element.getBoundingClientRect().top <= readingLine) {
        activeIndex = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    const activeEventId =
      steps[activeIndex >= 0 ? activeIndex : 0]?.eventId ?? null;
    if (activeEventId !== reportedActiveRef.current) {
      reportedActiveRef.current = activeEventId;
      onActiveEventChange?.(activeEventId);
    }
    const absoluteBottom = isAgentTranscriptAtBottom(container);
    const viewport = container.getBoundingClientRect();
    // Live pinning keeps following while the newest step is visible, even if
    // the scroll position sits above the bottom edge (a tall last reply).
    const lastStep = view.steps.at(-1);
    const lastElement = lastStep ? stepRefs.current.get(lastStep.id) : null;
    const stepRect = lastElement?.getBoundingClientRect() ?? null;
    const latestVisible = stepRect
      ? isLatestStepVisible(viewport, stepRect)
      : true;
    atBottomRef.current = absoluteBottom || latestVisible;
    if (absoluteBottom) {
      // Back at the very bottom: disarm the pill and resume live pinning.
      setShowJump(false);
      setPendingCount(0);
      return;
    }
    // The pill answers one question: is the newest message still on screen?
    // Direction is irrelevant — an explicit locate to an older step, a wheel
    // down past the tail and a wheel up past it all arrive at the same state.
    // Measuring the step (not the scroll distance) keeps a tall live reply's
    // reader from being offered a jump away from the text they are reading.
    const scrollable = container.scrollHeight > container.clientHeight + 40;
    const hidden = stepRect ? latestStepHiddenOutside(viewport, stepRect) : 0;
    setShowJump(
      hidden > AGENT_SCROLL_HIDDEN_STEP_THRESHOLD && (live || scrollable),
    );
  }, [live, view.steps, onActiveEventChange]);

  // One stable registration callback for every card: an inline closure per
  // row would defeat the memo above on every render.
  const registerStep = useCallback(
    (stepId: string, element: HTMLElement | null) => {
      if (element) {
        stepRefs.current.set(stepId, element);
      } else {
        stepRefs.current.delete(stepId);
      }
    },
    [],
  );

  const handleScroll = useCallback(() => {
    if (scrollFrameRef.current !== null) {
      return;
    }
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      syncScrollState();
    });
  }, [syncScrollState]);

  useEffect(
    () => () => {
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
      }
    },
    [],
  );

  const targetStep = view.steps.find(
    (step) =>
      (step.kind === "reply" ? step.eventIds.includes(selectedEventId ?? "") : false) ||
      step.eventId === selectedEventId,
  );

  // Opening the overlay (or switching to another run's chain) must land on the
  // newest step, not the oldest line. `atBottomRef` starts optimistic, so
  // without a real scroll a long thread opens at the top while the view claims
  // to be at the bottom — new steps would then be appended below the fold and
  // the "no pill while at the bottom" rule would describe a position the reader
  // never saw. Pin before paint so the first frame already shows the tail.
  useLayoutEffect(() => {
    if (initializedChainRef.current === chainId) {
      return;
    }
    initializedChainRef.current = chainId;
    const container = scrollRef.current;
    if (container) {
      scrollToTop(container, container.scrollHeight);
    }
    atBottomRef.current = true;
    stepCountRef.current = view.steps.length;
    setShowJump(false);
    setPendingCount(0);
  }, [chainId, scrollToTop]);

  // New steps while reading history are counted, never inserted under the
  // reader's scroll position. At the bottom the view stays pinned to the end.
  // A shorter chain (replay cursor back, a prefix break folding snapshots
  // into fewer steps) invalidates the count: the pill must not keep offering
  // "N new messages" that no longer exist.
  useLayoutEffect(() => {
    const count = view.steps.length;
    const previous = stepCountRef.current;
    stepCountRef.current = count;
    if (count < previous) {
      setPendingCount(0);
      return;
    }
    if (count === previous) {
      return;
    }
    if (atBottomRef.current) {
      const container = scrollRef.current;
      if (container) {
        scrollToTop(container, container.scrollHeight);
        // Reset synchronously instead of waiting for the scroll event's rAF:
        // the pill must never flash between the new step landing and the pin.
        syncScrollState();
      }
    } else {
      setPendingCount((current) => current + (count - previous));
    }
  }, [view.steps, scrollToTop, syncScrollState]);

  // Re-evaluate the affordance after the append pin above, never before it:
  // a newly appended step sits below the viewport until that pin runs, so a
  // layout read here first would flip `atBottomRef` to false and turn a live
  // follow into a "N new messages" pill on every streamed batch. The run can
  // also finish while the reader is up the chain; this covers that case too.
  // The append pin above is a layout effect too: re-reading the position in a
  // passive effect let one frame paint the new step below the fold with the
  // pill already armed. Now the pin and this check commit before paint.
  useLayoutEffect(() => {
    syncScrollState();
  }, [live, syncScrollState]);

  useEffect(() => {
    if (!selectedEventId || !targetStep) {
      return;
    }
    const explicit = locateRequest !== lastLocateRef.current;
    lastLocateRef.current = locateRequest;
    // Live follow advances the selection on every event. An explicit pick
    // always locates; a follow advance must not steal a reader who scrolled
    // back through the chain.
    if (!explicit && !atBottomRef.current) {
      return;
    }
    const container = scrollRef.current;
    const element = stepRefs.current.get(targetStep.id);
    if (!container) {
      return;
    }
    // Locating the *newest* step is the same as jumping to the bottom: the
    // reader wants the tail on screen, and pinning the step's top 12px down
    // would leave a blank gap under it while the run keeps appending. Scroll
    // to the absolute bottom instead so the newest message lands flush with
    // the bottom edge and live follow can resume from there.
    const isLastStep =
      view.steps.length > 0 && view.steps.at(-1)?.id === targetStep.id;
    if (isLastStep || !element) {
      scrollToTop(container, container.scrollHeight, explicit);
      atBottomRef.current = true;
      if (!explicit) {
        syncScrollState();
      }
      return;
    }
    // An older step: align its top near the container top so the reader sees
    // it in context. An explicit pick animates; a live follow stays instant so
    // a running message's re-renders cannot interrupt the scroll.
    const top =
      element.getBoundingClientRect().top -
      container.getBoundingClientRect().top +
      container.scrollTop;
    scrollToTop(container, Math.max(0, top - 12), explicit);
    atBottomRef.current = false;
    if (!explicit) {
      syncScrollState();
    }
  }, [
    selectedEventId,
    targetStep?.id,
    view.steps.length,
    locateRequest,
    scrollToTop,
    syncScrollState,
  ]);

  const jumpToLatest = useCallback(() => {
    const container = scrollRef.current;
    if (!container) {
      return;
    }
    scrollToTop(container, container.scrollHeight);
    atBottomRef.current = true;
    setShowJump(false);
    setPendingCount(0);
  }, [scrollToTop]);

  // Header stat chips double as jump affordances: hovering names the steps
  // behind the count, clicking lands on the first of them. Derived from the
  // one projection — no second classification of the step kinds.
  const statGroups = useMemo(() => {
    const groups: Record<
      "thinking" | "reply" | "question" | "event",
      readonly AgentStep[]
    > = {
      thinking: view.steps.filter((step) => step.kind === "thinking"),
      reply: view.steps.filter((step) => step.kind === "reply"),
      question: view.steps.filter((step) => step.kind === "question"),
      event: view.steps.filter((step) => step.kind === "event"),
    };
    const turnSteps = [...view.steps].sort(
      (left, right) => left.turn - right.turn,
    );
    return { ...groups, turn: turnSteps };
  }, [view.steps]);
  const [openStat, setOpenStat] = useState<string | null>(null);
  // One close timer for every chip: a per-instance timer cannot be cancelled
  // by the chip the pointer moved onto, and DOM fires pointerenter(next)
  // before pointerleave(previous) — the previous chip's timer then closed the
  // card the next chip had just opened (the flash-then-dead hover). Opening
  // any chip cancels the shared timer; leaving schedules it again, so the
  // 140ms gap stays reachable but can never close a newer card.
  const statCloseTimerRef = useRef<number | null>(null);
  const openStatChip = useCallback((name: string) => {
    if (statCloseTimerRef.current !== null) {
      window.clearTimeout(statCloseTimerRef.current);
      statCloseTimerRef.current = null;
    }
    setOpenStat(name);
  }, []);
  const scheduleStatChipClose = useCallback(() => {
    if (statCloseTimerRef.current !== null) {
      window.clearTimeout(statCloseTimerRef.current);
    }
    statCloseTimerRef.current = window.setTimeout(() => {
      statCloseTimerRef.current = null;
      setOpenStat(null);
    }, 140);
  }, []);
  useEffect(
    () => () => {
      if (statCloseTimerRef.current !== null) {
        window.clearTimeout(statCloseTimerRef.current);
      }
    },
    [],
  );

  return (
    <div className="agent-transcript">
      <div className="agent-transcript__head">
        <span className="agent-transcript__view-label">AGENT VIEW</span>
        {runDurationMs !== null ? (
          <RunClockChip
            durationMs={runDurationMs}
            live={live}
            state={runState}
          />
        ) : null}
        <StatChip
          icon={<Lightbulb aria-hidden="true" className="agent-transcript__stat-icon" />}
          name="thinking"
          label={`${view.stats.thinking} 思考`}
          steps={statGroups.thinking}
          open={openStat === "thinking"}
          onOpen={openStatChip}
          onLeave={scheduleStatChipClose}
          onJump={onSelectEvent}
        />
        <StatChip
          icon={<MessageSquare aria-hidden="true" className="agent-transcript__stat-icon" />}
          name="reply"
          label={`${view.stats.replies} 回复`}
          steps={statGroups.reply}
          open={openStat === "reply"}
          onOpen={openStatChip}
          onLeave={scheduleStatChipClose}
          onJump={onSelectEvent}
        />
        <StatChip
          icon={<HelpCircle aria-hidden="true" className="agent-transcript__stat-icon" />}
          name="question"
          label={`${view.stats.questions} 提问`}
          steps={statGroups.question}
          open={openStat === "question"}
          onOpen={openStatChip}
          onLeave={scheduleStatChipClose}
          onJump={onSelectEvent}
        />
        <StatChip
          icon={<Repeat aria-hidden="true" className="agent-transcript__stat-icon" />}
          name="turn"
          label={`${view.stats.turns} 轮`}
          steps={statGroups.turn}
          open={openStat === "turn"}
          onOpen={openStatChip}
          onLeave={scheduleStatChipClose}
          onJump={onSelectEvent}
        />
        <StatChip
          icon={<Activity aria-hidden="true" className="agent-transcript__stat-icon" />}
          name="event"
          label={`${view.stats.events} 事件`}
          steps={statGroups.event}
          open={openStat === "event"}
          onOpen={openStatChip}
          onLeave={scheduleStatChipClose}
          onJump={onSelectEvent}
        />
        {view.stats.snapshotsMerged > 0 ? (
          <span className="agent-transcript__stat is-merged">
            <Layers aria-hidden="true" className="agent-transcript__stat-icon" />
            <span className="agent-transcript__stat-text">
              {view.stats.snapshotsMerged} 个流式快照已合并
            </span>
          </span>
        ) : null}
      </div>
      {view.diagnostics.length ? (
        <div className="agent-transcript__diagnostics" role="status">
          {view.diagnostics.map((diagnostic) => (
            <p key={diagnostic.id}>
              <AlertCircle aria-hidden="true" />
              {diagnostic.message}
            </p>
          ))}
        </div>
      ) : null}
      {/* The progress strip sits directly under the header — it reads as part
          of the view's chrome, not as a floating bar over the list's end. */}
      <ChainProgress
        scrollRef={scrollRef}
        stepRefs={stepRefs.current}
        steps={view.steps}
      />
      <div className="agent-transcript__surface">
        <div
          className="agent-transcript__scroll"
          onScroll={handleScroll}
          ref={scrollRef}
        >
          {view.steps.length ? (
            view.steps.map((step) => (
              <StepCard
                key={step.id}
                step={step}
                selected={step.id === targetStep?.id}
                apiBase={apiBase}
                onSelectEvent={onSelectEvent}
                onLocate={onSelectEvent}
                questionBinding={questionBinding}
                questionIsCurrent={step.kind === "question" && step.eventId === questionEventId}
                registerStep={registerStep}
              />
            ))
          ) : (
            <p className="payload-overlay__empty">这次运行还没有可呈现的事件。</p>
          )}
        </div>
        {live && !showJump ? (
          <div
            aria-live="polite"
            className="agent-transcript__pending"
            role="status"
          >
            <LoaderCircle aria-hidden="true" className="animate-spin" />
            <span>正在等待新消息…</span>
          </div>
        ) : null}
        {showJump ? (
          <button
            className={cn("agent-transcript__jump", !live && "is-settled")}
            onClick={jumpToLatest}
            type="button"
          >
            {live ? (
              <>
                <LoaderCircle aria-hidden="true" className="animate-spin" />
                <span>
                  {pendingCount > 0
                    ? `回到最新 · ${pendingCount} 条新消息`
                    : "回到最新消息"}
                </span>
                <ArrowDown aria-hidden="true" />
              </>
            ) : (
              <>
                <ChevronsDown aria-hidden="true" />
                <span>快速滚动到底部</span>
              </>
            )}
          </button>
        ) : null}
      </div>
    </div>
  );
}

const StepCard = memo(function StepCard({
  step,
  selected,
  apiBase,
  onSelectEvent,
  onLocate,
  questionBinding,
  questionIsCurrent,
  registerStep,
}: {
  step: AgentStep;
  selected: boolean;
  apiBase: string;
  onSelectEvent: (eventId: string) => void;
  onLocate: (eventId: string) => void;
  questionBinding: QuestionAnswerBinding | null;
  questionIsCurrent: boolean;
  registerStep: (stepId: string, element: HTMLElement | null) => void;
}) {
  const onSelect = () => onSelectEvent(step.eventId);
  const register = (element: HTMLElement | null) =>
    registerStep(step.id, element);
  const header = (() => {
    switch (step.kind) {
      case "thinking":
        return { icon: <Lightbulb aria-hidden="true" />, label: "THINKING", tool: null, meta: "推理摘要" };
      case "reply":
        return { icon: <MessageSquare aria-hidden="true" />, label: "REPLY", tool: null, meta: "助手回复" };
      case "tool-result":
        return {
          icon: <Bot aria-hidden="true" />,
          label: "TOOL.RESULT",
          tool: step.toolName,
          meta: step.eventName,
        };
      case "question":
        return {
          icon: <MessageSquare aria-hidden="true" />,
          label: "QUESTION",
          tool: null,
          meta: `${step.parsed.prompts.length || 1} 个问题`,
        };
      default:
        // A tool-call event (PreToolUse) reads as a TOOL.CALL step: the kind
        // is a badge, the tool name its own chip, the event name quiet meta —
        // the three reads the screenshot asks to tell apart at a glance.
        const toolCall = step.toolName ? "TOOL.CALL" : step.key.toUpperCase();
        return {
          icon: <Bot aria-hidden="true" />,
          label: toolCall,
          tool: step.toolName,
          meta: step.toolName ? step.eventName : "",
        };
    }
  })();

  // Pre / Post tool hooks share the `tool` tone but are different moments of
  // the same call. The step keeps its tone and gains a phase class so the
  // rail and the chain colour a call and its result the same way.
  const hookPhase = hookPhaseOf(
    "eventName" in step ? step.eventName : null,
  );

  return (
    <section
      className={cn(
        "agent-step",
        `agent-step--${step.kind}`,
        `tone-${step.tone}`,
        hookPhase && `hook-${hookPhase}`,
        selected && "is-selected",
      )}
      data-step-id={step.id}
      data-event-id={step.eventId}
      ref={register}
    >
      <div className="agent-step__head-row">
        <button
          className="agent-step__head"
          onClick={onSelect}
          aria-label={`定位到 LOG ${step.sequence}`}
          type="button"
        >
          {header.icon}
          <span className="agent-step__label">{header.label}</span>
          {header.tool ? (
            <span className="agent-step__tool">{header.tool}</span>
          ) : null}
          <span
            className={cn(
              "agent-step__meta",
              hookPhase && `agent-step__meta--hook is-${hookPhase}`,
            )}
          >
            {header.meta}
          </span>
          <span className="agent-step__code">{step.sequence}</span>
          <span className="agent-step__turn">T{step.turn}</span>
        </button>
        <span className="agent-step__head-badges">
          <StepStatusBadge
            durationMs={step.durationMs}
            label={`第 ${step.sequence} 行的耗时与状态`}
            sequence={step.sequence}
            status={step.status}
          />
          {step.kind === "tool-result" && step.pairLink ? (
            <PairLinkMarker link={step.pairLink} onLocate={onLocate} />
          ) : null}
        </span>
      </div>
      <div className="agent-step__body">
        {step.kind === "thinking" ? (
          <ThinkingBody step={step} />
        ) : step.kind === "reply" ? (
          <ReplyBody step={step} />
        ) : step.kind === "tool-result" ? (
          <ToolResultBody apiBase={apiBase} step={step} />
        ) : step.kind === "question" ? (
          <QuestionBody
            step={step}
            answer={questionIsCurrent ? questionBinding : null}
          />
        ) : (
          <GenericBody apiBase={apiBase} step={step} />
        )}
      </div>
    </section>
  );
}, stepCardPropsEqual);

/**
 * A long run renders every step, and reading it scrolls the pane: a scroll
 * frame changes the reading-line highlight, not the projection. Without this
 * comparison every card re-rendered on every frame — each one re-running its
 * header and Markdown decisions — which is what made scrolling a long Agent
 * message list feel heavy. `step` is the projection's own object (a new one
 * only when the view is rebuilt), and the question binding only matters to the
 * one card that is the current question.
 */
function stepCardPropsEqual(
  previous: {
    step: AgentStep;
    selected: boolean;
    onSelectEvent: (eventId: string) => void;
    registerStep: (stepId: string, element: HTMLElement | null) => void;
    questionBinding: QuestionAnswerBinding | null;
    questionIsCurrent: boolean;
  },
  next: {
    step: AgentStep;
    selected: boolean;
    onSelectEvent: (eventId: string) => void;
    registerStep: (stepId: string, element: HTMLElement | null) => void;
    questionBinding: QuestionAnswerBinding | null;
    questionIsCurrent: boolean;
  },
) {
  return (
    previous.step === next.step &&
    previous.selected === next.selected &&
    previous.onSelectEvent === next.onSelectEvent &&
    previous.registerStep === next.registerStep &&
    previous.questionIsCurrent === next.questionIsCurrent &&
    (previous.questionBinding === next.questionBinding ||
      !next.questionIsCurrent)
  );
}

/**
 * One expand/collapse affordance shared by every step body, so the reader can
 * fold any step down to its one-line content description (the same reading the
 * stat cards use) and unfold the full body. Mirrors the related-fields value
 * fold: collapsed shows a truncated description plus a 展开/收起 toggle;
 * expanded shows the body itself.
 */
function StepBodyCollapse({
  label,
  children,
}: {
  /** Toggle verb: 收起{label} / 展开{label}. */
  label: string;
  /** The expanded view: the body plus the step's apparatus. */
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(true);
  // Collapsed, the step shows only its toggle: the content itself appears on
  // expand, so a folded chain is a calm list of labels, not a wall of text.
  return (
    <>
      <button
        aria-expanded={expanded}
        className="agent-step__toggle"
        onClick={() => setExpanded((current) => !current)}
        type="button"
      >
        {expanded ? (
          <ChevronDown aria-hidden="true" />
        ) : (
          <ChevronRight aria-hidden="true" />
        )}
        {expanded ? `收起${label}` : `展开${label}`}
      </button>
      {expanded ? children : null}
    </>
  );
}

function ThinkingBody({ step }: { step: ThinkingStep }) {
  // The captured thinking is the point of this block: it opens expanded, but
  // the shared toggle lets the reader fold it down to its one-line content
  // description like any other step. Inline image resources render as images.
  const source = useMemo(
    () => markdownWithEmbeddedImages(contentToMarkdown(step.text)),
    [step.text],
  );
  return (
    <StepBodyCollapse label="推理">
      <MarkdownView source={source} />
    </StepBodyCollapse>
  );
}

function ReplyBody({ step }: { step: ReplyStep }) {
  const source = useMemo(
    () => markdownWithEmbeddedImages(contentToMarkdown(step.text)),
    [step.text],
  );
  return (
    <StepBodyCollapse label="回复">
      {step.snapshotCount > 0 ? (
        <p className="agent-step__badge">
          {step.snapshotCount} 个流式快照已合并
        </p>
      ) : null}
      <MarkdownView source={source} fallback="这条消息没有正文。" />
    </StepBodyCollapse>
  );
}

function ToolResultBody({
  apiBase,
  step,
}: {
  apiBase: string;
  step: ToolResultStep;
}) {
  // A result that closes a user-question tool shows its recorded answers in
  // the shared answer-rows rendering (highlighted option chips, Markdown
  // free text) instead of the generic JSON body.
  const hasAnswers = step.answers.length > 0;
  const split = useMemo(() => splitPayloadPreview(step.payload), [step.payload]);
  // The shell command is already shown by the CallBlock frame, and the
  // related-fields pane already labels the client identity — so the body dump
  // runs over a display copy that drops the command leaves (when a call
  // carries one) and the top-level client / version, while the captured event
  // stays immutable. The description and the real result still read.
  const bodyPayload = useMemo(
    () => bodyPayloadOf(step.payload, Boolean(step.inputs?.command)),
    [step.inputs?.command, step.payload],
  );
  // A shell call's captured stdout renders in the call frame's terminal
  // block; when it is there the body must not dump the same text a second
  // time (the `split.content` for a bash result is that very output).
  const shellOutput = useMemo(
    () =>
      step.inputs?.command ? shellOutputOf(step.payload) : null,
    [step.inputs?.command, step.payload],
  );
  const listPayload = hasListPayload(step.payload);
  // A top-level array payload renders as item blocks — one bordered record
  // per entry, code fenced inside — not as a markdown wall. The blocks read
  // the display copy (the command's leaves are already in the call block).
  const arrayItems = useMemo(() => {
    if (!listPayload || hasAnswers || shellOutput) {
      return null;
    }
    const candidate = bodyPayload;
    if (Array.isArray(candidate) && candidate.length) {
      return candidate;
    }
    // A tool result wraps its array one level down (`toolResponse.content`);
    // reading only the root found nothing and printed the record as fields.
    return findFirstListPayload(candidate);
  }, [bodyPayload, hasAnswers, listPayload, shellOutput]);
  const source = useMemo(
    () => {
      const raw =
        hasAnswers || shellOutput
          ? ""
          : listPayload
            ? ""
            : split.content.trim()
              ? contentToMarkdown(split.content, findPayloadFilePath(step.payload))
              : payloadToMarkdown(bodyPayload);
      // Inline image resources in the result render as images, not base64 walls.
      return markdownWithEmbeddedImages(raw, step.payload);
    },
    [
      hasAnswers,
      shellOutput,
      listPayload,
      split.content,
      bodyPayload,
      step.payload,
    ],
  );
  // The one structured extractor drives the call block: a captured shell
  // command is a terminal line, every other tool is a list of named inputs —
  // never a flattened `field=value` string.
  return (
    <StepBodyCollapse label="结果">
      {step.inputs ? (
        <CallBlock inputs={step.inputs} output={shellOutput} />
      ) : null}
      {hasAnswers ? (
        <div className="agent-step__answers">
          <span className="agent-step__answers-label">ANSWERS</span>
          <AnswerRows questions={step.answerQuestions} rows={step.answers} />
        </div>
      ) : arrayItems ? (
        <PayloadItemBlocks apiBase={apiBase} items={arrayItems} />
      ) : source.trim() ? (
        <MarkdownView source={source} />
      ) : null}
      <StepRelated payload={step.payload} resetToken={step.id} />
    </StepBodyCollapse>
  );
}

function QuestionBody({
  step,
  answer,
}: {
  step: QuestionStep;
  answer: QuestionAnswerBinding | null;
}) {
  return answer ? (
    <QuestionContent payload={step.payload} answer={answer} />
  ) : (
    <QuestionPreview answers={step.answers} payload={step.payload} />
  );
}

function GenericBody({ apiBase, step }: { apiBase: string; step: GenericStep }) {
  const source = useMemo(
    () => markdownWithEmbeddedImages(contentToMarkdown(step.summary), step.payload),
    [step.summary, step.payload],
  );
  // A tool-call event opens with its structured invocation so the reader sees
  // what ran before the related-fields dump. The CallBlock frame already shows
  // the tool name in its bar and the command / fields in its body, so the
  // bare summary ("Bash") underneath it is pure duplication — drop it whenever
  // a call frame is present and keep the summary line only for the plain
  // (non-tool) events where it is the whole body.
  const inputs = step.inputs;
  return (
    <StepBodyCollapse label="内容">
      {inputs ? <CallBlock inputs={inputs} /> : null}
      {inputs ? null : <MarkdownView source={source} />}
      <StepRelated payload={step.payload} resetToken={step.id} />
    </StepBodyCollapse>
  );
}

function StepRelated({
  payload,
  resetToken,
}: {
  payload: unknown;
  resetToken: string;
}) {
  const fields = useMemo(
    () => orderRelated(collectPayloadFields(payload)),
    [payload],
  );
  if (!fields.length) {
    return null;
  }
  return (
    <details className="agent-step__related">
      <summary>相关字段 · {fields.length}</summary>
      <RelatedFields fields={fields} resetToken={resetToken} />
    </details>
  );
}
