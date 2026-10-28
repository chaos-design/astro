import { deckCopy, deckPages } from "./decks";
import { useLang } from "./i18n";
import { ROUTES } from "./routes";

const accents = ["", "cyan", "green", "purple", "yellow", ""] as const;

export function Gallery() {
  const { lang, t } = useLang();

  return (
    <div className="content-inner">
      <div className="crumb">
        <a href={ROUTES.home}>ASTRO</a> / {t.galleryCrumb}
      </div>

      <h1 className="page-title">{t.galleryTitle}</h1>
      <p className="page-desc">{t.galleryDesc}</p>

      <div className="grid">
        {deckPages.map((d, i) => {
          const c = deckCopy(d, lang);
          return (
            <a key={d.slug} href={ROUTES.deck(d.slug)} className="card">
              <div className={`card-accent ${accents[i % accents.length]}`} />
              <div className="card-kicker">{c.tags.join(" · ")}</div>
              <div className="card-title">{c.title}</div>
              <div className="card-body">{c.description}</div>
            </a>
          );
        })}
      </div>
    </div>
  );
}
