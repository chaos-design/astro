import { Check, Code2, Eye, Send, X } from "lucide-react";
import { useMemo } from "react";
import type { QuestionPanelMode } from "@/config/app-config";
import { cn } from "@/lib/utils";
import { AnswerRows } from "./answer-rows";
import { MarkdownView } from "./markdown-view";
import { QuestionPanelModeControl } from "./question-panel-mode-control";
import { QuestionResultList } from "./question-result";
import { Button } from "./ui/button";
import { JsonViewer } from "./json-viewer";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "./ui/toggle-group";
import {
  normalizeQuestionOptions,
  type InteractionResult,
  type QuestionDescriptor,
  type QuestionOption,
} from "../lib/interaction-contract";
import {
  buildQuestionAnswers,
  matchAnswerOptions,
  questionPanelSubmittable,
} from "../lib/question-panel-model";
import {
  parseUserQuestionContent,
  type UserQuestionPrompt,
} from "../lib/user-question-content";
import type { TracePayload } from "../types/trace";

export type QuestionViewMode = "preview" | "code";

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
  viewMode,
  onViewModeChange,
}: {
  payload: TracePayload;
  panelMode?: QuestionPanelMode;
  onPanelModeChange?: (mode: QuestionPanelMode) => void;
  answer?: QuestionAnswerBinding | null;
  /** Controlled by the inspector so the dock and Input tab share one view. */
  viewMode: QuestionViewMode;
  onViewModeChange: (mode: QuestionViewMode) => void;
}) {
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

  // Once the request closes the app clears drafts, so the selected chip has to
  // come from the recorded answer — otherwise every historical choice loses
  // its highlight the moment the result arrives.
  const selectedFor = (question: QuestionDescriptor): string[] => {
    if (answer?.result) {
      return matchAnswerOptions(
        answer.result.answers[question.question] ?? "",
        question.options,
      ).labels;
    }
    return tokensOf(answer?.drafts[question.question]);
  };

  const unanswered = answer
    ? answer.questions.filter(
        (question) =>
          question.required !== false &&
          !answers[question.question]?.trim(),
      ).length
    : 0;

  return (
    <div className="prompt-input">
      <div className="prompt-input__toolbar">
        <ToggleGroup
          aria-label="User question view"
          className="prompt-input__mode"
          onValueChange={(value) => {
            if (value) {
              onViewModeChange(value as QuestionViewMode);
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
      {viewMode === "preview" && answer ? (
        // The batch rule belongs with the question list, not the action bar:
        // the footer stays a pure Submit / Cancel pair on every surface.
        <div className="question-surface__summary">
          <span>{`${answer.questions.length} 个问题 · 一次提交`}</span>
          {unanswered ? (
            <span className="question-surface__todo">
              {`还需回答 ${unanswered} 项`}
            </span>
          ) : null}
        </div>
      ) : null}
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
              <QuestionResultList
                questions={answer.questions}
                result={answer.result}
              />
            ) : null}
            {answer ? (
              answer.questions.map((question, index) => (
                <article
                  className="question-surface__item"
                  key={`${question.question}-${index}`}
                >
                  <div className="question-surface__heading">
                    <h3>{question.header || `Question ${index + 1}`}</h3>
                    {question.required !== false ? (
                      <span className="question-surface__required">必答</span>
                    ) : null}
                    {question.multiSelect ? (
                      <span className="question-surface__hint">可多选</span>
                    ) : null}
                  </div>
                  <MarkdownView
                    fallback="No question text captured."
                    source={question.question}
                  />
                  <QuestionOptions
                    disabled={disabled}
                    onToggle={(label) => toggleOption(question, label)}
                    options={normalizeQuestionOptions(question.options)}
                    selected={selectedFor(question)}
                  />
                  {answer.result ? null : (
                    <input
                      aria-label={`Answer for ${question.question}`}
                      className="question-surface__input"
                      disabled={disabled}
                      onChange={(event) =>
                        answer.onDraftChange(
                          question.question,
                          event.target.value,
                        )
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && !disabled && submittable) {
                          event.preventDefault();
                          answer.onSend(answers);
                        }
                      }}
                      placeholder="选择选项，或直接输入答案…"
                      type="text"
                      value={answer.drafts[question.question] ?? ""}
                    />
                  )}
                </article>
              ))
            ) : (
              <QuestionPreview payload={payload} />
            )}
          </div>
          {live && answer ? (
            <footer className="question-surface__footer">
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
  options,
  selected,
  disabled,
  onToggle,
}: {
  options: readonly QuestionOption[];
  selected: readonly string[];
  disabled: boolean;
  onToggle: (label: string) => void;
}) {
  if (!options.length) {
    return null;
  }
  return (
    <div
      aria-label="Question options"
      className="question-options"
      role="group"
    >
      {options.map((option, index) => {
        const pressed = selected.includes(option.label);
        return (
          <button
            aria-pressed={pressed}
            className="question-options__option"
            disabled={disabled}
            key={`${option.label}-${index}`}
            onClick={() => onToggle(option.label)}
            title={option.description || undefined}
            type="button"
          >
            {pressed ? <Check aria-hidden="true" /> : null}
            <span className="question-options__label">{option.label}</span>
            {option.description ? (
              <small className="question-options__description">
                {option.description}
              </small>
            ) : null}
          </button>
        );
      })}
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
  const descriptors: QuestionDescriptor[] = content.prompts.map((prompt) => ({
    question: prompt.question,
    options: prompt.options,
  }));
  const answeredCount = content.answers.filter((item) =>
    content.prompts.some((prompt) => prompt.question === item.question),
  ).length;

  return (
    <>
      {content.prompts.length ? (
        <div className="question-preview__head">
          <span className="question-preview__count">
            {`${content.prompts.length} 个问题`}
          </span>
          <span className="question-preview__hint">
            {answeredCount
              ? `已记录 ${answeredCount} 项答案 · 选中项已高亮`
              : "按捕获顺序预览"}
          </span>
        </div>
      ) : null}
      {content.prompts.length ? (
        <div className="question-preview__list">
          {content.prompts.map((prompt, index) => (
            <StaticPrompt
              answer={
                content.answers.find(
                  (item) => item.question === prompt.question,
                )?.answer
              }
              index={index}
              key={`${prompt.title}-${index}`}
              prompt={prompt}
            />
          ))}
        </div>
      ) : content.message ? (
        <section className="question-surface__item">
          <div className="question-preview__heading">
            <span className="question-preview__index">01</span>
            <h3>Question</h3>
          </div>
          <MarkdownView source={content.message} />
        </section>
      ) : content.plan ? (
        // Plan approval (ZCode/Claude ExitPlanMode) carries its question as a
        // Markdown plan rather than a question string or options.
        <section className="question-surface__item">
          <div className="question-preview__heading">
            <span className="question-preview__index">01</span>
            <h3>Plan</h3>
          </div>
          <MarkdownView source={content.plan} />
        </section>
      ) : null}
      {content.answers.length ? (
        <section className="question-surface__item">
          <div className="question-preview__heading">
            <span className="question-preview__index">ANS</span>
            <h3>Answers</h3>
            <span className="question-preview__state is-answered">已记录</span>
          </div>
          <AnswerRows questions={descriptors} rows={content.answers} />
        </section>
      ) : null}
    </>
  );
}

/**
 * The read-only question list used by a captured user.question event and by
 * the global overlay's Preview. It is exported so both places render the same
 * question / option / answer shapes instead of growing a second preview.
 */
export function QuestionPreview({ payload }: { payload: TracePayload }) {
  const content = useMemo(() => parseUserQuestionContent(payload), [payload]);
  return <StaticQuestionContent content={content} />;
}

function StaticPrompt({
  answer,
  index,
  prompt,
}: {
  answer?: string;
  index: number;
  prompt: UserQuestionPrompt;
}) {
  const selected = matchAnswerOptions(answer ?? "", prompt.options).labels;
  return (
    <section
      className={cn(
        "question-surface__item",
        selected.length && "is-answered",
      )}
    >
      <div className="question-preview__heading">
        <span className="question-preview__index">
          {String(index + 1).padStart(2, "0")}
        </span>
        <h3>{prompt.title || `Question ${index + 1}`}</h3>
        <span
          className={cn(
            "question-preview__state",
            selected.length && "is-answered",
          )}
        >
          {selected.length ? `已选 ${selected.length} 项` : "未作答"}
        </span>
      </div>
      <MarkdownView source={prompt.question} />
      {prompt.options.length ? (
        <div
          aria-label="Question options"
          className="question-options"
          role="group"
        >
          {prompt.options.map((option, optionIndex) => {
            const chosen = selected.includes(option.label);
            return (
              <span
                className={cn(
                  "question-options__option",
                  chosen && "is-selected",
                  "is-static",
                )}
                key={`${option.label}-${optionIndex}`}
                title={option.description || undefined}
              >
                {chosen ? <Check aria-hidden="true" /> : null}
                <span className="question-options__label">{option.label}</span>
                {option.description ? (
                  <small className="question-options__description">
                    {option.description}
                  </small>
                ) : null}
              </span>
            );
          })}
        </div>
      ) : null}
      {selected.length ? (
        <p className="question-preview__answers">
          <span>已选答案</span>
          <strong>{selected.join("、")}</strong>
        </p>
      ) : null}
    </section>
  );
}
