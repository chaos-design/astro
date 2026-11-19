import { AnswerRows } from "./answer-rows";
import type {
  InteractionResult,
  QuestionDescriptor,
} from "../lib/interaction-contract";
import {
  interactionPanelStatus,
  resultAnswerRows,
} from "../lib/interaction-panel-model";

/**
 * The closed request, in one place: the floating card shows it while the card
 * settles and the docked question surface shows it right after a submit, so
 * the reader sees the same ANSWERED / CANCELLED record on every surface.
 */
export function QuestionResultList({
  result,
  questions,
}: {
  result: InteractionResult | null;
  questions?: readonly QuestionDescriptor[];
}) {
  const status = interactionPanelStatus(result);
  const rows = questions?.length
    ? resultAnswerRows({ questions }, result)
    : Object.entries(result?.answers ?? {}).map(([question, answer]) => ({
        question,
        answer,
      }));
  return (
    <AnswerRows
      meta={
        result
          ? {
              answeredBy: result.answeredBy,
              answeredAt: result.answeredAt,
              elapsedMs: result.elapsedMs,
            }
          : null
      }
      questions={questions}
      rows={rows}
      status={status}
    />
  );
}
