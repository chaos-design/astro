import type { InteractionResult } from "../lib/interaction-contract";
import { interactionPanelStatus } from "../lib/interaction-panel-model";

/**
 * The closed request, in one place: the floating card shows it while the card
 * settles and the docked question surface shows it right after a submit, so
 * the reader sees the same ANSWERED / CANCELLED record on every surface.
 */
export function QuestionResultList({
  result,
}: {
  result: InteractionResult | null;
}) {
  const status = interactionPanelStatus(result);
  const answers = result?.answers ?? {};
  return (
    <div className="question-result">
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
  );
}
