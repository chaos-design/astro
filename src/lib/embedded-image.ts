/**
 * Captured image resources are often inlined as `data:image/<mime>;base64,…`
 * inside a tool response or a related field. They are the actual thing the
 * agent saw, but in a text preview they read as a wall of base64.
 *
 * These helpers only read and rewrite *display* strings:
 *  - `findDataImages` returns the distinct, safe image sources in a string;
 *  - `replaceDataImages` swaps the raw blobs for a short placeholder.
 * Nothing writes back to a captured event, and the Code view keeps the raw
 * payload untouched.
 */

// No whitespace in the encoded body: a whitespace-inclusive class would keep
// consuming the words *after* an inline image in a JSON string.
export const DATA_IMAGE_PATTERN =
  /data:image\/(png|jpe?g|gif|webp|avif|bmp);base64,([A-Za-z0-9+/=]+)/g;

/** The set of MIME types the console and the Markdown sanitizer both allow. */
const ALLOWED_MIME = new Set(["png", "jpeg", "jpg", "gif", "webp", "avif", "bmp"]);

function normalize(match: RegExpExecArray): string | null {
  const mime = match[1].toLowerCase();
  if (!ALLOWED_MIME.has(mime)) {
    return null;
  }
  const encoded = match[2].replace(/\s/g, "");
  return encoded ? `data:image/${mime};base64,${encoded}` : null;
}

/** Distinct inline image sources found anywhere in a display string. */
export function findDataImages(text: string): string[] {
  if (typeof text !== "string" || !text.includes("data:image/")) {
    return [];
  }
  const out: string[] = [];
  const seen = new Set<string>();
  DATA_IMAGE_PATTERN.lastIndex = 0;
  for (let match = DATA_IMAGE_PATTERN.exec(text); match; match = DATA_IMAGE_PATTERN.exec(text)) {
    const source = normalize(match);
    if (source && !seen.has(source)) {
      seen.add(source);
      out.push(source);
    }
  }
  return out;
}

/** Swap raw base64 blobs for a short label so the surrounding text stays readable. */
export function replaceDataImages(
  text: string,
  placeholder = "[内嵌图片]",
): string {
  if (typeof text !== "string" || !text.includes("data:image/")) {
    return text;
  }
  DATA_IMAGE_PATTERN.lastIndex = 0;
  return text.replace(
    DATA_IMAGE_PATTERN,
    (match, mime: string, encoded: string) =>
      ALLOWED_MIME.has(mime.toLowerCase()) && encoded.replace(/\s/g, "")
        ? placeholder
        : match,
  );
}
