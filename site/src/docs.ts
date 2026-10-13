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
  "data-definitions-zh": "zh",
  "architecture-zh": "zh",
  "operations-zh": "zh",
  "implementation-details-zh": "zh",
  "user-manual-en": "en",
  "event-protocol-en": "en",
  "data-definitions-en": "en",
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
    "data-definitions-zh",
    "architecture-zh",
    "operations-zh",
    "implementation-details-zh",
  ],
  en: [
    "user-manual-en",
    "event-protocol-en",
    "data-definitions-en",
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

export const docCatalog: DocCatalog = catalog;

/** Resolve a hash route "#/doc/<slug>" to its raw markdown. */
export function getDoc(slug: string): { raw: string; item: DocItem } | null {
  const item = catalog.index[slug];
  if (!item) return null;
  return { raw: docs[slug] ?? "", item };
}

export function sectionOf(slug: string): DocSection | null {
  return catalog.sections.find((s) => s.items.some((i) => i.slug === slug)) ?? null;
}

/** Language of a doc slug ("-zh" / "-en" suffix), or null for language-neutral docs. */
export function docLang(slug: string): "zh" | "en" | null {
  if (slug.endsWith("-zh")) return "zh";
  if (slug.endsWith("-en")) return "en";
  return null;
}

export type Lang = "zh" | "en";
export const LANGS: Lang[] = ["zh", "en"];

/** Localized section titles, keyed by section id. */
const SECTION_TITLES: Record<string, Record<Lang, string>> = {
  top: { zh: "总览", en: "Overview" },
  zh: { zh: "文档", en: "Documentation" },
  en: { zh: "文档", en: "Documentation" },
  common: { zh: "通用", en: "Common" },
};

const catalogCache: Partial<Record<Lang, DocCatalog>> = {};

/**
 * Catalog filtered to one language: paired docs only appear in the language
 * currently selected, language-neutral docs (index, plugin-installation) stay
 * in both, and empty sections are dropped with localized titles.
 */
export function catalogFor(lang: Lang): DocCatalog {
  const cached = catalogCache[lang];
  if (cached) return cached;
  const filtered: DocSection[] = [];
  for (const section of catalog.sections) {
    const items = section.items.filter((item) => {
      const itemLang = docLang(item.slug);
      return itemLang === null || itemLang === lang;
    });
    if (items.length === 0) continue;
    filtered.push({
      id: section.id,
      title: SECTION_TITLES[section.id]?.[lang] ?? section.title,
      blurb: section.blurb,
      items,
    });
  }
  const built: DocCatalog = { sections: filtered, index: catalog.index };
  catalogCache[lang] = built;
  return built;
}

/** Flatten slugs of a language-filtered catalog in reading order. */
export function orderedDocSlugs(lang: Lang): string[] {
  return catalogFor(lang).sections.flatMap((s) => s.items.map((i) => i.slug));
}

/**
 * Slug of the same document in the other language ("user-manual-zh" ↔
 * "user-manual-en"), or null when the doc has no translated pair.
 */
export function counterpartSlug(slug: string): string | null {
  const lang = docLang(slug);
  if (!lang) return null;
  const candidate = `${slug.slice(0, -3)}-${lang === "zh" ? "en" : "zh"}`;
  return catalog.index[candidate] ? candidate : null;
}
