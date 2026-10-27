import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useLang } from "./i18n";

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

const MIN_SCALE = 0.25;
const MAX_SCALE = 5;

/**
 * Click-to-zoom lightbox for document content — both mermaid diagrams (an SVG
 * string) and wrapped markdown images (a URL). The content is re-hosted in a
 * pannable / zoomable viewport driven by a CSS transform:
 *   - wheel zooms, anchored to the pointer (native, non-passive listener, so
 *     the page behind never scrolls along);
 *   - single-finger / drag pans; two-finger pinch zooms; double-tap toggles;
 *   - buttons set scale; Esc, overlay click, or the close button close it;
 *   - opening locks background scroll and focuses the dialog; closing restores
 *     focus to the trigger.
 */
export function Lightbox({
  svgHtml,
  imageSrc,
  title,
  onClose,
}: {
  svgHtml?: string;
  imageSrc?: string;
  title?: string;
  onClose: () => void;
}) {
  const { t } = useLang();
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);

  const dialogRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  // Pointers currently on the viewport: one pans, two pinch.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchDist = useRef(0);
  const lastTap = useRef(0);
  // Set once the user takes control (zoom/pan); until then we re-fit on
  // media load / window resize so a wide picture still opens well-framed.
  const interacted = useRef(false);

  // Always-current view state for native (non-React) listeners to read.
  const view = useRef({ scale: 1, tx: 0, ty: 0 });
  view.current = { scale, tx, ty };

  const commit = useCallback((next: { scale: number; tx: number; ty: number }) => {
    view.current = next;
    setScale(next.scale);
    setTx(next.tx);
    setTy(next.ty);
  }, []);

  // Zoom anchored so the point at (ax, ay) — viewport-relative — stays put.
  const zoomAt = useCallback(
    (ax: number, ay: number, factor: number) => {
      interacted.current = true;
      const v = view.current;
      const next = clamp(v.scale * factor, MIN_SCALE, MAX_SCALE);
      const k = next / v.scale;
      commit({ scale: next, tx: ax - k * (ax - v.tx), ty: ay - k * (ay - v.ty) });
    },
    [commit],
  );

  const reset = useCallback(() => commit({ scale: 1, tx: 0, ty: 0 }), [commit]);

  // Fit the media into the viewport without ever upscaling beyond 100%: a wide
  // desktop screenshot shrinks to frame itself, a small diagram stays native.
  // offsetWidth/Height are the layout box at scale 1 (ancestor transforms do
  // not affect them), so the fit scale is simply availableSize / naturalSize.
  const fit = useCallback(() => {
    const vp = viewportRef.current;
    const media = stageRef.current?.firstElementChild as HTMLElement | null;
    if (!vp || !media) return;
    const naturalW = media.offsetWidth;
    const naturalH = media.offsetHeight;
    if (naturalW <= 0 || naturalH <= 0) return;
    const pad = 24;
    const scale = Math.min(
      1,
      (vp.clientWidth - pad * 2) / naturalW,
      (vp.clientHeight - pad * 2) / naturalH,
    );
    commit({ scale: clamp(scale, MIN_SCALE, MAX_SCALE), tx: 0, ty: 0 });
  }, [commit]);

  // Native, non-passive wheel listener: React's onWheel is passive in some
  // browsers so preventDefault would not stop the underlying page scroll.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      zoomAt(e.clientX - cx, e.clientY - cy, e.deltaY < 0 ? 1.12 : 0.89);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  // Lock background scroll while open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Focus the dialog on open; hand focus back to the trigger on close.
  useLayoutEffect(() => {
    triggerRef.current = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => {
      triggerRef.current?.focus?.();
      triggerRef.current = null;
    };
  }, []);

  // Fit the media into the viewport on open (after the media box is laid out)
  // and on window resize / image load — but only while the user has not yet
  // manually zoomed/panned, so their framing is never fought with.
  useLayoutEffect(() => {
    if (!interacted.current) fit();
    const media = stageRef.current?.firstElementChild;
    const img = media?.tagName === "IMG" ? (media as HTMLImageElement) : media?.querySelector("img");
    const onLoad = () => {
      if (!interacted.current) fit();
    };
    img?.addEventListener("load", onLoad);
    const onResize = () => {
      if (!interacted.current) fit();
    };
    window.addEventListener("resize", onResize);
    return () => {
      img?.removeEventListener("load", onLoad);
      window.removeEventListener("resize", onResize);
    };
  }, [fit]);

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinchDist.current = Math.hypot(a.x - b.x, a.y - b.y);
      // A two-finger gesture means "zoom", not "double-tap".
      lastTap.current = 0;
    }
    // Single-pointer tap (not drag) toggles zoom on mobile.
    if (pointers.current.size === 1) {
      const now = performance.now();
      if (now - lastTap.current < 280) {
        lastTap.current = 0;
        const el = viewportRef.current;
        const rect = el?.getBoundingClientRect();
        const cx = (rect?.left ?? 0) + (rect?.width ?? 0) / 2;
        const cy = (rect?.top ?? 0) + (rect?.height ?? 0) / 2;
        zoomAt(e.clientX - cx, e.clientY - cy, view.current.scale > 1.4 ? 0.55 : 2.2);
      } else {
        lastTap.current = now;
      }
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      interacted.current = true;
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchDist.current > 0) {
        const el = viewportRef.current;
        const rect = el?.getBoundingClientRect();
        const cx = (rect?.left ?? 0) + (rect?.width ?? 0) / 2;
        const cy = (rect?.top ?? 0) + (rect?.height ?? 0) / 2;
        zoomAt((a.x + b.x) / 2 - cx, (a.y + b.y) / 2 - cy, dist / pinchDist.current);
      }
      pinchDist.current = dist;
    } else if (pointers.current.size === 1) {
      interacted.current = true;
      commit({
        scale: view.current.scale,
        tx: view.current.tx + (e.clientX - prev.x),
        ty: view.current.ty + (e.clientY - prev.y),
      });
    }
  };

  const onPointerEnd = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    pinchDist.current = 0;
    (e.target as Element).releasePointerCapture?.(e.pointerId);
  };

  const shownTitle = title || t.lbDefaultTitle;
  const pct = Math.round(scale * 100);
  const center = (x: number, y: number) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    return {
      ax: x - ((rect?.left ?? 0) + (rect?.width ?? 0) / 2),
      ay: y - ((rect?.top ?? 0) + (rect?.height ?? 0) / 2),
    };
  };

  return (
    <div
      ref={dialogRef}
      className="lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={`${t.lbClose} ${shownTitle}`}
      tabIndex={-1}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="lightbox-box">
        <div className="lightbox-head">
          <span className="lightbox-title">{shownTitle}</span>
          <span className="lightbox-hint">{t.lbHint}</span>
          <div className="lightbox-tools">
            <button
              type="button"
              className="lightbox-tool"
              onClick={() => {
                const c = center(window.innerWidth / 2, window.innerHeight / 2);
                zoomAt(c.ax, c.ay, 0.8);
              }}
              aria-label={t.lbZoomOut}
            >
              −
            </button>
            <button
              type="button"
              className="lightbox-tool"
              onClick={() => {
                const c = center(window.innerWidth / 2, window.innerHeight / 2);
                zoomAt(c.ax, c.ay, 1.25);
              }}
              aria-label={t.lbZoomIn}
            >
              +
            </button>
            <button
              type="button"
              className="lightbox-tool lightbox-pct"
              onClick={reset}
              title={t.lbReset}
              aria-label={`${pct}% · ${t.lbReset}`}
            >
              {pct}%
            </button>
            <button
              type="button"
              className="lightbox-tool lightbox-close"
              onClick={onClose}
              aria-label={t.lbClose}
            >
              ✕
            </button>
          </div>
        </div>
        <div
          ref={viewportRef}
          className="lightbox-viewport"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
        >
          <div
            ref={stageRef}
            className="lightbox-stage"
            style={{
              transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
            }}
          >
            {imageSrc ? (
              <img src={imageSrc} alt={shownTitle} draggable={false} />
            ) : (
              // biome-ignore lint/security/noDangerouslySetInnerHtml: re-hosts only the site's own mermaid SVG output
              <div dangerouslySetInnerHTML={{ __html: svgHtml ?? "" }} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
