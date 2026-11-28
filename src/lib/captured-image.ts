/**
 * One classifier for a captured value that might name a file or an image.
 *
 * A tool result can carry an inline data URL, a remote URL, an absolute local
 * path, or a small record (`{ type: "image", file: "…" }`). Every surface that
 * previews such a value — item blocks, call fields, Markdown images — must
 * agree on what it is. Keeping one whitelist and one classifier here means a
 * value rendered as an image in the Agent view cannot turn back into text in
 * the Preview pane, and a PDF is never mistaken for a screenshot.
 *
 * This is display classification only: nothing writes back to a captured
 * event. Local files are served through the read-only `/api/file` window,
 * which repeats the extension check on the server for its own safety.
 */

/** The image MIME subtypes the console accepts, shared by every surface. */
export const CAPTURED_IMAGE_MIME_TYPES = new Set([
  "png", "jpeg", "jpg", "gif", "webp", "svg", "svg+xml", "avif", "bmp",
]);

/** Extension → MIME, the one table behind local and remote image sources. */
export const CAPTURED_IMAGE_MIME_BY_EXTENSION: ReadonlyMap<string, string> =
  new Map([
    [".png", "image/png"],
    [".jpg", "image/jpeg"],
    [".jpeg", "image/jpeg"],
    [".gif", "image/gif"],
    [".webp", "image/webp"],
    [".svg", "image/svg+xml"],
    [".avif", "image/avif"],
    [".bmp", "image/bmp"],
  ]);

const DATA_IMAGE = /^data:image\/([a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/i;
const REMOTE_URL = /^https?:\/\//i;
const FILE_EXTENSION = /\.([a-z0-9]{1,8})$/i;
const PATH_KEYS = [
  "file", "path", "file_path", "filePath", "url", "uri",
  "image", "image_url", "imageUrl", "src",
];

export type CapturedResource =
  | {
      kind: "image";
      origin: "data" | "remote" | "local";
      src: string;
      /** File name at the end of the path / URL, or "" for a data URL. */
      name: string;
      mime: string;
    }
  | {
      kind: "file";
      /** Original captured path / URL. */
      path: string;
      name: string;
      mime: string;
    }
  | { kind: "text" };

export type CapturedImage = Extract<CapturedResource, { kind: "image" }>;

function fileNameOf(path: string): string {
  const withoutQuery = path.split(/[?#]/, 1)[0] ?? "";
  return withoutQuery.split(/[\\/]/).filter(Boolean).pop() ?? "";
}

function mimeOf(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot < 0) {
    return "";
  }
  return CAPTURED_IMAGE_MIME_BY_EXTENSION.get(name.slice(dot).toLowerCase()) ?? "";
}

function imageResource(
  origin: "data" | "remote" | "local",
  src: string,
  name: string,
  mime: string,
): CapturedImage {
  return { kind: "image", origin, src, name, mime };
}

/**
 * Classify one captured value. Unknown shapes stay `text` — a preview must
 * never throw away data it cannot type, it just prints it. A typed record is
 * followed through its path field so `{ type: "file", file: "a.pdf" }` and a
 * bare `/a.pdf` land in the same bucket.
 */
export function classifyCapturedResource(
  value: unknown,
  apiBase: string,
): CapturedResource {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const type = `${typeof record.type === "string" ? record.type : ""} ${typeof record.mimeType === "string" ? record.mimeType : ""}`.toLowerCase();
    const explicitImage = type.includes("image");
    // A Read result carries both a `file_path` and its text. That is content
    // with a location, not an attachment — printing only a file chip would
    // throw the text away. Only a record whose payload *is* the file reference
    // is classified as a resource.
    const hasContent = [
      "content", "text", "message", "result", "output", "stdout", "stderr", "plan",
    ].some((key) => typeof record[key] === "string" && record[key].trim());
    if (hasContent && !explicitImage) {
      return { kind: "text" };
    }
    for (const key of PATH_KEYS) {
      const candidate = record[key];
      if (typeof candidate !== "string" || !candidate.trim()) {
        continue;
      }
      const found = classifyCapturedResource(candidate.trim(), apiBase);
      if (found.kind !== "text") {
        return found;
      }
      // An explicit image annotation can type a path without an extension —
      // the host said it is an image, so trust the host over the file name.
      if (type.includes("image")) {
        return imageResource("local", candidate.trim(), fileNameOf(candidate), "image/*");
      }
    }
    return { kind: "text" };
  }
  if (typeof value !== "string") {
    return { kind: "text" };
  }
  const text = value.trim();
  if (!text) {
    return { kind: "text" };
  }
  const data = DATA_IMAGE.exec(text);
  if (data && CAPTURED_IMAGE_MIME_TYPES.has(data[1].toLowerCase())) {
    return imageResource("data", text, "", `image/${data[1].toLowerCase()}`);
  }
  if (REMOTE_URL.test(text)) {
    // Credentials in a URL are never a preview source: they leak the host's
    // secrets into an <img> request and into the related-data pane.
    try {
      const parsed = new URL(text);
      if (parsed.username || parsed.password) {
        return { kind: "text" };
      }
    } catch {
      return { kind: "text" };
    }
    const name = fileNameOf(text);
    const mime = mimeOf(name);
    if (mime) {
      return imageResource("remote", text, name, mime);
    }
    if (FILE_EXTENSION.test(name)) {
      return { kind: "file", path: text, name, mime: "" };
    }
    return { kind: "text" };
  }
  if (text.startsWith("/")) {
    const name = fileNameOf(text);
    const mime = mimeOf(name);
    if (mime) {
      return imageResource(
        "local",
        `${apiBase}/api/file?path=${encodeURIComponent(text)}`,
        name,
        mime,
      );
    }
    if (FILE_EXTENSION.test(name)) {
      return { kind: "file", path: text, name, mime: "" };
    }
  }
  return { kind: "text" };
}

/** Back-compatible image-only view of the classifier. */
export function resolveCapturedImage(
  value: unknown,
  apiBase: string,
): CapturedImage | null {
  const found = classifyCapturedResource(value, apiBase);
  return found.kind === "image" ? found : null;
}
