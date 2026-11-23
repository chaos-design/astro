/**
 * Agent notifications are part of the interaction contract, so the console
 * reuses the builder and validator that the hook and the service use instead
 * of owning a second copy of the kind/target/channel lists.
 */
export {
  INTERACTION_NOTIFICATION_CHANNELS,
  INTERACTION_NOTIFICATION_KINDS,
  INTERACTION_NOTIFICATION_TARGETS,
  buildAgentNotification,
  validateAgentNotification,
} from "../../plugin/interaction-contract.mjs";
export type {
  AgentNotification,
  AgentNotificationChannel,
  AgentNotificationKind,
  AgentNotificationTarget,
} from "../../plugin/interaction-contract.mjs";

/**
 * A short, human-readable outcome for the console and for `systemMessage`.
 * Answers never enter the summary: a free-text answer may contain a credential.
 */
export function describeInteractionOutcome(
  status: "answered" | "cancelled" | "timeout" | "expired",
  answered: number,
  skipped: number,
): string {
  if (status === "answered") {
    return `User answered ${answered} question${answered === 1 ? "" : "s"}${
      skipped ? ` and skipped ${skipped}` : ""
    }; the answers are injected by the host hook.`;
  }
  if (status === "cancelled") {
    return "The user cancelled the interaction; the host's native prompt is still in charge.";
  }
  return status === "timeout"
    ? "The interaction expired without an answer; the host's native prompt is still in charge."
    : "The interaction's session ended before an answer; the host's native prompt is still in charge.";
}
