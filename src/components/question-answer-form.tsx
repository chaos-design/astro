import { Send } from "lucide-react";
import { Button } from "./ui/button";

/**
 * The answer affordance inside the expanded Flow atom inspector. It is
 * deliberately small: the question preview lives next to it, and the answer is
 * keyed by the descriptor's verbatim question text by the caller, not by the
 * input's position or the currently selected log row.
 */
export interface QuestionAnswerFormProps {
  /** Verbatim question text from the matched InteractionRequest. */
  question: string;
  /** Answer already mirrored by the reducer, if the user answered elsewhere. */
  selection?: string;
  draft: string;
  onDraftChange: (text: string) => void;
  onSend: (text: string) => void;
  readOnly?: boolean;
  pending?: boolean;
  className?: string;
}

export function QuestionAnswerForm({
  question,
  selection,
  draft,
  onDraftChange,
  onSend,
  readOnly = false,
  pending = false,
  className,
}: QuestionAnswerFormProps) {
  const disabled = readOnly || pending || !draft.trim();
  return (
    <section
      aria-label="Answer this question"
      className={className ? `question-answer ${className}` : "question-answer"}
    >
      <div className="question-answer__header">
        <span className="eyebrow">QUESTION · 作答</span>
        {selection ? (
          <span className="question-answer__existing" title={selection}>
            已填写：{selection}
          </span>
        ) : null}
      </div>
      <p className="question-answer__prompt" title={question}>
        {question}
      </p>
      <div className="question-answer__row">
        <input
          aria-label={`Answer for ${question}`}
          className="question-answer__input"
          disabled={readOnly || pending}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !disabled) {
              event.preventDefault();
              onSend(draft);
            }
          }}
          placeholder="键入答案…"
          type="text"
          value={draft}
        />
        <Button
          disabled={disabled}
          onClick={() => onSend(draft)}
          size="sm"
          type="button"
          variant="default"
        >
          <Send aria-hidden="true" data-icon="inline-start" />
          {pending ? "发送中…" : "提交发送"}
        </Button>
      </div>
      {readOnly ? (
        <small className="question-answer__hint">此提问已关闭或已在其他设备作答。</small>
      ) : null}
    </section>
  );
}
