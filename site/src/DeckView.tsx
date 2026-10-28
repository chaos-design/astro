import { useEffect, useState } from "react";
import { deckCopy, deckPages, getDeck } from "./decks";
import { useLang } from "./i18n";
import { ROUTES } from "./routes";

export function DeckView({ slug }: { slug: string }) {
  const { lang, t } = useLang();
  const deck = getDeck(slug);
  const [immersive, setImmersive] = useState(false);

  // Esc exits immersive mode.
  useEffect(() => {
    if (!immersive) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setImmersive(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [immersive]);

  if (!deck) {
    return (
      <div className="content-inner">
        <div className="crumb">{t.deckCrumb}</div>
        <h1 className="page-title">{t.deckNotFound}</h1>
        <p className="page-desc">
          {t.deckNotFoundLead} <code>{slug}</code> {t.deckNotFoundTrail}{" "}
          <a href={ROUTES.gallery}>{t.browseDecks}</a>.
        </p>
      </div>
    );
  }

  const c = deckCopy(deck, lang);
  const at = deckPages.findIndex((d) => d.slug === slug);
  const prev = at > 0 ? deckPages[at - 1] : null;
  const next = at >= 0 && at < deckPages.length - 1 ? deckPages[at + 1] : null;

  return (
    <div className="content-inner">
      <div className="crumb">
        <a href={ROUTES.home}>ASTRO</a> / {t.deckCrumb} / {c.title}
      </div>

      <h1 className="page-title">{c.title}</h1>
      <p className="page-desc">{c.description}</p>

      <div className="artifact-bar">
        <span className="pill">{c.tags.join(" · ")}</span>
        <span className="pill">{deck.file}</span>
        <a className="open-link" href={deck.file} target="_blank" rel="noreferrer">
          {t.openNewWindow}
        </a>
        <button className="btn primary" type="button" onClick={() => setImmersive(true)}>
          {t.immersive}
        </button>
      </div>

      {!immersive ? (
        <iframe
          key={deck.slug}
          className="artifact-frame"
          src={deck.file}
          title={c.title}
        />
      ) : null}

      {immersive ? (
        <div className="immersive">
          <div className="immersive-top">
            <span className="immersive-title">{c.title}</span>
            <span className="pill">{t.escExit}</span>
            <button className="btn" type="button" onClick={() => setImmersive(false)}>
              {t.exitImmersive}
            </button>
          </div>
          <iframe
            className="immersive-frame"
            src={deck.file}
            title={`${c.title}${t.immersiveSuffix}`}
          />
        </div>
      ) : null}

      {!immersive ? (
        <div className="pager">
          {prev ? (
            <a href={ROUTES.deck(prev.slug)}>
              <span className="pager-kicker">{t.pagerPrevDeck}</span>
              <span className="pager-title">{deckCopy(prev, lang).title}</span>
            </a>
          ) : (
            <a className="empty" href={ROUTES.gallery}>
              <span className="pager-kicker">{t.pagerBack}</span>
              <span className="pager-title">{t.galleryTitle}</span>
            </a>
          )}
          {next ? (
            <a href={ROUTES.deck(next.slug)}>
              <span className="pager-kicker">{t.pagerNextDeck}</span>
              <span className="pager-title">{deckCopy(next, lang).title}</span>
            </a>
          ) : (
            <a className="empty" href={ROUTES.home}>
              <span className="pager-kicker">{t.pagerDocs}</span>
              <span className="pager-title">{t.pagerDocsTitle}</span>
            </a>
          )}
        </div>
      ) : null}
    </div>
  );
}
