import { ChevronDown, Send } from "lucide-react";
import { useState } from "react";
import type { QuestionPanelMode } from "@/config/app-config";
import {
  normalizeQuestionOptions,
  type QuestionDescriptor,
} from "../lib/interaction-contract";
import { QuestionPanelModeControl } from "./question-panel-mode-control";
import { Button } from "./ui/button";

/**
 * The answer affordance inside the expanded Flow atom inspector. It is
 * deliberately small: the question preview lives next to it, and the answer is
 * keyed by the descriptor's verbatim question text by the caller, not by the
 * input's position or the currently selected log row.
 *
 * AskUserQuestion may carry several descriptors in one request. They are all
 * rendered here and submitted as one batch: the host closes a request on the
 * first submit, so answering them one at a time would strand the remaining
 * questions. A single-select descriptor's options are one-click quick answers
 * when it is the only question (the synchronous window has no click to spare);
 * in a batch they fill the row and the single submit sends everything.
 */
export interface QuestionAnswerFormProps {
  /** Verbatim question descriptors from the matched InteractionRequest. */
  questions: readonly QuestionDescriptor[];
  /** Answers already mirrored by the reducer, if the user answered elsewhere. */
  selections?: Readonly<Record<string, readonly string[]>>;
  /** Per-question drafts, keyed by the verbatim question text. */
  drafts: Readonly<Record<string, string>>;
  onDraftChange: (question: string, text: string) => void;
  /** One map of question text -> answer, submitted as a single chain. */
  onSend: (answers: Record<string, string>) => void;
  readOnly?: boolean;
  pending?: boolean;
  className?: string;
  panelMode?: QuestionPanelMode;
  onPanelModeChange?: (mode: QuestionPanelMode) => void;
}

export function QuestionAnswerForm({
  questions,
  selections,
  drafts,
  onDraftChange,
  onSend,
  readOnly = false,
  pending = false,
  className,
  panelMode,
  onPanelModeChange,
}: QuestionAnswerFormProps) {
  const [collapsed, setCollapsed] = useState(false);
  const answered = (question: QuestionDescriptor) =>
    Boolean(selections?.[question.question]?.length) ||
    Boolean(drafts[question.question]?.trim());
  const missingRequired = questions.some(
    (question) => question.required !== false && !answered(question),
  );
  const disabled = readOnly || pending || missingRequired;

  const submit = () => {
    if (disabled) {
      return;
    }
    const answers: Record<string, string> = {};
    for (const question of questions) {
      const existing = selections?.[question.question]?.[0];
      const value = drafts[question.question]?.trim() || existing;
      if (value) {
        answers[question.question] = value;
      }
    }
    onSend(answers);
  };

  return (
    <section
      aria-label="Answer this question"
      className={
        [
          "question-answer",
          collapsed ? "is-collapsed" : "",
          className || "",
        ]
          .filter(Boolean)
          .join(" ")
      }
    >
      <div className="question-answer__header">
        <span className="eyebrow">QUESTION · 作答</span>
        {questions.length > 1 ? (
          <span className="question-answer__count">
            {questions.length} 个问题 · 一次提交
          </span>
        ) : null}
        {onPanelModeChange ? (
          <QuestionPanelModeControl
            className="question-answer__layout"
            mode={panelMode ?? "dock-half"}
            onChange={onPanelModeChange}
          />
        ) : null}
        <button
          aria-expanded={!collapsed}
          aria-label={collapsed ? "展开作答区" : "收起作答区"}
          className="question-answer__collapse"
          onClick={() => setCollapsed((current) => !current)}
          type="button"
        >
          <ChevronDown aria-hidden="true" />
        </button>
      </div>
      {collapsed ? null : questions.map((question) => {
        const existing = selections?.[question.question]?.[0];
        const options = normalizeQuestionOptions(question.options).map(
          (option) => option.label,
        );
        const multi = question.multiSelect === true;
        const selectedTokens = (drafts[question.question] || "")
          .split(",")
          .map((token) => token.trim())
          .filter(Boolean);
        const toggleOption = (label: string) => {
          const next = multi
            ? selectedTokens.includes(label)
              ? selectedTokens.filter((token) => token !== label)
              : [...selectedTokens, label]
            : [label];
          // Keep declared order, and never send on the click: every option and
          // every typed answer is collected until the one Submit below.
          onDraftChange(
            question.question,
            options.filter((option) => next.includes(option)).join(", "),
          );
        };
        return (
          <div className="question-answer__item" key={question.question}>
            <div className="question-answer__meta">
              <p className="question-answer__prompt" title={question.question}>
                {question.question}
              </p>
              {existing ? (
                <span className="question-answer__existing" title={existing}>
                  已填写：{existing}
                </span>
              ) : null}
            </div>
            {options.length ? (
              <div
                aria-label={`Quick answers for ${question.question}`}
                className="question-answer__options"
                role="group"
              >
                {options.map((label) => (
                  <button
                    aria-pressed={selectedTokens.includes(label)}
                    className="question-answer__option"
                    disabled={readOnly || pending}
                    key={label}
                    onClick={() => toggleOption(label)}
                    type="button"
                  >
                    {label}
                  </button>
                ))}
              </div>
            ) : null}
            <div className="question-answer__row">
              <input
                aria-label={`Answer for ${question.question}`}
                className="question-answer__input"
                disabled={readOnly || pending}
                onChange={(event) =>
                  onDraftChange(question.question, event.target.value)
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !disabled) {
                    event.preventDefault();
                    submit();
                  }
                }}
                placeholder="键入答案…"
                type="text"
                value={drafts[question.question] ?? ""}
              />
            </div>
          </div>
        );
      })}
      <div className="question-answer__footer">
        <Button
          disabled={disabled}
          onClick={submit}
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
