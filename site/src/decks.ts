export interface DeckPage {
  slug: string;
  title: string;
  description: string;
  file: string;
  tags: string[];
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
    description:
      "自包含、可离线打开和打印的 22 页 16:9 交互演示，含设计落地地图、实时状态边界与共享运行时配置。",
    file: "decks/project-overview-slides-zh.html",
    tags: ["演示", "幻灯片", "分享"],
  },
  {
    slug: "project-interview-zh",
    title: "技术面试项目深讲",
    description:
      "14 页演示与 40 题交互题库，区分事实与规划，并提供详细答案、递进追问、筛选及考试复盘。",
    file: "decks/project-interview-zh.html",
    tags: ["面试", "题库"],
  },
  {
    slug: "interview-question-bank",
    title: "ASTRO 面试题库",
    description:
      "以本地优先的 Coding Agent 可观测性为主题的独立题库页，支持本地进度持久化与逐题演练。",
    file: "decks/interview-question-bank.html",
    tags: ["面试", "题库"],
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
