import { deckPages } from "./decks";
import { docCatalog } from "./docs";
import { ROUTES, type Route } from "./routes";

export function Sidebar({ route }: { route: Route }) {
  const activeKind = route.kind;
  const activeSlug =
    activeKind === "doc" ? route.slug : activeKind === "deck" ? route.slug : null;

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">A</div>
        <div>
          <div className="brand-name">ASTRO</div>
          <div className="brand-sub">Docs &amp; Decks</div>
        </div>
      </div>

      <nav className="nav-group">
        <div className="nav-label">Navigate</div>
        <a href={ROUTES.home} className={`nav-item ${activeKind === "home" ? "active" : ""}`}>
          <span>首页 / 总览</span>
        </a>
        <a
          href={ROUTES.gallery}
          className={`nav-item ${activeKind === "gallery" ? "active" : ""}`}
        >
          <span>演示与题库</span>
        </a>
      </nav>

      {docCatalog.sections.map((section) => (
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
            >
              <span>{item.title}</span>
            </a>
          ))}
        </div>
      ))}

      <div className="nav-group">
        <div className="nav-label">演示与题库 (Decks)</div>
        {deckPages.map((d) => (
          <a
            key={d.slug}
            href={ROUTES.deck(d.slug)}
            className={`nav-item ${
              activeKind === "deck" && activeSlug === d.slug ? "active" : ""
            }`}
          >
            <span>{d.title}</span>
          </a>
        ))}
      </div>

      <div className="sidebar-foot">
        文档与演示页由本仓库在构建时内联打包，<code>site/dist</code> 可直接部署到
        Vercel 或 GitHub Pages。
      </div>
    </aside>
  );
}
