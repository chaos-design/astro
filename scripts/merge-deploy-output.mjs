/**
 * Merge the two static builds into one deployable directory.
 *
 * Vercel (and any static host) serves a single output directory, but the repo
 * ships two: the docs site (`site/dist`) and the console (`dist`). The merged
 * layout keeps every existing URL stable and adds the console under a prefix:
 *
 *     deploy/            the docs site, exactly as today
 *     deploy/console/    the console preview
 *
 * The console is a static page: on the deployment it has no backend of its
 * own, so it reads the service running on the visitor's machine — see
 * `src/lib/api-base.ts` for the address resolution and `ASTRO_CORS_ORIGINS`
 * in `server/server.mjs` for the allowlist that makes the cross-origin read
 * possible.
 */
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = process.env.ASTRO_DEPLOY_OUTPUT_DIR
  ? resolve(process.env.ASTRO_DEPLOY_OUTPUT_DIR)
  : join(projectDir, "deploy");

const docsDist = join(projectDir, "site", "dist");
const consoleDist = join(projectDir, "dist");

for (const [label, source] of [
  ["docs site", docsDist],
  ["console", consoleDist],
]) {
  if (!existsSync(join(source, "index.html"))) {
    console.error(
      `[deploy] missing ${label} build at ${source}; run "pnpm build" and "pnpm build:docs" first`,
    );
    process.exit(1);
  }
}

mkdirSync(outputDir, { recursive: true });
cpSync(docsDist, outputDir, { recursive: true });
cpSync(consoleDist, join(outputDir, "console"), { recursive: true });

console.log(
  `[deploy] merged docs site + console preview into ${outputDir} (console at /console/)`,
);
