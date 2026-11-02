/**
 * Verify the console build before it is published.
 *
 * The deployed page is *only* the console (the flow / run-history page), and
 * it may live under a project path (GitHub Pages `/astro/`, Vercel
 * `/console/`). Two mistakes are invisible in a local `pnpm start` and only
 * show up on the deployment:
 *
 * 1. A `public/` file referenced from the origin root (`/icons/x.svg`). The
 *    request escapes the project path and 404s — the agent dropdown lost its
 *    raster marks that way.
 * 2. The docs build leaking into the console artifact, which would publish a
 *    second, unrelated page from the console's URL.
 *
 * Both are checked here, next to the build, so CI and a local release run the
 * same assertions.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const projectDir = resolve(import.meta.dirname, "..");
const distDir = process.env.ASTRO_CONSOLE_DIST
  ? resolve(process.env.ASTRO_CONSOLE_DIST)
  : join(projectDir, "dist");
const failures = [];
const fail = (message) => failures.push(message);

for (const file of [
  "index.html",
  "chaos.png",
  "data/demo-events.json",
  "icons/deepseek.svg",
  "icons/workbuddy-logo.png",
]) {
  if (!existsSync(join(distDir, file))) {
    fail(`missing ${file}`);
  }
}

const html = existsSync(join(distDir, "index.html"))
  ? readFileSync(join(distDir, "index.html"), "utf8")
  : "";
if (html) {
  if (!html.includes('src="./assets/')) {
    fail('index.html must reference "./assets/" so a sub-path deployment works');
  }
  for (const match of html.matchAll(/(?:src|href)="(\/[^"]*)"/g)) {
    fail(`index.html references an origin-root URL: ${match[1]}`);
  }
}

const assetsDir = join(distDir, "assets");
if (existsSync(assetsDir)) {
  for (const entry of readdirSync(assetsDir)) {
    if (!entry.endsWith(".js")) {
      continue;
    }
    const source = readFileSync(join(assetsDir, entry), "utf8");
    for (const match of source.matchAll(/["'`]\/(icons|assets)\/[^"'`]*/g)) {
      fail(`${entry} references an origin-root asset: ${match[0].slice(1)}`);
    }
  }
} else {
  fail("missing assets/");
}

// Docs-site build markers: the console deployment must never publish them.
for (const marker of ["decks", "architecture-en.html", "index.md"]) {
  if (existsSync(join(distDir, marker))) {
    fail(`docs artifact leaked into the console build: ${marker}`);
  }
}

if (failures.length) {
  console.error("[verify-console-build] failed:");
  for (const message of failures) {
    console.error(`  - ${message}`);
  }
  process.exit(1);
}

console.log(
  `[verify-console-build] ${distDir} is a console-only build with base-relative assets`,
);
