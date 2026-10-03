import {
  Bot,
  CalendarDays,
  ChevronDown,
  Clock3,
  FilterX,
  Search,
  Shapes,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { format } from "date-fns";
import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { DateRange } from "react-day-picker";

import { PlatformIcon } from "@/components/platform-icon";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import {
  filterHistorySearchEntries,
  getHistoryDateBounds,
  type HistorySearchEntry,
  type HistorySearchMatch,
  type HistoryTimeRange,
} from "@/lib/history-search";
import { cn } from "@/lib/utils";
import { atomPlatformOptions } from "@/config/atom-platforms";
import type {
  EventTone,
  PlatformId,
  TraceRunStatus,
} from "@/types/trace";

const resultBatchSize = 60;
const defaultTimeRange = "3h" satisfies HistoryTimeRange;
const statusOptions: ReadonlyArray<{
  label: string;
  tone: string;
  value: TraceRunStatus;
}> = [
  { label: "Active", tone: "status-active", value: "active" },
  { label: "Waiting", tone: "status-waiting", value: "waiting" },
  { label: "Complete", tone: "status-complete", value: "complete" },
  { label: "Failed", tone: "status-failed", value: "failed" },
  { label: "Terminated", tone: "status-terminated", value: "terminated" },
];
const timeOptions: ReadonlyArray<{
  label: string;
  value: HistoryTimeRange;
}> = [
  { label: "Last 3 hours", value: "3h" },
  { label: "Last 6 hours", value: "6h" },
  { label: "Last 12 hours", value: "12h" },
  { label: "Last 24 hours", value: "24h" },
  { label: "Today", value: "today" },
  { label: "Yesterday", value: "yesterday" },
  { label: "Last 7 days", value: "7d" },
];
const categoryOrder: readonly EventTone[] = [
  "prompt",
  "agent",
  "tool",
  "reasoning",
  "signal",
  "session",
  "complete",
  "failed",
  "unknown",
];
const categoryLabels: Readonly<Record<EventTone, string>> = {
  agent: "Agent message",
  complete: "Completion",
  failed: "Failure",
  prompt: "Prompt",
  reasoning: "Reasoning",
  session: "Session",
  signal: "Signal",
  tool: "Tool",
  unknown: "Other",
};

type MultiSelectOption<T extends string> = {
  label: string;
  platform?: PlatformId;
  tone?: string;
  value: T;
};

function formatSearchTime(timestamp: number) {
  return new Date(timestamp).toLocaleString([], {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function toggleSetValue<T>(current: ReadonlySet<T>, value: T) {
  const next = new Set(current);
  if (next.has(value)) {
    next.delete(value);
  } else {
    next.add(value);
  }
  return next;
}

function truncateSnippet(value: string) {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > 320 ? `${compact.slice(0, 319)}...` : compact;
}

function dateRangeForFilter(
  range: HistoryTimeRange,
  now: number,
  customRange: DateRange | undefined,
): DateRange | undefined {
  if (range === "custom") {
    return customRange;
  }
  const bounds = getHistoryDateBounds(range, now);
  return bounds.from === null
    ? undefined
    : {
        from: new Date(bounds.from),
        to: bounds.to === null ? undefined : new Date(bounds.to),
      };
}

function formatRangeLabel(
  range: HistoryTimeRange,
  customRange: DateRange | undefined,
) {
  const preset = timeOptions.find((option) => option.value === range);
  if (preset) {
    return preset.label;
  }
  if (!customRange?.from) {
    return "Date range";
  }
  if (!customRange.to) {
    return `Since ${format(customRange.from, "MMM d, yyyy")}`;
  }
  return `${format(customRange.from, "MMM d")} - ${format(
    customRange.to,
    customRange.from.getFullYear() === customRange.to.getFullYear()
      ? "MMM d, yyyy"
      : "MMM d, yyyy",
  )}`;
}

function HighlightedText({
  query,
  text,
}: {
  query: string;
  text: string;
}) {
  const tokens = query
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!tokens.length) {
    return text;
  }
  const pattern = new RegExp(
    `(${tokens
      .map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("|")})`,
    "gi",
  );
  return (
    <>
      {text.split(pattern).map((part, index) =>
        tokens.some(
          (token) =>
            part.toLocaleLowerCase() === token.toLocaleLowerCase(),
        ) ? (
          <mark key={`${part}-${index}`}>{part}</mark>
        ) : (
          part
        ),
      )}
    </>
  );
}

function MultiSelectFilter<T extends string>({
  icon: Icon,
  label,
  onChange,
  options,
  values,
}: {
  icon: LucideIcon;
  label: string;
  onChange: (values: ReadonlySet<T>) => void;
  options: ReadonlyArray<MultiSelectOption<T>>;
  values: ReadonlySet<T>;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn(
            "history-search__filter",
            values.size > 0 && "is-active",
          )}
        >
          <Icon data-icon="inline-start" />
          {label}
          {values.size ? <span>{values.size}</span> : null}
          <ChevronDown data-icon="inline-end" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="history-search__filter-menu"
      >
        <DropdownMenuGroup>
          {options.map((option) => (
            <DropdownMenuCheckboxItem
              checked={values.has(option.value)}
              data-platform={option.platform}
              key={option.value}
              onCheckedChange={() =>
                onChange(toggleSetValue(values, option.value))
              }
              onSelect={(event) => event.preventDefault()}
            >
              {option.platform ? (
                <PlatformIcon platform={option.platform} />
              ) : option.tone ? (
                <i className={option.tone} />
              ) : null}
              {option.label}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DateRangeFilter({
  customRange,
  now,
  onChange,
  range,
}: {
  customRange: DateRange | undefined;
  now: number;
  onChange: (
    range: HistoryTimeRange,
    customRange?: DateRange,
  ) => void;
  range: HistoryTimeRange;
}) {
  const [open, setOpen] = useState(false);
  const selectedRange = dateRangeForFilter(range, now, customRange);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn(
            "history-search__filter history-search__time-filter",
            range !== defaultTimeRange && "is-active",
          )}
          aria-label="Filter by date range"
        >
          <CalendarDays data-icon="inline-start" />
          <span>{formatRangeLabel(range, customRange)}</span>
          <ChevronDown data-icon="inline-end" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={8}
        className="history-search__range-popover"
      >
        <div className="history-search__range-layout">
          <div
            className="history-search__quick-ranges"
            role="group"
            aria-label="Quick date ranges"
          >
            {timeOptions.map((option) => (
              <Button
                key={option.value}
                type="button"
                variant="ghost"
                size="xs"
                aria-pressed={range === option.value}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                {option.label}
              </Button>
            ))}
          </div>
          <Separator orientation="vertical" />
          <Calendar
            mode="range"
            max={6}
            numberOfMonths={2}
            defaultMonth={selectedRange?.from ?? new Date(now)}
            selected={selectedRange}
            disabled={{ after: new Date(now) }}
            onSelect={(nextRange) => {
              onChange(
                nextRange?.from ? "custom" : defaultTimeRange,
                nextRange,
              );
              if (nextRange?.from && nextRange.to) {
                setOpen(false);
              }
            }}
            className="history-search__calendar"
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

function SearchResult({
  match,
  onSelect,
  query,
}: {
  match: HistorySearchMatch;
  onSelect: (entry: HistorySearchEntry) => void;
  query: string;
}) {
  return (
    <button
      type="button"
      className="history-search__result"
      data-search-result
      onClick={() => onSelect(match)}
    >
      <span className="history-search__result-rail">
        <i className={`status-${match.status}`} />
        <span />
      </span>
      <span className="history-search__result-copy">
        <span className="history-search__result-head">
          <span data-tone={match.category}>{match.eventLabel}</span>
          <time dateTime={match.event.capturedAt}>
            {formatSearchTime(match.timestamp)}
          </time>
        </span>
        <span className="history-search__result-snippet">
          <HighlightedText
            query={query}
            text={truncateSnippet(match.snippet || match.summary)}
          />
        </span>
        <span className="history-search__result-meta">
          <span
            className="history-search__tag history-search__tag--source"
            data-source={match.source}
          >
            {match.source}
          </span>
          <span
            className="history-search__tag history-search__tag--status"
            data-status={match.status}
          >
            {match.status}
          </span>
          {match.promptIndex !== null ? (
            <span
              className="history-search__tag history-search__tag--prompt"
              title={match.promptTitle}
            >
              Prompt {match.promptIndex + 1}
              {match.promptTitle ? ` · ${match.promptTitle}` : ""}
            </span>
          ) : null}
          <span
            className="history-search__tag history-search__tag--session"
            title={match.sessionTitle}
          >
            {match.sessionTitle}
          </span>
        </span>
      </span>
    </button>
  );
}

export function HistorySearch({
  entries,
  onOpenChange,
  onSelect,
  open,
}: {
  entries: readonly HistorySearchEntry[];
  onOpenChange: (open: boolean) => void;
  onSelect: (entry: HistorySearchEntry) => void;
  open: boolean;
}) {
  const [query, setQuery] = useState("");
  const [timeRange, setTimeRange] =
    useState<HistoryTimeRange>(defaultTimeRange);
  const [customRange, setCustomRange] = useState<DateRange>();
  const [categories, setCategories] = useState<ReadonlySet<EventTone>>(
    () => new Set(),
  );
  const [sources, setSources] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [statuses, setStatuses] = useState<ReadonlySet<TraceRunStatus>>(
    () => new Set(),
  );
  const [visibleCount, setVisibleCount] = useState(resultBatchSize);
  const [openedAt, setOpenedAt] = useState(() => Date.now());
  const inputRef = useRef<HTMLInputElement | null>(null);
  const resultListRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const sourceOptions = useMemo(
    () => {
      const availableSources = new Set(
        entries.map((entry) => entry.source),
      );
      const configuredSources = new Set(
        atomPlatformOptions.map((platform) => platform.source),
      );
      const configuredOptions = atomPlatformOptions.map((platform) => ({
        label: platform.label,
        platform: platform.id,
        value: platform.source,
      }));
      const additionalOptions = [...availableSources]
        .filter((source) => !configuredSources.has(source))
        .sort()
        .map((source) => ({
          label: source.toUpperCase(),
          tone: `source-${source}`,
          value: source,
        }));
      return [...configuredOptions, ...additionalOptions];
    },
    [entries],
  );
  const categoryOptions = useMemo(() => {
    const available = new Set(entries.map((entry) => entry.category));
    return categoryOrder
      .filter((category) => available.has(category))
      .map((category) => ({
        label: categoryLabels[category],
        tone: `tone-${category}`,
        value: category,
      }));
  }, [entries]);
  const dateBounds = useMemo(
    () =>
      getHistoryDateBounds(
        timeRange,
        openedAt,
        customRange?.from
          ? format(customRange.from, "yyyy-MM-dd")
          : "",
        customRange?.to ? format(customRange.to, "yyyy-MM-dd") : "",
      ),
    [customRange, openedAt, timeRange],
  );
  const filterInput = useMemo(
    () => ({
      categories,
      from: dateBounds.valid ? dateBounds.from : Number.NaN,
      query,
      sources,
      statuses,
      to: dateBounds.to,
    }),
    [categories, dateBounds, query, sources, statuses],
  );
  const deferredFilters = useDeferredValue(filterInput);
  const matches = useMemo(
    () => filterHistorySearchEntries(entries, deferredFilters),
    [deferredFilters, entries],
  );
  const visibleMatches = useMemo(
    () => matches.slice(0, visibleCount),
    [matches, visibleCount],
  );
  const hasFilters =
    query.length > 0 ||
    timeRange !== defaultTimeRange ||
    categories.size > 0 ||
    sources.size > 0 ||
    statuses.size > 0;

  useEffect(() => {
    if (open) {
      setOpenedAt(Date.now());
    }
  }, [open]);

  useEffect(() => {
    setVisibleCount(resultBatchSize);
  }, [deferredFilters]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || visibleCount >= matches.length) {
      return undefined;
    }
    if (typeof IntersectionObserver === "undefined") {
      setVisibleCount(matches.length);
      return undefined;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisibleCount((current) =>
            Math.min(matches.length, current + resultBatchSize),
          );
        }
      },
      { root: resultListRef.current, rootMargin: "120px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [matches.length, visibleCount]);

  const resetFilters = () => {
    setQuery("");
    setTimeRange(defaultTimeRange);
    setCustomRange(undefined);
    setCategories(new Set());
    setSources(new Set());
    setStatuses(new Set());
    inputRef.current?.focus();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="history-search"
        showCloseButton={false}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          inputRef.current?.focus();
        }}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Search history</DialogTitle>
          <DialogDescription>
            Search loaded runs and locate a matching event.
          </DialogDescription>
        </DialogHeader>

        <div className="history-search__query-row">
          <InputGroup className="history-search__query">
            <InputGroupAddon align="inline-start">
              <Search aria-hidden="true" />
            </InputGroupAddon>
            <InputGroupInput
              aria-label="Search History"
              autoComplete="off"
              placeholder="Search history, status, tools, or content"
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && matches[0]) {
                  event.preventDefault();
                  onSelect(matches[0]);
                } else if (event.key === "ArrowDown") {
                  event.preventDefault();
                  resultListRef.current
                    ?.querySelector<HTMLButtonElement>("[data-search-result]")
                    ?.focus();
                }
              }}
            />
            <InputGroupAddon align="inline-end">
              <kbd>ESC</kbd>
            </InputGroupAddon>
          </InputGroup>
        </div>

        <div className="history-search__filters">
          <div className="history-search__filter-scroll">
            <DateRangeFilter
              customRange={customRange}
              now={openedAt}
              range={timeRange}
              onChange={(nextRange, nextCustomRange) => {
                setTimeRange(nextRange);
                setCustomRange(nextCustomRange);
              }}
            />
            <MultiSelectFilter
              icon={Bot}
              label="Agent"
              onChange={setSources}
              options={sourceOptions}
              values={sources}
            />
            <MultiSelectFilter
              icon={Clock3}
              label="Status"
              onChange={setStatuses}
              options={statusOptions}
              values={statuses}
            />
            <MultiSelectFilter
              icon={Shapes}
              label="Type"
              onChange={setCategories}
              options={categoryOptions}
              values={categories}
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="history-search__clear"
            aria-label="Clear all search filters"
            disabled={!hasFilters}
            onClick={resetFilters}
          >
            <FilterX data-icon="inline-start" />
            Clear
          </Button>
          <output
            className={cn(
              "history-search__count",
              filterInput !== deferredFilters && "is-pending",
            )}
            aria-live="polite"
          >
            {matches.length} matches
          </output>
        </div>

        <div className="history-search__results" ref={resultListRef}>
          {visibleMatches.map((match) => (
            <SearchResult
              key={match.eventId}
              match={match}
              onSelect={onSelect}
              query={deferredFilters.query}
            />
          ))}
          {!matches.length ? (
            <output className="history-search__empty">
              {dateBounds.valid
                ? "No matching history"
                : "The selected date range is invalid"}
            </output>
          ) : null}
          {visibleCount < matches.length ? (
            <div
              aria-hidden="true"
              className="history-search__sentinel"
              ref={sentinelRef}
            />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
