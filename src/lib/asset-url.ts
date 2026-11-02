/**
 * URLs for files that live in `public/`.
 *
 * The console has two homes: served by the local service (site root) and
 * published as a static page under a project path — GitHub Pages serves this
 * repository at `/astro/`, Vercel at `/console/`. A public file referenced as
 * `/icons/deepseek.svg` is resolved against the *origin* root, so on a
 * sub-path deployment it escapes the project and 404s (the agent dropdown
 * showed two broken marks while every lucide glyph kept working).
 *
 * `import.meta.env.BASE_URL` carries the Vite base the bundle was built with:
 * `./` for the relative build (so the browser resolves against the page's own
 * directory), `/` in `pnpm dev`. Keeping this in one function means "public
 * asset" has a single definition instead of a string convention every new
 * component has to remember.
 */

/** Resolve a `public/` file against the deployment base. */
export function assetUrl(path: string, base?: string): string {
  const resolvedBase = base ?? import.meta.env?.BASE_URL ?? "/";
  const file = path.replace(/^\/+/, "");
  if (!resolvedBase || resolvedBase === "/") {
    return `/${file}`;
  }
  return `${resolvedBase.replace(/\/+$/, "")}/${file}`;
}
