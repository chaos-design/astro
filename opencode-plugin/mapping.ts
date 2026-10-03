type AstroPayload = Record<string, unknown> & { eventName: string };

type AnyEvent = {
  type?: string;
  data?: Record<string, any>;
};

const terminalFinish = new Set(["stop", "end_turn", "eog", "stop_sequence"]);
const failedFinish = new Set(["error", "failed", "length", "content_filter"]);
const interruptedTypes = new Set([
  "session.execution.interrupted",
  "session.execution.aborted",
  "session.execution.cancelled",
  "session.interrupted",
]);

/**
 * Maps one OpenCode server event to the ASTRO canonical event payloads it
 * produces. Returns an empty array for events that carry no traceable meaning
 * (deltas, progress, usage updates) so callers can drop them cheaply.
 */
export function mapOpenCodeEvent(event: AnyEvent): AstroPayload[] {
  const type = String(event?.type || "");
  const data = event?.data ?? {};
  const sessionId = data.sessionID;

  if (!sessionId) {
    return [];
  }

  if (type === "session.created") {
    return [{ eventName: "SessionStart" }];
  }

  if (type === "session.inbox.enqueued") {
    return data?.item?.type === "user"
      ? [
          {
            eventName: "UserPromptSubmit",
            prompt: data?.item?.payload?.text,
          },
        ]
      : [];
  }

  if (type === "session.step.started") {
    return [
      {
        eventName: "Notification",
        message: `step started (${data?.model?.id ?? "unknown"})`,
      },
    ];
  }

  if (type === "session.tool.called") {
    return [
      {
        eventName: "PreToolUse",
        toolUseId: data?.id,
        toolName: data?.name,
        tool_input: data?.input,
      },
    ];
  }

  if (type === "session.tool.success") {
    return [
      {
        eventName: "PostToolUse",
        toolUseId: data?.id,
        tool_response: data?.content,
      },
    ];
  }

  if (type === "session.reasoning.ended") {
    return [{ eventName: "Reasoning", message: data?.text }];
  }

  if (type === "session.text.ended") {
    return [{ eventName: "AgentMessage", message: data?.text }];
  }

  if (type === "session.step.ended") {
    const finish = String(data?.finish || data?.rawFinish || "");
    if (terminalFinish.has(finish)) {
      return [{ eventName: "Stop" }];
    }
    if (failedFinish.has(finish)) {
      return [{ eventName: "StopFailure", status: "failed" }];
    }
    // "tool-calls" only means the agent loop continues, not that the run ended.
    return [];
  }

  if (interruptedTypes.has(type)) {
    return [{ eventName: "Interrupt" }];
  }

  if (type === "session.execution.failed") {
    return [{ eventName: "StopFailure", status: "failed" }];
  }

  if (type === "session.deleted") {
    return [{ eventName: "SessionEnd" }];
  }

  if (type.startsWith("session.tool.")) {
    // Unknown tool outcome events are recorded as failures rather than dropped,
    // so a failed tool call never disappears from the trajectory.
    if (data?.error || data?.status === "error" || data?.failed === true) {
      return [
        {
          eventName: "PostToolUseFailure",
          toolUseId: data?.id,
          toolName: data?.name,
          tool_response: data?.error ?? data?.content,
          status: "failed",
        },
      ];
    }
  }

  return [];
}