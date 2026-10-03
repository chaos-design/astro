import type { TracePayload } from "../types/trace.ts";

export type PromptImage = {
  id: string;
  name: string;
  source: string;
  src: string | null;
};

export type PromptReference = {
  id: string;
  title: string;
  source: string;
  content: string;
};

export type PromptContent = {
  text: string;
  images: PromptImage[];
  references: PromptReference[];
};

const imageTypes = new Set(["image", "image_url", "input_image"]);
const referenceTypes = new Set(["file", "input_file", "reference", "code", "selection", "browser"]);
const imageMimePattern = /^image\/(?:png|jpe?g|gif|webp|avif|bmp)$/i;

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function string(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function contentText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(contentText).filter(Boolean).join("\n");
  const item = record(value);
  return string(item.text) || string(item.code) || string(item.outer_html) ||
    (item.content !== value ? contentText(item.content) : "");
}

export function safeImageSource(value: string): string | null {
  if (/^data:image\/(?:png|jpe?g|gif|webp|avif|bmp);base64,[a-z0-9+/=\s]+$/i.test(value)) {
    return value;
  }
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export function parsePromptContent(payload: TracePayload): PromptContent {
  const text: string[] = [];
  const images: PromptImage[] = [];
  const references: PromptReference[] = [];
  const imageKeys = new Set<string>();
  const referenceKeys = new Set<string>();
  const visited = new WeakSet<object>();

  const addImage = (value: unknown) => {
    const item = record(value);
    const source = record(item.source);
    const imageUrl = record(item.image_url);
    const mime = string(source.media_type) || string(item.media_type) ||
      string(item.mimeType) || string(item.mime_type);
    const data = string(source.data) || string(item.base64) || string(item.data);
    const encoded = data && imageMimePattern.test(mime)
      ? `data:${mime};base64,${data.replace(/\s/g, "")}`
      : "";
    const location = string(value) || string(item.image_url) || string(imageUrl.url) ||
      string(item.url) || string(item.src) || string(item.uri) || string(source.url) ||
      string(item.path) || string(item.file_path);
    const imageSource = encoded || location;
    const name = string(item.name) || string(item.filename) || string(item.alt) ||
      `Image ${images.length + 1}`;
    const key = imageSource || JSON.stringify(value);
    if (imageKeys.has(key)) return;
    imageKeys.add(key);
    images.push({
      id: `image-${images.length}`,
      name,
      source: imageSource.startsWith("data:") ? mime || "Embedded image" : imageSource,
      src: safeImageSource(imageSource),
    });
  };

  const addReference = (value: unknown) => {
    const item = record(value);
    const file = record(item.file);
    const location = string(item.path) || string(item.file_path) || string(item.uri) ||
      string(item.url) || string(file.path);
    const title = string(item.title) || string(item.name) || string(item.filename) ||
      string(item.tag_name) || location || `Reference ${references.length + 1}`;
    const content = contentText(value) || contentText(item.selection) ||
      contentText(item.selected_text) || contentText(file.content);
    const range = record(item.range);
    const start = item.startLine ?? item.start_line ?? record(range.start).line;
    const end = item.endLine ?? item.end_line ?? record(range.end).line;
    const source = location + (typeof start === "number"
      ? `:${start}${typeof end === "number" && end !== start ? `-${end}` : ""}`
      : "");
    const key = JSON.stringify([title, source, content]);
    if (referenceKeys.has(key)) return;
    referenceKeys.add(key);
    references.push({
      id: `reference-${references.length}`,
      title,
      source,
      content: content || JSON.stringify(value, null, 2),
    });
  };

  const visit = (value: unknown, hint: "content" | "image" | "reference" | "attachment" = "content") => {
    if (value === null || value === undefined) return;
    if (typeof value === "object") {
      if (visited.has(value)) return;
      visited.add(value);
    }
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, hint));
      return;
    }
    const item = record(value);
    const type = string(item.type).toLowerCase();
    const mime = string(item.mimeType) || string(item.mime_type) || string(item.media_type);
    const location = string(value) || string(item.url) || string(item.path) || string(item.uri);
    if (
      hint === "image" || imageTypes.has(type) || mime.startsWith("image/") ||
      (hint === "attachment" && (/^data:image\//i.test(location) || /\.(png|jpe?g|gif|webp|avif|bmp)(?:[?#]|$)/i.test(location)))
    ) {
      addImage(value);
      return;
    }
    if (hint === "reference" || hint === "attachment" || referenceTypes.has(type)) {
      addReference(value);
      return;
    }
    if (typeof value === "string") {
      if (value && !text.includes(value)) text.push(value);
      return;
    }
    for (const key of ["prompt", "text", "content", "message", "input"]) {
      if (item[key] !== undefined) visit(item[key]);
    }
    for (const key of ["images", "image", "image_url"]) {
      if (item[key] !== undefined) visit(item[key], "image");
    }
    if (item.attachments !== undefined) visit(item.attachments, "attachment");
    for (const key of [
      "references", "reference", "context", "contexts", "files", "mentions",
      "selected_browser_item", "selected_code", "selected_text", "selection",
    ]) {
      if (item[key] !== undefined) visit(item[key], "reference");
    }
    if (item.payload !== undefined) visit(item.payload);
  };

  visit(payload);
  return { text: text.join("\n\n"), images, references };
}
