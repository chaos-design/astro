import { Check, ChevronDown, Send, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from "react";
import type { QuestionPanelMode } from "@/config/app-config";
import { Button } from "./ui/button";
import { QuestionPanelModeControl } from "./question-panel-mode-control";
import type {
  InteractionRequest,
  InteractionResult,
} from "../lib/interaction-contract";
import { QuestionResultList } from "./question-result";
import {
  buildQuestionAnswers,
  questionPanelSubmittable,
} from "../lib/question-panel-model";
import {
  interactionPanelStatus,
  isInteractionPanelReadOnly,
  optionDescription,
  optionLabels,
  resolveOptionClick,
  resolvePanelKey,
  type InteractionPanelStatus,
} from "../lib/interaction-panel-model";

export type { InteractionPanelStatus };

export interface InteractionPanelProps {
  request: InteractionRequest;
  /** question text -> selected labels, or one free-text value */
  selections?: Record<string, string[]>;
  result?: InteractionResult | null;
  /** Device that answered first; other devices render read-only. */
  lockedBy?: string | null;
  deviceId?: string;
  /** A POST is in flight; controls stay enabled but Submit is blocked. */
  pending?: boolean;
  /** One batch send of every question's answer, never one POST per option. */
  onSend?: (answers: Record<string, string>) => void;
  onCancel?: () => void;
  className?: string;
  /** Floating card only: bind number keys, Enter and Escape to the answers. */
  keyboard?: boolean;
  /** Shared placement preference of the floating card and the inspector. */
  mode?: QuestionPanelMode;
  onModeChange?: (mode: QuestionPanelMode) => void;
}

function statusLabel(status: InteractionPanelStatus): string {
  switch (status) {
    case "answered":
      return "ANSWERED";
    case "cancelled":
      return "CANCELLED";
    case "timeout":
      return "TIMED OUT";
    case "expired":
      return "EXPIRED";
    default:
      return "WAITING";
  }
}

function cloneSelections(
  selections: Record<string, string[]> | undefined,
): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(selections ?? {}).map(([question, labels]) => [
      question,
      [...labels],
    ]),
  );
}

/**
 * The console side of the interaction fast path: render the host's questions,
 * collect a selection per question, and submit a full answer map. It is a
 * presentational component — the reducer owns state and the app posts events —
 * so it can also render the closed result in the run log.
 *
 * Every option and free-text edit stays in local drafts until Submit. Earlier
 * versions posted a `select` / `text` event per click; a multi-question card
 * then looked like several independent answers and typed text needed a Set
 * button. The single Submit now sends the same one batch the inspector sends.
 */
export function InteractionPanel({
  request,
  selections = {},
  result = null,
  lockedBy = null,
  deviceId = "console",
  pending = false,
  onSend,
  onCancel,
  className,
  keyboard = false,
  mode = "dock-full",
  onModeChange,
}: InteractionPanelProps) {
  const [draftSelections, setDraftSelections] = useState(() =>
    cloneSelections(selections),
  );
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  // Collapsing only hides the body: the header stays as a one-line summary so
  // the card can get out of the canvas's way without losing the question. A
  // new request remounts the card (the app keys it by requestId) and expands.
  const [collapsed, setCollapsed] = useState(false);
  const status = interactionPanelStatus(result);
  const readOnly = isInteractionPanelReadOnly(status, lockedBy, deviceId);
  const answerMap = useMemo(
    () =>
      buildQuestionAnswers({
        questions: request.questions,
        selections: draftSelections,
        drafts,
      }),
    [drafts, draftSelections, request.questions],
  );
  const submittable = questionPanelSubmittable(request.questions, answerMap);
  const summary = collapsed
    ? request.questions[0]?.header || request.questions[0]?.question
    : null;
  const panelRef = useRef<HTMLElement | null>(null);
  const optionsRef = useRef<HTMLButtonElement | null>(null);
  // Drive the countdown from the host's own timestamps with one CSS animation
  // per request: a JS tick would stutter and a stale `now` state would show a
  // bar that no longer matches the hook's real window.
  const countdown = useMemo(() => {
    const created = Date.parse(request.createdAt);
    const age = Number.isFinite(created) ? Math.max(0, Date.now() - created) : 0;
    return {
      animationDelay: `-${Math.round(age)}ms`,
      animationDuration: `${request.ttlMs}ms`,
    } as CSSProperties;
  }, [request.createdAt, request.requestId, request.ttlMs]);

  // A newer snapshot from the service (another device, a settled answer)
  // replaces the local draft; until then the reader's clicks stay highlighted.
  useEffect(() => {
    setDraftSelections(cloneSelections(selections));
  }, [request.requestId, selections]);

  const submit = () => {
    if (readOnly || pending || !submittable) {
      return;
    }
    onSend?.(answerMap);
  };

  const toggleOption = (question: string, label: string) => {
    const descriptor = request.questions.find(
      (candidate) => candidate.question === question,
    );
    const multi = descriptor?.multiSelect === true;
    const labels = optionLabels(descriptor ?? { question, options: [] });
    const current = draftSelections[question] ?? [];
    const active = current.includes(label);
    const click = resolveOptionClick({ active, multiSelect: multi, readOnly });
    if (click === "none") {
      return;
    }
    const next = click === "deselect"
      ? current.filter((item) => item !== label)
      : multi
        ? [...current, label]
        : [label];
    setDraftSelections((previous) => ({
      ...previous,
      [question]: labels.filter((item) => next.includes(item)),
    }));
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (!keyboard || collapsed || status !== "open") {
      return;
    }
    // Modifier chords belong to the console (⌘K search); text fields own
    // their own keystrokes so "Other…" can contain digits and Enter submits
    // the batch from inside the field too.
    if (event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }
    const target = event.target;
    // Match by editability, not by a tag-name blacklist that drifts as new
    // controls appear: digits typed into the answer field must select nothing,
    // and Enter there submits only through the field's own handler.
    if (
      target instanceof HTMLElement &&
      (target.isContentEditable ||
        target.closest("input, textarea, select, [contenteditable]"))
    ) {
      return;
    }
    const action = resolvePanelKey({
      key: event.key,
      questions: request.questions,
      readOnly,
    });
    if (action.action === "none") {
      return;
    }
    if (action.action === "submit") {
      if (submittable && !pending) {
        event.preventDefault();
        submit();
      }
      return;
    }
    if (action.action === "cancel") {
      event.preventDefault();
      onCancel?.();
      return;
    }
    const question = request.questions[action.question];
    const label = question ? optionLabels(question)[action.option] : undefined;
    if (question && label) {
      event.preventDefault();
      toggleOption(question.question, label);
    }
  };

  // A new question must be answerable without a mouse: focus the first option
  // on mount (the app keys the card by requestId, so this runs once per
  // question). Keep the listener on the card instead of the document so an
  // open settings dialog or history search never receives these shortcuts.
  useEffect(() => {
    if (!keyboard || collapsed || status !== "open") {
      return;
    }
    (optionsRef.current || panelRef.current)?.focus({ preventScroll: true });
  }, [keyboard, collapsed, status, request.requestId]);

  return (
    <section
      aria-label="User question"
      ref={panelRef}
      tabIndex={keyboard ? -1 : undefined}
      onKeyDown={handleKeyDown}
      className={[
        "interaction-panel",
        collapsed ? "is-collapsed" : "",
        className || "",
      ]
        .filter(Boolean)
        .join(" ")}
      data-status={status}
      data-mode={mode}
    >
      {status === "open" && keyboard ? (
        <div
          aria-hidden="true"
          className="interaction-panel__countdown"
          style={countdown}
        />
      ) : null}
      <header className="interaction-panel__header">
        <span className="interaction-panel__eyebrow">USER QUESTION</span>
        {summary ? (
          <span className="interaction-panel__summary">{summary}</span>
        ) : null}
        {keyboard ? (
          // The shortcut legend sits in the header's open space (between the
          // summary and the status) instead of owning the footer's left half;
          // the long form lives in the title.
          <span
            className="interaction-panel__keys"
            title="数字键高亮第一个问题的选项，Enter 提交整批，Esc 取消"
          >
            <kbd>1</kbd>–<kbd>
              {request.questions[0]
                ? optionLabels(request.questions[0]).length
                : 0}
            </kbd>
            <span aria-hidden="true">·</span>
            <kbd>Enter</kbd>
            <span aria-hidden="true">·</span>
            <kbd>Esc</kbd>
          </span>
        ) : null}
        <span className="interaction-panel__status">{statusLabel(status)}</span>
        {lockedBy && lockedBy !== deviceId ? (
          <span className="interaction-panel__locked">answered on {lockedBy}</span>
        ) : null}
        {onModeChange ? (
          <QuestionPanelModeControl mode={mode} onChange={onModeChange} />
        ) : null}
        <button
          aria-expanded={!collapsed}
          aria-label={
            collapsed ? "Expand question panel" : "Collapse question panel"
          }
          className="interaction-panel__toggle"
          onClick={() => setCollapsed((current) => !current)}
          type="button"
        >
          <ChevronDown aria-hidden="true" />
        </button>
      </header>

      <div className="interaction-panel__body">
        <div className="interaction-panel__body-inner">
          {status === "open" ? (
            <div className="question-surface__summary">
              <span>{`${request.questions.length} 个问题 · 一次提交`}</span>
              {!submittable ? (
                <span className="question-surface__todo">还有必答题未填写</span>
              ) : null}
            </div>
          ) : null}
          {status === "open" ? (
            <div
              aria-label="Question content"
              className="interaction-panel__questions"
            >
              {request.questions.map((question, questionIndex) => {
                const selected = draftSelections[question.question] ?? [];
                return (
                  <article
                    className="interaction-panel__question"
                    key={`${question.question}-${questionIndex}`}
                  >
                    <div className="interaction-panel__question-heading">
                      <h3>{question.header || question.question}</h3>
                      {question.required !== false ? (
                        <span className="question-surface__required">必答</span>
                      ) : null}
                      {question.multiSelect ? (
                        <span className="question-surface__hint">可多选</span>
                      ) : null}
                    </div>
                    <p className="interaction-panel__prompt">
                      {question.question}
                    </p>
                    <div
                      aria-label={question.question}
                      className="question-options"
                      role="group"
                    >
                      {optionLabels(question).map((label, optionIndex) => {
                        const pressed = selected.includes(label);
                        const description = optionDescription(question, label);
                        return (
                          <button
                            ref={
                              question === request.questions[0] &&
                              optionIndex === 0
                                ? optionsRef
                                : undefined
                            }
                            aria-pressed={pressed}
                            className="question-options__option"
                            disabled={readOnly || pending}
                            key={`${label}-${optionIndex}`}
                            onClick={() =>
                              toggleOption(question.question, label)
                            }
                            type="button"
                          >
                            {pressed ? <Check aria-hidden="true" /> : null}
                            <span className="question-options__label">{label}</span>
                            {description ? (
                              <small className="question-options__description">
                                {description}
                              </small>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>

                    <div className="interaction-panel__text">
                      <input
                        aria-label={`Answer for ${question.question}`}
                        disabled={readOnly || pending}
                        onChange={(event) =>
                          setDrafts((current) => ({
                            ...current,
                            [question.question]: event.target.value,
                          }))
                        }
                        onKeyDown={(event) => {
                          if (
                            event.key === "Enter" &&
                            !readOnly &&
                            !pending &&
                            submittable
                          ) {
                            event.preventDefault();
                            submit();
                          }
                        }}
                        placeholder="选择选项，或直接输入答案…"
                        type="text"
                        value={drafts[question.question] ?? ""}
                      />
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <QuestionResultList
              questions={request.questions}
              result={result}
            />
          )}

          {status === "open" ? (
            <footer className="interaction-panel__footer">
              <div className="interaction-panel__footer-actions">
                <Button
                  disabled={readOnly || pending || !submittable}
                  onClick={submit}
                  size="sm"
                  type="button"
                  variant="default"
                >
                  <Send aria-hidden="true" data-icon="inline-start" />
                  Submit
                </Button>
                <Button
                  disabled={readOnly || pending}
                  onClick={onCancel}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  <X aria-hidden="true" data-icon="inline-start" />
                  Cancel
                </Button>
                {pending ? (
                  <span className="interaction-panel__pending" role="status">
                    Sending…
                  </span>
                ) : null}
              </div>
            </footer>
          ) : null}
        </div>
      </div>
    </section>
  );
}
