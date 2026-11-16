/**
 * Console → service calls for one interaction.
 *
 * The reducer owns the state; this module owns the wire format and the
 * optimistic update around it. Every click is applied locally first (the card
 * must light immediately — the hook's window is 4.5 seconds), then posted. A
 * failed POST reverts to the last seq the service confirmed, so the panel never
 * shows an answer the host will not receive.
 *
 * Submit is the only action with a lock: a double-click while the POST is in
 * flight would send two events, and the second one would be rejected as an old
 * seq after the request closed.
 */

import { joinApi } from "./api-base.ts";
import type {
  InteractionAction,
  InteractionEvent,
  InteractionResult,
} from "./interaction-contract.ts";
import {
  buildInteractionAnswers,
  isInteractionSubmittable,
  type InteractionAction as InteractionStateAction,
  type InteractionDraft,
} from "./interaction-reducer.ts";

export const consoleDeviceId = "console";

export interface InteractionTransport {
  /** Empty string means same-origin. */
  apiBase: string;
  deviceId?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  eventId?: () => string;
}

/** Event fields a caller may set; identity and ordering stay derived. */
export type InteractionEventFields = Omit<
  Partial<InteractionEvent>,
  "requestId" | "eventId" | "seq" | "action" | "deviceId" | "at"
>;

export interface InteractionSendResult {
  ok: boolean;
  /** A guard refused the call before any request was made. */
  blocked?: boolean;
  error?: string;
  result?: InteractionResult | null;
}

function defaultEventId(): string {
  return globalThis.crypto.randomUUID();
}

function eventUrl(transport: InteractionTransport, requestId: string): string {
  return joinApi(
    transport.apiBase,
    `/api/interactions/${encodeURIComponent(requestId)}/events`,
  );
}

function closeUrl(transport: InteractionTransport, requestId: string): string {
  return joinApi(
    transport.apiBase,
    `/api/interactions/${encodeURIComponent(requestId)}/close`,
  );
}

export function buildInteractionEvent(
  draft: InteractionDraft,
  action: InteractionAction,
  fields: InteractionEventFields = {},
  transport: InteractionTransport = { apiBase: "" },
): InteractionEvent {
  const now = transport.now?.() ?? Date.now();
  return {
    requestId: draft.request.requestId,
    eventId: transport.eventId?.() ?? defaultEventId(),
    seq: draft.seq + 1,
    action,
    deviceId: transport.deviceId ?? consoleDeviceId,
    at: new Date(now).toISOString(),
    ...fields,
  };
}

async function postJson(
  transport: InteractionTransport,
  url: string,
  body: unknown,
): Promise<{ ok: boolean; status: number; payload: unknown }> {
  const fetchImpl = transport.fetchImpl ?? globalThis.fetch;
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    return { ok: response.ok, status: response.status, payload };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      payload: { error: error instanceof Error ? error.message : String(error) },
    };
  }
}

function errorText(payload: unknown, fallback: string): string {
  const error =
    payload && typeof payload === "object" && "error" in payload
      ? String((payload as { error?: unknown }).error || "")
      : "";
  return error || fallback;
}

function resultOf(payload: unknown): InteractionResult | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const candidate = payload as Partial<InteractionResult>;
  return typeof candidate.status === "string" && candidate.requestId
    ? (candidate as InteractionResult)
    : null;
}

export type ConsoleInteractionAction =
  | "select"
  | "deselect"
  | "text"
  | "edit"
  | "skip";

/**
 * Apply one event locally and post it. Non-final actions never hold a lock;
 * they only roll back on failure.
 */
export async function sendInteractionEvent(
  draft: InteractionDraft,
  action: ConsoleInteractionAction,
  fields: InteractionEventFields,
  dispatch: (action: InteractionStateAction) => void,
  transport: InteractionTransport,
): Promise<InteractionSendResult> {
  const event = buildInteractionEvent(draft, action, fields, transport);
  dispatch({ type: "update", event });
  const response = await postJson(
    transport,
    eventUrl(transport, draft.request.requestId),
    event,
  );
  if (!response.ok) {
    dispatch({
      type: "revert",
      requestId: draft.request.requestId,
      seq: draft.seq,
    });
    return {
      ok: false,
      error: errorText(response.payload, `event rejected (${response.status})`),
    };
  }
  return { ok: true };
}

/** The one action with a submit lock: answers, optimistic submit, rollback. */
export async function submitInteraction(
  draft: InteractionDraft,
  dispatch: (action: InteractionStateAction) => void,
  transport: InteractionTransport,
): Promise<InteractionSendResult> {
  if (draft.pending) {
    return { ok: false, blocked: true, error: "submit already in flight" };
  }
  if (draft.result) {
    return { ok: false, blocked: true, error: "interaction already closed" };
  }
  if (!isInteractionSubmittable(draft)) {
    return { ok: false, blocked: true, error: "required answers missing" };
  }
  const event = buildInteractionEvent(
    draft,
    "submit",
    { answers: buildInteractionAnswers(draft) },
    transport,
  );
  dispatch({ type: "pending", requestId: draft.request.requestId, eventId: event.eventId });
  dispatch({ type: "update", event });
  const response = await postJson(
    transport,
    eventUrl(transport, draft.request.requestId),
    event,
  );
  if (!response.ok) {
    dispatch({
      type: "revert",
      requestId: draft.request.requestId,
      seq: draft.seq,
    });
    return {
      ok: false,
      error: errorText(response.payload, `submit rejected (${response.status})`),
    };
  }
  return { ok: true, result: resultOf(response.payload) };
}

/** Cancel is closed through the service, which broadcasts the one close frame. */
export async function cancelInteraction(
  draft: InteractionDraft,
  transport: InteractionTransport,
): Promise<InteractionSendResult> {
  const response = await postJson(
    transport,
    closeUrl(transport, draft.request.requestId),
    {
      status: "cancelled",
      answeredBy: transport.deviceId ?? consoleDeviceId,
    },
  );
  if (!response.ok) {
    return {
      ok: false,
      error: errorText(response.payload, `cancel rejected (${response.status})`),
    };
  }
  return { ok: true, result: resultOf(response.payload) };
}
