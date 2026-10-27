import { forwardRef } from "react";
import { deckPages } from "./decks";
import { counterpartSlug, catalogFor } from "./docs";
import { nextLang, useLang } from "./i18n";
import { GITHUB_REPO, ROUTES, navigate, type Route } from "./routes";

const githubIcon = (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 .5C5.73.5.5 5.73.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56 0-.28-.01-1.02-.02-2-3.2.7-3.88-1.54-3.88-1.54-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.71.08-.71 1.16.08 1.77 1.2 1.77 1.2 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18.92-.26 1.91-.39 2.89-.4.98.02 1.97.15 2.89.4 2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.8 1.19 1.83 1.19 3.09 0 4.42-2.7 5.4-5.27 5.68.41.35.78 1.05.78 2.12 0 1.53-.01 2.77-.01 3.15 0 .31.2.67.8.56A11.51 11.51 0 0 0 23.5 12C23.5 5.73 18.27.5 12 .5Z" />
  </svg>
);

interface SidebarProps {
  route: Route;
  /** DOM id applied to the aside (used by the mobile toggle's aria-controls). */
  id?: string;
  /** True when the mobile drawer is open; flips the panel in. */
  navOpen?: boolean;
  /** Called after any nav-item is tapped so the drawer can close. */
  onNavigate?: () => void;
}

/**
 * Desktop navigation column. On mobile the same element doubles as the panel the
 * header toggle expands (hence `id` + `aria-controls` on the toggle, and a
 * forwardRef `tabIndex=-1` target so the panel can receive programmatic focus
 * when it opens). Its brand row and footer live in the mobile header there, so
 * both are hidden inside the mobile breakpoint.
 */
export const Sidebar = forwardRef<HTMLElement, SidebarProps>(function Sidebar(
  { route, id, navOpen = false, onNavigate },
  ref,
) {
  const { lang, setLang, t } = useLang();
  const catalog = catalogFor(lang);
  const activeKind = route.kind;
  const activeSlug =
    activeKind === "doc" ? route.slug : activeKind === "deck" ? route.slug : null;

  // Tapping any nav link closes the drawer (mobile); on desktop this is a no-op.
  const handleNav = () => onNavigate?.();

  // The language button flips the whole chrome and, when a translated twin of
  // the current doc exists, jumps straight to it (paired-slug docs).
  const onToggleLang = () => {
    const target = activeKind === "doc" ? counterpartSlug(route.slug) : null;
    setLang(nextLang(lang));
    if (target) navigate(ROUTES.doc(target));
    handleNav();
  };

  return (
    <aside id={id} ref={ref} tabIndex={-1} className={navOpen ? "sidebar nav-open" : "sidebar"} aria-label={t.navigate}>
      <div className="sidebar-head">
        <div className="brand">
          <div className="brand-mark">A</div>
          <div>
            <div className="brand-name">ASTRO</div>
            <div className="brand-sub">{t.brandSub}</div>
          </div>
        </div>
      </div>

      <div className="sidebar-scroll">
        <nav className="nav-group">
          <div className="nav-label">{t.navigate}</div>
          <a
            href={ROUTES.home}
            className={`nav-item ${activeKind === "home" ? "active" : ""}`}
            onClick={handleNav}
          >
            <span>{t.home}</span>
          </a>
          <a
            href={ROUTES.gallery}
            className={`nav-item ${activeKind === "gallery" ? "active" : ""}`}
            onClick={handleNav}
          >
            <span>{t.gallery}</span>
          </a>
        </nav>

        {catalog.sections.map((section) => (
          <div className="nav-group" key={section.id}>
            <div className="nav-label">{section.title}</div>
            {section.items.map((item) => (
              <a
                key={item.slug}
                href={ROUTES.doc(item.slug)}
                className={`nav-item ${
                  activeKind === "doc" && activeSlug === item.slug ? "active" : ""
                }`}
                title={item.title}
                onClick={handleNav}
              >
                <span>{item.title}</span>
              </a>
            ))}
          </div>
        ))}

        <div className="nav-group">
          <div className="nav-label">{t.decks}</div>
          {deckPages.map((d) => (
            <a
              key={d.slug}
              href={ROUTES.deck(d.slug)}
              className={`nav-item ${
                activeKind === "deck" && activeSlug === d.slug ? "active" : ""
              }`}
              onClick={handleNav}
            >
              <span>{d.title}</span>
            </a>
          ))}
        </div>
      </div>

      {/* Pinned footer: the GitHub entry and the language button form a matched
          pair of equal cells; neither scrolls with the menu. On mobile these two
          live in the top header instead (see App.tsx + the mobile breakpoint). */}
      <div className="sidebar-github">
        <a
          href={GITHUB_REPO}
          target="_blank"
          rel="noreferrer"
          onClick={handleNav}
        >
          {githubIcon}
          <span>{t.github}</span>
          <span className="ext-arrow">↗</span>
        </a>
        <button
          type="button"
          className="lang-toggle"
          onClick={onToggleLang}
          title={t.langTitle}
          aria-label={t.langTitle}
        >
          {t.langLabel}
        </button>
      </div>
    </aside>
  );
});
