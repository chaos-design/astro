# AGENTS.md

## Scope

These instructions apply to the entire repository.

ASTRO is a local-first observability application for coding-agent traces. The
frontend uses React 19, strict TypeScript, Vite, Tailwind CSS, local shadcn/ui
components, and Lucide icons. The service, CLI, installers, and capture adapters
use Node.js ES modules or CommonJS according to their existing file extension.

## Repository Map

- `src/`: frontend application, domain projections, configuration, and UI.
- `server/`: HTTP, SSE, static hosting, and JSONL repositories.
- `plugin/`: canonical recorder, adapters, storage paths, and browser client.
- `*-plugin/`: portable client-specific plugin packages.
- `opencode-plugin/`: zero-dependency OpenCode plugin installed globally by
  `scripts/install-opencode-plugin.mjs`; `mapping.ts` maps OpenCode server
  events onto canonical event names, `claim.ts` guarantees one recorder per
  session.
- `scripts/`: installation, migration, validation, and packaging scripts.
- `tests/`: Node test runner suites.
- `docs/`: English and Chinese architecture, protocol, operation, and user docs.

## Conventions

- Frontend filenames are lowercase and use hyphens.
- Functions use lower camel case.
- Follow existing TypeScript types and local shadcn/ui patterns.
- Use Lucide icons for interface actions when an icon exists.
- Keep raw `TraceEvent` data immutable. UI status, duration, topology, and
  trajectory state must be derived without rewriting persisted events.
- Keep platform-neutral behavior in shared domain helpers. Platform-specific
  mappings belong in `src/config/atom-platforms.ts` or the relevant adapter.
- Treat unrelated working-tree changes as user-owned and do not revert them.

## Run Timeout Invariant

- `appTimings.activeRunTimeoutMs` is the single frontend timeout policy.
- Its default is 24 hours in milliseconds.
- A duration that is still advancing is capped at the timeout and its effective
  UI status becomes `terminated`.
- The timeout is derived at read/render time. It must not append a synthetic
  event or replace the persisted session status.
- Expired selected runs must not keep live topology animation or running log
  markers active.

## Event Labels

- User-question lifecycle events use the `user.question` / `user.answer`
  display keys.
- `Notification` is displayed as `user.question` (`AskUserQuestion`) in the
  event log.
- `PreCompact` / `PostCompact` cover context compaction for every client that
  reports it; streaming compaction deltas are never recorded.

## Validation

Run these checks after TypeScript or frontend changes:

```bash
pnpm test
pnpm typecheck
pnpm build
```

The repository currently has no separate lint script. Use `git diff --check`
for whitespace validation and keep public helpers covered by focused tests.

When capture or portable plugin sources change, also run:

```bash
pnpm build:native-plugins
pnpm validate:claude-hooks
```
