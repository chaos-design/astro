import {
  AlertCircle,
  ArrowDown,
  Bot,
  ChevronDown,
  ChevronsDown,
  ChevronRight,
  Lightbulb,
  LoaderCircle,
  MessageSquare,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { MarkdownView } from "@/components/markdown-view";
import { AnswerRows } from "@/components/answer-rows";
import { PairLinkMarker } from "@/components/pair-link-marker";
import { PlatformIcon } from "@/components/platform-icon";
import { QuestionContent, QuestionPreview, type QuestionAnswerBinding } from "@/components/question-content";
import { RelatedFields } from "@/components/related-fields";
import {
  isAgentTranscriptAtBottom,
  isLatestStepVisible,
} from "@/lib/agent-transcript-scroll";
import { cn } from "@/lib/utils";
import type {
  AgentStep,
  AgentView,
  ReplyStep,
  ThinkingStep,
  ToolResultStep,
  QuestionStep,
  GenericStep,
} from "@/lib/agent-view";
import {
  collectPayloadFields,
  contentToMarkdown,
  orderRelated,
  splitPayloadPreview,
} from "@/lib/payload-preview";
import { payloadToMarkdown } from "@/lib/payload-markdown";
import { formatDurationMs } from "@/lib/duration-label";
import { formatDuration, type ToolCallInputs } from "@/lib/trace-model";
import { getAtomPlatformConfig } from "@/config/atom-platforms";
import type { PlatformId } from "@/types/trace";

function platformLabel(platform: PlatformId): string {
  return getAtomPlatformConfig(platform).label;
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
function CallBlock({ inputs }: { inputs: ToolCallInputs }) {
  if (inputs.command) {
    return (
      <div className="agent-step__call agent-step__call--shell">
        <div className="agent-step__call-bar" aria-hidden="true">
          <span className="agent-step__command-dots">
            <i />
            <i />
            <i />
          </span>
          <span className="agent-step__call-name">{inputs.toolName || "Bash"}</span>
          <span className="agent-step__command-label">COMMAND</span>
        </div>
        <div className="agent-step__command-line">
          <span className="agent-step__command-prompt" aria-hidden="true">
            $
          </span>
          <MarkdownView source={contentToMarkdown(inputs.command)} />
        </div>
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
              <dd>{field.value}</dd>
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
function StatChip({
  name,
  label,
  steps,
  open,
  onOpenChange,
  onJump,
}: {
  name: string;
  label: string;
  steps: readonly AgentStep[];
  open: boolean;
  onOpenChange: (name: string | null) => void;
  onJump: (eventId: string) => void;
}) {
  const preview = steps.slice(0, 12);
  return (
    <span
      className={cn("agent-transcript__stat-wrap", open && "is-open")}
      onMouseEnter={() => onOpenChange(name)}
      onMouseLeave={() => onOpenChange(null)}
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
        {label}
      </button>
      {open && steps.length ? (
        <span className="agent-transcript__stat-card" role="tooltip">
          <span className="agent-transcript__stat-card-title">{label}</span>
          {preview.map((step) => (
            <button
              className="agent-transcript__stat-card-row"
              key={step.id}
              onClick={() => onJump(step.eventId)}
              type="button"
            >
              <span>{step.sequence}</span>
              <span>{step.kind === "reply" ? "REPLY" : step.kind === "thinking" ? "THINKING" : step.kind === "question" ? "QUESTION" : step.kind === "tool-result" ? (step.toolName || step.eventName) : step.eventName}</span>
              <span>T{step.turn}</span>
            </button>
          ))}
          {steps.length > preview.length ? (
            <span className="agent-transcript__stat-card-more">
              还有 {steps.length - preview.length} 步
            </span>
          ) : null}
        </span>
      ) : null}
    </span>
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
  platform = "chatgpt",
  agentVersion = null,
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
  /** The agent that produced this run — shown with its brand icon in the head. */
  platform?: PlatformId;
  /** The source's captured client version, e.g. `5.11.3`. */
  agentVersion?: string | null;
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

  // Programmatic positioning: the centered affordance is derived from whether
  // the newest step is still on screen, so a programmatic scroll (pin, locate,
  // jump) can never masquerade as a manual one — there is no gesture state to
  // get wrong.
  const scrollToTop = useCallback((element: HTMLElement, top: number) => {
    element.scrollTop = top;
  }, []);

  // The scroll handler reads layout at most once per frame: a live stream can
  // append several events a second, but a wheel gesture must not turn every
  // event into a layout read plus a render.
  const syncScrollState = useCallback(() => {
    const container = scrollRef.current;
    if (!container) {
      return;
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
    // Between the bottom and the newest step being visible, an upward gesture
    // is the only thing that arms the jump — a programmatic scroll to an older
    // step must not offer it, matching the "scroll up" ask. A live run keeps
    // its loading state in the pill with the pending-step count; a finished
    // run becomes a plain quick-scroll button when the chain overflows.
    const scrollable = container.scrollHeight > container.clientHeight + 40;
    if (scrolledUpRef.current) {
      setShowJump(live || scrollable);
    } else if (!latestVisible) {
      // Scrolled down but the newest step is still off screen (e.g. located
      // to an older step): keep a live loading read, but arming is on scroll-up.
      setShowJump(false);
    }
  }, [live, view.steps]);

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

  // The run can finish while the reader is still up the chain; re-evaluate the
  // affordance without waiting for another scroll gesture.
  useEffect(() => {
    syncScrollState();
  }, [live, syncScrollState]);

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
  useEffect(() => {
    const count = view.steps.length;
    const previous = stepCountRef.current;
    stepCountRef.current = count;
    if (count <= previous) {
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
      scrollToTop(container, container.scrollHeight);
      atBottomRef.current = true;
      syncScrollState();
      return;
    }
    // An older step: align its top near the container top so the reader sees
    // it in context. Instant positioning: smooth scrolling is interrupted by
    // the re-renders that keep arriving while a live run appends events.
    const top =
      element.getBoundingClientRect().top -
      container.getBoundingClientRect().top +
      container.scrollTop;
    scrollToTop(container, Math.max(0, top - 12));
    syncScrollState();
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
        <PlatformIcon platform={platform} width={14} height={14} />
        <span className="agent-transcript__brand">{platformLabel(platform)}</span>
        {agentVersion ? (
          <span className="agent-transcript__version">{agentVersion}</span>
        ) : null}
        <span className="agent-transcript__view-label">AGENT VIEW</span>
        {runDurationMs !== null ? (
          <span
            className={cn(
              "agent-transcript__stat",
              "agent-transcript__duration",
              live && "is-live",
            )}
          >
            执行 {formatDuration(runDurationMs)}
          </span>
        ) : null}
        <StatChip
          name="thinking"
          label={`${view.stats.thinking} 思考`}
          steps={statGroups.thinking}
          open={openStat === "thinking"}
          onOpenChange={setOpenStat}
          onJump={onSelectEvent}
        />
        <StatChip
          name="reply"
          label={`${view.stats.replies} 回复`}
          steps={statGroups.reply}
          open={openStat === "reply"}
          onOpenChange={setOpenStat}
          onJump={onSelectEvent}
        />
        <StatChip
          name="question"
          label={`${view.stats.questions} 提问`}
          steps={statGroups.question}
          open={openStat === "question"}
          onOpenChange={setOpenStat}
          onJump={onSelectEvent}
        />
        <StatChip
          name="turn"
          label={`${view.stats.turns} 轮`}
          steps={statGroups.turn}
          open={openStat === "turn"}
          onOpenChange={setOpenStat}
          onJump={onSelectEvent}
        />
        <StatChip
          name="event"
          label={`${view.stats.events} 事件`}
          steps={statGroups.event}
          open={openStat === "event"}
          onOpenChange={setOpenStat}
          onJump={onSelectEvent}
        />
        {view.stats.snapshotsMerged > 0 ? (
          <span className="agent-transcript__stat is-merged">
            {view.stats.snapshotsMerged} 个流式快照已合并
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
                onSelect={() => onSelectEvent(step.eventId)}
                onLocate={onSelectEvent}
                questionBinding={questionBinding}
                questionIsCurrent={step.kind === "question" && step.eventId === questionEventId}
                register={(element) => {
                  if (element) {
                    stepRefs.current.set(step.id, element);
                  } else {
                    stepRefs.current.delete(step.id);
                  }
                }}
              />
            ))
          ) : (
            <p className="payload-overlay__empty">这次运行还没有可呈现的事件。</p>
          )}
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
        </div>
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

function StepCard({
  step,
  selected,
  onSelect,
  onLocate,
  questionBinding,
  questionIsCurrent,
  register,
}: {
  step: AgentStep;
  selected: boolean;
  onSelect: () => void;
  onLocate: (eventId: string) => void;
  questionBinding: QuestionAnswerBinding | null;
  questionIsCurrent: boolean;
  register: (element: HTMLElement | null) => void;
}) {
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

  return (
    <section
      className={cn(
        "agent-step",
        `agent-step--${step.kind}`,
        `tone-${step.tone}`,
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
          <span className="agent-step__meta">{header.meta}</span>
          <span className="agent-step__code">{step.sequence}</span>
          <span className="agent-step__turn">T{step.turn}</span>
        </button>
        {step.kind === "tool-result" ? (
          <span className="agent-step__head-badges">
            {step.durationMs !== null ? (
              <span className="atomic-log__duration">{formatDurationMs(step.durationMs)}</span>
            ) : null}
            {step.pairLink ? (
              <PairLinkMarker link={step.pairLink} onLocate={onLocate} />
            ) : null}
          </span>
        ) : null}
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
}

function ThinkingBody({ step }: { step: ThinkingStep }) {
  // The captured thinking is the point of this block: show it as soon as the
  // reader opens the view instead of hiding real content behind a disclosure.
  const [expanded, setExpanded] = useState(true);
  const source = useMemo(() => contentToMarkdown(step.text), [step.text]);
  return (
    <>
      <button
        aria-expanded={expanded}
        className="agent-step__toggle"
        onClick={() => setExpanded((current) => !current)}
        type="button"
      >
        {expanded ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
        {expanded ? "收起推理" : "展开推理"}
      </button>
      {expanded ? (
        <MarkdownView source={source} />
      ) : (
        <p className="agent-step__teaser">{step.text}</p>
      )}
    </>
  );
}

function ReplyBody({ step }: { step: ReplyStep }) {
  const source = useMemo(() => contentToMarkdown(step.text), [step.text]);
  return (
    <>
      {step.snapshotCount > 0 ? (
        <p className="agent-step__badge">{step.snapshotCount} 个流式快照已合并</p>
      ) : null}
      <MarkdownView source={source} fallback="这条消息没有正文。" />
    </>
  );
}

function ToolResultBody({ step }: { step: ToolResultStep }) {
  // A result that closes a user-question tool shows its recorded answers in
  // the shared answer-rows rendering (highlighted option chips, Markdown
  // free text) instead of the generic JSON body.
  const hasAnswers = step.answers.length > 0;
  const split = useMemo(() => splitPayloadPreview(step.payload), [step.payload]);
  const source = useMemo(
    () =>
      hasAnswers
        ? ""
        : split.content.trim()
          ? contentToMarkdown(split.content)
          : payloadToMarkdown(step.payload),
    [hasAnswers, split.content, step.payload],
  );
  // The one structured extractor drives the call block: a captured shell
  // command is a terminal line, every other tool is a list of named inputs —
  // never a flattened `field=value` string.
  return (
    <>
      {step.inputs ? <CallBlock inputs={step.inputs} /> : null}
      {hasAnswers ? (
        <div className="agent-step__answers">
          <span className="agent-step__answers-label">ANSWERS</span>
          <AnswerRows questions={step.answerQuestions} rows={step.answers} />
        </div>
      ) : source.trim() ? (
        <MarkdownView source={source} />
      ) : (
        <p className="agent-step__teaser">这条结果没有正文。</p>
      )}
      <StepRelated payload={step.payload} resetToken={step.id} />
    </>
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
  const source = useMemo(() => contentToMarkdown(step.summary), [step.summary]);
  // A tool-call event opens with its structured invocation so the reader sees
  // what ran before the summary and the related-fields dump.
  return (
    <>
      {step.inputs ? <CallBlock inputs={step.inputs} /> : null}
      <MarkdownView source={source} />
      <StepRelated payload={step.payload} resetToken={step.id} />
    </>
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
