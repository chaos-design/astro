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
  AGENT_SCROLL_JUMP_THRESHOLD,
  isAgentTranscriptAtBottom,
  isLatestStepVisible,
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
  hasListPayload,
  inferCodeLanguage,
  orderRelated,
  splitPayloadPreview,
} from "@/lib/payload-preview";
import { payloadToMarkdown } from "@/lib/payload-markdown";
import { markdownWithEmbeddedImages } from "@/lib/embedded-image";
import { hookPhaseOf } from "@/lib/trace-event-kind";
import { findPayloadFilePath } from "@/lib/numbered-code";
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
 * A field whose value is an image is read as one: `image_url` / `image_path`
 * (and the OpenAI-style `input_image`) name the image an agent looked at, so
 * a raw path or data-URL should render as the image — a thumbnail when the
 * source is loadable, a labelled chip when it is a local path the browser
 * cannot open. Only these keys count, so an ordinary `url` / `path` field
 * that happens to hold text keeps its plain rendering.
 */
const IMAGE_FIELD_KEYS = new Set([
  "image_url", "imageUrl", "image_path", "imagePath",
  "input_image", "image", "img",
]);
const IMAGE_SOURCE_EXT = /\.(png|jpe?g|gif|webp|avif|bmp|svg)([?#]|$)/i;

function imageFieldKind(key: string, value: string): "remote" | "data" | "local" | null {
  if (!IMAGE_FIELD_KEYS.has(key)) {
    return null;
  }
  if (value.startsWith("data:image/")) {
    return "data";
  }
  if (/^https?:\/\//i.test(value)) {
    return "remote";
  }
  // A bare path (or any value naming an image file) is a local capture the
  // console cannot load into an <img>; it still renders as a distinct chip.
  if (IMAGE_SOURCE_EXT.test(value) || /[\\/][^\\/]+\.[a-z]{2,4}$/.test(value)) {
    return "local";
  }
  return null;
}

function CallFieldValue({ field }: { field: ToolInputField }) {
  const kind = imageFieldKind(field.key, field.value);
  if (kind === "remote" || kind === "data") {
    return (
      <span className="agent-step__call-image">
        <img
          alt={field.value}
          className="agent-step__call-image__thumb"
          loading="lazy"
          referrerPolicy="no-referrer"
          src={field.value}
        />
        <code className="agent-step__call-image__src" title={field.value}>
          {field.value}
        </code>
      </span>
    );
  }
  if (kind === "local") {
    const base = field.value.split(/[\\/]/).pop() || field.value;
    return (
      <span className="agent-step__call-image agent-step__call-image--local">
        <span aria-hidden="true" className="agent-step__call-image__glyph">
          🖼
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
  onOpenChange,
  onJump,
}: {
  name: string;
  label: string;
  /** A small leading glyph so the count reads as an icon-tagged stat, not a
   * bare number. Rendered inside the button, before the label text. */
  icon: ReactNode;
  steps: readonly AgentStep[];
  open: boolean;
  onOpenChange: (name: string | null) => void;
  onJump: (eventId: string) => void;
}) {
  // Closing on hover-out is delayed a beat so a pointer travelling down into
  // the card across the gap still lands on a row — otherwise a one-item list
  // (card title + a single row) is too small to reach before the card closes.
  const closeTimer = useRef<number | null>(null);
  const cancelClose = () => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  useEffect(() => () => cancelClose(), []);
  return (
    <span
      className={cn("agent-transcript__stat-wrap", open && "is-open")}
      onPointerEnter={() => {
        cancelClose();
        onOpenChange(name);
      }}
      onPointerLeave={(event) => {
        cancelClose();
        // DOM fires `pointerenter(next)` *before* `pointerleave(previous)`,
        // so moving from one chip onto another opened the next card and this
        // leave then scheduled a close that fired 140ms later — the new card
        // flashed and, with the pointer at rest, never came back. A leave
        // whose pointer landed on any stat chip (or inside the open card)
        // hands ownership over instead of scheduling a close.
        const next = event.relatedTarget;
        if (
          next instanceof Element &&
          next.closest(".agent-transcript__stat-wrap")
        ) {
          return;
        }
        closeTimer.current = window.setTimeout(() => onOpenChange(null), 140);
      }}
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
 * The main message's accumulated execution clock. Hovering it states the
 * message's own status and, when it did not complete normally, the cause —
 * the one place a reader can learn that a run "terminated because it timed
 * out" instead of guessing from a grey badge.
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
  const status = state?.status ?? null;
  const statusWord = status ? runStatusLabels[status] : null;
  const reasonText = state?.reason
    ? runTerminalReasonDescriptions[state.reason]
    : status === "waiting"
      ? "等待：宿主在等待输入或限流，计时仍在推进"
      : status === "complete"
        ? null
        : live
          ? "执行中：仍在接收事件，计时每秒推进"
          : status
            ? "异常：宿主报告了非正常结束，未附带更具体的原因"
            : null;
  // CSS-hover driven like the step badges: a live run re-renders every second,
  // and a stateful hover card would flash off on each of those renders.
  return (
    <span className="agent-transcript__stat-wrap">
      <span
        aria-label="本条消息的累计执行时间与状态"
        className={cn(
          "agent-transcript__stat",
          "agent-transcript__duration",
          live && "is-live",
          status && status !== "active" && `is-${status}`,
        )}
        tabIndex={0}
      >
        <Timer aria-hidden="true" className="agent-transcript__stat-icon" />
        <span
          className={cn(
            "agent-transcript__stat-text",
            !live &&
              (!status || status === "complete") &&
              `heat-${durationHeatClass(durationMs)}`,
          )}
        >
          执行 {formatExecutionClock(durationMs)}
        </span>
      </span>
      <span className="agent-transcript__stat-card" role="tooltip">
        <span className="agent-transcript__stat-card-title">
          本条消息 · {statusWord ?? "执行中"}
        </span>
        {reasonText ? (
          <span className="agent-transcript__status-reason">{reasonText}</span>
        ) : null}
        {state?.detail ? (
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
          <span
            className={cn(
              "atomic-log__duration",
              `heat-${durationHeatClass(durationMs)}`,
            )}
          >
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
  const [ticks, setTicks] = useState<ProgressTick[]>([]);

  const measure = useCallback(() => {
    const container = scrollRef.current;
    if (!container) {
      return;
    }
    const range = container.scrollHeight - container.clientHeight;
    if (fillRef.current) {
      fillRef.current.style.width =
        range <= 4 ? "100%" : `${Math.min(100, Math.max(0, (container.scrollTop / range) * 100))}%`;
    }
    if (range <= 4) {
      // Everything is on screen: no ticks to place.
      setTicks((previous) => (previous.length ? [] : previous));
      return;
    }
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
    setTicks((previous) => (sameTicks(previous, next) ? previous : next));
  }, [scrollRef, steps, stepRefs]);

  // Scroll drives the fill on its own rAF budget; a resize of the container
  // (panel drag, viewport change) re-measures the ticks.
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) {
      return;
    }
    measure();
    const onScroll = () => {
      if (frameRef.current !== null) {
        return;
      }
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = null;
        measure();
      });
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    const observer = new ResizeObserver(onScroll);
    observer.observe(container);
    return () => {
      container.removeEventListener("scroll", onScroll);
      observer.disconnect();
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [measure, scrollRef]);

  if (!ticks.length) {
    return null;
  }
  return (
    <div aria-hidden="false" className="agent-transcript__progress">
      <div className="agent-transcript__progress-track">
        <div className="agent-transcript__progress-fill" ref={fillRef} />
        {ticks.map((tick) => (
          <button
            aria-label={`跳到第 ${tick.turn} 轮（${tick.count} 步，从第 ${tick.sequence} 行开始）`}
            className="agent-transcript__progress-tick"
            key={tick.turn}
            onClick={() => {
              const element = stepRefs.get(tick.firstStepId);
              element?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
            style={{ left: `${tick.ratio * 100}%` }}
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
  // The centered pill follows an *upward gesture*, not merely "newest step
  // out of view": the reader speaks with the wheel, so only a real scroll-up
  // offers the jump. Programmatic pin / locate still update the baseline
  // through the scroll event, but never arm the pill on their own.
  const lastScrollTopRef = useRef(0);
  const scrolledUpRef = useRef(false);
  const [showJump, setShowJump] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  // The last event reported as the reading line. Comparing before calling
  // keeps the parent's rail highlight stable across the app's one-second
  // ticks and across every scroll frame within the same step.
  const reportedActiveRef = useRef<string | null>(null);

  // Programmatic positioning: the centered affordance is derived from whether
  // the newest step is still on screen, so a programmatic scroll (pin, locate,
  // jump) can never masquerade as a manual one — there is no gesture state to
  // get wrong.
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
    // Live pinning keeps following while the newest step is visible, even if
    // the scroll position sits above the bottom edge (a tall last reply).
    const lastStep = view.steps.at(-1);
    const lastElement = lastStep ? stepRefs.current.get(lastStep.id) : null;
    const latestVisible = lastElement
      ? isLatestStepVisible(
          container.getBoundingClientRect(),
          lastElement.getBoundingClientRect(),
        )
      : true;
    atBottomRef.current = absoluteBottom || latestVisible;
    if (absoluteBottom) {
      // Back at the very bottom: disarm the pill and resume live pinning.
      setShowJump(false);
      setPendingCount(0);
      scrolledUpRef.current = false;
      return;
    }
    // The pill offers itself by *position*, not only by the last gesture: the
    // reader is a little height above the bottom edge, so reading history is
    // plausible and the jump reads as available. A live run keeps its loading
    // state in the pill with the pending-step count; a finished run becomes a
    // plain quick-scroll button when the chain overflows.
    const scrollable = container.scrollHeight > container.clientHeight + 40;
    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    const scrolledUp = distanceFromBottom > AGENT_SCROLL_JUMP_THRESHOLD;
    // Reconcile the gesture latch with position: settling back within the
    // threshold of the bottom means the reader is no longer reading history,
    // so the show button tracks where the reader *is*, not where they *were*
    // — an earlier wheel-up no longer lingers after scrolling back down.
    if (!scrolledUp) {
      scrolledUpRef.current = false;
    }
    if (scrolledUpRef.current || scrolledUp) {
      setShowJump(live || scrollable);
    } else if (!latestVisible) {
      // Scrolled down but the newest step is still off screen (e.g. located
      // to an older step): keep a live loading read, but arming is on scroll-up.
      setShowJump(false);
    }
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
    const container = scrollRef.current;
    if (container) {
      const top = container.scrollTop;
      scrolledUpRef.current = top < lastScrollTopRef.current - 1;
      lastScrollTopRef.current = top;
    }
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
    scrolledUpRef.current = false;
    lastScrollTopRef.current = container?.scrollTop ?? 0;
    setShowJump(false);
    setPendingCount(0);
  }, [chainId, scrollToTop]);

  // New steps while reading history are counted, never inserted under the
  // reader's scroll position. At the bottom the view stays pinned to the end.
  // A shorter chain (replay cursor back, a prefix break folding snapshots
  // into fewer steps) invalidates the count: the pill must not keep offering
  // "N new messages" that no longer exist.
  useEffect(() => {
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
  useEffect(() => {
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
          onOpenChange={setOpenStat}
          onJump={onSelectEvent}
        />
        <StatChip
          icon={<MessageSquare aria-hidden="true" className="agent-transcript__stat-icon" />}
          name="reply"
          label={`${view.stats.replies} 回复`}
          steps={statGroups.reply}
          open={openStat === "reply"}
          onOpenChange={setOpenStat}
          onJump={onSelectEvent}
        />
        <StatChip
          icon={<HelpCircle aria-hidden="true" className="agent-transcript__stat-icon" />}
          name="question"
          label={`${view.stats.questions} 提问`}
          steps={statGroups.question}
          open={openStat === "question"}
          onOpenChange={setOpenStat}
          onJump={onSelectEvent}
        />
        <StatChip
          icon={<Repeat aria-hidden="true" className="agent-transcript__stat-icon" />}
          name="turn"
          label={`${view.stats.turns} 轮`}
          steps={statGroups.turn}
          open={openStat === "turn"}
          onOpenChange={setOpenStat}
          onJump={onSelectEvent}
        />
        <StatChip
          icon={<Activity aria-hidden="true" className="agent-transcript__stat-icon" />}
          name="event"
          label={`${view.stats.events} 事件`}
          steps={statGroups.event}
          open={openStat === "event"}
          onOpenChange={setOpenStat}
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
        <ChainProgress
          scrollRef={scrollRef}
          stepRefs={stepRefs.current}
          steps={view.steps}
        />
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
  onSelectEvent,
  onLocate,
  questionBinding,
  questionIsCurrent,
  registerStep,
}: {
  step: AgentStep;
  selected: boolean;
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
          <ToolResultBody step={step} />
        ) : step.kind === "question" ? (
          <QuestionBody
            step={step}
            answer={questionIsCurrent ? questionBinding : null}
          />
        ) : (
          <GenericBody step={step} />
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
  teaser,
  children,
}: {
  /** Toggle verb: 收起{label} / 展开{label}. */
  label: string;
  /** One-line content description shown while collapsed. */
  teaser: string;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(true);
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
      {expanded ? (
        children
      ) : (
        <p className="agent-step__teaser">{teaser || label}</p>
      )}
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
    <StepBodyCollapse label="推理" teaser={statCardRowHint(step)}>
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
    <StepBodyCollapse label="回复" teaser={statCardRowHint(step)}>
      {step.snapshotCount > 0 ? (
        <p className="agent-step__badge">
          {step.snapshotCount} 个流式快照已合并
        </p>
      ) : null}
      <MarkdownView source={source} fallback="这条消息没有正文。" />
    </StepBodyCollapse>
  );
}

function ToolResultBody({ step }: { step: ToolResultStep }) {
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
  const source = useMemo(
    () => {
      const raw =
        hasAnswers || shellOutput
          ? ""
          : listPayload
            ? payloadToMarkdown(step.payload)
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
    <StepBodyCollapse label="结果" teaser={statCardRowHint(step)}>
      {step.inputs ? (
        <CallBlock inputs={step.inputs} output={shellOutput} />
      ) : null}
      {hasAnswers ? (
        <div className="agent-step__answers">
          <span className="agent-step__answers-label">ANSWERS</span>
          <AnswerRows questions={step.answerQuestions} rows={step.answers} />
        </div>
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

function GenericBody({ step }: { step: GenericStep }) {
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
    <StepBodyCollapse label="内容" teaser={statCardRowHint(step)}>
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
