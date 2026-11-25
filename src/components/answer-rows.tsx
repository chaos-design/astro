import { Check } from "lucide-react";
import { MarkdownView } from "./markdown-view";
import type {
  QuestionDescriptor,
  QuestionOption,
} from "../lib/interaction-contract";
import type { InteractionPanelStatus } from "../lib/interaction-panel-model";
import { matchAnswerOptions } from "../lib/question-panel-model";

export type AnswerRow = { question: string; answer: string };

/**
 * One rendering of a captured answer, used by the floating card's result, the
 * docked question surface and the inspector's historical Answers section.
 * Selected options come back as highlighted chips; whatever the answer carried
 * beyond those labels is rendered as Markdown, so a prose answer keeps its
 * line breaks, links and code.
 */
export function AnswerRows({
  rows,
  questions,
  status,
  meta,
}: {
  rows: readonly AnswerRow[];
  questions?: readonly QuestionDescriptor[];
  status?: InteractionPanelStatus;
  meta?: {
    answeredBy?: string;
    answeredAt?: string;
    elapsedMs?: number;
  } | null;
}) {
  if (!rows.length) {
    return (
      <div className="question-result">
        <p className="answer-rows__empty">
          {status === "cancelled"
            ? "已取消：宿主的原生提问仍然生效。"
            : status === "timeout"
              ? "宿主等待超时，没有收到回答。"
              : status === "expired"
                ? "回答窗口已过期。"
                : status === "answered"
                  ? "宿主没有记录具体的回答内容。"
                  : "尚未收到回答。"}
        </p>
      </div>
    );
  }

  return (
    <div className="question-result">
      <ul className="answer-rows">
        {rows.map((row, index) => {
          const options = questions?.find(
            (question) => question.question === row.question,
          )?.options as readonly (QuestionOption | string)[] | undefined;
          const { labels, text } = matchAnswerOptions(row.answer, options);
          return (
            <li className="answer-rows__row" key={`${row.question}-${index}`}>
              <span className="answer-rows__question">{row.question}</span>
              <div className="answer-rows__value">
                {labels.length ? (
                  <div className="answer-rows__chips">
                    {labels.map((label) => (
                      <span className="answer-rows__chip" key={label}>
                        <Check aria-hidden="true" />
                        {label}
                      </span>
                    ))}
                  </div>
                ) : null}
                {text ? <MarkdownView source={text} /> : null}
                {!labels.length && !text ? (
                  <MarkdownView source={row.answer} />
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      {meta?.answeredBy ? (
        <p className="answer-rows__meta">
          <span>{meta.answeredBy}</span>
          {meta.answeredAt ? (
            <>
              <span aria-hidden="true">·</span>
              <time dateTime={meta.answeredAt}>
                {formatAnsweredAt(meta.answeredAt)}
              </time>
            </>
          ) : null}
          {typeof meta.elapsedMs === "number" ? (
            <>
              <span aria-hidden="true">·</span>
              <span>{formatElapsed(meta.elapsedMs)}</span>
            </>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}

function formatAnsweredAt(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return value;
  }
  return new Date(parsed).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatElapsed(ms: number): string {
  if (ms < 1000) {
    return `${Math.max(0, Math.round(ms))}ms`;
  }
  if (ms < 60_000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}
