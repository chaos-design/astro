import { deckCopy, deckPages } from "./decks";
import { docCatalog } from "./docs";
import { useLang } from "./i18n";
import { ROUTES } from "./routes";

const accents = ["blue", "cyan", "green", "purple", "yellow", "red"] as const;

export function Home() {
  const { lang, t } = useLang();
  const sections = docCatalog.sections;
  const totalDocs = docCatalog.sections.reduce((n, s) => n + s.items.length, 0);

  return (
    <div className="content-inner">
      <div className="crumb">{t.homeCrumb}</div>

      <div className="hero">
        <div className="hero-kicker">{t.heroKicker}</div>
        <h1>{t.heroTitle}</h1>
        <p>{t.heroBody}</p>
        <div className="hero-actions">
          <a href={ROUTES.doc("index")} className="btn primary">
            {t.readDocs}
          </a>
          <a href={ROUTES.gallery} className="btn">
            {t.browseDecks}
          </a>
        </div>
      </div>

      <div className="grid" style={{ marginBottom: 8 }}>
        <a href={ROUTES.doc("index")} className="card">
          <div className="card-accent" />
          <div className="card-kicker">{t.cardDocsKicker}</div>
          <div className="card-title">{t.cardDocsTitle}</div>
          <div className="card-body">
            {t.cardDocsBody} {lang === "zh" ? `共 ${totalDocs} 篇参考文档。` : `${totalDocs} reference docs in total.`}
          </div>
        </a>
        <a href={ROUTES.gallery} className="card">
          <div className="card-accent cyan" />
          <div className="card-kicker">{t.cardDecksKicker}</div>
          <div className="card-title">{t.cardDecksTitle}</div>
          <div className="card-body">{t.cardDecksBody}</div>
        </a>
        <a href={ROUTES.doc("user-manual-zh")} className="card">
          <div className="card-accent green" />
          <div className="card-kicker">{t.cardManualKicker}</div>
          <div className="card-title">{t.cardManualTitle}</div>
          <div className="card-body">{t.cardManualBody}</div>
        </a>
        <a href={ROUTES.deck("project-overview-slides-zh")} className="card">
          <div className="card-accent purple" />
          <div className="card-kicker">{t.cardSlidesKicker}</div>
          <div className="card-title">{t.cardSlidesTitle}</div>
          <div className="card-body">{t.cardSlidesBody}</div>
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
        <h2>{t.decksSectionTitle}</h2>
        <p>{t.decksSectionBlurb}</p>
      </div>
      <div className="grid">
        {deckPages.map((d) => {
          const c = deckCopy(d, lang);
          return (
            <a key={d.slug} href={ROUTES.deck(d.slug)} className="card">
              <div className="card-accent" />
              <div className="card-kicker">{c.tags.join(" · ") || "deck"}</div>
              <div className="card-title">{c.title}</div>
              <div className="card-body">{c.description}</div>
            </a>
          );
        })}
      </div>
    </div>
  );
}
