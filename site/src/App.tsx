import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { counterpartSlug, docLang } from "./docs";
import { DeckView } from "./DeckView";
import { DocView } from "./DocView";
import { Gallery } from "./Gallery";
import { Home } from "./Home";
import { LangProvider, useLang } from "./i18n";
import { GITHUB_REPO, ROUTES, navigate, useHashRoute, type Route } from "./routes";
import { Sidebar } from "./Sidebar";
import { useBottomReserve } from "./useBottomReserve";

const SITE_NAV_ID = "site-nav";
/** Must stay in sync with the mobile breakpoint in styles.css (860px). */
const MOBILE_NAV_QUERY = "(max-width: 860px)";

/** GitHub glyph shared by the mobile header entry. */
const githubIcon = (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 .5C5.73.5.5 5.73.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56 0-.28-.01-1.02-.02-2-3.2.7-3.88-1.54-3.88-1.54-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.71.08-.71 1.16.08 1.77 1.2 1.77 1.2 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18.92-.26 1.91-.39 2.89-.4.98.02 1.97.15 2.89.4 2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.8 1.19 1.83 1.19 3.09 0 4.42-2.7 5.4-5.27 5.68.41.35.78 1.05.78 2.12 0 1.53-.01 2.77-.01 3.15 0 .31.2.67.8.56A11.51 11.51 0 0 0 23.5 12C23.5 5.73 18.27.5 12 .5Z" />
  </svg>
);

/** Stable key for the active route — used to collapse the mobile panel on navigation. */
function routeKey(route: Route): string {
  return route.kind === "doc" || route.kind === "deck" ? `${route.kind}:${route.slug}` : route.kind;
}

function Shell() {
  const route = useHashRoute();
  const { lang, setLang, t } = useLang();
  const contentRef = useRef<HTMLElement | null>(null);
  const navRef = useRef<HTMLElement | null>(null);
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const key = routeKey(route);

  // Mobile app-style layout: keep the scrollable content pane clear of the
  // fixed bottom bar / pager by measuring their real height (see useBottomReserve).
  useBottomReserve(route);

  // The content column owns the scroll position on mobile, so a route change
  // must reset it explicitly — otherwise the next page opens mid-document.
  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 });
  }, [key]);

  // Deep links open docs in either language: keep the global chrome language
  // in step with the doc actually on screen.
  useEffect(() => {
    if (route.kind !== "doc") return;
    const docLanguage = docLang(route.slug);
    if (docLanguage && docLanguage !== lang) setLang(docLanguage);
  }, [key]);

  const closeNav = useCallback((restoreFocus = false) => {
    setNavOpen(false);
    if (restoreFocus) toggleRef.current?.focus();
  }, []);

  // Any navigation closes the mobile panel; focus stays on the link the user
  // just activated rather than jumping back to the toggle.
  useEffect(() => {
    setNavOpen(false);
  }, [key]);

  // Esc closes the panel and hands focus back to the toggle.
  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeNav(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navOpen, closeNav]);

  // Rotating to a desktop-width viewport must never leave the mobile panel open.
  useEffect(() => {
    const media = window.matchMedia(MOBILE_NAV_QUERY);
    const onChange = () => {
      if (!media.matches) setNavOpen(false);
    };
    onChange();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  // Freeze the page behind the open panel so only the panel scrolls.
  useEffect(() => {
    if (!navOpen) return;
    document.body.classList.add("nav-open");
    return () => document.body.classList.remove("nav-open");
  }, [navOpen]);

  // Opening moves focus into the panel, so Tab walks its items next.
  useEffect(() => {
    if (navOpen) navRef.current?.focus();
  }, [navOpen]);

  let view: ReactNode;
  switch (route.kind) {
    case "home":
      view = <Home />;
      break;
    case "doc":
      view = <DocView slug={route.slug} />;
      break;
    case "deck":
      view = <DeckView key={route.slug} slug={route.slug} />;
      break;
    case "gallery":
      view = <Gallery />;
      break;
    default:
      view = <Home />;
  }

  return (
    <div className="shell" data-nav-open={navOpen ? "true" : "false"}>
      {/* Pinned mobile chrome: brand (→ home), GitHub, language, drawer toggle.
          Hidden on desktop, where the same entries live in the sidebar footer. */}
      <header className="site-header">
        <a className="site-header-brand" href={ROUTES.home} aria-label={t.backHome}>
          <div className="brand-mark">A</div>
          <div className="site-header-text">
            <div className="brand-name">ASTRO</div>
            <div className="brand-sub">{t.brandSub}</div>
          </div>
        </a>
        <div className="site-header-actions">
          <a className="header-github" href={GITHUB_REPO} target="_blank" rel="noreferrer" title={t.github} aria-label={t.github}>
            {githubIcon}
          </a>
          <button
            type="button"
            className="lang-toggle header-lang"
            onClick={() => {
              const next = lang === "zh" ? "en" : "zh";
              const target = route.kind === "doc" ? counterpartSlug(route.slug) : null;
              setLang(next);
              if (target) navigate(ROUTES.doc(target));
            }}
            title={t.langTitle}
            aria-label={t.langTitle}
          >
            {t.langShort}
          </button>
          <button
            type="button"
            ref={toggleRef}
            className={`nav-toggle${navOpen ? " open" : ""}`}
            aria-expanded={navOpen}
            aria-controls={SITE_NAV_ID}
            aria-label={navOpen ? t.navMenuClose : t.navMenuOpen}
            onClick={() => setNavOpen((v) => !v)}
          >
            <span className="nav-toggle-bars" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          </button>
        </div>
      </header>

      <Sidebar ref={navRef} id={SITE_NAV_ID} route={route} navOpen={navOpen} onNavigate={() => closeNav()} />

      {/* Dim backdrop behind the open panel; a tap closes it. */}
      {navOpen ? <div className="nav-backdrop" onClick={() => closeNav(true)} aria-hidden="true" /> : null}

      <main className="content" ref={contentRef}>
        {view}
      </main>
    </div>
  );
}

export function App() {
  return (
    <LangProvider>
      <Shell />
    </LangProvider>
  );
}
