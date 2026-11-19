import { Code2, Eye, Send, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { QuestionPanelMode } from "@/config/app-config";
import { QuestionPanelModeControl } from "./question-panel-mode-control";
import { QuestionResultList } from "./question-result";
import { Button } from "./ui/button";
import { JsonViewer } from "./json-viewer";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "./ui/toggle-group";
import { renderMarkdownPreview } from "../lib/markdown-preview";
import {
  normalizeQuestionOptions,
  type InteractionResult,
  type QuestionDescriptor,
} from "../lib/interaction-contract";
import {
  buildQuestionAnswers,
  questionPanelSubmittable,
} from "../lib/question-panel-model";
import {
  parseUserQuestionContent,
  type UserQuestionPrompt,
} from "../lib/user-question-content";
import type { TracePayload } from "../types/trace";

type QuestionViewMode = "preview" | "code";

/**
 * Everything the surface needs to answer the question that is still open (or
 * the one that just closed). The options, the free-text draft and the submit
 * all live here; the caller owns the request and this only renders it.
 */
export interface QuestionAnswerBinding {
  /** Verbatim descriptors of the live (or just-closed) request. */
  questions: readonly QuestionDescriptor[];
  /** Per-question drafts, keyed by the verbatim question text. */
  drafts: Readonly<Record<string, string>>;
  onDraftChange: (question: string, text: string) => void;
  onSend: (answers: Record<string, string>) => void;
  onCancel?: () => void;
  pending?: boolean;
  readOnly?: boolean;
  /** The closed result, kept for the settle window. */
  result?: InteractionResult | null;
}

function tokensOf(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean);
}

/**
 * One question surface for every placement: the docked panel and the Input tab
 * render the same component. Preview shows what the reader was asked — with
 * answerable options and a pinned submit only while a request is open — and
 * Code shows the raw payload and nothing else. The toolbar is the single row
 * of controls: view switch, placement, fold.
 */
export function QuestionContent({
  payload,
  panelMode,
  onPanelModeChange,
  answer = null,
}: {
  payload: TracePayload;
  panelMode?: QuestionPanelMode;
  onPanelModeChange?: (mode: QuestionPanelMode) => void;
  answer?: QuestionAnswerBinding | null;
}) {
  const content = useMemo(() => parseUserQuestionContent(payload), [payload]);
  const [viewMode, setViewMode] = useState<QuestionViewMode>("preview");

  const answers = useMemo(() => {
    if (!answer) {
      return {};
    }
    const selections: Record<string, string[]> = {};
    for (const question of answer.questions) {
      const tokens = tokensOf(answer.drafts[question.question]);
      if (tokens.length) {
        selections[question.question] = tokens;
      }
    }
    return buildQuestionAnswers({
      questions: answer.questions,
      selections,
      drafts: answer.drafts,
    });
  }, [answer]);

  const disabled = Boolean(answer?.readOnly || answer?.pending);
  const submittable = answer
    ? questionPanelSubmittable(answer.questions, answers)
    : false;
  const live = Boolean(answer && !answer.result);

  const toggleOption = (question: QuestionDescriptor, label: string) => {
    if (!answer || disabled) {
      return;
    }
    const labels = normalizeQuestionOptions(question.options).map(
      (option) => option.label,
    );
    const current = tokensOf(answer.drafts[question.question]);
    const next =
      question.multiSelect === true
        ? current.includes(label)
          ? current.filter((token) => token !== label)
          : [...current, label]
        : [label];
    // Keep declared order, and never send on the click: every choice fills the
    // draft and the one Submit below sends the whole batch.
    answer.onDraftChange(
      question.question,
      labels.filter((item) => next.includes(item)).join(", "),
    );
  };

  return (
    <div className="prompt-input">
      <div className="prompt-input__toolbar">
        <ToggleGroup
          aria-label="User question view"
          className="prompt-input__mode"
          onValueChange={(value) => {
            if (value) {
              setViewMode(value as QuestionViewMode);
            }
          }}
          spacing={0}
          type="single"
          value={viewMode}
          variant="outline"
        >
          <ToggleGroupItem aria-label="Preview question content" value="preview">
            <Eye data-icon="inline-start" />
            Preview
          </ToggleGroupItem>
          <ToggleGroupItem aria-label="View question payload code" value="code">
            <Code2 data-icon="inline-start" />
            Code
          </ToggleGroupItem>
        </ToggleGroup>
        {onPanelModeChange ? (
          <QuestionPanelModeControl
            className="prompt-input__layout"
            mode={panelMode ?? "dock-full"}
            onChange={onPanelModeChange}
          />
        ) : null}
      </div>
      {viewMode === "code" ? (
        // Code is the raw payload only: no options, no answer box, no submit.
        <div className="prompt-input__code">
          <JsonViewer emptyLabel="No question payload captured." value={payload} />
        </div>
      ) : (
        <div className="question-surface">
          <div className="question-surface__body">
            {answer?.result ? (
              // The outcome leads: after a submit or a cancel the reader must
              // see what the host received before scrolling the questions.
              <QuestionResultList result={answer.result} />
            ) : null}
            {answer ? (
              answer.questions.map((question, index) => (
                <article
                  className="question-surface__item"
                  key={question.question}
                >
                  <h3>{question.header || `Question ${index + 1}`}</h3>
                  <p className="question-surface__prompt">{question.question}</p>
                  <QuestionOptions
                    disabled={disabled}
                    labels={normalizeQuestionOptions(question.options).map(
                      (option) => option.label,
                    )}
                    onToggle={(label) => toggleOption(question, label)}
                    selected={tokensOf(answer.drafts[question.question])}
                  />
                  <input
                    aria-label={`Answer for ${question.question}`}
                    className="question-surface__input"
                    disabled={disabled}
                    onChange={(event) =>
                      answer.onDraftChange(question.question, event.target.value)
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !disabled && submittable) {
                        event.preventDefault();
                        answer.onSend(answers);
                      }
                    }}
                    placeholder="键入答案…"
                    type="text"
                    value={answer.drafts[question.question] ?? ""}
                  />
                </article>
              ))
            ) : (
              <StaticQuestionContent content={content} />
            )}
          </div>
          {live && answer ? (
            <footer className="question-surface__footer">
              <span className="question-surface__meta">
                {`${answer.questions.length} 个问题`}
              </span>
              <div className="question-surface__actions">
                {answer.pending ? (
                  <span className="question-surface__pending" role="status">
                    Sending…
                  </span>
                ) : null}
                <Button
                  disabled={disabled || !submittable}
                  onClick={() => answer.onSend(answers)}
                  size="sm"
                  type="button"
                  variant="default"
                >
                  <Send aria-hidden="true" data-icon="inline-start" />
                  Submit
                </Button>
                <Button
                  disabled={disabled}
                  onClick={answer.onCancel}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  <X aria-hidden="true" data-icon="inline-start" />
                  Cancel
                </Button>
              </div>
            </footer>
          ) : null}
        </div>
      )}
    </div>
  );
}

/**
 * One row of option buttons. Clickable only while the question is open; a
 * closed request keeps the same chips greyed out so the captured choices stay
 * readable without looking answerable.
 */
function QuestionOptions({
  labels,
  selected,
  disabled,
  onToggle,
}: {
  labels: readonly string[];
  selected: readonly string[];
  disabled: boolean;
  onToggle: (label: string) => void;
}) {
  if (!labels.length) {
    return null;
  }
  return (
    <div
      aria-label="Question options"
      className="question-options"
      role="group"
    >
      {labels.map((label) => (
        <button
          aria-pressed={selected.includes(label)}
          className="question-options__option"
          disabled={disabled}
          key={label}
          onClick={() => onToggle(label)}
          type="button"
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** The captured question without a live request: same layout, no controls. */
function StaticQuestionContent({
  content,
}: {
  content: ReturnType<typeof parseUserQuestionContent>;
}) {
  if (!content.prompts.length && !content.message && !content.plan) {
    return content.answers.length ? null : (
      <section className="question-surface__item">
        <p className="prompt-content__empty">No question content captured.</p>
      </section>
    );
  }
  return (
    <>
      {content.prompts.length ? (
        content.prompts.map((prompt, index) => (
          <StaticPrompt
            index={index}
            key={`${prompt.title}-${index}`}
            prompt={prompt}
          />
        ))
      ) : content.message ? (
        <section className="question-surface__item">
          <h3>Question</h3>
          <MarkdownPreview source={content.message} />
        </section>
      ) : content.plan ? (
        // Plan approval (ZCode/Claude ExitPlanMode) carries its question as a
        // Markdown plan rather than a question string or options.
        <section className="question-surface__item">
          <h3>Plan</h3>
          <MarkdownPreview source={content.plan} />
        </section>
      ) : null}
      {content.answers.length ? (
        <section className="question-surface__item">
          <h3>Answers</h3>
          <ul className="question-content__options">
            {content.answers.map((item, index) => (
              <li key={`${item.question}-${index}`}>
                {item.question} → {item.answer}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

function StaticPrompt({
  index,
  prompt,
}: {
  index: number;
  prompt: UserQuestionPrompt;
}) {
  return (
    <section className="question-surface__item">
      <h3>{prompt.title || `Question ${index + 1}`}</h3>
      <MarkdownPreview source={prompt.question} />
      {prompt.options.length ? (
        <div
          aria-label="Question options"
          className="question-options"
          role="group"
        >
          {prompt.options.map((option, optionIndex) => (
            <span
              className="question-options__option is-static"
              key={optionIndex}
            >
              {option}
            </span>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function MarkdownPreview({ source }: { source: string }) {
  const render = useMemo(() => renderMarkdownPreview(source), [source]);
  if (!render.valid) {
    // An invalid or empty markdown source renders as the captured text,
    // never as a broken or half-rendered document.
    return (
      <p className="prompt-content__text">
        {source || "No question text captured."}
      </p>
    );
  }
  return (
    <div
      className="markdown-preview"
      dangerouslySetInnerHTML={{ __html: render.html }}
    />
  );
}
