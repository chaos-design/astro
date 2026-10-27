import type { Lang } from "./docs";

export interface DeckPage {
  slug: string;
  title: string;
  /** English title used when the site chrome is in EN. */
  titleEn: string;
  description: string;
  /** English description used when the site chrome is in EN. */
  descriptionEn: string;
  file: string;
  tags: string[];
  /** English tags used when the site chrome is in EN. */
  tagsEn: string[];
}

/** Localized title / description / tags for a deck in the active UI language. */
export function deckCopy(d: DeckPage, lang: Lang): {
  title: string;
  description: string;
  tags: string[];
} {
  return lang === "en"
    ? { title: d.titleEn, description: d.descriptionEn, tags: d.tagsEn }
    : { title: d.title, description: d.description, tags: d.tags };
}

/**
 * The self-contained visual decks shipped into the build output (docs/*.html
 * copied to dist/decks/) and shown in a same-origin iframe. `file` is the
 * dist-relative path (relative base is "./", so the app loads them next to
 * index.html).
 */
export const deckPages: DeckPage[] = [
  {
    slug: "project-overview-slides-zh",
    title: "项目架构与功能演示",
    titleEn: "Architecture & Feature Demo",
    description:
      "自包含、可离线打开和打印的 22 页 16:9 交互演示，含设计落地地图、实时状态边界与共享运行时配置。",
    descriptionEn:
      "A self-contained, offline-openable, printable 22-page 16:9 walkthrough with a design-landing map, live-status boundaries, and shared runtime config.",
    file: "decks/project-overview-slides-zh.html",
    tags: ["演示", "幻灯片", "分享"],
    tagsEn: ["demo", "slides", "sharing"],
  },
  {
    slug: "project-interview-zh",
    title: "技术面试项目深讲",
    titleEn: "Technical Interview Deep Dive",
    description:
      "14 页演示与 40 题交互题库，区分事实与规划，并提供详细答案、递进追问、筛选及考试复盘。",
    descriptionEn:
      "A 14-page walkthrough plus a 40-question interactive bank that separates fact from plan, with detailed answers, progressive follow-ups, filtering, and exam review.",
    file: "decks/project-interview-zh.html",
    tags: ["面试", "题库"],
    tagsEn: ["interview", "bank"],
  },
  {
    slug: "interview-question-bank",
    title: "ASTRO 面试题库",
    titleEn: "ASTRO Interview Bank",
    description:
      "以本地优先的 Coding Agent 可观测性为主题的独立题库页，支持本地进度持久化与逐题演练。",
    descriptionEn:
      "A standalone question bank on local-first coding-agent observability, with local progress persistence and per-question practice.",
    file: "decks/interview-question-bank.html",
    tags: ["面试", "题库"],
    tagsEn: ["interview", "bank"],
  },
];

export function getDeck(slug: string): DeckPage | null {
  return deckPages.find((d) => d.slug === slug) ?? null;
}

/** Map bare deck file names (e.g. "project-interview-zh.html") to slugs, for
 * rewriting relative .html links found in the Markdown docs. */
export const deckSlugByFile: Record<string, string> = Object.fromEntries(
  deckPages.map((d) => [d.file.slice(d.file.lastIndexOf("/") + 1), d.slug]),
);
