import { Check, ChevronDown, PencilLine, Send, SkipForward, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from "react";
import { Button } from "./ui/button";
import type {
  InteractionRequest,
  InteractionResult,
  QuestionDescriptor,
} from "../lib/interaction-contract";
import {
  interactionPanelStatus,
  isInteractionPanelReadOnly,
  isInteractionPanelSubmittable,
  optionDescription,
  optionLabels,
  resolveOptionClick,
  resolvePanelKey,
  resolveTextAction,
  type InteractionPanelStatus,
  type TextAction,
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
  onSelect?: (question: string, label: string) => void;
  onDeselect?: (question: string, label: string) => void;
  onText?: (question: string, text: string) => void;
  onEdit?: (question: string, previous: string, next: string) => void;
  onSkip?: (question: string) => void;
  onSubmit?: () => void;
  onCancel?: () => void;
  className?: string;
  /** Floating card only: bind number keys, Enter and Escape to the answers. */
  keyboard?: boolean;
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

function dispatchTextAction(
  action: TextAction,
  question: string,
  handlers: Pick<InteractionPanelProps, "onText" | "onEdit">,
) {
  if (action.action === "text") {
    handlers.onText?.(question, action.text);
  } else if (action.action === "edit") {
    handlers.onEdit?.(question, action.previous, action.next);
  }
}

/**
 * The console side of the interaction fast path: render the host's questions,
 * collect a selection per question, and submit a full answer map. It is a
 * presentational component — the reducer owns state and the app posts events —
 * so it can also render the closed result in the run log.
 */
export function InteractionPanel({
  request,
  selections = {},
  result = null,
  lockedBy = null,
  deviceId = "console",
  pending = false,
  onSelect,
  onDeselect,
  onText,
  onEdit,
  onSkip,
  onSubmit,
  onCancel,
  className,
  keyboard = false,
}: InteractionPanelProps) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<string | null>(null);
  // Collapsing only hides the body: the header stays as a one-line summary so
  // the card can get out of the canvas's way without losing the question. A
  // new request remounts the card (the app keys it by requestId) and expands.
  const [collapsed, setCollapsed] = useState(false);
  const status = interactionPanelStatus(result);
  const readOnly = isInteractionPanelReadOnly(status, lockedBy, deviceId);
  const answers = result?.answers ?? {};
  const submittable = isInteractionPanelSubmittable(request.questions, selections);
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

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (!keyboard || collapsed || status !== "open") {
      return;
    }
    // Modifier chords belong to the console (⌘K search); text fields own
    // their own keystrokes so "Other…" can contain digits and Enter.
    if (event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      (target.isContentEditable ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
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
        onSubmit?.();
      }
      return;
    }
    if (action.action === "cancel") {
      event.preventDefault();
      onCancel?.();
      return;
    }
    const question = request.questions[action.question];
    if (question) {
      const label = optionLabels(question)[action.option];
      const active = (selections[question.question] || []).includes(label);
      const click = resolveOptionClick({
        active,
        multiSelect: question.multiSelect === true,
        readOnly,
      });
      if (click === "select") {
        event.preventDefault();
        onSelect?.(question.question, label);
      } else if (click === "deselect") {
        event.preventDefault();
        onDeselect?.(question.question, label);
      }
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
            <div className="interaction-panel__questions">
              {request.questions.map((question) => {
                const selected = selections[question.question] || [];
                const draft = drafts[question.question] || "";
                const freeText = selected.find(
                  (value) => !optionLabels(question).includes(value),
                );
                return (
                  <article
                    className="interaction-panel__question"
                    key={question.question}
                  >
                    <h3>{question.header || question.question}</h3>
                    <p className="interaction-panel__prompt">{question.question}</p>
                    <div
                      aria-label={question.question}
                      className="interaction-panel__options"
                      role="group"
                    >
                      {optionLabels(question).map((label, optionIndex) => {
                        const active = selected.includes(label);
                        const description = optionDescription(question, label);
                        return (
                          <button
                            ref={
                              question === request.questions[0] && optionIndex === 0
                                ? optionsRef
                                : undefined
                            }
                            aria-pressed={active}
                            className="interaction-panel__option"
                            disabled={readOnly}
                            key={label}
                            onClick={() => {
                              const click = resolveOptionClick({
                                active,
                                multiSelect: question.multiSelect === true,
                                readOnly,
                              });
                              if (click === "select") {
                                onSelect?.(question.question, label);
                              } else if (click === "deselect") {
                                onDeselect?.(question.question, label);
                              }
                            }}
                            type="button"
                          >
                            {active ? <Check aria-hidden="true" /> : null}
                            <span>{label}</span>
                            {description ? <small>{description}</small> : null}
                          </button>
                        );
                      })}
                    </div>

                    {editing === question.question || !freeText ? (
                      <div className="interaction-panel__text">
                        <input
                          aria-label={`Other answer for ${question.question}`}
                          disabled={readOnly}
                          onChange={(event) =>
                            setDrafts((current) => ({
                              ...current,
                              [question.question]: event.target.value,
                            }))
                          }
                          placeholder="Other…"
                          value={draft}
                        />
                        <Button
                          disabled={readOnly || !draft.trim()}
                          onClick={() => {
                            dispatchTextAction(
                              resolveTextAction(freeText, draft),
                              question.question,
                              { onText, onEdit },
                            );
                            setEditing(null);
                          }}
                          size="sm"
                          type="button"
                          variant="outline"
                        >
                          Set
                        </Button>
                      </div>
                    ) : (
                      <Button
                        disabled={readOnly}
                        onClick={() => setEditing(question.question)}
                        size="xs"
                        type="button"
                        variant="ghost"
                      >
                        <PencilLine aria-hidden="true" data-icon="inline-start" />
                        Edit answer
                      </Button>
                    )}

                    {question.required === false ? (
                      <Button
                        disabled={readOnly}
                        onClick={() => onSkip?.(question.question)}
                        size="xs"
                        type="button"
                        variant="ghost"
                      >
                        <SkipForward aria-hidden="true" data-icon="inline-start" />
                        Skip
                      </Button>
                    ) : null}
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="interaction-panel__result">
              {Object.keys(answers).length ? (
                <ul>
                  {Object.entries(answers).map(([question, answer]) => (
                    <li key={question}>
                      <span>{question}</span>
                      <strong>{answer}</strong>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>
                  {status === "cancelled"
                    ? "Cancelled; the host's native prompt is still in charge."
                    : "No answer arrived before the host's window closed."}
                </p>
              )}
            </div>
          )}

          {status === "open" ? (
            <footer className="interaction-panel__footer">
              <Button
                disabled={readOnly || pending || !submittable}
                onClick={onSubmit}
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
              {keyboard ? (
                <span className="interaction-panel__keys">
                  <kbd>1</kbd>–<kbd>{request.questions[0] ? optionLabels(request.questions[0]).length : 0}</kbd> 选择 · <kbd>Enter</kbd> 提交 · <kbd>Esc</kbd> 取消
                </span>
              ) : null}
              {pending ? (
                <span className="interaction-panel__pending" role="status">
                  sending…
                </span>
              ) : null}
            </footer>
          ) : null}
        </div>
      </div>
    </section>
  );
}
