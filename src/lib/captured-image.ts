/**
 * Whether a captured value *is* an image resource, and how the console shows
 * it. Three shapes a tool result can carry: an inline data URL (renders
 * directly), a remote URL (the browser fetches it), and an absolute local
 * path (the console's read-only image window serves it — the browser cannot
 * read the user's filesystem itself). Any other value is not an image.
 */
export type CapturedImage = {
  kind: "data" | "remote" | "local";
  src: string;
};

const IMAGE_FILE_EXTENSIONS =
  /\.(png|jpe?g|gif|webp|svg|avif|bmp)(\?[^"\s]*)?$/i;

const REMOTE_URL = /^https?:\/\//i;

export function resolveCapturedImage(
  value: unknown,
  apiBase: string,
): CapturedImage | null {
  if (typeof value !== "string") {
    return null;
  }
  const text = value.trim();
  if (text.startsWith("data:image/")) {
    return { kind: "data", src: text };
  }
  if (REMOTE_URL.test(text) && IMAGE_FILE_EXTENSIONS.test(text.split("?")[0])) {
    return { kind: "remote", src: text };
  }
  if (!text.startsWith("/") || !IMAGE_FILE_EXTENSIONS.test(text)) {
    return null;
  }
  // A local capture: the image window only serves image extensions, so a
  // path that slips past the regex still fails closed on the server.
  return {
    kind: "local",
    src: `${apiBase}/api/file?path=${encodeURIComponent(text)}`,
  };
}
