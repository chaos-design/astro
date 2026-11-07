/**
 * Demo dataset loader.
 *
 * The sample run the console shows when it has no captured events used to be a
 * hardcoded array in `trace-model.ts`, which meant the bundle carried the data
 * and the service could not answer "what sample data do we have?" at all. The
 * dataset now lives in `data/demo-events.json`, is served by the local service
 * as `GET /api/demo-events`, and is parsed here.
 *
 * Two rules make that safe:
 *
 * - The service is not the only way to reach the file. A page served without
 *   the service (a static host, or `pnpm dev` with the API down) falls back to
 *   the same document at `/data/demo-events.json`, which the build copies into
 *   `dist/`. Both shapes are accepted: the endpoint wraps the document for
 *   diagnostics (`{ dataset, path, eventCount }`), the static file is the
 *   document itself.
 * - Nothing about the document is trusted. Every field is validated here,
 *   because a hand-edited file must produce a readable console notice rather
 *   than a blank page or a render crash.
 *
 * Times in the file are offsets from the moment it is loaded, not timestamps:
 * RUN HISTORY is an hours-based window, so absolute times would age out of it
 * and the sample run would silently disappear.
 */
import type { TraceEvent, TracePayload } from "@/types/trace";
import { normalizeTraceEvent } from "./trace-model.ts";

/** Lookup order. The service first, the build-time copy second. */
export const demoDatasetEndpoints = [
  "/api/demo-events",
  "/data/demo-events.json",
] as const;

/**
 * The explicit opt-in query param that lets a *production* deployment render
 * the sample run. A Vercel / GitHub Pages build keeps its honest empty state by
 * default (`shouldShowDemo` is dev/test only); the sample is a documented
 * opt-in, reached by appending `?demo=1` to the page URL. It is never an
 * implicit fallback — a deployment must not present sample runs as captured
 * evidence on its own.
 */
export const demoPreviewQueryParam = "demo";

/** The flag values that count as "preview the sample run". */
const demoPreviewFlagValues = new Set(["1", "true", "on", "yes"]);

/**
 * Is the explicit `?demo=1` preview switch present on this load? Accepted on a
 * query string or parsed `URLSearchParams`; anything absent or unrecognised is
 * "off", so a typo never silently turns the sample on.
 */
export function isDemoPreviewEnabled(
  search: string | URLSearchParams,
): boolean {
  const params =
    search instanceof URLSearchParams ? search : new URLSearchParams(search);
  const value = params.get(demoPreviewQueryParam);
  return value !== null && demoPreviewFlagValues.has(value.toLowerCase());
}

/**
 * Same-origin path to the built static copy, resolved *next to the page* rather
 * than at the host root. The console ships under a mount prefix (`/console/` on
 * a merged deployment, `/` on the local service), so a hard-coded absolute
 * `/data/demo-events.json` would miss the file when the page is served from
 * `/console/`.
 *
 * The path is normalised to a directory (trailing slash) before joining, because
 * Vercel rewrites `/console` → `/console/` internally and leaves the address bar
 * without the slash — a plain relative resolution from `…/console` would drop
 * the `console/` segment. Returned as a same-origin path (origin comes from the
 * page, not from the configured `?api=` base, which is a different origin).
 */
export function staticDemoDatasetEndpoint(): string {
  if (typeof document === "undefined" || !document.baseURI) {
    return "/data/demo-events.json";
  }
  const base = new URL(document.baseURI);
  let dir = base.pathname;
  if (!dir.endsWith("/")) {
    // An explicit `index.html` names the document inside its directory; any
    // other trailing segment is the app root (the no-slash `/console`).
    dir = dir.endsWith("index.html")
      ? dir.slice(0, -"index.html".length)
      : `${dir}/`;
  }
  return `${dir}data/demo-events.json`;
}

/** A stalled request must not leave the console on the loading skeleton. */
export const demoDatasetTimeoutMs = 4_000;

export interface DemoDatasetSession {
  id: string;
  source: string;
  workspaceId: string;
  cwd: string | null;
}

export interface DemoDatasetEntry {
  offsetMs: number;
  eventName: string;
  payload: TracePayload;
}

export interface DemoDataset {
  session: DemoDatasetSession;
  events: DemoDatasetEntry[];
}

export type DemoLoadStatus = "ready" | "empty" | "error" | "canceled";

export type DemoLoadResult =
  | {
      status: "ready";
      events: TraceEvent[];
      endpoint: string;
      sessionId: string;
    }
  | { status: "empty"; events: TraceEvent[]; endpoint: string }
  | { status: "error"; events: TraceEvent[]; error: string }
  | { status: "canceled"; events: TraceEvent[] };

export class DemoDatasetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DemoDatasetError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new DemoDatasetError(`${field} 必须是非空字符串`);
  }
  return value.trim();
}

/**
 * Validate a parsed dataset document. Accepts both the service envelope and a
 * bare document, so one loader covers the API and the static copy.
 */
export function parseDemoDataset(value: unknown): DemoDataset {
  const document =
    isRecord(value) && isRecord(value.dataset) ? value.dataset : value;
  if (!isRecord(document)) {
    throw new DemoDatasetError("示例数据集必须是 JSON 对象");
  }
  if (!isRecord(document.session)) {
    throw new DemoDatasetError("缺少 session 对象");
  }
  const session: DemoDatasetSession = {
    id: readText(document.session.id, "session.id"),
    source: readText(document.session.source, "session.source"),
    workspaceId:
      typeof document.session.workspaceId === "string" &&
      document.session.workspaceId.trim()
        ? document.session.workspaceId.trim()
        : "demo-workspace",
    cwd:
      typeof document.session.cwd === "string" && document.session.cwd.trim()
        ? document.session.cwd.trim()
        : null,
  };
  if (!Array.isArray(document.events)) {
    throw new DemoDatasetError("缺少 events 数组");
  }
  const events = document.events.map((entry, index) => {
    const position = `events[${index}]`;
    if (!isRecord(entry)) {
      throw new DemoDatasetError(`${position} 必须是 JSON 对象`);
    }
    const { offsetMs } = entry;
    if (typeof offsetMs !== "number" || !Number.isFinite(offsetMs)) {
      throw new DemoDatasetError(`${position}.offsetMs 必须是有限数字`);
    }
    if (entry.payload !== undefined && !isRecord(entry.payload)) {
      throw new DemoDatasetError(`${position}.payload 必须是 JSON 对象`);
    }
    return {
      offsetMs,
      eventName: readText(entry.eventName, `${position}.eventName`),
      payload: (entry.payload ?? {}) as TracePayload,
    };
  });
  return { session, events };
}

/**
 * Turn a dataset into canonical events anchored at `now`. Offsets are applied
 * here rather than in the file, and the result is sorted by time so a file
 * authored out of order still renders as a chronological run.
 */
export function buildDemoEvents(
  dataset: DemoDataset,
  now: number = Date.now(),
): TraceEvent[] {
  const { session } = dataset;
  // `index` breaks offset ties so the sort stays stable without relying on the
  // engine's stability guarantee for equal keys.
  const ordered = dataset.events
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) =>
      left.entry.offsetMs === right.entry.offsetMs
        ? left.index - right.index
        : left.entry.offsetMs - right.entry.offsetMs,
    )
    .map(({ entry }) => entry);
  return ordered.map((entry, index) => {
    const { payload } = entry;
    return normalizeTraceEvent({
      schemaVersion: 2,
      id: `demo-${index}`,
      capturedAt: new Date(now + entry.offsetMs).toISOString(),
      source: session.source,
      workspaceId: session.workspaceId,
      sessionId: session.id,
      eventName: entry.eventName,
      toolUseId: typeof payload.tool_use_id === "string" ? payload.tool_use_id : null,
      toolName: typeof payload.tool_name === "string" ? payload.tool_name : null,
      cwd: session.cwd,
      payload: {
        session_id: session.id,
        event_name: entry.eventName,
        ...(session.cwd ? { cwd: session.cwd } : {}),
        ...payload,
      },
    });
  });
}

function abortError(): Error {
  const error = new Error("示例数据请求已取消");
  error.name = "AbortError";
  return error;
}

async function requestJson(
  endpoint: string,
  {
    fetchImpl,
    signal,
    timeoutMs,
  }: {
    fetchImpl: typeof fetch;
    signal?: AbortSignal;
    timeoutMs: number;
  },
): Promise<unknown> {
  const controller = new AbortController();
  let timedOut = false;
  const forwardAbort = () => controller.abort();
  if (signal?.aborted) {
    throw abortError();
  }
  signal?.addEventListener("abort", forwardAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const response = await fetchImpl(endpoint, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new DemoDatasetError(`HTTP ${response.status}`);
    }
    const text = await response.text();
    try {
      return JSON.parse(text) as unknown;
    } catch {
      // A static host that rewrites unknown paths to index.html answers 200
      // with HTML. Say so instead of reporting a JSON syntax error.
      throw new DemoDatasetError("响应不是 JSON");
    }
  } catch (error) {
    if (timedOut) {
      throw new DemoDatasetError(`请求超时（${timeoutMs}ms）`);
    }
    if (signal?.aborted) {
      throw abortError();
    }
    throw error instanceof DemoDatasetError
      ? error
      : new DemoDatasetError(
          error instanceof Error ? error.message : String(error),
        );
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", forwardAbort);
  }
}

/**
 * Load the sample dataset from the first endpoint that answers with a valid
 * document. Never throws: the caller renders `ready` / `empty` / `error`, and
 * a canceled load (the component unmounted) is not an error to report.
 */
export async function loadDemoEvents({
  endpoints = demoDatasetEndpoints,
  fetchImpl = globalThis.fetch,
  now = Date.now(),
  signal,
  timeoutMs = demoDatasetTimeoutMs,
}: {
  endpoints?: readonly string[];
  fetchImpl?: typeof fetch;
  now?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
} = {}): Promise<DemoLoadResult> {
  let failure = "没有可用的示例数据来源";
  for (const endpoint of endpoints) {
    if (signal?.aborted) {
      return { status: "canceled", events: [] };
    }
    try {
      const payload = await requestJson(endpoint, {
        fetchImpl,
        signal,
        timeoutMs,
      });
      const dataset = parseDemoDataset(payload);
      if (!dataset.events.length) {
        return { status: "empty", events: [], endpoint };
      }
      return {
        status: "ready",
        endpoint,
        events: buildDemoEvents(dataset, now),
        sessionId: dataset.session.id,
      };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return { status: "canceled", events: [] };
      }
      failure = `${endpoint}: ${
        error instanceof Error ? error.message : String(error)
      }`;
    }
  }
  return { status: "error", events: [], error: failure };
}
