export type AstroPayload = Record<string, unknown> & { eventName: string };

type AnyEvent = {
  type?: string;
  data?: Record<string, any>;
};

const terminalFinish = new Set(["stop", "end_turn", "eog", "stop_sequence"]);
const failedFinish = new Set(["error", "failed", "length", "content_filter"]);
const abortedErrorTypes = new Set([
  "aborted",
  "abort",
  "cancelled",
  "canceled",
  "interrupted",
  "declined",
]);

// Verified against OpenCode 2.0.22 event streams and the shipped event names:
// session.step.failed / session.tool.failed / permission.asked /
// permission.replied / session.execution.interrupted.
const interruptedTypes = new Set([
  "session.execution.interrupted",
  "session.execution.aborted",
  "session.execution.cancelled",
  "session.interrupted",
]);

const terminalEventNames = new Set(["Stop", "StopFailure", "Interrupt"]);

/** Terminal events close an agent turn; duplicates of the same one are noise. */
export function isTerminalEventName(eventName: string): boolean {
  return terminalEventNames.has(eventName);
}

function isAborted(error: unknown): boolean {
  const type = String(
    (error as any)?.type || (error as any)?.name || "",
  ).toLowerCase();
  const message = String((error as any)?.message || "").toLowerCase();
  return (
    abortedErrorTypes.has(type) ||
    type.includes("abort") ||
    type.includes("cancel") ||
    message.includes("declined") ||
    message.includes("aborted") ||
    message.includes("interrupted")
  );
}

function describeError(error: unknown): Record<string, unknown> {
  if (typeof error === "string") return { message: error };
  if (error && typeof error === "object") return error as Record<string, unknown>;
  return {};
}

export type MappingContext = {
  /** Tool name learned from session.tool.input.started, which is the only
   * OpenCode event that carries it; tool.called/success omit the name. */
  toolName?: string;
};

/**
 * Maps one OpenCode server event to the ASTRO canonical event payloads it
 * produces. Returns an empty array for events that carry no traceable meaning
 * (deltas, progress, usage updates) so callers can drop them cheaply.
 */
export function mapOpenCodeEvent(
  event: AnyEvent,
  context: MappingContext = {},
): AstroPayload[] {
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
        toolName: context.toolName ?? data?.name,
        tool_input: data?.input,
      },
    ];
  }

  if (type === "session.tool.success") {
    return [
      {
        eventName: "PostToolUse",
        toolUseId: data?.id,
        toolName: context.toolName ?? data?.name,
        tool_response: data?.content,
        status: data?.metadata?.exit === 0 ? undefined : "failed",
      },
    ];
  }

  if (type === "session.tool.failed") {
    return [
      {
        eventName: "PostToolUseFailure",
        toolUseId: data?.id,
        toolName: context.toolName ?? data?.name,
        tool_response: describeError(data?.error),
        status: "failed",
      },
    ];
  }

  if (type === "permission.asked") {
    return [
      {
        eventName: "PermissionRequest",
        toolUseId: data?.source?.id,
        toolName: data?.action,
        permission: {
          action: data?.action,
          resources: data?.resources,
          message: data?.message,
        },
      },
    ];
  }

  if (type === "permission.replied") {
    return data?.reply === "reject"
      ? [
          {
            eventName: "PermissionDenied",
            permission: {
              requestId: data?.requestID,
              reply: data?.reply,
            },
          },
        ]
      : [];
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

  if (type === "session.step.failed") {
    return isAborted(data?.error)
      ? [{ eventName: "Interrupt", status: "failed" }]
      : [
          {
            eventName: "StopFailure",
            status: "failed",
            error: describeError(data?.error),
          },
        ];
  }

  if (interruptedTypes.has(type)) {
    return [{ eventName: "Interrupt", reason: data?.reason }];
  }

  if (type === "session.execution.failed" || type === "session.error") {
    return [
      {
        eventName: "StopFailure",
        status: "failed",
        error: describeError(data?.error ?? data),
      },
    ];
  }

  if (type === "session.compaction.started") {
    return [{ eventName: "PreCompact", reason: data?.reason }];
  }

  if (type === "session.compaction.ended") {
    return [
      {
        eventName: "PostCompact",
        reason: data?.reason,
        message: data?.text,
      },
    ];
  }

  if (type === "session.compaction.failed") {
    return [
      {
        eventName: "PostCompact",
        status: "failed",
        error: describeError(data?.error),
      },
    ];
  }

  if (type === "session.deleted") {
    return [{ eventName: "SessionEnd" }];
  }

  // session.idle exists but its firing cadence is unverified: treating it as a
  // terminal event would split a long run, so it stays unmapped.
  return [];
}