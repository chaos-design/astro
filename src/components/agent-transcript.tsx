import {
  AlertCircle,
  ArrowDown,
  Bot,
  ChevronDown,
  ChevronRight,
  Lightbulb,
  LoaderCircle,
  MessageSquare,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { MarkdownView } from "@/components/markdown-view";
import { PairLinkMarker } from "@/components/pair-link-marker";
import { QuestionContent, QuestionPreview, type QuestionAnswerBinding } from "@/components/question-content";
import { RelatedFields } from "@/components/related-fields";
import { isAgentTranscriptAtBottom } from "@/lib/agent-transcript-scroll";
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
  const firstStepIdRef = useRef(view.steps[0]?.id ?? "");
  const lastLocateRef = useRef(locateRequest);
  const scrollFrameRef = useRef<number | null>(null);
  const [showJump, setShowJump] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);

  // The scroll handler reads layout at most once per frame: a live stream can
  // append several events a second, but a wheel gesture must not turn every
  // event into a layout read plus a render.
  const syncScrollState = useCallback(() => {
    const container = scrollRef.current;
    if (!container) {
      return;
    }
    const atBottom = isAgentTranscriptAtBottom(container);
    atBottomRef.current = atBottom;
    setShowJump(
      !atBottom && container.scrollHeight > container.clientHeight + 40,
    );
    if (atBottom) {
      setPendingCount(0);
    }
  }, []);

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

  // New steps while reading history are counted, never inserted under the
  // reader's scroll position. At the bottom the view stays pinned to the end.
  useEffect(() => {
    const firstStepId = view.steps[0]?.id ?? "";
    if (firstStepId !== firstStepIdRef.current) {
      // Switching runs replaces the chain: an old "N new steps" count would
      // describe a run the reader is no longer looking at.
      firstStepIdRef.current = firstStepId;
      atBottomRef.current = true;
      stepCountRef.current = view.steps.length;
      setShowJump(false);
      setPendingCount(0);
      return;
    }
    const count = view.steps.length;
    const previous = stepCountRef.current;
    stepCountRef.current = count;
    if (count <= previous) {
      return;
    }
    if (atBottomRef.current) {
      const container = scrollRef.current;
      if (container) {
        container.scrollTop = container.scrollHeight;
      }
    } else {
      setPendingCount((current) => current + (count - previous));
    }
  }, [view.steps]);

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
    container.scrollTop = Math.max(0, top - 12);
    syncScrollState();
  }, [selectedEventId, targetStep?.id, view.steps.length, locateRequest, syncScrollState]);

  const jumpToLatest = useCallback(() => {
    const container = scrollRef.current;
    if (!container) {
      return;
    }
    container.scrollTop = container.scrollHeight;
    atBottomRef.current = true;
    setShowJump(false);
    setPendingCount(0);
  }, []);

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
          {live ? (
            <div
              aria-live="polite"
              className="agent-transcript__pending"
              role="status"
            >
              <LoaderCircle aria-hidden="true" className="animate-spin" />
              <span>
                {pendingCount > 0
                  ? `正在等待 ${pendingCount} 条新消息…`
                  : "正在等待新消息…"}
              </span>
            </div>
          ) : null}
        </div>
        {showJump ? (
          <button
            className="agent-transcript__jump"
            onClick={jumpToLatest}
            type="button"
          >
            <LoaderCircle aria-hidden="true" className="animate-spin" />
            <span>
              {pendingCount > 0
                ? `回到最新 · ${pendingCount} 条新消息`
                : "回到最新消息"}
            </span>
            <ArrowDown aria-hidden="true" />
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
  const [expanded, setExpanded] = useState(false);
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
      {expanded ? <MarkdownView source={step.text} /> : <p className="agent-step__teaser">{step.text}</p>}
    </>
  );
}

function ReplyBody({ step }: { step: ReplyStep }) {
  return (
    <>
      {step.snapshotCount > 0 ? (
        <p className="agent-step__badge">{step.snapshotCount} 个流式快照已合并</p>
      ) : null}
      <MarkdownView source={step.text} fallback="这条消息没有正文。" />
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
      {source.trim() ? (
        <MarkdownView source={source} />
      ) : (
        <p className="agent-step__teaser">这条结果没有正文。</p>
      )}
      <StepRelated payload={step.payload} />
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
  return (
    <>
      <MarkdownView source={step.summary} />
      <StepRelated payload={step.payload} />
    </>
  );
}

function StepRelated({ payload }: { payload: unknown }) {
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
      <RelatedFields fields={fields} />
    </details>
  );
}
