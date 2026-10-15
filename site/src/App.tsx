import { useEffect, useRef, useState, type ReactNode } from "react";
import { BottomBar } from "./BottomBar";
import { docLang } from "./docs";
import { DeckView } from "./DeckView";
import { DocView } from "./DocView";
import { Gallery } from "./Gallery";
import { Home } from "./Home";
import { LangProvider, useLang } from "./i18n";
import { useHashRoute } from "./routes";
import { Sidebar } from "./Sidebar";

const SITE_NAV_ID = "site-nav";

/** Hamburger glyph for the mobile nav toggle (closed state). */
function MenuIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <line x1="4" y1="7" x2="20" y2="7" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="17" x2="20" y2="17" />
    </svg>
  );
}

/** Close glyph for the mobile nav toggle (open state). */
function CloseIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </svg>
  );
}

function Shell() {
  const route = useHashRoute();
  const { lang, setLang, t } = useLang();
  const contentRef = useRef<HTMLElement | null>(null);
  const navToggleRef = useRef<HTMLButtonElement | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  // The content column owns the scroll position now, so a route change must
  // reset it explicitly — otherwise the next page opens mid-document.
  const routeKey = `${route.kind}:${"slug" in route ? route.slug : ""}`;

  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 });
  }, [routeKey]);

  // Deep links open docs in either language: keep the global chrome language
  // in step with the doc actually on screen.
  useEffect(() => {
    if (route.kind !== "doc") return;
    const docLanguage = docLang(route.slug);
    if (docLanguage && docLanguage !== lang) setLang(docLanguage);
  }, [routeKey]);

  // Close the mobile drawer on Esc and hand focus back to the toggle.
  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setNavOpen(false);
        navToggleRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navOpen]);

  const closeNav = () => setNavOpen(false);
  const toggleNav = () => setNavOpen((v) => !v);

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
    <div className="shell">
      {/* Pinned mobile chrome: brand + drawer toggle. Hidden on desktop. */}
      <div className="mobile-topbar">
        <div className="brand topbar-brand">
          <div className="brand-mark">A</div>
          <div>
            <div className="brand-name">ASTRO</div>
            <div className="brand-sub">{t.brandSub}</div>
          </div>
        </div>
        <button
          ref={navToggleRef}
          type="button"
          className="topbar-toggle"
          aria-expanded={navOpen}
          aria-controls={SITE_NAV_ID}
          aria-label={navOpen ? t.navClose : t.navOpen}
          onClick={toggleNav}
        >
          {navOpen ? <CloseIcon /> : <MenuIcon />}
        </button>
      </div>

      <Sidebar
        id={SITE_NAV_ID}
        route={route}
        navOpen={navOpen}
        onNavigate={closeNav}
      />

      {/* Dim backdrop behind the open drawer; a tap closes it. */}
      {navOpen ? (
        <div className="scrim" aria-hidden="true" onClick={closeNav} />
      ) : null}

      <main className="content" ref={contentRef}>
        {view}
      </main>
      <BottomBar />
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
