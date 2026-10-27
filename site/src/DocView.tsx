import { useCallback, useEffect, useRef, useState } from "react";
import { catalogFor, getDoc, orderedDocSlugs } from "./docs";
import { useLang } from "./i18n";
import { Lightbox } from "./Lightbox";
import { type RenderedDoc, renderMarkdown } from "./markdown";
import { ROUTES } from "./routes";

export function DocView({ slug }: { slug: string }) {
  const { lang, t } = useLang();
  const result = getDoc(slug);
  const catalog = catalogFor(lang);
  const [doc, setDoc] = useState<RenderedDoc | null>(null);
  const [zoomSvg, setZoomSvg] = useState<string | null>(null);
  const [zoomImage, setZoomImage] = useState<string | null>(null);
  const [zoomTitle, setZoomTitle] = useState<string>("");
  const bodyRef = useRef<HTMLDivElement | null>(null);

  // Depend on `slug` only: `getDoc` returns a fresh object each render, and
  // re-running this effect on every render is what looped the earlier version
  // into a "stuck" state. Fetch the doc inside the effect instead.
  useEffect(() => {
    let cancelled = false;
    setDoc(null);
    const { raw } = getDoc(slug) ?? { raw: "" };
    renderMarkdown(raw, slug).then((rendered) => {
      if (cancelled) return;
      setDoc(rendered);
    });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  // In-page anchors (#heading) must scroll, not rewrite the site hash route
  // (#/doc/...). Clicking them as-is would replace the whole hash and send the
  // router to a not-found page. Intercept them here.
  useEffect(() => {
    if (!doc) return;
    const onAnchorClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement | null)?.closest?.("a[href^='#']");
      if (!a) return;
      const href = a.getAttribute("href") ?? "";
      if (href.length <= 1 || href.startsWith("#/")) return; // site route or bare
      e.preventDefault();
      const id = decodeURIComponent(href.slice(1));
      const el = document.getElementById(id);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    };
    document.addEventListener("click", onAnchorClick, true);
    return () => document.removeEventListener("click", onAnchorClick, true);
  }, [doc]);

  // Click a mermaid diagram or a wrapped document image to open it in a
  // zoomable lightbox.
  useEffect(() => {
    if (!doc) return;
    const body = bodyRef.current;
    if (!body) return;
    const nearestHeading = (target: Element): string => {
      const headings = Array.from(body.querySelectorAll("h1, h2, h3"));
      let title = "";
      for (const h of headings) {
        const pos = h.compareDocumentPosition(target);
        if (pos & Node.DOCUMENT_POSITION_FOLLOWING) {
          title = h.textContent ?? "";
        }
      }
      return title;
    };
    const onDiagramClick = (e: MouseEvent) => {
      // A wrapped markdown image opens as a zoomable picture.
      const img = (e.target as HTMLElement).closest?.(".zoomable-image");
      if (img && body.contains(img)) {
        setZoomImage(img.getAttribute("data-zoom-img") ?? "");
        setZoomSvg(null);
        setZoomTitle(
          (img.getAttribute("data-zoom-alt") || "").trim() ||
            nearestHeading(img) ||
            getDoc(slug)?.item.title ||
            t.lbDefaultTitle,
        );
        return;
      }
      const target = (e.target as HTMLElement).closest?.(".mermaid-diagram");
      if (!target || !body.contains(target)) return;
      const svg = target.querySelector("svg");
      if (!svg) return;
      setZoomSvg(svg.outerHTML);
      setZoomImage(null);
      setZoomTitle(nearestHeading(target) || getDoc(slug)?.item.title || t.lbDefaultTitle);
    };
    body.addEventListener("click", onDiagramClick);
    return () => body.removeEventListener("click", onDiagramClick);
  }, [doc, slug, t]);

  const closeZoom = useCallback(() => {
    setZoomSvg(null);
    setZoomImage(null);
  }, []);

  if (!result) {
    return (
      <div className="content-inner">
        <div className="crumb">{t.docCrumb}</div>
        <h1 className="page-title">{t.docNotFound}</h1>
        <p className="page-desc">
          {lang === "en" ? (
            <>
              No doc with slug <code>{slug}</code>. <a href={ROUTES.home}>{t.backHome}</a>.
            </>
          ) : (
            <>
              没有 slug 为 <code>{slug}</code> 的文档。
              <a href={ROUTES.home}>{t.backHome}</a>。
            </>
          )}
        </p>
      </div>
    );
  }

  // The pager walks the current language's reading order only.
  const slugs = orderedDocSlugs(lang);
  const i = slugs.indexOf(slug);
  const prev = i > 0 ? slugs[i - 1] : null;
  const next = i >= 0 && i < slugs.length - 1 ? slugs[i + 1] : null;
  const section = catalog.sections.find((s) => s.items.some((item) => item.slug === slug));

  return (
    <div className="content-inner">
      <div className="crumb">
        <a href={ROUTES.home}>ASTRO</a> / {section?.title ?? t.docCrumb} /{" "}
        {result.item.title}
      </div>

      <div className="doc-layout">
        <div>
          <div
            ref={bodyRef}
            className="doc-body"
            // biome-ignore lint/security/noDangerouslySetInnerHtml: content is generated only by our own marked + hljs + mermaid pipeline over repository-provided docs; no external input can reach this value
            dangerouslySetInnerHTML={doc ? { __html: doc.html } : undefined}
          />
          {/* Purely visual placeholder (no spinner or text), mirroring memx. */}
          {!doc ? (
            <div className="doc-skeleton" role="status" aria-live="polite" aria-busy="true">
              <i className="sk-title" style={{ width: "42%" }} />
              <i style={{ width: "96%" }} />
              <i style={{ width: "88%" }} />
              <i style={{ width: "93%" }} />
              <i className="sk-block" style={{ width: "71%" }} />
              <i style={{ width: "90%" }} />
              <i style={{ width: "57%" }} />
            </div>
          ) : null}

          <div className="pager">
            {prev ? (
              <a href={ROUTES.doc(prev)}>
                <span className="pager-kicker">{t.pagerPrev}</span>
                <span className="pager-title">
                  {catalog.index[prev]?.title ?? getDoc(prev)?.item.title ?? prev}
                </span>
              </a>
            ) : (
              <a className="empty" href={ROUTES.home}>
                <span className="pager-kicker">{t.pagerPrev}</span>
                <span className="pager-title">{t.pagerHome}</span>
              </a>
            )}
            {next ? (
              <a href={ROUTES.doc(next)}>
                <span className="pager-kicker">{t.pagerNext}</span>
                <span className="pager-title">
                  {catalog.index[next]?.title ?? getDoc(next)?.item.title ?? next}
                </span>
              </a>
            ) : (
              <a className="empty" href={ROUTES.gallery}>
                <span className="pager-kicker">{t.pagerNext}</span>
                <span className="pager-title">{t.pagerGallery}</span>
              </a>
            )}
          </div>
        </div>

        {doc && doc.toc.length > 0 ? (
          <div className="doc-toc">
            <h4>{t.tocTitle}</h4>
            <ol>
              {doc.toc.map((tocItem) => (
                <li key={tocItem.id} style={{ paddingLeft: tocItem.depth === 3 ? 14 : 0 }}>
                  <a href={`#${tocItem.id}`}>{tocItem.text}</a>
                </li>
              ))}
            </ol>
          </div>
        ) : null}
      </div>

      {zoomSvg || zoomImage ? (
        <Lightbox
          svgHtml={zoomSvg ?? undefined}
          imageSrc={zoomImage ?? undefined}
          title={zoomTitle}
          onClose={closeZoom}
        />
      ) : null}
    </div>
  );
}
