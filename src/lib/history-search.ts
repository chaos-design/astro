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
  /**
   * Normalized payload text, capped at {@link HISTORY_SEARCH_PAYLOAD_BUDGET}
   * characters. Kept apart from {@link normalizedText} so a fuzzy subsequence
   * scan never walks a multi-kilobyte tool output.
   */
  normalizedPayload: string;
  /**
   * Normalized, newline-joined short fields (session/prompt titles, summary,
   * label, names, path, status…). Scoring one string per token instead of one
   * per field is what keeps a keystroke cheap on a 70k-entry index.
   */
  normalizedText: string;
  /**
   * Normalized head of the *semantic* fields only (session/prompt titles,
   * summary, label) used for fuzzy subsequence matching. Ids, paths and status
   * words are deliberately excluded: as subsequence haystacks they turn short
   * queries into noise ("pnpm" matching "/users/…/project-3").
   */
  normalizedFuzzy: string;
  promptIndex: number | null;
  promptRunKey: string;
  promptTitle: string;
  /** Raw short fields, used to build a snippet on demand (visible rows only). */
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

/**
 * How much payload text per event is indexed. Real captures average ~4.6KB per
 * event; indexing all of it multiplied a 70k-event history into hundreds of
 * megabytes of strings. The head of the payload carries the tool name,
 * command, path and the first lines of output — where people actually search.
 */
const HISTORY_SEARCH_PAYLOAD_BUDGET = 1_600;

/**
 * How much of the short-field block fuzzy matching looks at. Exact and
 * payload matches still cover everything; fuzzy is a convenience for titles
 * and summaries, which are at the front of the block.
 */
const HISTORY_SEARCH_FUZZY_BUDGET = 160;

/**
 * Payload text for the index. `JSON.stringify` is native and walks the whole
 * object in one pass, which measured ~2x faster than accumulating keys and
 * leaves with `+=`; the result is cut to the budget afterwards.
 */
function collectPayloadText(value: unknown): string {
  if (!value) {
    return "";
  }
  let text: string;
  try {
    text = JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
  return text.length > HISTORY_SEARCH_PAYLOAD_BUDGET
    ? text.slice(0, HISTORY_SEARCH_PAYLOAD_BUDGET)
    : text;
}

function compactText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

const asciiOnlyPattern = /^[\u0000-\u007f]*$/;

/**
 * `normalize("NFKC")` costs ~20ns per character, and a 70k-event index pushes
 * tens of megabytes through it. ASCII is already NFKC-normal, so only text
 * containing other code points pays for it (full-width CJK input, ligatures).
 */
function normalizeSearchText(value: string) {
  return asciiOnlyPattern.test(value)
    ? value.toLowerCase()
    : value.normalize("NFKC").toLowerCase();
}

function tokenizeSearchQuery(query: string) {
  const normalized = normalizeSearchText(query);
  return normalized.split(/\s+/).filter(Boolean);
}

/** Score an exact (case-insensitive, already normalized) substring hit. */
function exactTokenScore(normalizedValue: string, token: string) {
  const index = normalizedValue.indexOf(token);
  return index >= 0 ? 1_000 - Math.min(300, index) : -1;
}

/**
 * Score an ordered character subsequence ("bld" → "build"). Implemented as a
 * chain of native `indexOf` calls: a JS character loop costs ~20x more per
 * entry, and this runs for every entry that missed the exact substring.
 */
function fuzzyTokenScore(normalizedValue: string, token: string) {
  let position = 0;
  let firstIndex = -1;
  let lastIndex = -1;
  for (let index = 0; index < token.length; index += 1) {
    const found = normalizedValue.indexOf(token[index], position);
    if (found < 0) {
      return -1;
    }
    if (firstIndex < 0) {
      firstIndex = found;
    }
    lastIndex = found;
    position = found + 1;
  }
  return 300 - Math.min(260, lastIndex - firstIndex);
}

/**
 * Score one entry against already-tokenized query tokens. Short fields win
 * over payload text, and the payload is only checked for exact substrings so
 * a fuzzy query never scans a long tool output.
 */
function scoreEntry(
  entry: HistorySearchEntry,
  tokens: readonly string[],
): number {
  let score = 0;
  for (const token of tokens) {
    const exactScore = exactTokenScore(entry.normalizedText, token);
    if (exactScore >= 0) {
      score += exactScore;
      continue;
    }
    const fuzzyScore = fuzzyTokenScore(entry.normalizedFuzzy, token);
    if (fuzzyScore >= 0) {
      score += fuzzyScore;
      continue;
    }
    const payloadIndex = entry.normalizedPayload.indexOf(token);
    if (payloadIndex < 0) {
      return -1;
    }
    score += 400 - Math.min(300, payloadIndex);
  }
  return score;
}

/**
 * Payload matches come from stringified JSON, so the window around a hit is
 * full of escapes and keys. One cheap pass makes it readable without turning
 * the snippet builder into a JSON parser.
 */
function humanizeSnippet(value: string) {
  return value
    .replace(/\\[nrt]/g, " ")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
}

/**
 * A snippet is only rendered for the handful of visible rows, so it is built
 * on demand instead of being stored for every match.
 */
export function getHistorySearchSnippet(
  entry: HistorySearchEntry,
  query: string,
): string {
  const tokens = tokenizeSearchQuery(query);
  if (!tokens.length) {
    return entry.summary;
  }
  const summary = entry.summary.toLocaleLowerCase();
  if (tokens.some((token) => summary.includes(token))) {
    return entry.summary;
  }
  for (const field of entry.searchFields) {
    const normalized = field.toLocaleLowerCase();
    for (const token of tokens) {
      const index = normalized.indexOf(token);
      if (index < 0) {
        continue;
      }
      // Keep a little lead-in so the hit has context, but stay close to it:
      // payload hits sit inside stringified JSON, and a long lead turns the
      // snippet into keys and escapes.
      const start = Math.max(0, index - 12);
      const window = compactText(
        humanizeSnippet(field.slice(start, start + 200)),
      );
      return start > 0 ? `…${window}` : window;
    }
  }
  return entry.summary;
}

function promptRunsByEventId(promptRuns: readonly TracePromptRun[]) {
  const byEventId = new Map<string, TracePromptRun>();
  for (const promptRun of promptRuns) {
    for (const event of promptRun.events) {
      byEventId.set(event.id, promptRun);
    }
  }
  return byEventId;
}

/**
 * The window the dialog can display. The index is built for exactly this
 * range: searching the last 3 hours should not pay for every event ever
 * recorded, and widening the range is an explicit action that can afford a
 * rebuild.
 */
export type HistorySearchRange = {
  from: number | null;
  to: number | null;
};

export function buildHistorySearchIndex(
  sessions: readonly TraceSession[],
  promptRunsBySession: ReadonlyMap<string, readonly TracePromptRun[]>,
  range?: HistorySearchRange,
): HistorySearchEntry[] {
  const from = range?.from ?? null;
  const to = range?.to ?? null;
  const entries: HistorySearchEntry[] = [];
  for (const session of sessions) {
    // Session bounds are already on the object: skip whole runs before
    // touching their events. A terminal run's recorded duration is exact, so
    // only live runs need to fall through to the per-event check.
    if (to !== null && session.start > to) {
      continue;
    }
    if (
      from !== null &&
      session.status !== "active" &&
      session.status !== "waiting" &&
      session.start + (session.duration || 0) < from
    ) {
      continue;
    }
    const promptRuns = promptRunsBySession.get(session.key) ?? [];
    let promptRunByEventId: Map<string, TracePromptRun> | null = null;
    // One lookup table per session: scanning every prompt run for every event
    // was quadratic and dominated the build on long sessions. Built lazily so
    // sessions with nothing in the window never pay for it.
    const promptRunFor = (eventId: string) => {
      if (!promptRuns.length) {
        return undefined;
      }
      promptRunByEventId ??= promptRunsByEventId(promptRuns);
      return promptRunByEventId.get(eventId);
    };
    for (const event of session.events) {
      const timestamp = Date.parse(event.capturedAt) || 0;
      if (
        (from !== null && timestamp < from) ||
        (to !== null && timestamp > to)
      ) {
        continue;
      }
      const promptRun = promptRunFor(event.id);
      if (promptRuns.length > 0 && !promptRun) {
        continue;
      }
      const summary = compactText(getEventSummary(event));
      const meta = eventMeta[event.eventName] ?? eventMeta.Unknown;
      const eventLabel = event.toolName || meta.label;
      const messageCategory = getMessageCategory(event);
      const status = promptRun?.status ?? session.status;
      const payloadText = collectPayloadText(event.payload);
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
      ].filter(Boolean);
      const normalizedText = normalizeSearchText(searchFields.join("\n"));
      const fuzzyText = normalizeSearchText(
        [session.title, promptRun?.title ?? "", summary, eventLabel]
          .filter(Boolean)
          .join("\n"),
      );
      entries.push({
        category: meta.tone,
        event,
        eventId: event.id,
        eventLabel,
        messageCategory,
        // One normalize pass per entry instead of one per field.
        normalizedPayload: payloadText
          ? normalizeSearchText(payloadText)
          : "",
        normalizedText: normalizedText,
        normalizedFuzzy: fuzzyText.slice(0, HISTORY_SEARCH_FUZZY_BUDGET),
        promptIndex: promptRun?.index ?? null,
        promptRunKey: promptRun?.key ?? "",
        promptTitle: promptRun?.title ?? "",
        searchFields: payloadText
          ? [...searchFields, payloadText]
          : searchFields,
        sessionId: session.id,
        sessionKey: session.key,
        sessionTitle: session.title,
        source: event.source,
        status,
        summary,
        timestamp,
      });
    }
  }
  return entries.sort((left, right) => right.timestamp - left.timestamp);
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

  // Tokenizing once here instead of once per entry is the difference between
  // a keystroke costing a few milliseconds and a second on a full history.
  const tokens = tokenizeSearchQuery(filters.query);
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
    if (!tokens.length) {
      // Nothing to score: hand back the entries themselves rather than
      // cloning tens of thousands of objects for a score nobody reads.
      matches.push(entry as HistorySearchMatch);
      continue;
    }
    const score = scoreEntry(entry, tokens);
    if (score >= 0) {
      matches.push({ ...entry, score });
    }
  }
  return tokens.length
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
