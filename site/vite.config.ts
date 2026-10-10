import { createReadStream, readdirSync, readFileSync, type Dirent } from "node:fs";
import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { defineConfig } from "vite";

const siteDir = import.meta.dirname;
const repoRoot = path.resolve(siteDir, "..");
const docsDir = path.join(repoRoot, "docs");

// Expose every docs/**/*.md file as Record<key, rawMarkdown> through a virtual
// module, so the site renders the documentation at build time and stays fully
// self-contained (no runtime fetch of the repo).
function docsModule(): Plugin {
  const virtualId = "virtual:astro-docs";
  const resolvedId = `\0${virtualId}`;

  function collectMarkdown(dir: string, prefix: string, out: Map<string, string>) {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        collectMarkdown(full, `${prefix}${entry.name}/`, out);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        const key = `${prefix}${entry.name}`.replace(/\.md$/, "");
        out.set(key, readFileSync(full, "utf8"));
      }
    }
  }

  return {
    name: "astro-site-docs",
    enforce: "pre",
    resolveId(id) {
      if (id === virtualId) return resolvedId;
      return null;
    },
    load(id) {
      if (id !== resolvedId) return null;
      const docs = new Map<string, string>();
      collectMarkdown(docsDir, "", docs);
      const obj: Record<string, string> = {};
      for (const [k, v] of docs) obj[k] = v;
      return `export const docs = ${JSON.stringify(obj)};`;
    },
  };
}

// Serve the self-contained deck HTML and the docs image assets during dev so
// the iframe views and doc images resolve exactly like they will in the built
// output (/decks/<name>.html, /assets/<file>).
function serveDeckAssets(): Plugin {
  return {
    name: "astro-site-serve-deck-assets",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? "").split("?")[0];
        let target: string | null = null;
        let contentType = "application/octet-stream";
        if (url !== "/decks" && url.startsWith("/decks/")) {
          const relPath = url.replace("/decks/", "");
          if (relPath.endsWith(".html")) {
            target = path.normalize(path.join(docsDir, relPath));
            contentType = "text/html";
          }
        } else if (url !== "/assets" && url.startsWith("/assets/")) {
          target = path.normalize(path.join(docsDir, "assets", url.replace("/assets/", "")));
          if (target.endsWith(".png")) contentType = "image/png";
        }
        if (!target) {
          next();
          return;
        }
        const root = target.endsWith(".html") ? docsDir : path.join(docsDir, "assets");
        if (!target.startsWith(root + path.sep)) {
          next();
          return;
        }
        const stream = createReadStream(target);
        stream.on("open", () => res.setHeader("Content-Type", contentType));
        stream.pipe(res);
      });
    },
  };
}

// Copy the self-contained deck HTML files and docs/assets/ into the build
// output after Vite writes the bundle.
function copyDeckAssets(): Plugin {
  let outDir = "dist";
  return {
    name: "astro-site-copy-deck-assets",
    apply: "build",
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    async closeBundle() {
      const decksDest = path.join(outDir, "decks");
      await rm(decksDest, { recursive: true, force: true });
      await mkdir(decksDest, { recursive: true });
      for (const entry of readdirSync(docsDir)) {
        if (entry.endsWith(".html")) {
          await cp(path.join(docsDir, entry), path.join(decksDest, entry));
        }
      }
      const assetsDest = path.join(outDir, "assets");
      await rm(assetsDest, { recursive: true, force: true });
      await cp(path.join(docsDir, "assets"), assetsDest, { recursive: true });
    },
  };
}

export default defineConfig({
  // This config is always run with an explicit --config site/vite.config.ts, so
  // pin the root to the site/ directory: the main app's root `vite build` keeps
  // writing its own dist/, and the docs site writes site/dist/.
  root: siteDir,
  // Relative base so the built site works from a repo root (Vercel), a GitHub
  // Pages subpath, or a nested directory without a server rewrite.
  base: "./",
  plugins: [react(), docsModule(), serveDeckAssets(), copyDeckAssets()],
  server: {
    host: "127.0.0.1",
    port: 5174,
    fs: { allow: [repoRoot] },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // Bundled chunks must not land in dist/assets/: that directory is
    // reserved for docs/assets images referenced relatively by the markdown
    // (the copy plugin wipes it after the build).
    assetsDir: "app",
  },
});
