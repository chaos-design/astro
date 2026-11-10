# Deployment Guide

> Complete reference for every ASTRO deployment target: the local service,
> the cloud console, and the docs site, plus the environment-variable and
> configuration reference and a troubleshooting quick table. For user-facing
> behavior (Live filter, time window, preferences) see the
> [User Manual](user-manual-en.md); for permissions and capacity limits see
> [Operations](operations-en.md).

## 1. Deployment topology

ASTRO is local-first: data and capture always live on the reader's machine.
Only two **static artifacts** are deployable — the console and the docs site —
and they can sit on any static host, reading the reader's local service over
CORS:

| Component | Where | Notes |
| --- | --- | --- |
| Local service | Reader's machine | Single-file Node service (`server/server.mjs`): data read/write, SSE stream, static console hosting |
| Console | Local or cloud | Pure static page. Hosted by the service locally; on a deployment it resolves `?api=` / same-origin back to `http://127.0.0.1:5678` |
| Docs site | Cloud or any static host | Inlines `docs/*.md` at build time; fully self-contained |

The address resolution lives in exactly one place —
`src/lib/api-base.ts`: `?api=` (persisted as `ASTROX_API_BASE`) → stored value
→ same origin when the page itself is local → `http://127.0.0.1:5678`. It is
resolved once per mount and never changes mid-session.

## 2. Local service: install and run

### 2.1 Prerequisites

- The current Node.js LTS (native ESM and the dependency tree require it).
- pnpm (the repo pins its version via the `packageManager` field;
  `corepack enable` is enough).

### 2.2 Install and run from source

```bash
corepack enable
pnpm install
pnpm build        # console -> dist/
pnpm start        # service on 127.0.0.1:5678, hosting dist/
```

Without `dist/index.html` the service answers 503 "Dashboard is not built.
Run `pnpm build` first." — **if the service comes up but the console 404s or
503s, the first thing to check is a missing or misplaced build.** When the
port is taken the service walks up from the preferred port (up to +20) and
prints the actual one.

### 2.3 Where data and config live

`ASTRO_HOME` (default `~/.astrox`):

```text
<ASTRO_HOME>/plugins/astro/config.yaml   # structured config (created at install, never overwritten on upgrade)
<ASTRO_HOME>/plugins/astro/.env          # private values (mode 0600); YAML may reference them via ${VAR} / ${VAR:-default}
<ASTRO_HOME>/<source>/<date>/<session>/events.jsonl   # events split by source, time and session
```

`config.yaml` fields: `server.host` / `server.port` / `server.maxBodyBytes` /
`server.corsOrigins`, `runtime.autoOpen`, `storage.traceDir` /
`storage.projectDir`, `clients.{codex,claude,deepseek,workbuddy}.{home,command}`
(fully commented in `config.example.yaml` at the repo root).

**Precedence**: explicit CLI flags → inherited process environment → legacy
upgrade-compat variables (`AOT_HOME`, `AGENT_TRACE_*`, `TRAE_TRACE_*`) →
plugin `.env` → `config.yaml` → built-in defaults. `ASTRO_HOME` locates the
plugin itself, so it must be set via environment or `--astro-home` *before*
installing — it cannot live in the plugin's own `.env`.

### 2.4 Full environment variable reference

| Variable | Default | Description |
| --- | --- | --- |
| `ASTRO_HOST` | `127.0.0.1` | Service bind address |
| `ASTRO_PORT` | `5678` | Preferred port; the service walks up on conflict (up to +20) |
| `ASTRO_MAX_BODY_BYTES` | `5242880` | Maximum POST body size |
| `ASTRO_CORS_ORIGINS` | unset (no CORS) | Origins allowed to read the local API, comma-separated; `*` must be spelled out. Equivalent config field `server.corsOrigins` (the only route that survives a headless recorder launch) |
| `ASTRO_HOME` (`AOT_HOME`) | `~/.astrox` | Root for the runtime, plugins and event files |
| `ASTRO_TRACE_DIR` | unset | Data directory override; also settable from the console's "data directory → change" card (`POST /api/config/data-root`), which writes the plugin `.env` and restarts in place |
| `ASTRO_PROJECT_DIR` | cwd | Base for resolving a relative `ASTRO_TRACE_DIR` |
| `ASTRO_DEMO_EVENTS` | unset | Path override for the sample dataset (`GET /api/demo-events`) |
| `ASTRO_PID_FILE` | auto | Where the recorder writes the service pid (`astrox status/restart` rely on it) |
| `ASTRO_OPEN_BROWSER` | inherited | Whether the service opens a browser at launch; the recorder starts it headless with `0` |
| `ASTRO_OPEN_SOURCE` / `ASTRO_OPEN_SESSION` | unset | Deep-link source and session passed when the recorder launches the service |
| `ASTRO_TAKEOVER` | internal | In-place restart flag; the successor inherits the same port — do not set by hand |
| `ASTRO_RESTART_COUNT` / `ASTRO_RESTARTED_AT` | internal | In-place restart counter and timestamp, reported by `/api/health` |

### 2.5 Enabling capture per client

- **Direct hooks (generic)**: `pnpm install-plugins [--clients codex,claude,...]`.
  Copies the recorder, `dist/`, `server/` and `config.yaml` into
  `<ASTRO_HOME>/plugins/astro/` and writes each client's hook config; it runs
  `pnpm build` first when `dist/` is missing (`--no-build` skips it).
- **Native plugins**: `pnpm build:native-plugins` first (syncs the runtime into
  `*-plugin/` and stamps versions), then install per client:
  - Codex: `codex plugin add astro-codex-local`
  - Claude Code: `claude plugin add astro-claude-local`
  - WorkBuddy: `codebuddy plugin add astro-workbuddy-local`
  - DeepSeek Harness: `dsh plugin --profile web add file:~/.astrox/plugins/astro/deepseek-plugin` (verify with `dsh --profile web --dump-config` that `astro-trace` appears in the composed tree)
- **Standalone installers**: ZCode (`pnpm install-zcode-plugin`), OpenCode
  (`pnpm install-opencode-plugin`), Pi (`pnpm install-pi-plugin`).

Install and launch also bring up the dashboard; refresh afterwards with
`astrox update` (copy the new build) + `astrox restart`.

### 2.6 Service management and upgrades

```bash
astrox status|start|stop|restart|update|logs|doctor|path|open|info
```

Two HTTP endpoints do the same jobs (the console's service card uses them):

- `POST /api/restart` — **in-place restart**: a successor rebinds the same
  port (takeover), SSE clients and the browser tab reconnect automatically,
  and the port never drifts. A restart re-reads every file from scratch, so
  the console drops its snapshot cursor and re-subscribes.
- `POST /api/config/data-root` with `{"path": "/abs/path"}` — writes the data
  directory into the plugin `.env` (every other line preserved; missing or
  relative paths rejected), then restarts in place; `/api/health` reports the
  resulting `dataRoot`.

**Stale-bundle trap**: an installed runtime serves
`<ASTRO_HOME>/plugins/astro/dist`, **not** the repository checkout. After
`pnpm build` in the repo you must `astrox update` (or reinstall) and
`astrox restart` before the page runs the new build.

## 3. CORS and deployed pages

- With nothing configured the service emits **no** CORS headers — it behaves
  exactly like a same-origin-only install.
- An allowed origin gets an echoed `Access-Control-Allow-Origin`,
  `Access-Control-Allow-Private-Network: true` (Chrome's public→local
  preflight), and the generic `OPTIONS /api/*` preflight answers.
- Those headers attach to **every** `/api/*` response, including the SSE
  stream — EventSource cannot send custom headers, so response headers are all
  a deployed page gets.
- Verify via the `corsOrigins` array in `/api/health`.
- Non-default port or moved service: open the page with
  `?api=http://127.0.0.1:<port>` (persisted to `ASTROX_API_BASE`).

## 4. Cloud deployment: the console

### 4.1 Vercel (console + docs, one repo)

Import the repo into Vercel — **zero configuration**: `vercel.json` drives the
whole build (`pnpm build && pnpm build:docs &&
node scripts/merge-deploy-output.mjs`), producing docs at the root and the
console under `/console/` (with a rewrite so `/console` resolves).

The live deployment — and the online address of the documentation — is
<https://astro-site-cyan-five.vercel.app/>.

The reader side (data always stays on the reader's machine):

1. Run the local service (§2);
2. Add the deployment origin to the allowlist — either
   `ASTRO_CORS_ORIGINS="https://<domain>" pnpm start`, or
   `server.corsOrigins` in `~/.astrox/plugins/astro/config.yaml` plus a
   restart (an installed runtime is normally launched by a recorder hook with
   no shell to carry the variable, so only the `config.yaml` list survives);
3. Open the deployed page — it now reads the local service; use `?api=` to
   point at a non-default port.

Behavior contract: a deployed page that never connects announces it **once**
("cannot reach the local service", with the base and the exact
`ASTRO_CORS_ORIGINS` line to add) — no per-retry noise, and **never** a
silent fallback to sample data. The sample renders only behind the reader's
explicit `?demo=1`, with a persistent "sample data" banner.

### 4.2 GitHub Pages (console preview only)

`.github/workflows/console-preview.yml` — the live preview page is
<https://chaos-design.github.io/astro/>; append `?demo=1` to explore it with
the sample dataset:

- On every push/PR to `main`: build the console, run the
  `verify-console-build` assertions (relative assets, shipped icons and sample
  dataset, no docs-site markers), upload the `console-dist` artifact.
- The **deploy** job publishes automatically on push to `main` (the formal
  release) or to a rolling-preview branch listed in the workflow's `push`
  trigger (an in-flight feature branch gets a live preview URL without merging;
  remove it from that list once it merges). It publishes *that* branch's build
  over the single shared Pages site — the most recent qualifying build wins.
- The manual `workflow_dispatch` can run from **any branch** to re-publish a
  branch that is no longer a push trigger.

Constraint: the Pages site hosts the **console only**, never the docs — the
two cannot share the one site (the workflow comments and
`verify-console-build` enforce this). The docs site keeps its own path: the
Vercel merged output (`vercel.json` + `scripts/merge-deploy-output.mjs`) or the
`docs-dist` artifact; it is not auto-deployed to Pages.

### 4.3 Any other static host

The console build uses a relative Vite `base`, so `pnpm build` output works
under any sub-path; pair it with the CORS allowlist from §3.

## 5. The docs site

`pnpm build:docs` inlines every `docs/*.md` into `site/dist` at build time
(`docs/*.html` decks go to `/decks/`, `docs/assets/` ships along); the output
is self-contained. The published instance is the Vercel deployment from §4.1
(<https://astro-site-cyan-five.vercel.app/>). Three hosting routes:

1. The merged artifact: `pnpm deploy:preview` produces `deploy/` (docs at the
   root);
2. The Actions artifact: `docs-site.yml` uploads `docs-dist` on every
   push/PR (there is no automatic publish — download and host it anywhere);
3. `site/dist` deployed directly.

Adding a doc = drop the `.md` in `docs/` **and** register it in
`site/src/docs.ts` (`sectionBySlug`, and `readingOrder` where applicable);
keep `docs/index.md` in step.

## 6. Verifying the deployment output locally

```bash
pnpm deploy:preview
# = pnpm build && pnpm build:docs
#   && node scripts/merge-deploy-output.mjs
#   && ASTRO_CONSOLE_DIST=deploy/console node scripts/verify-console-build.mjs
```

Produces exactly what Vercel would publish, in `deploy/`, and verifies it on
the spot; serve the directory statically to preview the merged layout.

## 7. Troubleshooting quick table

| Symptom | Check |
| --- | --- |
| Console 503 "Dashboard is not built" | Source run: `pnpm build`. Installed runtime: `astrox update` + `astrox restart` (stale-bundle trap) |
| Deployed page says it cannot reach the local service | ① service running (`astrox status`); ② origin in `corsOrigins` (`/api/health`); ③ port — `clientCount` and `?api=` agree |
| Port conflict | The service walks up (≤ +20); the log prints the real port, point the page there with `?api=` |
| Sample data unavailable | `data/demo-events.json` missing (404) or malformed (500 names the offending field) |
| Jank / long tasks while streaming | Open the performance panel via **Settings → Performance** (floating panel at the page bottom; expand it for the pinned summary tiles and the fully expanded metric rows), read `window.__astroPerf.snapshot()`; reproduce with `pnpm perf:fixture` + `pnpm perf:bench` |
| Service misbehaving | `astrox doctor` (config diagnostics), `astrox logs`, `/api/health` (`restartCount` / `restartedAt` / `dataRoot` / `version`) |
