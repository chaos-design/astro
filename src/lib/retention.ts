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
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "RetentionRequestError";
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
    throw new RetentionRequestError(message, response.status);
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
