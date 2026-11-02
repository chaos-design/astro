/**
 * Where the console's data comes from.
 *
 * The console is a static bundle. Served by the local service it talks
 * same-origin, exactly as before. Deployed to Vercel or GitHub Pages it has no
 * backend of its own — its data is the service running on the reader's
 * machine, reached over the loopback interface:
 *
 *     https://astro.example.vercel.app/console/  →  http://127.0.0.1:5678/api/*
 *
 * Browsers treat loopback as a trustworthy origin, so an HTTPS page may call
 * it; what the *service* must do is allow the page's origin (CORS) and answer
 * the Private-Network preflight Chrome sends for public→local requests. Both
 * are server-side concerns (see `ASTRO_CORS_ORIGINS` in `server/server.mjs`);
 * this module only decides which URL the page talks to.
 *
 * Resolution order, once per mount:
 *
 * 1. `?api=<url>` — explicit and persisted, so a shared link keeps working
 *    after the query string is gone. An empty value means "same origin" and
 *    clears the stored override.
 * 2. `ASTROX_API_BASE` — the stored override from an earlier visit.
 * 3. Heuristic — a page served from the loopback (the local service, `pnpm
 *    dev`) talks same-origin; anything else is a deployment, which defaults to
 *    the service's default address on this machine.
 */

/** The address the service binds by default; overridable with ASTRO_PORT. */
export const defaultLocalApiBase = "http://127.0.0.1:5678";

/** Where the override is persisted between visits. */
export const apiBaseStorageKey = "ASTROX_API_BASE";

const localHostnames = new Set(["localhost", "127.0.0.1", "[::1]"]);

export type ApiBaseSource = "param" | "stored" | "heuristic" | "same-origin";

export interface ApiBaseResolution {
  /** Empty string means same-origin requests; otherwise `scheme://host[/path]`. */
  base: string;
  source: ApiBaseSource;
}

/**
 * Normalize a user-supplied base. Accepts `http(s)://host[:port][/path]`
 * (a path prefix survives, for consoles served behind a reverse proxy);
 * returns `""` for a same-origin request and `null` for anything unusable.
 */
export function normalizeApiBase(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return null;
  }
  if (url.search || url.hash) {
    return null;
  }
  const path = url.pathname.replace(/\/+$/, "");
  return `${url.protocol}//${url.host}${path}`;
}

/** True for the loopback origins the local service itself is served from. */
export function isLocalOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      localHostnames.has(url.hostname)
    );
  } catch {
    return false;
  }
}

/**
 * Decide the API base for this page load. `search` accepts a query string or
 * a parsed `URLSearchParams`; `stored` is the persisted override, if any.
 * Invalid input never throws — the resolver falls through to the next source.
 */
export function resolveApiBase({
  search = "",
  origin = typeof window === "undefined" ? "http://127.0.0.1" : window.location.origin,
  stored = "",
}: {
  search?: string | URLSearchParams;
  origin?: string;
  stored?: string;
} = {}): ApiBaseResolution {
  const params =
    search instanceof URLSearchParams ? search : new URLSearchParams(search);
  if (params.has("api")) {
    const normalized = normalizeApiBase(params.get("api") ?? "");
    if (normalized !== null) {
      return { base: normalized, source: "param" };
    }
  }
  const fromStorage = normalizeApiBase(stored ?? "");
  if (fromStorage) {
    return { base: fromStorage, source: "stored" };
  }
  if (isLocalOrigin(origin)) {
    return { base: "", source: "same-origin" };
  }
  return { base: defaultLocalApiBase, source: "heuristic" };
}

/** Prefix a same-origin API path with the configured base. */
export function joinApi(base: string, path: string): string {
  return `${base}${path}`;
}

/** The human-readable hint a deployed page needs when the service refuses it. */
export function corsHint(origin: string): string {
  return `ASTRO_CORS_ORIGINS=${origin}`;
}
