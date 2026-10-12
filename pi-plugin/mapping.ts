export type AstroPayload = Record<string, unknown> & { eventName: string };

type AnyEvent = {
  type?: string;
  [key: string]: any;
};

const terminalEventNames = new Set(["Stop", "StopFailure", "Interrupt"]);

/** Terminal events close an agent turn; duplicates of the same one are noise. */
export function isTerminalEventName(eventName: string): boolean {
  return terminalEventNames.has(eventName);
}

function joinBlocks(content: unknown, blockType: string, field: string): string {
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .filter((block) => block?.type === blockType)
    .map((block) =>
      String(block?.[field] ?? "").trim(),
    )
    .filter(Boolean)
    .join("\n");
}

/** Image blocks carry base64 payloads that would bloat trace events. */
function textOnlyContent(content: unknown): unknown {
  if (!Array.isArray(content)) {
    return content;
  }
  return content.filter((block) => block?.type !== "image");
}

function describeError(error: unknown): Record<string, unknown> {
  if (typeof error === "string") {
    return { message: error };
  }
  if (error && typeof error === "object") {
    return error as Record<string, unknown>;
  }
  return {};
}

export type PiMappingContext = {
  /**
   * Prompt text captured from the most recent `input` event and consumed by
   * `before_agent_start`. Pairing the two keeps slash commands and other
   * non-agent inputs from creating prompt runs that never execute.
   */
  pendingPrompt?: string;
};

/**
 * Maps one Pi extension event to the ASTRO canonical event payloads it
 * produces. Returns an empty array for events that carry no traceable meaning
 * (streaming deltas, turn markers, lifecycle bookkeeping) so callers can drop
 * them cheaply.
 *
 * Pi event shapes follow packages/coding-agent/docs/extensions.md in
 * badlogic/pi-mono: tool_call carries toolName/toolCallId/input, tool_result
 * carries content/details/isError, and assistant message_end carries the
 * message with stopReason "stop" | "length" | "toolUse" | "error" | "aborted".
 * Unknown fields are read defensively so a Pi update never breaks capture.
 */
export function mapPiEvent(
  type: string,
  event: AnyEvent,
  context: PiMappingContext = {},
): AstroPayload[] {
  switch (type) {
    case "session_start":
      return [{ eventName: "SessionStart" }];

    case "input": {
      const text = String(event?.text ?? "").trim();
      context.pendingPrompt = text || undefined;
      return [];
    }

    case "before_agent_start": {
      const prompt = context.pendingPrompt;
      context.pendingPrompt = undefined;
      return prompt ? [{ eventName: "UserPromptSubmit", prompt }] : [];
    }

    case "message_end": {
      const message = event?.message;
      if (message?.role !== "assistant") {
        return [];
      }
      const payloads: AstroPayload[] = [];
      const thinking = joinBlocks(message.content, "thinking", "thinking");
      if (thinking) {
        payloads.push({ eventName: "Reasoning", message: thinking });
      }
      const text = joinBlocks(message.content, "text", "text");
      if (text) {
        payloads.push({
          eventName: "AgentMessage",
          message: text,
          model: message.model,
          provider: message.provider,
          usage: message.usage,
        });
      }
      const stopReason = String(message.stopReason || "");
      if (stopReason === "error") {
        payloads.push({
          eventName: "StopFailure",
          status: "failed",
          error: describeError(message.errorMessage || "model error"),
        });
      } else if (stopReason === "aborted") {
        payloads.push({
          eventName: "Interrupt",
          reason: message.errorMessage || "aborted",
        });
      } else if (stopReason === "stop" || stopReason === "length") {
        payloads.push({ eventName: "Stop" });
      }
      // "toolUse" only means the agent loop continues after the tools run.
      return payloads;
    }

    case "tool_call":
      return [
        {
          eventName: "PreToolUse",
          toolUseId: event?.toolCallId,
          toolName: event?.toolName,
          tool_input: event?.input,
        },
      ];

    case "tool_result": {
      const failed = Boolean(event?.isError);
      return [
        {
          eventName: failed ? "PostToolUseFailure" : "PostToolUse",
          toolUseId: event?.toolCallId,
          toolName: event?.toolName,
          tool_response: {
            content: textOnlyContent(event?.content),
            details: event?.details,
          },
          ...(failed ? { status: "failed" } : {}),
        },
      ];
    }

    case "user_bash":
      return event?.command
        ? [
            {
              eventName: "Notification",
              message: `! ${event.command}`,
              notification_type: "user_bash",
              exitCode: event.exitCode,
            },
          ]
        : [];

    case "model_select": {
      const model = event?.model;
      const modelId =
        typeof model?.id === "string"
          ? model.id
          : typeof event?.modelId === "string"
            ? event.modelId
            : typeof model === "string"
              ? model
              : "";
      if (!modelId) {
        return [];
      }
      const provider =
        typeof model?.provider === "string"
          ? model.provider
          : typeof event?.provider === "string"
            ? event.provider
            : "";
      return [
        {
          eventName: "Notification",
          message: `model → ${provider ? `${provider}/` : ""}${modelId}`,
          notification_type: "model_select",
        },
      ];
    }

    case "session_before_compact":
      return [{ eventName: "PreCompact" }];

    case "session_compact":
      return [
        {
          eventName: "PostCompact",
          message:
            event?.summary ??
            event?.compaction?.summary ??
            event?.result?.summary,
          tokensBefore:
            event?.tokensBefore ?? event?.compaction?.tokensBefore,
        },
      ];

    case "session_shutdown":
      return [{ eventName: "SessionEnd" }];

    default:
      return [];
  }
}
