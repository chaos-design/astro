import {
  ChevronDown,
  Search,
} from "lucide-react";
import {
  memo,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { OthersAgentIcon } from "./agent-icons";
import { PlatformIcon } from "./platform-icon";
import { Button } from "@/components/ui/button";
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
import { agentOptions } from "@/config/atom-platforms";
import { OTHERS_AGENT_ID } from "@/lib/run-history-window";
import type { PlatformId } from "@/types/trace";
import { cn } from "@/lib/utils";

type AgentValue = PlatformId | typeof OTHERS_AGENT_ID;

type AgentOption = {
  id: AgentValue;
  label: string;
};

/**
 * Every configured agent plus the trailing "Others" catch-all, in dropdown
 * display order (the agent list itself is ordered by atom-platforms.ts).
 */
const agentSelectOptions: AgentOption[] = [
  ...agentOptions.map((agent) => ({ id: agent.id as AgentValue, label: agent.label })),
  { id: OTHERS_AGENT_ID, label: "Others" },
];

function getAgentLabel(value: AgentValue) {
  return (
    agentSelectOptions.find((option) => option.id === value)?.label ?? "Others"
  );
}

function renderAgentIcon(value: AgentValue) {
  return value === OTHERS_AGENT_ID ? (
    <OthersAgentIcon />
  ) : (
    <PlatformIcon platform={value} />
  );
}

/**
 * Searchable agent picker. The native Select could not filter, and the agent
 * list keeps growing, so this combobox pairs a search input with the option
 * list and full keyboard navigation (arrows, home/end, enter, escape).
 */
export const AgentSelect = memo(function AgentSelect({
  value,
  onChange,
}: {
  value: AgentValue;
  onChange: (value: AgentValue) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [focusedIndex, setFocusedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const listId = useId();

  const filteredOptions = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return agentSelectOptions;
    }
    return agentSelectOptions.filter(
      (option) =>
        option.label.toLowerCase().includes(needle) ||
        String(option.id).toLowerCase().includes(needle),
    );
  }, [query]);

  useEffect(() => {
    setFocusedIndex(0);
  }, [query, open]);

  // Keep the keyboard-highlighted option visible while navigating.
  useEffect(() => {
    if (!open) {
      return;
    }
    listRef.current
      ?.querySelector(".agent-select__option.is-focused")
      ?.scrollIntoView({ block: "nearest" });
  }, [focusedIndex, open]);

  const moveFocus = (delta: number) => {
    if (!filteredOptions.length) {
      return;
    }
    setFocusedIndex(
      (current) =>
        (current + delta + filteredOptions.length) % filteredOptions.length,
    );
  };

  const commit = (option: AgentOption) => {
    onChange(option.id);
    setOpen(false);
  };

  const handleSearchKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveFocus(1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      moveFocus(-1);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      setFocusedIndex(0);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      setFocusedIndex(Math.max(0, filteredOptions.length - 1));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const option = filteredOptions[focusedIndex];
      if (option) {
        commit(option);
      }
    }
    // Escape closes the popover through Radix.
  };

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) {
          setQuery("");
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn("platform-select", `platform-select--${value}`)}
          aria-label="切换智能体平台"
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          {renderAgentIcon(value)}
          <span>{getAgentLabel(value)}</span>
          <ChevronDown aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="agent-select__popover"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          inputRef.current?.focus();
        }}
      >
        <InputGroup className="agent-select__search">
          <InputGroupAddon align="inline-start">
            <Search aria-hidden="true" />
          </InputGroupAddon>
          <InputGroupInput
            ref={inputRef}
            aria-label="搜索智能体"
            aria-controls={listId}
            placeholder="搜索名称或 ID"
            role="combobox"
            aria-expanded={open}
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={handleSearchKeyDown}
          />
        </InputGroup>
        {filteredOptions.length === 0 ? (
          <p className="agent-select__empty">
            没有匹配“{query.trim()}”的智能体
          </p>
        ) : (
          <div
            className="agent-select__list"
            id={listId}
            ref={listRef}
            role="listbox"
            aria-label="智能体列表"
          >
            {filteredOptions.map((option, index) => (
              <button
                type="button"
                key={option.id}
                role="option"
                aria-selected={option.id === value}
                className={cn(
                  "agent-select__option",
                  index === focusedIndex && "is-focused",
                  option.id === value && "is-selected",
                )}
                onMouseMove={() => setFocusedIndex(index)}
                onClick={() => commit(option)}
              >
                {renderAgentIcon(option.id)}
                <span>{option.label}</span>
              </button>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
});
