import { useEffect, useState } from "react";
import { deckPages, getDeck } from "./decks";
import { ROUTES } from "./routes";

export function DeckView({ slug }: { slug: string }) {
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
        <div className="crumb">演示</div>
        <h1 className="page-title">未找到演示</h1>
        <p className="page-desc">
          没有 slug 为 <code>{slug}</code> 的演示页。 <a href={ROUTES.gallery}>浏览全部演示</a>。
        </p>
      </div>
    );
  }

  const at = deckPages.findIndex((d) => d.slug === slug);
  const prev = at > 0 ? deckPages[at - 1] : null;
  const next = at >= 0 && at < deckPages.length - 1 ? deckPages[at + 1] : null;

  return (
    <div className="content-inner">
      <div className="crumb">
        <a href={ROUTES.home}>ASTRO</a> / 演示 / {deck.title}
      </div>

      <h1 className="page-title">{deck.title}</h1>
      <p className="page-desc">{deck.description}</p>

      <div className="artifact-bar">
        <span className="pill">{deck.tags.join(" · ")}</span>
        <span className="pill">{deck.file}</span>
        <a className="open-link" href={deck.file} target="_blank" rel="noreferrer">
          新窗口打开 ↗
        </a>
        <button className="btn primary" type="button" onClick={() => setImmersive(true)}>
          全屏沉浸 ⛶
        </button>
      </div>

      {!immersive ? (
        <iframe
          key={deck.slug}
          className="artifact-frame"
          src={deck.file}
          title={deck.title}
        />
      ) : null}

      {immersive ? (
        <div className="immersive">
          <div className="immersive-top">
            <span className="immersive-title">{deck.title}</span>
            <span className="pill">Esc 退出</span>
            <button className="btn" type="button" onClick={() => setImmersive(false)}>
              退出 ⤢
            </button>
          </div>
          <iframe
            className="immersive-frame"
            src={deck.file}
            title={`${deck.title}（沉浸模式）`}
          />
        </div>
      ) : null}

      {!immersive ? (
        <div className="pager">
          {prev ? (
            <a href={ROUTES.deck(prev.slug)}>
              <span className="pager-kicker">← 上一个演示</span>
              <span className="pager-title">{prev.title}</span>
            </a>
          ) : (
            <a className="empty" href={ROUTES.gallery}>
              <span className="pager-kicker">← 返回</span>
              <span className="pager-title">演示与题库</span>
            </a>
          )}
          {next ? (
            <a href={ROUTES.deck(next.slug)}>
              <span className="pager-kicker">下一个演示 →</span>
              <span className="pager-title">{next.title}</span>
            </a>
          ) : (
            <a className="empty" href={ROUTES.home}>
              <span className="pager-kicker">文档中心 →</span>
              <span className="pager-title">ASTRO 文档</span>
            </a>
          )}
        </div>
      ) : null}
    </div>
  );
}
