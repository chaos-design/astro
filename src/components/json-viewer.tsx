import { Check, ChevronDown, ChevronRight, Copy } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";

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

type TokenType =
  | "key"
  | "string"
  | "number"
  | "boolean"
  | "null"
  | "bracket"
  | "punct"
  | "text";

type Token = { t: TokenType; v: string };

/**
 * One visible line of the tree. Containers (and collapsed containers) carry a
 * `key` — the node path that toggles them — and their open/close rows sit at
 * the same indent. Line numbers are assigned by render order, so collapsing a
 * block renumbers the rows below it to match what is actually on screen.
 */
type JsonRow = {
  indent: number;
  tokens: Token[];
  key?: string;
  collapsed?: boolean;
};

const PUNCT_COLON: Token = { t: "punct", v: ": " };
const PUNCT_COMMA: Token = { t: "punct", v: "," };

function leafTokens(value: unknown): Token[] {
  if (value === null || value === undefined) {
    return [{ t: "null", v: value === undefined ? "undefined" : "null" }];
  }
  switch (typeof value) {
    case "string":
      return [{ t: "string", v: JSON.stringify(value) }];
    case "number":
      return [{ t: "number", v: String(value) }];
    case "boolean":
      return [{ t: "boolean", v: String(value) }];
    default:
      return [{ t: "text", v: String(value) }];
  }
}

function isContainer(value: unknown): boolean {
  return value !== null && typeof value === "object";
}

/**
 * Flatten the tree into display rows for the current collapsed set. `path` is
 * the node's address (`""` at the root, dotted for nested objects, numeric for
 * arrays) and is what the collapse toggle keys off. A collapsed container
 * folds its children into a single `{… N keys}` / `[… N items]` line.
 */
function buildRows(
  value: unknown,
  collapsed: ReadonlySet<string>,
): JsonRow[] {
  const walk = (
    value: unknown,
    indent: number,
    path: string,
    prefix: Token[],
    comma: Token[],
    out: JsonRow[],
  ): void => {
    if (!isContainer(value)) {
      out.push({ indent, tokens: [...prefix, ...leafTokens(value), ...comma] });
      return;
    }

    const isArr = Array.isArray(value);
    const entries: Array<[string, unknown]> = isArr
      ? (value as unknown[]).map((item, index) => [String(index), item])
      : Object.entries(value as Record<string, unknown>);

    if (entries.length === 0) {
      out.push({
        indent,
        tokens: [
          ...prefix,
          { t: "bracket", v: isArr ? "[ ]" : "{ }" },
          ...comma,
        ],
      });
      return;
    }

    const open: Token = { t: "bracket", v: isArr ? "[" : "{" };
    const close: Token = { t: "bracket", v: isArr ? "]" : "}" };

    if (collapsed.has(path)) {
      const summary: Token = {
        t: "text",
        v: `… ${entries.length} ${isArr ? "items" : "keys"}`,
      };
      out.push({
        indent,
        tokens: [...prefix, open, summary, close, ...comma],
        key: path,
        collapsed: true,
      });
      return;
    }

    out.push({ indent, tokens: [...prefix, open], key: path });
    entries.forEach(([key, child], index) => {
      const last = index === entries.length - 1;
      const childPrefix = isArr
        ? []
        : [
            { t: "key", v: JSON.stringify(key) } satisfies Token,
            PUNCT_COLON,
          ];
      const childPath = isArr
        ? `${path}#${key}`
        : path === ""
          ? key
          : `${path}.${key}`;
      walk(child, indent + 1, childPath, childPrefix, last ? [] : [PUNCT_COMMA], out);
    });
    out.push({ indent, tokens: [close, ...comma], key: undefined });
  };

  const rows: JsonRow[] = [];
  walk(value, 0, "", [], [], rows);
  return rows;
}

export function JsonViewer({
  value,
  emptyLabel = "No structured data.",
}: {
  value: unknown;
  emptyLabel?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const collapsedSet = useMemo(() => new Set(collapsed), [collapsed]);

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

  // The tree only makes sense over a real object/array; a scalar or a raw
  // string falls back to a single highlighted line.
  const showTree =
    normalizedValue !== undefined &&
    isContainer(normalizedValue);
  const rows = useMemo(
    () => (showTree ? buildRows(normalizedValue, collapsedSet) : []),
    [showTree, normalizedValue, collapsedSet],
  );

  const toggle = (key: string) => {
    setCollapsed((prev) =>
      prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key],
    );
  };

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
      {/* The glyph already is the action, and the button switches to a check
          once the copy lands, so the hover card was repeating the aria-label. */}
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
      <div className="json-viewer__rows">
        {showTree ? (
          rows.map((row, index) => (
            <div className="json-line" key={`${row.key ?? "leaf"}-${index}`}>
              <span className="json-line__no" aria-hidden="true">
                {index + 1}
              </span>
              <div
                className="json-line__body"
                style={{ paddingLeft: `${row.indent * 14}px` }}
              >
                {row.key !== undefined ? (
                  <button
                    type="button"
                    className="json-line__toggle"
                    aria-label={row.collapsed ? "展开节点" : "折叠节点"}
                    onClick={() => toggle(row.key as string)}
                  >
                    {row.collapsed ? (
                      <ChevronRight aria-hidden="true" />
                    ) : (
                      <ChevronDown aria-hidden="true" />
                    )}
                  </button>
                ) : null}
                <div className="json-line__tokens">
                  {row.tokens.map((token, tokenIndex) => (
                    <span
                      className={`json-token json-token--${token.t}`}
                      key={tokenIndex}
                    >
                      {token.v}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ))
        ) : normalizedValue === undefined ? (
          <span className="json-viewer__empty">{emptyLabel}</span>
        ) : (
          <div className="json-line">
            <span className="json-line__no" aria-hidden="true">
              1
            </span>
            <div className="json-line__body">
              <div className="json-line__tokens">
                {leafTokens(normalizedValue).map((token, tokenIndex) => (
                  <span
                    className={`json-token json-token--${token.t}`}
                    key={tokenIndex}
                  >
                    {token.v}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
