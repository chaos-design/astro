# ASTRO Project Conventions and Execution Rules

> Audience: repository contributors and coding agents working in this repo.
>
> This is the readable companion to the root `AGENTS.md`: `AGENTS.md` states the
> invariants an agent must not break, this document explains where they come from
> and where they live in the code. When the two disagree, `AGENTS.md` wins and
> this document must be corrected in the same change.

## 1. Scope

- Applies to the whole repository: the console in `src/`, the service in
  `server/`, capture and adapters in `plugin/`, the per-client portable plugin
  directories, `scripts/`, `tests/`, `docs/`, and the docs site in `site/`.
- Rules describe what must be true, not what once was. Historical reasoning
  belongs in code comments and explanatory paragraphs, not in rule bullets.

## 2. Directory responsibilities

| Directory | Responsibility | Not here |
| --- | --- | --- |
| `src/` | React console, domain projections, configuration, UI | capture logic, filesystem access |
| `server/` | HTTP, SSE, static hosting, JSONL repositories | presentation logic |
| `plugin/` | canonical recorder, adapters, storage paths, browser client | per-client hook lists |
| `*-plugin/` | portable plugin packages for one client each | shared cross-client logic |
| `scripts/` | install, migration, validation, packaging | runtime dependencies |
| `tests/` | Node test-runner suites | manual acceptance notes |
| `docs/` | paired Chinese/English user, protocol, architecture, operations and convention docs | generated output |
| `site/` | the docs site (reads `docs/*.md`) | copies of doc content |

## 3. Branches, commits, and pull requests

- Branch from `origin/main`. Do not pile unrelated work onto someone else's
  unmerged feature branch.
- Use conventional commit prefixes: `feat(console):`, `fix(console):`, `docs:`,
  `test:`, `chore(plugins):`.
- PR descriptions use `## 变更点 / ## 验证 / ## 备注`. The verification section
  lists the commands that actually ran, never "tested".
- Do not commit `dist/`, `.astrox` data directories, scratch screenshots, or
  machine-specific paths.
- Unrelated working-tree changes belong to the user: never revert them, never
  smuggle them into an unrelated commit.

## 4. Code conventions

- TypeScript strict; frontend file names are lowercase and hyphenated, functions
  are lower camel case.
- Raw `TraceEvent` data is immutable. Status, duration, topology, and trajectory
  state are derived at read/render time; never rewrite or synthesize events.
- One definition per concept:
  - error/exception classification lives only in
    `src/lib/exception-events.ts`;
  - RUN HISTORY liveness lives only in `src/lib/run-history-state.ts`
    (`isLiveRunStatus` + `isFreshLiveRun` + `collectLiveRunKeys`);
  - the time window lives only in `src/lib/run-history-window.ts`.
  New consumers reuse those helpers; do not grow a second failure or live list.
- Platform-specific mappings belong in `src/config/atom-platforms.ts` or the
  relevant adapter; domain helpers stay platform-neutral.
- Prefer Lucide icons for interface actions. Brand glyphs (such as GitHub) ship
  as inline SVG components instead of adding a dependency.

## 5. The time window

- The window unit is **hours**, not calendar days: "last 3 hours" is the same
  span at 09:00 and at 23:00, and it does not change length at midnight.
- The length comes from the `Default time range` setting (`1h` / `3h` / `6h` /
  `12h` / `24h` / `3d` / `7d` / `30d`, default `3h`; four per row in the
  dialog), converted at runtime by `getHistoryRangeHours()`. The same value
  seeds the global search dialog, so a new option also needs an entry in the
  `HistoryTimeRange` duration table.
- The window **ends at the newest message**, not at `Date.now()`. Opened after a
  night away, the console still shows the messages around the last session.
- Executing messages ignore the window: `selectVisibleRunHistory` takes
  `liveKeys` as the window-exemption set.
- Loading earlier messages **doubles** the window (3 → 6 → 12 → 24 → 48 hours)
  until `canLoadMoreRunHistory` reports nothing older.
- Switching agent or changing the default range resets the window width to the
  configured default.

## 6. The Live filter

- The `N LIVE` chip in the panel header is both a count and a toggle. Its state
  persists in `ASTROX_RUN_HISTORY_LIVE_VIEW` and defaults to **off** (the
  settings dialog edits the same default). The older
  `ASTROX_RUN_HISTORY_LIVE_FILTER` means the opposite, so it is retired rather
  than migrated and removed on the next write.
- Armed and disarmed must be distinguishable at a glance: armed is a solid
  `--status-running` pill (panel-coloured text, glyph dropped, 3px halo);
  disarmed is a ghost outline. The header's second line switches from `N runs`
  to an "all history" badge, because the filter drops the time window. Never
  implement the armed state as "the same tint, one shade darker" — in the dark
  theme the two states become indistinguishable.
- Armed, the list is a **filter**: only the messages whose run is executing
  right now (`selectLiveRunHistory`). The pool it filters is the selected
  agent's *whole* history — the time window is dropped, so a session resumed a
  minute ago (started days ago) still qualifies — while finished messages are
  not listed. Live rows are pinned, expanded and scrolled into view, and
  `LOAD EARLIER` is not offered.
- Zero live rows is an empty list with the "nothing is executing" empty state.
  Never fall back to the full history and never clear the arm: a filter that
  shows everything when it matches nothing is not a filter. That is also why
  the preference defaults to off — an empty panel on load reads as broken.
- Disarmed, the list returns to the default window.
- A *new* key entering the live set means "a message was just sent": `RunHistory`
  diffs against the previous live set and locates the run automatically. The
  previous set lives in a ref, not in state — storing it would schedule a second
  render on every live batch.
- The count, the pin, and the auto-locate must all come from the same
  `liveSessionKeys`. A row that is pinned but not counted (or the reverse) is a
  bug.
- Live runs of other agents still enter the filtered list (`historySessions`
  adds them): the dropdown scopes finished history, never the message that is
  executing.

## 7. Settings and local preferences

- The settings dialog holds browser-local preferences only. Changes apply
  immediately, with no server round trip and no Apply button.
- It groups preferences by what they change (appearance / run history / canvas /
  panels). A preference that also has an inline control in the header or toolbar
  is still listed here: one place that lists everything beats hunting the
  chrome. Header and footer stay fixed while `settings-dialog__body` scrolls.
- Keys are namespaced `ASTROX_` and centralized in `storageKeys` in
  `src/config/app-config.ts`.
- Invalid values must fall back to `appDefaults`; corrupt storage must never
  block rendering.
- A new preference must update: `storageKeys`, `appDefaults`, the settings
  dialog, the §15.1 table in `docs/user-manual-*.md`, and
  `tests/app-config.test.ts`.
- A key whose *meaning* changed is retired (`retiredStorageKeys`) and deleted on
  write instead of migrated. The Live filter is the example: its stored `true`
  meant "show every message", which would arm the new filter on a machine where
  nothing runs.

## 8. Header controls

- The GitHub entry is an anchor (`<a>`) whose href comes from
  `appRepository.url`; it opens in a new tab with `rel="noreferrer noopener"`.
  Never hardcode the URL inside a component.
- Icon buttons are 28 px (`size="console-icon"`) with the same height and radius
  as the theme switcher, and they stay visible when the header nav collapses on
  narrow screens.
- The order is fixed: settings (gear) → theme → GitHub. GitHub is always the
  right-most control — it is the only one that leaves the console — so new
  controls go to its left.
- The settings trigger uses a gear, not a sliders glyph: it configures the Live
  filter rather than filtering the list itself.
- Every icon button needs an `aria-label` and a tooltip that describes the
  action, not the glyph.
- In-list scroll controls belong in the panel header, never as a floating
  overlay: a floating chevron sits on the first visible atom, so the row the
  reader just scrolled to is the one they cannot read. Render a direction's
  control only while that edge is out of view.

## 9. Keeping docs in sync

- Docs are published in pairs: `<name>-zh.md` / `<name>-en.md`; the docs site
  pairs the language switch by suffix.
- A behavior change updates four places:
  1. `docs/user-manual-*.md` — what a user sees;
  2. `docs/conventions-*.md` — this document, for rules;
  3. `AGENTS.md` — the invariants an agent executes against;
  4. `docs/index.md` and `site/src/docs.ts` — catalog and reading order.
- Docs describe current behavior. Planned work is marked explicitly.
- Quote interface copy as it appears on screen; do not invent translations for
  key names.

## 10. Verification checklist

Before pushing:

```bash
pnpm typecheck                                  # tsc --noEmit
./node_modules/.bin/tsc -p site/tsconfig.json --noEmit   # docs site typecheck
pnpm build
pnpm build:docs
pnpm test
```

For interface work, verify against an isolated data root so real history does not
slow the browser down:

```bash
ASTRO_HOME=/tmp/astro-check ASTRO_PORT=4401 node server/server.mjs
```

- Layout is `<source>/YYYY/MM-DD/HH_MM_SS-<session>/events.jsonl`.
- Cover three kinds of data: finished messages inside the window, older messages
  outside it, and one executing message. Then `POST /api/events` to confirm a new
  prompt is located automatically.

## 11. Common mistakes

| Symptom | Cause | Fix |
| --- | --- | --- |
| `N LIVE` misses an executing message | the live set was derived from the agent-scoped list | derive `liveSessionKeys` from every session |
| A row says RUNNING but is missing from `N LIVE` | display state bypassed `isFreshLiveRun` | always go through `getRunDisplayState` |
| The list is empty the morning after | window ended at `now` | anchor on `getRunHistoryAnchorTime` |
| A new message has to be hunted for | Live filter never diffed the live set | see the auto-locate rule in §6 |
| The armed Live filter shows an empty list | possibly nothing is running; possibly the window was not dropped | check `0 LIVE` first, then that the rows come from `selectLiveRunHistory` (no window) |
| The setting changed but the list did not | window width was not reset with the range | keep `runHistoryHours` in step with `historyRangeHours` |
