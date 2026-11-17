/**
 * Query parameters for the console's current position.
 *
 * `agent` is the scope of the RUN HISTORY dropdown and is always necessary.
 * `session` / `event` only describe the open run; keeping them after an agent
 * switch would deep-link the next page load back into the agent just left (a
 * `?session=` wins over the dropdown filter on load). They are written only
 * while a run of the selected agent is actually open.
 */
export interface ConsoleLocation {
  /** The current `window.location.search`, including unrelated params. */
  search: string;
  agentId: string;
  sessionId?: string | null;
  eventId?: string | null;
  /** Event ids that belong to the open run; an id outside it is stale. */
  eventIds?: ReadonlySet<string>;
  /** Switch in flight: keep only `agent`, never write session/event. */
  suppressSession?: boolean;
}

export function buildConsoleLocationSearch({
  search,
  agentId,
  sessionId,
  eventId,
  eventIds,
  suppressSession,
}: ConsoleLocation) {
  const params = new URLSearchParams(search);
  // The renamed parameter replaces the legacy one instead of accumulating.
  params.delete("source");
  params.set("agent", agentId);
  if (suppressSession || !sessionId) {
    // No run in this scope: a stale session/event would silently move the next
    // page load to another agent's message.
    params.delete("session");
    params.delete("event");
  } else {
    params.set("session", sessionId);
    if (eventId && (!eventIds || eventIds.has(eventId))) {
      params.set("event", eventId);
    } else {
      params.delete("event");
    }
  }
  return `?${params}`;
}
