import { Link2 } from "lucide-react";
import { formatLogSequence, type TracePairLink } from "@/lib/trace-model";

/**
 * The single pair marker shared by LOG rows, trajectory atoms and the payload
 * overlay's rail. Its `#number` is the *other half's* LOG row, not a pair
 * ordinal: a pair made of `#027` and `#029` reads `#029` on `#027` and `#027`
 * on `#029`. The two halves cross-reference each other, so "who is paired with
 * whom" is visible without hovering, and clicking jumps straight to that
 * numbered row. The turn and the pair's order stay in the tooltip and the
 * accessible name — the chip itself keeps only the row number. Kept as a real
 * button so keyboard users get the same jump, and it stops propagation so the
 * jump never doubles as a plain row selection.
 */
export function PairLinkMarker({
  link,
  onLocate,
}: {
  link: TracePairLink;
  onLocate: (eventId: string) => void;
}) {
  const roleLabel = link.role === "start" ? "起始" : "结果";
  const targetLabel = link.role === "start" ? "结果" : "起始";
  const targetRow = formatLogSequence(link.partnerIndex);
  const pairHint = `${link.label} · 第 ${link.turn} 轮第 ${link.ordinal} 对 · ${link.rows} · #号是另一半的 LOG 行号`;
  return (
    <button
      type="button"
      className={`pair-link-marker is-${link.role}`}
      title={`${pairHint}，成对${roleLabel}，点击定位${targetLabel}事件 ${targetRow}`}
      aria-label={`${pairHint}，成对${roleLabel}，定位${targetLabel}事件 ${targetRow}`}
      onClick={(clickEvent) => {
        clickEvent.stopPropagation();
        onLocate(link.partnerId);
      }}
      onKeyDown={(keyEvent) => {
        if (keyEvent.key === "Enter" || keyEvent.key === " ") {
          keyEvent.preventDefault();
          keyEvent.stopPropagation();
          onLocate(link.partnerId);
        }
      }}
    >
      <Link2 aria-hidden="true" />
      <span className="pair-link-marker__target">{targetRow}</span>
    </button>
  );
}
