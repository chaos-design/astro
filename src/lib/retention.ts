import { joinApi } from "./api-base.ts";

/**
 * Retention over the local service.
 *
 * Deleting captured sessions is a filesystem operation, so the console never
 * does it: it asks the service for a *preview* (what would go, how much, how
 * old) and only then posts the prune. Both calls carry the same day window,
 * so the confirmation a reader sees is the deletion that happens.
 */

export type RetentionSession = {
  file: string;
  directory: string;
  lastCapturedAt: string;
  ageDays: number;
  bytes: number;
};

export type RetentionPreview = {
  days: number;
  cutoff: string;
  now: string;
  sessions: RetentionSession[];
  eventFiles: number;
  bytes: number;
};

export type RetentionPruneResult = {
  days: number;
  cutoff: string;
  removed: number;
  bytes: number;
  directories: number;
};

/** The preview request can fail for a bad window; the message is the service's. */
export class RetentionRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "RetentionRequestError";
    this.status = status;
  }
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) {
    const message =
      body && typeof body === "object" && "error" in body
        ? String((body as { error: unknown }).error)
        : `HTTP ${response.status}`;
    // A 404 means the service predates the retention routes: the settings
    // panel cannot fix that, only a restart of the local service can.
    throw new RetentionRequestError(
      response.status === 404
        ? `${message}：本地服务还没有清理接口，重启本地服务后再试`
        : message,
      response.status,
    );
  }
  // A static host that rewrites unknown paths to `index.html` answers 200 with
  // HTML, and an old service can answer 200 with no body. Both used to reach
  // the caller as `null` and crashed on `preview.eventFiles`; name the real
  // problem instead of a property access error.
  if (body === null || typeof body !== "object") {
    throw new RetentionRequestError(
      "本地服务没有返回 JSON（可能仍是旧版本，或请求被静态页回退）；重启本地服务后再试",
      response.status,
    );
  }
  return body as T;
}

export async function fetchRetentionPreview(
  apiBase: string,
  days: number,
  signal?: AbortSignal,
): Promise<RetentionPreview> {
  const response = await fetch(
    joinApi(apiBase, `/api/retention/preview?days=${encodeURIComponent(String(days))}`),
    { signal },
  );
  return readJsonResponse<RetentionPreview>(response);
}

export async function pruneRetention(
  apiBase: string,
  days: number,
  signal?: AbortSignal,
): Promise<RetentionPruneResult> {
  const response = await fetch(joinApi(apiBase, "/api/retention/prune"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ days }),
    signal,
  });
  return readJsonResponse<RetentionPruneResult>(response);
}

/** Human summary for the settings panel and the console notice. */
export function describeRetentionPreview(preview: RetentionPreview | null): string {
  if (!preview) {
    return "尚未读取清理预览";
  }
  if (preview.eventFiles === 0) {
    return `没有超过 ${preview.days} 天的消息`;
  }
  const megabytes = preview.bytes / (1024 * 1024);
  return `${preview.eventFiles} 条消息 · ${megabytes.toFixed(1)} MB 将超过 ${preview.days} 天`;
}
