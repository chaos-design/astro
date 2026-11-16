import { Check, PencilLine, Send, SkipForward, X } from "lucide-react";
import { useState } from "react";
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
}: InteractionPanelProps) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const status = interactionPanelStatus(result);
  const readOnly = isInteractionPanelReadOnly(status, lockedBy, deviceId);
  const answers = result?.answers ?? {};
  const submittable = isInteractionPanelSubmittable(request.questions, selections);

  return (
    <section
      aria-label="User question"
      className={className ? `interaction-panel ${className}` : "interaction-panel"}
      data-status={status}
    >
      <header className="interaction-panel__header">
        <span className="interaction-panel__eyebrow">USER QUESTION</span>
        <span className="interaction-panel__status">{statusLabel(status)}</span>
        {lockedBy && lockedBy !== deviceId ? (
          <span className="interaction-panel__locked">answered on {lockedBy}</span>
        ) : null}
      </header>

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
                  {optionLabels(question).map((label) => {
                    const active = selected.includes(label);
                    const description = optionDescription(question, label);
                    return (
                      <button
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
          {pending ? (
            <span className="interaction-panel__pending" role="status">
              sending…
            </span>
          ) : null}
        </footer>
      ) : null}
    </section>
  );
}
