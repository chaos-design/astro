import { counterpartSlug, docLang } from "./docs";
import { ROUTES } from "./routes";

/** Segmented 中文 / EN switch; links to the translated twin of the current doc. */
export function LangToggle({ slug }: { slug: string | null }) {
  // Only doc pages carry a language; home, gallery, and deck pages do not.
  if (!slug) return null;
  const lang = docLang(slug);
  const counterpart = counterpartSlug(slug);
  // Language-neutral docs (index, plugin-installation) have no twin to switch to.
  if (!lang || !counterpart) return null;
  return (
    <div className="lang-toggle" role="group" aria-label="切换语言 / Switch language">
      {lang === "zh" ? (
        <span className="active">中文</span>
      ) : (
        <a href={ROUTES.doc(counterpart)} title="切换到中文">
          中文
        </a>
      )}
      {lang === "en" ? (
        <span className="active">EN</span>
      ) : (
        <a href={ROUTES.doc(counterpart)} title="Switch to English">
          EN
        </a>
      )}
    </div>
  );
}
