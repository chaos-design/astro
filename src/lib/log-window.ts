/**
 * Windowing math for the event log.
 *
 * The log can hold tens of thousands of events. Rendering every row makes
 * each live update and each interaction re-reconcile the whole list, which is
 * what turns into INP jank. These helpers turn the flat entry list into
 * measurable offsets so only the rows inside the viewport are mounted.
 */

/** Fallback heights used until the real rows are measured in the DOM. */
export const LOG_ROW_ESTIMATE = 50;
export const LOG_TURN_ESTIMATE = 30;

/** Vertical gap between stacked log items, mirroring the log list CSS. */
export const LOG_ROW_GAP = 6;

/** Extra items rendered above and below the viewport to smooth scrolling. */
export const LOG_OVERSCAN = 6;

export type LogRowMetrics = {
  gap: number;
  row: number;
  turn: number;
};

export type LogLayoutItem = {
  height: number;
  /** Index into the entry list, or -1 for a turn separator. */
  index: number;
  kind: "row" | "turn";
  top: number;
  turn: number;
};

export type LogLayout = {
  items: LogLayoutItem[];
  /** Start offset of each item, ascending, parallel to {@link LogLayout.items}. */
  offsets: number[];
  /** Start offset of each row, parallel to the entry list. */
  rowTops: number[];
  total: number;
};

type LogEntry = {
  turn: number;
};

/**
 * Lay out log entries (already ordered newest first) into turn separators and
 * rows with absolute offsets. Heights are uniform per kind, so the offsets
 * stay correct for scroll math and for locating a row by index.
 */
export function buildLogLayout(
  entries: readonly LogEntry[],
  metrics: LogRowMetrics = {
    gap: LOG_ROW_GAP,
    row: LOG_ROW_ESTIMATE,
    turn: LOG_TURN_ESTIMATE,
  },
): LogLayout {
  const items: LogLayoutItem[] = [];
  const offsets: number[] = [];
  const rowTops: number[] = new Array(entries.length);
  let top = 0;

  const push = (item: Omit<LogLayoutItem, "top">) => {
    if (items.length) {
      top += metrics.gap;
    }
    offsets.push(top);
    items.push({ ...item, top });
    top += item.height;
  };

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (index === 0 || entries[index - 1].turn !== entry.turn) {
      push({
        height: metrics.turn,
        index: -1,
        kind: "turn",
        turn: entry.turn,
      });
    }
    rowTops[index] = items.length ? top + metrics.gap : top;
    push({
      height: metrics.row,
      index,
      kind: "row",
      turn: entry.turn,
    });
  }

  return { items, offsets, rowTops, total: top };
}

/** First index whose offset is greater than or equal to `value`. */
export function lowerBound(offsets: readonly number[], value: number) {
  let low = 0;
  let high = offsets.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (offsets[middle] < value) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
}

/**
 * Inclusive-exclusive range of items intersecting the viewport, widened by
 * `overscan` on both sides.
 */
export function findVisibleRange(
  offsets: readonly number[],
  scrollTop: number,
  viewportHeight: number,
  overscan = LOG_OVERSCAN,
) {
  if (!offsets.length) {
    return { end: 0, start: 0 };
  }
  const start = Math.max(0, lowerBound(offsets, scrollTop) - overscan);
  const end = Math.min(
    offsets.length,
    lowerBound(offsets, scrollTop + viewportHeight) + overscan,
  );
  return { end: Math.max(start, end), start };
}

/**
 * Scroll target that brings a row into view. Returns `null` when the row is
 * already visible so callers can skip a scroll write entirely.
 */
export function resolveScrollTopForRow({
  center = false,
  rowHeight,
  scrollTop,
  top,
  viewportHeight,
}: {
  center?: boolean;
  rowHeight: number;
  scrollTop: number;
  top: number;
  viewportHeight: number;
}) {
  if (viewportHeight <= 0 || rowHeight <= 0) {
    return null;
  }
  if (center) {
    return Math.max(0, top - (viewportHeight - rowHeight) / 2);
  }
  if (top < scrollTop) {
    return top;
  }
  const bottom = top + rowHeight;
  if (bottom > scrollTop + viewportHeight) {
    return bottom - viewportHeight;
  }
  return null;
}
