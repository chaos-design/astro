import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { LANGS, type Lang } from "./docs";

const STORAGE_KEY = "astro-lang";

// UI chrome strings for the reading path (sidebar, doc view, pagers). Doc
// content itself comes from the paired -zh / -en markdown files; Home, the
// gallery, and deck pages keep their own copy for now.
const STRINGS = {
  zh: {
    brandSub: "文档与演示",
    navigate: "导航",
    home: "首页 / 总览",
    gallery: "演示与题库",
    decks: "演示与题库 (Decks)",
    langLabel: "English",
    langTitle: "切换到 English",
    // Compact label for the square language button in the mobile header.
    langShort: "EN",
    github: "GitHub",
    backHome: "返回首页",
    // Mobile nav drawer
    navOpen: "打开导航",
    navClose: "关闭导航",
    navMenuOpen: "展开导航菜单",
    navMenuClose: "收起导航菜单",
    // Home
    homeCrumb: "ASTRO · 在线文档中心",
    heroKicker: "Agent State Trace & Runtime Observations",
    heroTitle: "ASTRO 文档中心与交互演示",
    heroBody:
      "ASTRO 是一个 local-first 的 coding-agent 可观测性应用。这是它的在线站点：左侧导航联动右侧内容区，docs/ 下的 Markdown 参考文档在此渲染（代码高亮、页内目录、mermaid 图表与图片点击放大），仓库自带的自包含演示与题库页面以内嵌视口呈现。站点在构建时把文档与演示一起打包，Vercel 与 GitHub Pages 两种部署路径可直接运行。",
    readDocs: "阅读文档中心",
    browseDecks: "浏览演示与题库",
    cardDocsKicker: "文档",
    cardDocsTitle: "文档中心",
    cardDocsBody: "阅读路径、文档目录与维护索引。",
    cardDecksKicker: "演示",
    cardDecksTitle: "演示与题库",
    cardDecksBody: "自包含交互演示与面试题库，以同来源 iframe 内嵌呈现。",
    cardManualKicker: "手册",
    cardManualTitle: "ASTRO 使用手册",
    cardManualBody: "安装、Prompt 子运行层级、拓扑、轨迹、回放与实时超时。",
    cardSlidesKicker: "可视化",
    cardSlidesTitle: "项目架构与功能演示",
    cardSlidesBody: "面向讲解的 22 页 16:9 交互演示，含设计落地地图。",
    decksSectionTitle: "演示与题库 (Decks)",
    decksSectionBlurb: "来自仓库 docs/，自包含、可离线打开",
    // Gallery
    galleryCrumb: "演示与题库",
    galleryTitle: "演示与题库",
    galleryDesc:
      "仓库 docs/ 下的自包含可视化页面。每个演示页在独立的内嵌视图中展示（同来源 iframe，相对路径加载，可离线打开与打印），可在此直接切换。",
    // DocView
    docCrumb: "文档",
    docNotFound: "未找到文档",
    docNotFoundLead: "没有 slug 为",
    docNotFoundTrail: "的文档。",
    tocTitle: "本页目录",
    pagerPrev: "← 上一篇",
    pagerNext: "下一篇 →",
    pagerHome: "首页",
    pagerGallery: "演示与题库",
    pagerDocsTitle: "ASTRO 文档",
    // DeckView
    deckCrumb: "演示",
    deckNotFound: "未找到演示",
    deckNotFoundLead: "没有 slug 为",
    deckNotFoundTrail: "的演示页。",
    openNewWindow: "新窗口打开 ↗",
    immersive: "全屏沉浸 ⛶",
    escExit: "Esc 退出",
    exitImmersive: "退出 ⤢",
    immersiveSuffix: "（沉浸模式）",
    pagerPrevDeck: "← 上一个演示",
    pagerBack: "← 返回",
    pagerNextDeck: "下一个演示 →",
    pagerDocs: "文档中心 →",
    // Lightbox
    lbFit: "适应",
    lbZoomIn: "放大",
    lbZoomOut: "缩小",
    lbReset: "100%",
    lbClose: "关闭",
    lbHint: "滚轮缩放 · 拖拽平移 · Esc 关闭",
    lbDefaultTitle: "图片",
  },
  en: {
    brandSub: "Docs & Decks",
    navigate: "Navigate",
    home: "Home",
    gallery: "Docs & Decks",
    decks: "Decks",
    langLabel: "中文",
    langTitle: "Switch to 中文",
    // Compact label for the square language button in the mobile header.
    langShort: "中",
    github: "GitHub",
    backHome: "Back to home",
    // Mobile nav drawer
    navOpen: "Open navigation",
    navClose: "Close navigation",
    navMenuOpen: "Open navigation menu",
    navMenuClose: "Close navigation menu",
    // Home
    homeCrumb: "ASTRO · Online docs",
    heroKicker: "Agent State Trace & Runtime Observations",
    heroTitle: "ASTRO Documentation & Interactive Decks",
    heroBody:
      "ASTRO is a local-first observability application for coding agents. This is its online site: the left navigation drives the content pane, the Markdown references under docs/ are rendered here (code highlighting, in-page TOC, click-to-zoom mermaid diagrams and images), and the repo's self-contained demo decks are shown in embedded viewports. The site bundles the docs and decks at build time, so the Vercel and GitHub Pages deployment paths both just work.",
    readDocs: "Read the docs",
    browseDecks: "Browse decks & banks",
    cardDocsKicker: "Docs",
    cardDocsTitle: "Documentation",
    cardDocsBody: "Reading paths, the doc catalog, and a maintenance index.",
    cardDecksKicker: "Decks",
    cardDecksTitle: "Decks & Question Banks",
    cardDecksBody: "Self-contained interactive demos and interview banks, embedded via a same-origin iframe.",
    cardManualKicker: "Manual",
    cardManualTitle: "ASTRO User Manual",
    cardManualBody: "Install, prompt sub-run hierarchy, topology, trajectory, replay, and live timeouts.",
    cardSlidesKicker: "Visual",
    cardSlidesTitle: "Architecture & Feature Demo",
    cardSlidesBody: "A 22-page 16:9 walkthrough deck with a design-landing map.",
    decksSectionTitle: "Decks",
    decksSectionBlurb: "From the repo docs/, self-contained and openable offline",
    // Gallery
    galleryCrumb: "Docs & Decks",
    galleryTitle: "Docs & Decks",
    galleryDesc:
      "Self-contained visual pages from the repo docs/ directory. Each deck opens in its own embedded viewport (same-origin iframe, relative paths, works offline and prints), and you can switch between them here.",
    // DocView
    docCrumb: "Docs",
    docNotFound: "Doc not found",
    docNotFoundLead: "No doc with slug",
    docNotFoundTrail: "exists.",
    tocTitle: "On this page",
    pagerPrev: "← Previous",
    pagerNext: "Next →",
    pagerHome: "Home",
    pagerGallery: "Docs & Decks",
    pagerDocsTitle: "ASTRO Docs",
    // DeckView
    deckCrumb: "Decks",
    deckNotFound: "Deck not found",
    deckNotFoundLead: "No deck with slug",
    deckNotFoundTrail: "exists.",
    openNewWindow: "Open in a new window ↗",
    immersive: "Fullscreen ⛶",
    escExit: "Esc to exit",
    exitImmersive: "Exit ⤢",
    immersiveSuffix: " (immersive)",
    pagerPrevDeck: "← Previous deck",
    pagerBack: "← Back",
    pagerNextDeck: "Next deck →",
    pagerDocs: "Docs →",
    // Lightbox
    lbFit: "Fit",
    lbZoomIn: "Zoom in",
    lbZoomOut: "Zoom out",
    lbReset: "100%",
    lbClose: "Close",
    lbHint: "Scroll to zoom · Drag to pan · Esc to close",
    lbDefaultTitle: "Image",
  },
} as const;

export type Strings = (typeof STRINGS)["zh"];

interface LangContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: Strings;
}

const LangContext = createContext<LangContextValue | null>(null);

function initialLang(): Lang {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "en" || saved === "zh") return saved;
  } catch {
    // localStorage unavailable (privacy mode etc.) — default below.
  }
  return "zh";
}

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);

  const setLang = (next: Lang) => {
    setLangState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Ignore persistence failures; the toggle still works for the session.
    }
  };

  // Keep <html lang> in sync for font shaping and accessibility.
  useEffect(() => {
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  }, [lang]);

  const value = useMemo<LangContextValue>(
    () => ({ lang, setLang, t: STRINGS[lang] as Strings }),
    [lang],
  );
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export function useLang(): LangContextValue {
  const ctx = useContext(LangContext);
  if (!ctx) throw new Error("useLang must be used within LangProvider");
  return ctx;
}

/** Cycle helper used by the single language button. */
export function nextLang(lang: Lang): Lang {
  const i = LANGS.indexOf(lang);
  return LANGS[(i + 1) % LANGS.length];
}
