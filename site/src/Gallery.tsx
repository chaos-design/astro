import { deckPages } from "./decks";
import { ROUTES } from "./routes";

const accents = ["", "cyan", "green", "purple", "yellow", ""] as const;

export function Gallery() {
  return (
    <div className="content-inner">
      <div className="crumb">
        <a href={ROUTES.home}>ASTRO</a> / 演示与题库
      </div>

      <h1 className="page-title">演示与题库</h1>
      <p className="page-desc">
        仓库 <code>docs/</code> 下的自包含可视化页面。每个演示页在独立的内嵌视图中展示
        （同来源 iframe，相对路径加载，可离线打开与打印），可在此直接切换。
      </p>

      <div className="grid">
        {deckPages.map((d, i) => (
          <a key={d.slug} href={ROUTES.deck(d.slug)} className="card">
            <div className={`card-accent ${accents[i % accents.length]}`} />
            <div className="card-kicker">{d.tags.join(" · ")}</div>
            <div className="card-title">{d.title}</div>
            <div className="card-body">{d.description}</div>
          </a>
        ))}
      </div>
    </div>
  );
}
