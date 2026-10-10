// Docs are inlined at build time through the virtual module produced by
// vite.config.ts. Astro's docs are flat top-level files, so the key is the
// file name without the .md extension, e.g. "user-manual-zh".
import { docs } from "virtual:astro-docs";

export interface DocSection {
  id: string;
  title: string;
  blurb: string;
  items: DocItem[];
}

export interface DocItem {
  slug: string;
  title: string;
  summary: string;
}

export interface DocCatalog {
  sections: DocSection[];
  index: Record<string, DocItem>;
}

function summaryOf(raw: string): string {
  const lines = raw.split("\n").filter((l) => l.trim());
  for (const line of lines) {
    let trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    trimmed = trimmed
      .replace(/^>\s?/, "")
      .replace(/^[-*+]\s+/, "")
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/[*_~`]+/g, "")
      .trim();
    return trimmed.slice(0, 140);
  }
  return "";
}

function heading(raw: string): string {
  const m = raw.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : "";
}

const sections: DocSection[] = [
  {
    id: "top",
    title: "总览 / Overview",
    blurb: "文档中心、阅读路径与维护索引。",
    items: [],
  },
  {
    id: "zh",
    title: "中文文档",
    blurb: "面向使用者与维护者的中文参考。",
    items: [],
  },
  {
    id: "en",
    title: "English",
    blurb: "User and maintainer references in English.",
    items: [],
  },
  {
    id: "common",
    title: "通用 / Common",
    blurb: "语言无关的安装与接入说明。",
    items: [],
  },
];

const sectionBySlug: Record<string, string> = {
  index: "top",
  "user-manual-zh": "zh",
  "event-protocol-zh": "zh",
  "architecture-zh": "zh",
  "operations-zh": "zh",
  "implementation-details-zh": "zh",
  "user-manual-en": "en",
  "event-protocol-en": "en",
  "architecture-en": "en",
  "operations-en": "en",
  "implementation-details-en": "en",
  "plugin-installation": "common",
};

// Preferred reading order inside each language section (the pager follows it).
const readingOrder: Record<string, string[]> = {
  zh: [
    "user-manual-zh",
    "event-protocol-zh",
    "architecture-zh",
    "operations-zh",
    "implementation-details-zh",
  ],
  en: [
    "user-manual-en",
    "event-protocol-en",
    "architecture-en",
    "operations-en",
    "implementation-details-en",
  ],
};

const catalog: DocCatalog = {
  sections,
  index: {},
};

for (const key of Object.keys(docs).sort()) {
  const raw = docs[key];
  const item: DocItem = { slug: key, title: heading(raw) || key, summary: summaryOf(raw) };
  catalog.index[key] = item;

  const section = sections.find((s) => s.id === sectionBySlug[key]);
  if (section) {
    section.items.push(item);
  } else {
    // Unknown doc files fall back to their own ad-hoc top section.
    let adhoc = sections.find((s) => s.id === key);
    if (!adhoc) {
      adhoc = { id: key, title: key, blurb: "", items: [] };
      sections.unshift(adhoc);
    }
    adhoc.items.push(item);
  }
}

for (const section of sections) {
  const order = readingOrder[section.id];
  if (order) {
    section.items.sort((a, b) => order.indexOf(a.slug) - order.indexOf(b.slug));
  }
}

export const docCatalog = catalog;

/** Resolve a hash route "#/doc/<slug>" to its raw markdown. */
export function getDoc(slug: string): { raw: string; item: DocItem } | null {
  const item = catalog.index[slug];
  if (!item) return null;
  return { raw: docs[slug] ?? "", item };
}

export function sectionOf(slug: string): DocSection | null {
  return catalog.sections.find((s) => s.items.some((i) => i.slug === slug)) ?? null;
}

/** Flatten slugs in reading order (section order, not alphabetical). */
export function orderedDocSlugs(): string[] {
  return catalog.sections.flatMap((s) => s.items.map((i) => i.slug));
}
