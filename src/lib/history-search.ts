import { differenceInCalendarDays } from "date-fns";

import { eventMeta, getEventSummary, getMessageCategory } from "./trace-model.ts";
import type {
  EventTone,
  MessageCategory,
  TraceEvent,
  TracePromptRun,
  TraceRunStatus,
  TraceSession,
} from "../types/trace.ts";

export type HistoryTimeRange =
  | "3h"
  | "6h"
  | "12h"
  | "today"
  | "yesterday"
  | "24h"
  | "7d"
  | "custom";

export type HistorySearchEntry = {
  category: EventTone;
  event: TraceEvent;
  eventId: string;
  eventLabel: string;
  messageCategory: MessageCategory;
  normalizedSearchFields: readonly string[];
  promptIndex: number | null;
  promptRunKey: string;
  promptTitle: string;
  searchFields: readonly string[];
  sessionId: string;
  sessionKey: string;
  sessionTitle: string;
  source: string;
  status: TraceRunStatus;
  summary: string;
  timestamp: number;
};

export type HistorySearchMatch = HistorySearchEntry & {
  score: number;
  snippet: string;
};

export type HistorySearchFilters = {
  categories: ReadonlySet<EventTone>;
  from: number | null;
  messageCategories: ReadonlySet<MessageCategory>;
  query: string;
  sources: ReadonlySet<string>;
  statuses: ReadonlySet<TraceRunStatus>;
  to: number | null;
};

export type HistoryDateBounds = {
  from: number | null;
  to: number | null;
  valid: boolean;
};

const rangeDurations: Readonly<
  Record<
    Extract<HistoryTimeRange, "3h" | "6h" | "12h" | "24h" | "7d">,
    number
  >
> = {
  "3h": 3 * 60 * 60 * 1_000,
  "6h": 6 * 60 * 60 * 1_000,
  "12h": 12 * 60 * 60 * 1_000,
  "24h": 24 * 60 * 60 * 1_000,
  "7d": 7 * 24 * 60 * 60 * 1_000,
};

function collectSearchValues(
  value: unknown,
  output: string[] = [],
  seen = new WeakSet<object>(),
): string[] {
  if (value === null || value === undefined) {
    return output;
  }
  if (typeof value === "object") {
    if (seen.has(value)) {
      return output;
    }
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach((child) => collectSearchValues(child, output, seen));
    } else {
      Object.entries(value).forEach(([key, child]) => {
        output.push(key);
        collectSearchValues(child, output, seen);
      });
    }
    return output;
  }
  output.push(String(value));
  return output;
}

function compactText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeSearchText(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase();
}

function scoreToken(normalizedValue: string, token: string) {
  const exactIndex = normalizedValue.indexOf(token);
  if (exactIndex >= 0) {
    return 1_000 - Math.min(300, exactIndex);
  }

  let firstIndex = -1;
  let lastIndex = -1;
  let tokenIndex = 0;
  for (
    let valueIndex = 0;
    valueIndex < normalizedValue.length && tokenIndex < token.length;
    valueIndex += 1
  ) {
    if (normalizedValue[valueIndex] !== token[tokenIndex]) {
      continue;
    }
    if (firstIndex < 0) {
      firstIndex = valueIndex;
    }
    lastIndex = valueIndex;
    tokenIndex += 1;
  }
  if (tokenIndex !== token.length) {
    return -1;
  }
  return 300 - Math.min(260, lastIndex - firstIndex);
}

function findEntryMatch(entry: HistorySearchEntry, query: string) {
  const tokens = normalizeSearchText(query).split(/\s+/).filter(Boolean);
  if (!tokens.length) {
    return { score: 0, snippet: entry.summary };
  }

  let score = 0;
  let snippet = entry.summary;
  for (const token of tokens) {
    let bestScore = -1;
    let bestField = "";
    for (const [index, field] of entry.normalizedSearchFields.entries()) {
      const fieldScore = scoreToken(field, token);
      if (fieldScore > bestScore) {
        bestScore = fieldScore;
        bestField = entry.searchFields[index] ?? field;
      }
    }
    if (bestScore < 0) {
      return null;
    }
    score += bestScore;
    if (!snippet || bestScore >= 700) {
      snippet = bestField;
    }
  }
  return { score, snippet: compactText(snippet) };
}

function promptRunForEvent(
  promptRuns: readonly TracePromptRun[],
  eventId: string,
) {
  return promptRuns.find((promptRun) =>
    promptRun.events.some((event) => event.id === eventId),
  );
}

export function buildHistorySearchIndex(
  sessions: readonly TraceSession[],
  promptRunsBySession: ReadonlyMap<string, readonly TracePromptRun[]>,
): HistorySearchEntry[] {
  return sessions.flatMap((session) => {
    const promptRuns = promptRunsBySession.get(session.key) ?? [];
    return session.events.flatMap((event) => {
      const promptRun = promptRunForEvent(promptRuns, event.id);
      if (promptRuns.length > 0 && !promptRun) {
        return [];
      }
      const summary = compactText(getEventSummary(event));
      const meta = eventMeta[event.eventName] ?? eventMeta.Unknown;
      const eventLabel = event.toolName || meta.label;
      const messageCategory = getMessageCategory(event);
      const status = promptRun?.status ?? session.status;
      const searchFields = [
        session.title,
        promptRun?.title ?? "",
        summary,
        eventLabel,
        event.eventName,
        event.nativeEventName,
        event.id,
        event.sessionId,
        event.locator,
        event.cwd ?? "",
        event.source,
        status,
        meta.tone,
        messageCategory,
        ...collectSearchValues(event.payload),
      ].filter(Boolean);
      return [{
        category: meta.tone,
        event,
        eventId: event.id,
        eventLabel,
        messageCategory,
        normalizedSearchFields: searchFields.map(normalizeSearchText),
        promptIndex: promptRun?.index ?? null,
        promptRunKey: promptRun?.key ?? "",
        promptTitle: promptRun?.title ?? "",
        searchFields,
        sessionId: session.id,
        sessionKey: session.key,
        sessionTitle: session.title,
        source: event.source,
        status,
        summary,
        timestamp: Date.parse(event.capturedAt) || 0,
      }];
    });
  }).sort((left, right) => right.timestamp - left.timestamp);
}

export function filterHistorySearchEntries(
  entries: readonly HistorySearchEntry[],
  filters: HistorySearchFilters,
): HistorySearchMatch[] {
  if (
    (filters.from !== null && !Number.isFinite(filters.from)) ||
    (filters.to !== null && !Number.isFinite(filters.to)) ||
    (filters.from !== null &&
      filters.to !== null &&
      filters.from > filters.to)
  ) {
    return [];
  }

  const query = filters.query.trim();
  const matches: HistorySearchMatch[] = [];
  for (const entry of entries) {
    if (
      (filters.from !== null && entry.timestamp < filters.from) ||
      (filters.to !== null && entry.timestamp > filters.to) ||
      (filters.categories.size &&
        !filters.categories.has(entry.category)) ||
      (filters.messageCategories.size &&
        !filters.messageCategories.has(entry.messageCategory)) ||
      (filters.sources.size && !filters.sources.has(entry.source)) ||
      (filters.statuses.size && !filters.statuses.has(entry.status))
    ) {
      continue;
    }
    const match = findEntryMatch(entry, query);
    if (match) {
      matches.push({ ...entry, ...match });
    }
  }
  return query
    ? matches.sort(
        (left, right) =>
          right.score - left.score || right.timestamp - left.timestamp,
      )
    : matches;
}

export function getHistoryDateBounds(
  range: HistoryTimeRange,
  now: number,
  customFrom = "",
  customTo = "",
): HistoryDateBounds {
  if (range === "today" || range === "yesterday") {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    if (range === "yesterday") {
      start.setDate(start.getDate() - 1);
      return {
        from: start.getTime(),
        to: start.getTime() + 24 * 60 * 60 * 1_000 - 1,
        valid: true,
      };
    }
    return { from: start.getTime(), to: now, valid: true };
  }
  if (range in rangeDurations) {
    return {
      from: now - rangeDurations[range as keyof typeof rangeDurations],
      to: now,
      valid: true,
    };
  }

  const from = customFrom ? Date.parse(`${customFrom}T00:00:00`) : null;
  const to = customTo ? Date.parse(`${customTo}T23:59:59.999`) : null;
  const rangeEnd = to ?? now;
  const valid =
    (from === null || Number.isFinite(from)) &&
    (to === null || Number.isFinite(to)) &&
    (from === null ||
      (from <= rangeEnd &&
        differenceInCalendarDays(rangeEnd, from) < 7));
  return { from, to, valid };
}
