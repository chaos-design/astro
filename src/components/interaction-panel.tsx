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
  /** Shared layout preference of the floating card and the inspector. */
  mode?: QuestionPanelMode;
  onModeChange?: (mode: QuestionPanelMode) => void;
  /** Upper/lower sections can be folded independently on both surfaces. */
  questionsCollapsed?: boolean;
  onToggleQuestions?: () => void;
  footerCollapsed?: boolean;
  onToggleFooter?: () => void;
  showSectionToggles?: boolean;
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
  mode = "dock-half",
  onModeChange,
  questionsCollapsed,
  onToggleQuestions,
  footerCollapsed,
  onToggleFooter,
  showSectionToggles = false,
}: InteractionPanelProps) {
  const [localQuestionsCollapsed, setLocalQuestionsCollapsed] = useState(false);
  const [localFooterCollapsed, setLocalFooterCollapsed] = useState(false);
  const questionsFolded = questionsCollapsed ?? localQuestionsCollapsed;
  const footerFolded = footerCollapsed ?? localFooterCollapsed;
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
  const summary =
    collapsed && status === "open"
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
    if (
      target instanceof HTMLElement &&
      (target.isContentEditable ||
        ["TEXTAREA", "SELECT"].includes(target.tagName))
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
            <div
              aria-label="Question content"
              className="interaction-panel__questions"
            >
              {request.questions.map((question) => {
                const selected = draftSelections[question.question] ?? [];
                return (
                  <article
                    className="interaction-panel__question"
                    key={question.question}
                  >
                    <div className="interaction-panel__question-heading">
                      <h3>{question.header || question.question}</h3>
                      {showSectionToggles ? (
                        <button
                          aria-expanded={!questionsFolded}
                          aria-label={
                            questionsFolded
                              ? "展开问题内容"
                              : "收起问题内容"
                          }
                          className="interaction-panel__section-toggle"
                          onClick={() => {
                            if (onToggleQuestions) {
                              onToggleQuestions();
                            } else {
                              setLocalQuestionsCollapsed((current) => !current);
                            }
                          }}
                          type="button"
                        >
                          <ChevronDown aria-hidden="true" />
                        </button>
                      ) : null}
                    </div>
                    {questionsFolded ? null : (
                      <>
                        <p className="interaction-panel__prompt">
                          {question.question}
                        </p>
                        <div
                          aria-label={question.question}
                          className="interaction-panel__options"
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
                                className="interaction-panel__option"
                                disabled={readOnly || pending}
                                key={label}
                                onClick={() =>
                                  toggleOption(question.question, label)
                                }
                                type="button"
                              >
                                {pressed ? <Check aria-hidden="true" /> : null}
                                <span>{label}</span>
                                {description ? <small>{description}</small> : null}
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
                            placeholder="选一项或直接输入；提交时发送输入框内容"
                            type="text"
                            value={drafts[question.question] ?? ""}
                          />
                        </div>
                      </>
                    )}
                  </article>
                );
              })}
            </div>
          ) : (
            <QuestionResultList result={result} />
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
                  一次性提交
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
                {showSectionToggles ? (
                  <button
                    aria-expanded={!footerFolded}
                    aria-label={footerFolded ? "展开快捷说明" : "收起快捷说明"}
                    className="interaction-panel__section-toggle"
                    onClick={() => {
                      if (onToggleFooter) {
                        onToggleFooter();
                      } else {
                        setLocalFooterCollapsed((current) => !current);
                      }
                    }}
                    type="button"
                  >
                    <ChevronDown aria-hidden="true" />
                  </button>
                ) : null}
                {pending ? (
                  <span className="interaction-panel__pending" role="status">
                    sending…
                  </span>
                ) : null}
              </div>
              {keyboard && !footerFolded ? (
                <span className="interaction-panel__keys">
                  <kbd>1</kbd>–<kbd>{request.questions[0] ? optionLabels(request.questions[0]).length : 0}</kbd> 高亮 · <kbd>Enter</kbd> 提交 · <kbd>Esc</kbd> 取消
                </span>
              ) : null}
            </footer>
          ) : null}
        </div>
      </div>
    </section>
  );
}
