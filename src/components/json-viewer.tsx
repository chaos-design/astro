import { Check, Copy } from "lucide-react";
import React, { Fragment, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

function parseJsonString(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  const candidate = value.trim();
  if (
    (!candidate.startsWith("{") || !candidate.endsWith("}")) &&
    (!candidate.startsWith("[") || !candidate.endsWith("]"))
  ) {
    return value;
  }

  try {
    return JSON.parse(candidate);
  } catch {
    return value;
  }
}

function indent(depth: number) {
  return "  ".repeat(depth);
}

function JsonValue({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (value === null || value === undefined) {
    return (
      <span className="json-token json-token--null">
        {value === null ? "null" : "undefined"}
      </span>
    );
  }

  if (typeof value === "string") {
    return (
      <span className="json-token json-token--string">
        {JSON.stringify(value)}
      </span>
    );
  }

  if (typeof value === "number") {
    return <span className="json-token json-token--number">{value}</span>;
  }

  if (typeof value === "boolean") {
    return (
      <span className="json-token json-token--boolean">{String(value)}</span>
    );
  }

  const isArray = Array.isArray(value);
  const entries = isArray
    ? value.map((item, index) => [String(index), item])
    : Object.entries(value as Record<string, unknown>);
  const open = isArray ? "[" : "{";
  const close = isArray ? "]" : "}";

  if (!entries.length) {
    return (
      <span className="json-token json-token--bracket">
        {open}
        {close}
      </span>
    );
  }

  return (
    <>
      <span className="json-token json-token--bracket">{open}</span>
      {"\n"}
      {entries.map(([key, item], index) => (
        <Fragment key={`${key}-${index}`}>
          {indent(depth + 1)}
          {!isArray ? (
            <>
              <span className="json-token json-token--key">
                {JSON.stringify(key)}
              </span>
              <span className="json-token json-token--punctuation">: </span>
            </>
          ) : null}
          <JsonValue value={item} depth={depth + 1} />
          {index < entries.length - 1 ? (
            <span className="json-token json-token--punctuation">,</span>
          ) : null}
          {"\n"}
        </Fragment>
      ))}
      {indent(depth)}
      <span className="json-token json-token--bracket">{close}</span>
    </>
  );
}

export function JsonViewer({
  value,
  emptyLabel = "No structured data.",
}: {
  value: unknown;
  emptyLabel?: string;
}) {
  const [copied, setCopied] = useState(false);
  const normalizedValue = useMemo(() => parseJsonString(value), [value]);
  const text = useMemo(() => {
    if (normalizedValue === undefined) {
      return "undefined";
    }
    if (typeof normalizedValue === "string") {
      return normalizedValue;
    }
    return JSON.stringify(normalizedValue, null, 2);
  }, [normalizedValue]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="json-viewer">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="console"
            size="icon-xs"
            className="json-viewer__copy"
            onClick={copy}
            aria-label={copied ? "JSON 已复制" : "复制 JSON"}
          >
            {copied ? <Check /> : <Copy />}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="left">
          {copied ? "已复制" : "复制 JSON"}
        </TooltipContent>
      </Tooltip>
      <pre>
        {normalizedValue === undefined ? (
          <span className="json-viewer__empty">{emptyLabel}</span>
        ) : (
          <JsonValue value={normalizedValue} />
        )}
      </pre>
    </div>
  );
}
