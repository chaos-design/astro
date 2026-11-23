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
import { PairLinkMarker } from "@/components/pair-link-marker";
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
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stepRefs = useRef(new Map<string, HTMLElement>());
  const atBottomRef = useRef(true);
  const stepCountRef = useRef(view.steps.length);
  const chainId = view.steps[0]?.id ?? "";
  const initializedChainRef = useRef<string | null>(null);
  const lastLocateRef = useRef(locateRequest);
  const scrollFrameRef = useRef<number | null>(null);
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
    // "At the newest" is not the same as "at the bottom": a tall last reply
    // can still be on screen well above the bottom edge. Keep following and
    // hide the pill whenever that newest step is visible, so a reader looking
    // at the latest message is never offered a button to jump to it.
    const lastStep = view.steps.at(-1);
    const lastElement = lastStep ? stepRefs.current.get(lastStep.id) : null;
    const latestVisible = lastElement
      ? isLatestStepVisible(
          container.getBoundingClientRect(),
          lastElement.getBoundingClientRect(),
        )
      : true;
    const atBottom =
      isAgentTranscriptAtBottom(container) || latestVisible;
    atBottomRef.current = atBottom;
    if (atBottom) {
      // At the newest step: disarm the pill and resume live pinning. The
      // bottom loading row owns the "still executing" read on its own.
      setShowJump(false);
      setPendingCount(0);
      return;
    }
    // The newest step has scrolled out of view. A live run keeps its loading
    // state in the centered pill (with the pending-step count); a finished
    // run has nothing to follow, so the same spot becomes a plain
    // quick-scroll button — and only when the chain actually overflows.
    const scrollable = container.scrollHeight > container.clientHeight + 40;
    setShowJump(live || scrollable);
  }, [live, view.steps]);

  const handleScroll = useCallback(() => {
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
    if (!container || !element) {
      return;
    }
    // Instant positioning: smooth scrolling is interrupted by the re-renders
    // that keep arriving while a live run appends events.
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

  return (
    <div className="agent-transcript">
      <div className="agent-transcript__head">
        <Bot aria-hidden="true" />
        <span>AGENT VIEW</span>
        <span className="agent-transcript__stat">{view.stats.thinking} 思考</span>
        <span className="agent-transcript__stat">{view.stats.replies} 回复</span>
        <span className="agent-transcript__stat">{view.stats.questions} 提问</span>
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
        return { icon: <Lightbulb aria-hidden="true" />, label: "THINKING", meta: "推理摘要" };
      case "reply":
        return { icon: <MessageSquare aria-hidden="true" />, label: "REPLY", meta: "助手回复" };
      case "tool-result":
        return { icon: <Bot aria-hidden="true" />, label: "TOOL RESULT", meta: step.toolName || step.eventName };
      case "question":
        return { icon: <MessageSquare aria-hidden="true" />, label: "QUESTION", meta: `${step.parsed.prompts.length || 1} 个问题` };
      default:
        return { icon: <Bot aria-hidden="true" />, label: step.key.toUpperCase(), meta: step.eventName };
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
      <button
        className="agent-step__head"
        onClick={onSelect}
        title={`定位到 LOG ${step.sequence}`}
        type="button"
      >
        {header.icon}
        <span className="agent-step__label">{header.label}</span>
        <span className="agent-step__meta">{header.meta}</span>
        <span className="agent-step__code">{step.sequence}</span>
        <span className="agent-step__turn">T{step.turn}</span>
      </button>
      <div className="agent-step__body">
        {step.kind === "thinking" ? (
          <ThinkingBody step={step} />
        ) : step.kind === "reply" ? (
          <ReplyBody step={step} />
        ) : step.kind === "tool-result" ? (
          <ToolResultBody step={step} onLocate={onLocate} />
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

function ToolResultBody({
  step,
  onLocate,
}: {
  step: ToolResultStep;
  onLocate: (eventId: string) => void;
}) {
  const split = useMemo(() => splitPayloadPreview(step.payload), [step.payload]);
  const source = split.content.trim()
    ? contentToMarkdown(split.content)
    : payloadToMarkdown(step.payload);
  return (
    <>
      <div className="agent-step__toolbar">
        {step.durationMs !== null ? (
          <span className="atomic-log__duration">{formatDurationMs(step.durationMs)}</span>
        ) : null}
        {step.pairLink ? (
          <PairLinkMarker link={step.pairLink} onLocate={onLocate} />
        ) : null}
      </div>
      {step.command ? (
        <div className="agent-step__command">
          <span className="agent-step__command-label">COMMAND</span>
          <MarkdownView source={contentToMarkdown(step.command)} />
        </div>
      ) : null}
      {source.trim() ? (
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
    <QuestionPreview payload={step.payload} />
  );
}

function GenericBody({ step }: { step: GenericStep }) {
  const source = useMemo(() => contentToMarkdown(step.summary), [step.summary]);
  return (
    <>
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
