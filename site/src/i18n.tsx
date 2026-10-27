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
    // Mobile nav drawer
    navOpen: "打开导航",
    navClose: "关闭导航",
    // DocView
    docCrumb: "文档",
    docNotFound: "未找到文档",
    backHome: "返回首页",
    tocTitle: "本页目录",
    pagerPrev: "← 上一篇",
    pagerNext: "下一篇 →",
    pagerHome: "首页",
    pagerGallery: "演示与题库",
    pagerDocsTitle: "ASTRO 文档",
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
    // Mobile nav drawer
    navOpen: "Open navigation",
    navClose: "Close navigation",
    // DocView
    docCrumb: "Docs",
    docNotFound: "Doc not found",
    backHome: "Back to home",
    tocTitle: "On this page",
    pagerPrev: "← Previous",
    pagerNext: "Next →",
    pagerHome: "Home",
    pagerGallery: "Docs & Decks",
    pagerDocsTitle: "ASTRO Docs",
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
