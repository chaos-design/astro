/**
 * One payload resolution for every surface that answers "what does the
 * inspector show for this event": the main inspector's Input / Output tabs and
 * the global overlay dialog's payload resolution shared one shape until each
 * grew its own drift — the inspector never read the `text` spelling, and both
 * ended the output side on a fabricated `{message: null}` stub. A prompt row
 * (or a recovered `Reasoning`) therefore previewed a contentless JSON shell in
 * the dialog while the Agent view body rendered the real text from the same
 * payload. One resolver here keeps the two surfaces honest: a row must show
 * its own data everywhere, and a pane that has nothing to say falls back to
 * the row's payload — never to a stub whose only value is `null`.
 *
 * Presentation (Markdown splitting, field inventories) stays in
 * `payload-preview.ts` / `payload-markdown.ts`; this module only decides
 * *which* payload a tab previews.
 */

import type { TraceEvent } from "../types/trace.ts";

/**
 * The recorder normalizes `toolInput` / `toolResponse` onto the canonical
 * snake names even when the producer only carried the camel spelling, so an
 * empty `{}` can sit beside real content. An empty object is the recorder's
 * placeholder, never content: it must not shadow the next spelling down the
 * fallback chain (that shadowing is how a tool call's Input preview went
 * blank while `toolInput.command` was right there).
 */
export function payloadField(...values: unknown[]): unknown {
  for (const value of values) {
    if (
      value !== null &&
      value !== undefined &&
      !(
        typeof value === "object" &&
        !Array.isArray(value) &&
        Object.keys(value).length === 0
      )
    ) {
      return value;
    }
  }
  return null;
}

/**
 * The payload a reader of the event's *output* sees. The step's own captured
 * result wins, then the paired close's result, then a real reply / thinking
 * text (`last_assistant_message` / `message` / `text` — long-lived adapters
 * write thinking under `message`, transcript recovery under `text`), and
 * finally the event's own payload: a prompt submit or a payload-less event has
 * no output object, and printing `{message: null}` hid the very data the row
 * summary showed.
 */
export function resolveOutputPayload(
  event: TraceEvent | null | undefined,
  endEvent?: TraceEvent | null,
): unknown {
  if (!event) {
    return null;
  }
  const payload = event.payload ?? {};
  const paired = payloadField(
    payload.tool_response,
    payload.toolResponse,
    endEvent?.payload?.tool_response,
    endEvent?.payload?.toolResponse,
  );
  if (paired !== null) {
    return paired;
  }
  const text = payload.last_assistant_message || payload.message || payload.text;
  if (typeof text === "string" && text.trim()) {
    return { message: text };
  }
  return payload;
}

/**
 * The payload a reader of the event's *input* sees. A prompt submit is its own
 * input, a tool call reads its arguments from either spelling (own event
 * first, then the atom's start), and anything else falls back to the event's
 * own payload — the previous `{prompt: undefined, message: null, source: …}`
 * stub rendered as an empty shell for exactly the events that carried real
 * content one level down.
 */
export function resolveInputPayload(
  event: TraceEvent | null | undefined,
  startEvent?: TraceEvent | null,
): unknown {
  if (!event) {
    return null;
  }
  const startPayload = startEvent?.payload ?? {};
  if (startEvent?.eventName === "UserPromptSubmit") {
    return startEvent.payload ?? null;
  }
  const payload = event.payload ?? {};
  const input = payloadField(
    payload.tool_input,
    payload.toolInput,
    startPayload.tool_input,
    startPayload.toolInput,
  );
  if (input !== null) {
    return input;
  }
  return payload;
}
