/**
 * Build the docs/ folder into a self-contained static site under docs/dist/.
 *
 * The site is what vercel.json publishes and what the GitHub Actions
 * "Deploy docs site" workflow deploys to Vercel:
 *
 *   - every top-level *.md file is rendered into a templated HTML page
 *     (sidebar navigation, GitHub-style heading ids, GFM tables/code);
 *   - relative `.md` links are rewritten to `.html` so the output is
 *     self-contained;
 *   - standalone *.html pages (self-contained decks) and assets/ are
 *     copied verbatim;
 *   - files that exist in docs/ but are not listed in the curated nav
 *     below are still published, grouped under "Other / 其他", so new
 *     documents are never silently dropped.
 *
 * Output lands in docs/dist, which is gitignored by the root `dist/`
 * pattern and needs no per-directory ignore entry.
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { Marked } from "marked";

const repoRoot = path.resolve(import.meta.dirname, "..");
const docsDir = path.join(repoRoot, "docs");
const outDir = path.join(docsDir, "dist");

const siteName = "ASTRO Docs";
const siteTagline = "Agent State Trace & Runtime Observations";
const repoUrl = "https://github.com/chaos-design/astro";

/**
 * Curated sidebar navigation. `file` values are top-level names in docs/.
 * `lang` selects the HTML lang attribute for the rendered page.
 */
const navGroups = [
  {
    title: "Home / 首页",
    items: [{ file: "index.md", label: "Documentation / 文档首页", lang: "en" }],
  },
  {
    title: "中文",
    items: [
      { file: "user-manual-zh.md", label: "使用手册", lang: "zh-Hans" },
      { file: "event-protocol-zh.md", label: "事件协议参考", lang: "zh-Hans" },
      { file: "architecture-zh.md", label: "架构说明", lang: "zh-Hans" },
      { file: "operations-zh.md", label: "运维与故障处理", lang: "zh-Hans" },
      { file: "implementation-details-zh.md", label: "实现细节与规划状态", lang: "zh-Hans" },
      { file: "plugin-installation.md", label: "插件安装", lang: "en" },
    ],
  },
  {
    title: "English",
    items: [
      { file: "user-manual-en.md", label: "User Manual", lang: "en" },
      { file: "event-protocol-en.md", label: "Event Protocol", lang: "en" },
      { file: "architecture-en.md", label: "Architecture", lang: "en" },
      { file: "operations-en.md", label: "Operations & Troubleshooting", lang: "en" },
      { file: "implementation-details-en.md", label: "Implementation Details", lang: "en" },
      { file: "plugin-installation.md", label: "Plugin Installation", lang: "en" },
    ],
  },
  {
    title: "Standalone / 独立页面",
    items: [
      { file: "project-overview-slides-zh.html", label: "项目演示（22 页）", lang: "zh-Hans" },
      { file: "project-interview-zh.html", label: "技术面试项目深讲", lang: "zh-Hans" },
      { file: "interview-question-bank.html", label: "交互题库", lang: "zh-Hans" },
    ],
  },
];

const css = `
:root {
  --bg: #ffffff;
  --fg: #1f2328;
  --muted: #57606a;
  --border: #d0d7de;
  --accent: #0969da;
  --accent-soft: rgba(9, 105, 218, 0.08);
  --code-bg: #f6f8fa;
  --sidebar-bg: #f6f8fa;
  --stripe: rgba(9, 105, 218, 0.04);
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0d1117;
    --fg: #e6edf3;
    --muted: #8b949e;
    --border: #30363d;
    --accent: #4493f8;
    --accent-soft: rgba(68, 147, 248, 0.15);
    --code-bg: #161b22;
    --sidebar-bg: #010409;
    --stripe: rgba(255, 255, 255, 0.03);
  }
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0;
  font: 16px/1.75 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
    "Helvetica Neue", "PingFang SC", "Microsoft YaHei", sans-serif;
  color: var(--fg);
  background: var(--bg);
}
.sidebar {
  position: fixed;
  inset: 0 auto 0 0;
  width: 296px;
  overflow-y: auto;
  padding: 20px 14px 48px;
  background: var(--sidebar-bg);
  border-right: 1px solid var(--border);
}
.brand {
  display: block;
  padding: 6px 10px 14px;
  font-size: 1.2rem;
  font-weight: 700;
  color: var(--fg);
  text-decoration: none;
}
.brand small {
  display: block;
  margin-top: 2px;
  font-size: 0.68rem;
  font-weight: 500;
  letter-spacing: 0.04em;
  color: var(--muted);
}
.nav-group { margin-top: 14px; }
.nav-group > h2 {
  margin: 0 0 4px;
  padding: 0 10px;
  font-size: 0.72rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--muted);
}
.nav-group a {
  display: block;
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 0.92rem;
  color: var(--fg);
  text-decoration: none;
}
.nav-group a:hover { background: var(--accent-soft); color: var(--accent); }
.nav-group a.active {
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 600;
}
.repo-link {
  margin-top: 24px;
  padding: 8px 10px 0;
  font-size: 0.85rem;
  color: var(--muted);
}
.repo-link a { color: var(--accent); text-decoration: none; }
.main { margin-left: 296px; padding: 40px 44px 96px; }
.content { max-width: 940px; }
.content > h1 {
  margin: 0.4em 0 0.8em;
  font-size: 2.1rem;
  line-height: 1.25;
  padding-bottom: 0.35em;
  border-bottom: 1px solid var(--border);
}
.content h2 {
  margin: 2em 0 0.8em;
  font-size: 1.5rem;
  padding-bottom: 0.3em;
  border-bottom: 1px solid var(--border);
  scroll-margin-top: 16px;
}
.content h3 { margin: 1.6em 0 0.6em; font-size: 1.18rem; scroll-margin-top: 16px; }
.content p,
.content ul,
.content ol { margin: 0.8em 0; }
.content ul,
.content ol { padding-left: 1.7em; }
.content li + li { margin-top: 0.35em; }
a { color: var(--accent); }
code {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas,
    "Liberation Mono", monospace;
  font-size: 0.88em;
  background: var(--code-bg);
  padding: 0.15em 0.4em;
  border-radius: 6px;
}
pre {
  background: var(--code-bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 14px 16px;
  overflow-x: auto;
}
pre code { background: none; padding: 0; border-radius: 0; }
table {
  border-collapse: collapse;
  margin: 1em 0;
  width: 100%;
  font-size: 0.95em;
}
th,
td {
  border: 1px solid var(--border);
  padding: 8px 12px;
  text-align: left;
  vertical-align: top;
}
thead th { background: var(--code-bg); }
tbody tr:nth-child(even) { background: var(--stripe); }
blockquote {
  margin: 1em 0;
  padding: 0.2em 0 0.2em 1em;
  color: var(--muted);
  border-left: 3px solid var(--border);
}
img { max-width: 100%; border-radius: 8px; }
hr { border: 0; border-top: 1px solid var(--border); margin: 2em 0; }
footer {
  margin-top: 4em;
  padding-top: 1.5em;
  border-top: 1px solid var(--border);
  font-size: 0.85rem;
  color: var(--muted);
}
@media (max-width: 920px) {
  .sidebar {
    position: static;
    inset: auto;
    width: auto;
    border-right: 0;
    border-bottom: 1px solid var(--border);
    padding-bottom: 8px;
  }
  .main { margin-left: 0; padding: 24px 20px 64px; }
}
`;

/** GitHub-style heading anchor: unicode letters/digits survive, spaces become dashes. */
function slugify(text) {
  return (
    text
      .toLowerCase()
      .trim()
      .replace(/`/g, "")
      .replace(/\*/g, "")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // [label](url) -> label
      .replace(/[`*]/g, "")
      .replace(/[^\p{L}\p{N} _-]/gu, "")
      .replace(/\s+/g, "-")
  );
}

/** Fresh marked instance: GFM defaults, GitHub-style ids on headings, per-page counters. */
function createPageParser() {
  const parser = new Marked();
  const slugCounts = new Map();
  parser.use({
    renderer: {
      heading(token) {
        // The renderer visits headings in document order, so the per-page
        // counter yields GitHub-style unique ids. this.parser is the
        // per-page Parser; its parseInline renders token arrays (the Marked
        // instance API only accepts markdown strings).
        const base = slugify(token.text) || "section";
        const seen = slugCounts.get(base) ?? 0;
        slugCounts.set(base, seen + 1);
        const id = seen === 0 ? base : `${base}-${seen}`;
        const text = this.parser.parseInline(token.tokens);
        return `<h${token.depth} id="${id}">${text}</h${token.depth}>\n`;
      },
    },
  });
  return parser;
}

/** Rewrite relative `.md` links/images to the published `.html` names. */
function publishRelativeLinks(html) {
  return html.replace(/(href|src)="([^"<>]+?)\.md(#[^"<>]*)?"/g, (match, attr, target, hash) => {
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(target)) return match; // external
    const clean = target.replace(/^\.\//, "");
    return `${attr}="${clean}.html${hash ?? ""}"`;
  });
}

function htmlEscape(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function publishedName(file) {
  return file.endsWith(".md") ? `${file.slice(0, -3)}.html` : file;
}

function renderShell({ lang, title, body, activeFile, groups }) {
  const nav = groups
    .map((group) => {
      const links = group.items
        .map((item) => {
          const href = publishedName(item.file);
          const active = item.file === activeFile ? " active" : "";
          return `<a href="${href}"${active}>${htmlEscape(item.label)}</a>`;
        })
        .join("\n");
      return `<div class="nav-group">\n<h2>${htmlEscape(group.title)}</h2>\n${links}\n</div>`;
    })
    .join("\n");
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="description" content="${htmlEscape(siteTagline)} — ${htmlEscape(siteName)}">
<title>${htmlEscape(title)}</title>
<style>${css}</style>
</head>
<body>
<aside class="sidebar">
<a class="brand" href="index.html">ASTRO <small>${htmlEscape(siteTagline)}</small></a>
${nav}
<div class="repo-link">GitHub · <a href="${repoUrl}" target="_blank" rel="noreferrer">chaos-design/astro</a></div>
</aside>
<main class="main">
<article class="content">
${body}
<footer>ASTRO — ${htmlEscape(siteTagline)} · 文档源目录 <a href="index.html">docs/</a> · <a href="${repoUrl}" target="_blank" rel="noreferrer">chaos-design/astro</a></footer>
</article>
</main>
</body>
</html>
`;
}

function main() {
  if (process.argv.includes("--help")) {
    console.log("Usage: node scripts/build-docs-site.mjs");
    return;
  }
  if (!existsSync(docsDir)) {
    console.error(`docs directory not found: ${docsDir}`);
    process.exit(1);
  }

  const mdFiles = readdirSync(docsDir)
    .filter((name) => name.endsWith(".md"))
    .sort();
  const htmlFiles = readdirSync(docsDir)
    .filter((name) => name.endsWith(".html"))
    .sort();

  const groups = [...navGroups];
  const registered = new Set(
    groups.flatMap((group) => group.items.map((item) => item.file)),
  );
  for (const file of registered) {
    if (!existsSync(path.join(docsDir, file))) {
      console.error(`navigation references a missing file: docs/${file}`);
      process.exit(1);
    }
  }

  // Publish everything in docs/ that is not already in the curated nav.
  const stray = [...mdFiles, ...htmlFiles]
    .filter((file) => !registered.has(file))
    .sort();
  if (stray.length > 0) {
    groups.push({
      title: "Other / 其他",
      items: stray.map((file) => ({
        file,
        label: file.replace(/\.(md|html)$/, ""),
        lang: "en",
      })),
    });
  }

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const itemsByFile = new Map(
    groups.flatMap((group) => group.items.map((item) => [item.file, item])),
  );
  const written = [];

  for (const file of mdFiles) {
    const source = readFileSync(path.join(docsDir, file), "utf8");
    const body = publishRelativeLinks(createPageParser().parse(source));
    const item = itemsByFile.get(file);
    const page = renderShell({
      lang: item?.lang ?? "en",
      title: `${item?.label ?? file} · ${siteName}`,
      body,
      activeFile: file,
      groups,
    });
    const outFile = publishedName(file);
    writeFileSync(path.join(outDir, outFile), page);
    written.push(outFile);
  }

  for (const file of htmlFiles) {
    cpSync(path.join(docsDir, file), path.join(outDir, file));
    written.push(file);
  }

  if (existsSync(path.join(docsDir, "assets"))) {
    cpSync(path.join(docsDir, "assets"), path.join(outDir, "assets"), {
      recursive: true,
    });
    written.push("assets/");
  }

  if (!existsSync(path.join(outDir, "index.html"))) {
    console.error("build failed: docs/index.md is missing, no index.html produced");
    process.exit(1);
  }

  const totalBytes = written.reduce((sum, name) => {
    const target = path.join(outDir, name);
    if (name.endsWith("/")) {
      const dir = target;
      const names = readdirSync(dir);
      return sum + names.reduce(
        (b, child) => b + statSync(path.join(dir, child)).size,
        0,
      );
    }
    return sum + statSync(target).size;
  }, 0);

  console.log(
    `docs site: ${mdFiles.length} markdown pages + ${htmlFiles.length} standalone HTML files -> ${path.relative(
      repoRoot,
      outDir,
    )}`,
  );
  console.log(`total output: ${(totalBytes / 1024).toFixed(1)} KiB`);
}

main();
