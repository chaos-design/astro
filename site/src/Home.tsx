import { deckPages } from "./decks";
import { docCatalog } from "./docs";
import { ROUTES } from "./routes";

const accents = ["blue", "cyan", "green", "purple", "yellow", "red"] as const;

export function Home() {
  const sections = docCatalog.sections;
  const totalDocs = docCatalog.sections.reduce((n, s) => n + s.items.length, 0);

  return (
    <div className="content-inner">
      <div className="crumb">ASTRO · 在线文档中心</div>

      <div className="hero">
        <div className="hero-kicker">Agent State Trace &amp; Runtime Observations</div>
        <h1>ASTRO 文档中心与交互演示</h1>
        <p>
          ASTRO 是一个 local-first 的 coding-agent 可观测性应用。这是它的在线站点：左侧导航联动右侧内容区，
          <code>docs/</code> 下的 Markdown 参考文档在此渲染（代码高亮、页内目录、mermaid 图表点击放大），
          仓库自带的自包含演示与题库页面以内嵌视口呈现。站点在构建时把文档与演示一起打包，
          Vercel 与 GitHub Pages 两种部署路径可直接运行。
        </p>
        <div className="hero-actions">
          <a href={ROUTES.doc("index")} className="btn primary">
            阅读文档中心
          </a>
          <a href={ROUTES.gallery} className="btn">
            浏览演示与题库
          </a>
        </div>
      </div>

      <div className="grid" style={{ marginBottom: 8 }}>
        <a href={ROUTES.doc("index")} className="card">
          <div className="card-accent" />
          <div className="card-kicker">文档</div>
          <div className="card-title">文档中心</div>
          <div className="card-body">
            阅读路径、文档目录与维护索引，共 {totalDocs} 篇参考文档。
          </div>
        </a>
        <a href={ROUTES.gallery} className="card">
          <div className="card-accent cyan" />
          <div className="card-kicker">演示</div>
          <div className="card-title">演示与题库</div>
          <div className="card-body">自包含交互演示与面试题库，以同来源 iframe 内嵌呈现。</div>
        </a>
        <a href={ROUTES.doc("user-manual-zh")} className="card">
          <div className="card-accent green" />
          <div className="card-kicker">手册</div>
          <div className="card-title">ASTRO 使用手册</div>
          <div className="card-body">安装、Prompt 子运行层级、拓扑、轨迹、回放与实时超时。</div>
        </a>
        <a href={ROUTES.deck("project-overview-slides-zh")} className="card">
          <div className="card-accent purple" />
          <div className="card-kicker">可视化</div>
          <div className="card-title">项目架构与功能演示</div>
          <div className="card-body">面向讲解的 22 页 16:9 交互演示，含设计落地地图。</div>
        </a>
      </div>

      {sections
        .filter((section) => section.id !== "top" && section.items.length > 0)
        .map((section, i) => (
          <div key={section.id}>
            <div className="section-head">
              <h2>{section.title}</h2>
              <p>{section.blurb}</p>
            </div>
            <div className="grid">
              {section.items.map((item, j) => (
                <a key={item.slug} href={ROUTES.doc(item.slug)} className="card">
                  <div className={`card-accent ${accents[(i + j) % accents.length]}`} />
                  <div className="card-kicker">{section.id}</div>
                  <div className="card-title">{item.title}</div>
                  {item.summary ? <div className="card-body">{item.summary}</div> : null}
                </a>
              ))}
            </div>
          </div>
        ))}

      <div className="section-head">
        <h2>演示与题库 (Decks)</h2>
        <p>来自仓库 docs/，自包含、可离线打开</p>
      </div>
      <div className="grid">
        {deckPages.map((d) => (
          <a key={d.slug} href={ROUTES.deck(d.slug)} className="card">
            <div className="card-accent" />
            <div className="card-kicker">{d.tags.join(" · ") || "deck"}</div>
            <div className="card-title">{d.title}</div>
            <div className="card-body">{d.description}</div>
          </a>
        ))}
      </div>
    </div>
  );
}
