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
- `pi-plugin/`: zero-dependency Pi extension installed globally by
  `scripts/install-pi-plugin.mjs`; `mapping.ts` maps Pi extension events onto
  canonical event names, and `claim.ts` stores the owning pid so resumable Pi
  sessions keep recording across Pi restarts.
- `zcode-plugin/`: portable ZCode plugin and its local marketplace catalog;
  `plugin/zcode-adapter.cjs` normalizes ZCode hook payloads before they reach
  the canonical recorder.
- `scripts/`: installation, migration, validation, and packaging scripts.
- `tests/`: Node test runner suites.
- `data/`: local resource files served by the service, currently the console's
  sample dataset (`data/demo-events.json`). Not captured traces, not user
  preferences.
- `site/`: the docs site; it reads `docs/*.md` at build time, so a new doc also
  needs a catalog entry in `site/src/docs.ts`.
- `docs/`: English and Chinese architecture, protocol, operation, user, and
  convention docs. `docs/conventions-*.md` is the readable companion to this
  file; keep the two in step.

## Conventions

- Frontend filenames are lowercase and use hyphens.
- Functions use lower camel case.
- Follow existing TypeScript types and local shadcn/ui patterns.
- Use Lucide icons for interface actions when an icon exists; brand glyphs are
  inline SVG components.
- Keep raw `TraceEvent` data immutable. UI status, duration, topology, and
  trajectory state must be derived without rewriting persisted events.
- Keep platform-neutral behavior in shared domain helpers. Platform-specific
  mappings belong in `src/config/atom-platforms.ts` or the relevant adapter.
- One definition per concept: exception classification lives only in
  `src/lib/exception-events.ts`, RUN HISTORY liveness only in
  `src/lib/run-history-state.ts`, and the visible time window only in
  `src/lib/run-history-window.ts`. Do not grow a second list of failure or live
  event names. Sample (Demo) data lives only in `data/demo-events.json`.
  The preview page's opened state lives only in
  `plugin/trace-recorder.cjs` (`readPreviewState` / `markPreviewOpened`,
  persisted as `preview-state.json` in `ASTRO_HOME`); the service marks it
  when a console page attaches to `/api/stream`, and the hook launch flow
  consumes it to decide whether the browser still gets opened.
  The run model (which LLM a prompt executed on) is read only in
  `src/lib/trace-model.ts` (`extractRunModel` + the SessionStart fallback in
  `buildSessionPromptRuns`), which normalizes every client's payload spelling
  — pi's `model`/`provider` keys, deepseek's model source object, opencode's
  step notification, zcode's session-start model — into one display string;
  the UI shows the tag only when a run reports a model.
  Turn numbering lives only in `src/lib/trajectory-model.ts`
  (`buildTraceTurnIndex`): a numbered source keeps its own number (DeepSeek's
  `data.turn` can start at 5), an opaque identity takes the next ordinal,
  identity-less events stay in the executing turn, and a leading preamble joins
  the first turn it introduces. LOG grouping, the trajectory view, and turn
  counts read that one result; do not grow a second turn inference, and key a
  separator by its position, never by the turn value (duplicate React keys leave
  orphaned chips behind when a number repeats).
- Treat unrelated working-tree changes as user-owned and do not revert them.
- A behavior change is only complete when `docs/user-manual-*.md`,
  `docs/conventions-*.md`, this file, `docs/index.md`, and `site/src/docs.ts`
  agree with it.

## Demo Dataset

- The sample run is a local resource file, `data/demo-events.json`, not a
  bundle constant. `createDemoEvents` used to build it in code; that meant the
  console carried synthetic events and the service could not answer for them.
  Do not reintroduce an inline event array in a component, test, or route.
- The service is the primary reader: `server/demo-dataset.mjs` resolves
  `data/demo-events.json` (repository) or `dist/data/demo-events.json`
  (installed runtime, static build), caches by mtime and size, and serves
  `GET /api/demo-events`. `ASTRO_DEMO_EVENTS` overrides the path. The
  repository `data/` directory wins whenever it exists, so deleting the file
  reads as 404 instead of quietly serving the copy an older build left in
  `dist/`; only a runtime without `data/` (the installed plugin) falls through.
  A missing file is a 404 and an invalid one a 500 with the offending field;
  neither may throw through the request handler.
- The console is the primary validator: `src/lib/demo-events.ts` accepts both
  the service envelope (`{ dataset, path, eventCount }`) and the bare document,
  because the build also copies the file to `/data/demo-events.json` and the
  loader falls back to it when no service answers. A static host that rewrites
  unknown paths to `index.html` answers 200 with HTML — that is a parse failure
  to report, not a dataset.
- Times in the dataset are `offsetMs` from load time, never timestamps. RUN
  HISTORY is an hours-based window: absolute times age out of it within a day
  and the sample run silently disappears.
- Loading is async, so `isDemo` needs three things: zero captured events, the
  gate open, and the dataset having arrived. The gate (`isDemoGateOpen` in
  `app-config.ts`) is automatic in development/test (`shouldShowDemo`) but, in a
  production build, only when the reader explicitly opts in with `?demo=1`
  (parsed by `isDemoPreviewEnabled`, `src/lib/demo-events.ts`) — a production
  page keeps its truthful empty state otherwise and must never *implicitly*
  fall back to the sample. When it does render, a persistent「示例数据」banner
  (`studio-shell__sample-banner`) makes it unmistakable that the run is a
  sample, not captured evidence. A failed load keeps the truthful empty state
  and raises one `示例数据不可用` notice; it must never block or hide captured
  events.
- The Demo dataset is a rendering fixture only: it must stay out of health
  counts, `N LIVE`, the sync budget, and `DELETE /api/events`.

## Deployed Console

- The user-facing deployment reference is `docs/deployment-zh.md` /
  `docs/deployment-en.md` (local install, full env-var table, CORS, `astrox`,
  cloud console, docs site, troubleshooting). The bullets below are the
  invariants that code must keep satisfying; the docs are the reader-facing
  wording. Keep the two in step.
- The console is a static page and may be served from a cloud origin (Vercel,
  GitHub Pages, any static host) while its data is the service on the reader's
  machine. `src/lib/api-base.ts` is the single definition of that address:
  `?api=` (persisted to `ASTROX_API_BASE`) → stored value → same-origin when
  the page itself is local → `http://127.0.0.1:5678` otherwise. Every request
  goes through `joinApi(apiBase, path)`; do not hardcode `/api/...` in
  components. The base is resolved once per mount and never changed
  mid-session.
- The service decides who may read. `ASTRO_CORS_ORIGINS` is an explicit
  allowlist (comma-separated; `*` only when spelled out); with nothing set the
  service emits no CORS headers and behaves exactly like a same-origin-only
  install. Allowed origins get an echoed `Access-Control-Allow-Origin`,
  `Access-Control-Allow-Private-Network: true` (Chrome's public→local
  preflight), and the generic `OPTIONS /api/*` preflight answers allow
  methods/headers. The headers attach to every `/api/*` response including the
  SSE stream — EventSource cannot send custom headers, so response headers are
  all a deployed page gets. The installed runtime is normally started by a
  recorder hook with no shell to carry the variable, so the same list also
  lives in `config.yaml` as `server.corsOrigins` (`plugin/runtime-config.cjs`),
  which survives every later launch.
- Files under `public/` are addressed through `assetUrl()` in
  `src/lib/asset-url.ts`, never with an origin-root path such as `/icons/…`:
  GitHub Pages mounts this console at `/astro/`, so a root path leaves the
  project prefix and 404s (it broke the agent dropdown's brand marks).
  `scripts/verify-console-build.mjs` fails the build on origin-root asset URLs.
- A deployed page that never connects announces it once (「无法连接本地服务」
  with the base and the `ASTRO_CORS_ORIGINS` line to add). Do not turn that
  into per-retry noise, and do not silently fall back to demo data — a
  deployment must never *implicitly* present sample runs as captured evidence.
  The only path to the sample on a deployment is the reader's explicit `?demo=1`
  (see Demo Dataset above).
- Deployment outputs: `vercel.json` builds console + docs and merges them via
  `scripts/merge-deploy-output.mjs` (docs at the root, console at
  `/console/`); the console build uses a relative Vite `base` so it also works
  under GitHub Pages project paths. `.github/workflows/console-preview.yml`
  uploads `console-dist` on every build, and the Pages deploy job publishes on
  push to `main` (the formal release) and to the rolling-preview branch listed
  in the workflow's `push` trigger (an in-flight feature branch gets a live
  preview URL without merging; drop the branch from that list once it merges),
  plus `workflow_dispatch` from *any* branch — the most recent qualifying
  build publishes over the single shared Pages site. The docs and
  console still must not fight over the one Pages site. The Pages artifact is
  *only* the console: `scripts/verify-console-build.mjs` asserts the relative
  asset shape, the shipped icons/sample dataset, and the absence of docs-site
  markers before the artifact is uploaded.

## Run Timeout Invariant

- `appTimings.activeRunTimeoutMs` is the single frontend timeout policy.
- Its default is 24 hours in milliseconds.
- The clock belongs to the executing message, not the session: while the newest
  Prompt run is live, both the displayed duration and the timeout start at that
  Prompt. Timing the session made a session resumed two days later read as a
  48-hour run, so it flipped to `terminated` the instant the new prompt
  arrived — invisible in the list and absent from `N LIVE`. Only a session with
  no Prompt runs falls back to its own start.
- A duration that is still advancing is capped at the timeout and its effective
  UI status becomes `terminated`. Terminal rows keep the recorded session
  duration, so the row reads session span again once the run stops.
- The timeout is derived at read/render time. It must not append a synthetic
  event or replace the persisted session status.
- Expired selected runs must not keep live topology animation or running log
  markers active.

## Run History Live Markers

- `isLiveRunStatus` is the single definition of a live run status (`active` /
  `waiting`); the live *index* additionally requires recent activity
  (`isFreshLiveRun`: 10 minutes for `active`, 60 for `waiting`). A crashed
  recorder leaves its last session `active` forever, so counting status alone
  filled `N LIVE` with hours-dead sessions and pushed the one message that was
  actually executing out of the picture. The row still reports the recorder
  status (RUNNING capsule + STALE marker); pin, count, and view use the fresh
  set.
- The live index is split in two: `collectLiveRunKeys` answers "what is
  executing on this machine", and `scopeLiveRunIndex` intersects it with the
  selected agent's sessions. RUN HISTORY only ever consumes the intersection.
  The dropdown is the *outer* filter — agent first, then the time window — so a
  neighbour's live run must not be merged into this list. It used to be, which
  put the Claude message that was executing at the top of the Codex history.
- A neighbouring agent that is running is signalled by a live dot in the agent
  picker (`scopeLiveRunIndex().sources` → `AgentSelect liveAgents`). Cross-agent
  messages are reached by switching the dropdown, never by adding their rows to
  the open agent's history.
- Switching agent clears the open selection (`activeSessionKey`,
  `activePromptRunKey`, `selectedEventId`, `selectedAtomId`) so the canvas, the
  log and the list all land on the new agent's newest message; the fallback run
  is `filteredSessions[0]`, never `sessions[0]`. A `?session=` deep link that
  names another agent's run moves the dropdown to that agent instead of leaving
  the canvas on a run the list cannot show.
- A live message is marked on the row (status accent plus a `RUNNING` /
  `WAITING` capsule) and in the panel header (`N LIVE` chip that scrolls the
  first live row into view), so the executing message is findable without
  scrolling.
- Selection styling outranks the live accent; a selected live row keeps its
  selection border.
- Executing runs are pinned to the top of the list, ordered by the **start of
  the run's newest message** (not its latest event, which moves on every
  streaming batch and made two running rows trade places constantly), and stay
  inside the visible time window whatever their `start`
  (`collectLiveRunKeys` → `selectVisibleRunHistory` / `pinLiveRunHistory`,
  which app.tsx calls with an `executionStart` resolver from
  `promptRunsBySession`). A session resumed today began days ago; without the
  pin its new prompt would sort below every run that merely started later, and
  the window would drop it mid-execution. The message that started executing
  last sits on top; a newly sent message takes the top the moment it starts.
  Finished runs fall back to newest-first order.
- The same live key set drives the pin, the window exemption, the `N LIVE`
  count, and the Live filter's rows. Do not derive a second one — a row that is
  pinned but not counted (or the reverse) reads as a bug.
- "Running again" means a historical session that received a new prompt, even
  days later: it must land in that live key set so `N LIVE` can find it. Its
  clock (see Run Timeout Invariant) is the new prompt's, not the session's.
- The footer Live button is the same state seen from the bottom bar:
  `isPromptExecuting` delegates to `isLiveRunStatus` (so `waiting` keeps Live
  available), the button is lit only while the open run is executing *and* the
  selection still tracks its newest atom, and pressing it from a finished run
  selects the executing run — never `filteredSessions[0]`, which is the newest
  start and therefore never a resumed run. The jump stays inside the selected
  agent, so it can never open a run whose row this list does not show.
- Finished messages (`complete` / `failed` / `terminated`) do not auto-locate
  the last atom: `getPromptAtomSelection` returns `null` for every non-live
  status, and only an explicit atom pick locates the topology.

## Run History Window

- The window is measured in **hours**, never calendar days: a range must mean
  the same span at 09:00 and at 23:00. `src/lib/run-history-window.ts` is the
  only module that computes it.
- Its length is the persisted preference `ASTROX_HISTORY_RANGE`
  (`1h` / `3h` / `6h` / `12h` / `1d` / `3d` / `5d` / `7d`, default `3h`;
  hours on one row, days on the next), converted with
  `getHistoryRangeHours`. The same value seeds the global search dialog, so a
  new option also needs an entry in the `HistoryTimeRange` duration table.
- The window ends at the newest message (`getRunHistoryAnchorTime`), not at
  `Date.now()`. Anchoring on the wall clock left the panel empty on the first
  login of a new day, when the only thing the user wanted was the session they
  had been running before.
- Live runs are exempt from the window (the `liveKeys` argument); a resumed
  session's `start` is older than the range by definition.
- "Load earlier" **doubles** the window (`nextRunHistoryVisibleHours`) instead of
  advancing one day at a time, and disappears when the control can no longer
  grow. The service ships only the requested window, so widening past what is
  loaded re-subscribes with a larger `hours` and replaces the event list;
  `historyTruncated` keeps the control available even though the older sessions
  are not in memory. Switching agent or changing the default range resets the
  width to the preference.
- The empty state names the configured range, so a short window never reads as
  "no history at all".
- The sparse/dense row layout carries **hysteresis**
  (`isSparseRunHistoryList` + `RUN_HISTORY_SPARSE_HYSTERESIS_ROWS`): the list
  goes sparse at `appLayout.runHistorySparseListRows` but only returns to the
  dense clamp two runs later. The window is a moving anchor — sessions age out
  of it while a re-run enters — and a count hovering at the threshold would
  otherwise re-clamp every row's title on each crossing, which read as the
  whole list jumping while a run executed.

## Snapshot Streaming

- `GET /api/stream` accepts `hours` (capped at a month). The first snapshot
  contains only that window plus the full history of sessions that are still
  active/waiting within the live threshold — a running row must never lose the
  events that made it a row. `ready` reports `eventCount`, `totalEventCount`,
  `hours`, `truncated` and `snapshot`; the client uses `truncated` to keep
  "load earlier" available and to request a wider window.
- A snapshot is **streamed**, never one `JSON.stringify(events)`:
  `reset` carries the metadata (and an empty list), the events follow as
  ordinary `trace` frames in batches of 400, then `ready`. A single frame of a
  95k-event / 456 MB history blocked the event loop for minutes, which made
  live events, `/api/health` and every other SSE client wait behind it — the
  console looked frozen while an agent was running. Keep the batch boundary;
  the client buffers the frames and commits once at `ready`.
- The snapshot key includes the window (`<historyKey>@<hours>:<count>`), so the
  same history at 3h and 6h is never mistaken for the same snapshot. Widening
  the window clears the cursor and the key before re-subscribing.
- `POST /api/config/data-root` changes the service's trace root. The file
  rewriting lives only in `server/runtime-settings.mjs` (it preserves every
  other `.env` line and rejects missing/relative paths), then the service
  restarts so the new root is read. The service card exposes it as
  "data directory → change" and health reports the resulting `dataRoot`.

## Live View

- The `N LIVE` chip is a count *and* a persisted toggle
  (`ASTROX_RUN_HISTORY_LIVE_VIEW`, default **off**, also editable in Settings).
  It always renders — `0 LIVE` included, in an idle (non-pulsing) variant —
  because the state is a preference, not a badge.
- Armed and disarmed must be distinguishable at a glance, with the polarity
  "light when off, dark when on": armed is a dark filled pill (`--status-running`
  at 26% over `--bg`, light-violet text, soft halo), disarmed a light outlined
  pill, and the header's second line switches from `N runs` to the "全部历史"
  badge. The radar glyph is kept in both states and inherits the pill colour.
  Do not express the armed state as one shade more tint (unreadable on the dark
  theme) or as a solid bright accent fill (the brightest surface in the panel,
  which reads as "lighter" than the disarmed pill).
- Armed, RUN HISTORY is a **filter**: the rows are only the messages whose run
  is executing right now (`selectLiveRunHistory`). The pool it filters is the
  agent's *whole* history — the time window is dropped, so a session resumed a
  minute ago (and started days ago) still qualifies — but finished messages are
  not part of the list. `LOAD EARLIER` disappears; live threads render expanded
  so each executing Prompt is a row of its own. This answers "what is running,
  and where is it" rather than "what has this agent ever done".
- Zero live rows with the filter armed means an **empty list** with the
  "nothing is executing" empty state. It must not fall back to the full history
  and must not clear the arm: a filter that quietly shows everything when it
  matches nothing is not a filter. This is also why the preference defaults to
  off — an empty panel on first load would read as broken.
- Disarmed, the list returns to the windowed rendering.
- A *new* key entering the live set means a message was just sent: the panel
  expands it and scrolls it into view without a second click. The previous live
  set is held in a ref, not in state — state there would re-render on every
  live batch.
- Demo traces are synthetic and never live, so the demo list ignores the arm
  instead of pretending the filter is active.
- Live runs of other agents stay in the filtered list (the history pool adds
  them); the Live view is agent-scoped for *finished* history only.

## Settings And Preferences

- The settings dialog (`src/components/settings-dialog.tsx`) edits
  browser-local preferences only: immediate effect, no Apply button, no server
  round trip. Its trigger is the gear icon, not a sliders glyph: the control
  configures the Live filter, it does not filter anything itself.
- Every key is declared in `storageKeys` with the `ASTROX_` prefix and resolved
  through `readStorageValue` / `readStorageBoolean`; an invalid stored value
  falls back to `appDefaults` and must never block rendering.
- `appDefaults.historyRange` is the single default for both the RUN HISTORY
  window and the search dialog's initial range — do not add a second
  "default range" constant.
- `appDefaults.liveView` is the single default of the Live filter. Its old key
  (`ASTROX_RUN_HISTORY_LIVE_FILTER`) is retired, not migrated: it meant "show
  the whole history", so honouring it would arm the new filter on load.
- `appDefaults.perfHud` is the single default of the performance HUD
  (Settings → 性能, off by default): the app root mounts the pure-DOM panel
  from an effect keyed on that flag, and `resolvePerfHudInitial` honours the
  retired `?perf=1` legacy flag (`astro:perf-hud` = `"1"`) once — the first
  write of `ASTROX_PERF_HUD` removes the legacy key.
- The dialog is a two-pane card: `.settings-nav` (外观 / 运行历史 / 画布 / 面板 /
  性能 / 关于) beside a `.settings-pane` that renders only the active section,
  carried by
  a vertical Radix `Tabs` so arrow keys work. A single stacked column scrolled the
  whole dialog or squeezed the controls on a short window. Header and footer are
  fixed and only the pane scrolls; Done merely closes it. A preference that also
  has an inline control in the header or toolbar is listed here as well.
- 关于 names the console version, where preferences live (`localStorage`, the
  `ASTROX_` prefix), and that settings never write back to captured events.
- The footer actions carry their own ink and surface. The app-level
  `button { color: inherit }` and `button:not(...){ border: 0 }` resets outrank
  Tailwind's `text-*` / `border` utilities, so a plain `variant="default"`
  button rendered light text on the bright primary fill (~1.6:1). Footer
  buttons are tagged `settings-footer__button` (exempted from both resets) and
  styled against `--primary` / `--primary-foreground`; the disabled outline
  action stays muted-but-legible instead of fading to 50% opacity.
- A new preference updates, in one change: `storageKeys`, `appDefaults`, the
  dialog, the §15.1 table in `docs/user-manual-*.md`, and
  `tests/app-config.test.ts`.

## Sync Budget

- `appDefaults.maxSync` (8 hours) is the longest the console keeps consuming
  the event stream. A page left open otherwise appends every captured event and
  re-derives sessions, runs and flows from an ever-growing list.
- The budget is a single `setTimeout`, armed by `getSyncStopDelay`
  (`src/lib/sync-budget.ts`). No interval, no polling: with the limit set to
  `off` there is no timer at all. Do not turn this into a per-second check.
- Changing the cap re-arms that timer for the time left under the new cap
  (wall-clock from the current sync start, not a clock restart): lowering the
  cap below what already elapsed stops the stream at once. While a pause is in
  effect no timer runs and the counting is stopped too; the clock only starts
  over on a resume.
- When it fires, `syncStopped` closes the `EventSource`; that is what stops the
  appending, the re-derivation and the memory growth. The header marker turns
  from `synced` to `paused` (amber, a `<button>`), and the service card says the
  stream stopped on purpose rather than reporting a dropped connection.
- Recovery is `resumeSync`: reset `syncStartedAt`, lift `syncStopped`, and
  reload a fresh snapshot (`handleReloadLatestEvents`) instead of replaying the
  missed tail — appending hours of deltas would grow the very array the budget
  capped. Restarting the local service performs the same reset, so a restart
  after a spent budget never leaves the console stuck in `paused`.
- A cap change while the budget has stopped the stream lifts the pause through
  that same reset (`capChangeResumesSync` in `sync-budget.ts`): a cap that
  still has time left — `off` included — reopens the stream with a fresh
  snapshot, so the new cap takes effect without a second click. A cap whose
  time is already spent keeps the stream stopped.
- `syncStopped` is not `connected === false`: a dropped socket is retried by
  `EventSource`; a spent budget is deliberate and only a user action lifts it.

## Restart And Snapshot Reload

- A service restart means **the new process re-read the files from scratch**, so
  it is not "the same history with a newer tail". The console drops
  `resumeCursorRef`, sets `forceSnapshotRef`, resets `runHistoryHours` to the
  configured range and re-subscribes. Leaving the cursor in place turned a
  restart into an empty `resume` replay: the list looked freshly loaded while
  still showing the previous process's data.
- The reload is scoped by the current filter — agent first, then the configured
  default range, then the Live filter. The selection falls back through the same
  pool (`filteredSessions`), so a restart lands on the newest message the list is
  allowed to show.
- While the console is deliberately between snapshots (restarting, or a forced
  snapshot in flight) the header reads `restarting` / `reloading`. It must not
  read `offline`: a successful restart is not a dropped connection.
- A snapshot is only applied when it is **not the history already on screen**.
  The client names the key it holds (`?snapshot=<key>`, see
  `TraceRepository.getSnapshotKey`: event count plus a rolling hash of every id);
  an unchanged history is answered by `reset-same` and the page skips the
  transfer, the parse and the re-projection entirely. Without a key (first load,
  an older server) `isSameEventSequence` in `src/lib/event-snapshot.ts` makes the
  same decision after parsing, and `setLiveEvents` is skipped when it matches —
  replacing the array is exactly what forces a full session rebuild.
- The key answers "is this the same history"; it is not a dedup mechanism. Event
  deduplication stays with the per-connection `seenIds` set.

## Run History Prompt Thread

- The expanded Prompt list is **measured**, not estimated: a `ResizeObserver` in
  `RunHistoryItem` sizes it to `scrollHeight` up to
  `appLayout.historyPromptListMaxHeight` (300 px), and a thread that overshoots
  the ceiling by less than 1.25× is shown whole. `rows × fixed estimate` clipped
  the last row whenever a title wrapped — exactly the two-message thread where
  that row is the whole second message.
- The estimate stays as the first-paint fallback only. `max-height` must not be
  re-added in CSS: it would clip the measured height again.
- The thread is **always mounted** for multi-prompt rows and *animates* between
  its measured height and 0 (`.run-history__prompt-scroll`, margins collapsing
  with it; collapsed it is `visibility: hidden`). Unmounting it on collapse
  made every expand a teleport — the executing row grew hundreds of pixels in
  one commit and shoved the whole list, which read as the N LIVE view jumping.
  A collapsed thread must take no more space than an unmounted one.
- Only a multi-prompt session renders the thread (`hasPromptThread`): a
  single-prompt live row shows the parent only. The armed Live filter used to
  auto-expand one-prompt sessions too, rendering the same message twice.

## Agent Filter

- An "agent" filter lists agents. The RUN HISTORY dropdown and the global
  search's Agent filter both use `agentOptions` plus the trailing `Others`
  (`OTHERS_AGENT_ID`); `matchesAgentSourceFilter` treats `Others` as "every
  source that is not a configured agent". Sources without an agent definition
  (browser, generic, custom HTTP collectors) must not become pseudo-agent
  entries of their own.

## Header Chrome

- The GitHub entry is an anchor whose href comes from `appRepository.url` in
  `src/config/app-config.ts`; it opens in a new tab with
  `rel="noreferrer noopener"`. Never hardcode the URL in a component.
- It is the **last** control in the header icon row: settings and theme are
  console-local, the repository link is the one control that leaves the console,
  so it owns the far right edge.
- Header icon controls are 28 px (`size="console-icon"`) with the same height,
  radius, and quiet surface as the theme switcher, and they stay visible when
  the nav collapses on narrow screens.
- Brand glyphs are inline SVG components (`src/components/repo-link.tsx`).
  Lucide no longer ships brand icons, and a single path is not worth a
  dependency.
- Every icon control keeps an `aria-label`; a **tooltip is opt-in**. Add one
  only when the glyph cannot carry the meaning on its own (the chevrons that
  say *which* panel collapses, the action menu, the topology/trajectory
  switches) or when it adds state or consequence the icon cannot show (the
  `N LIVE` rules, the reload control while it is loading). A card that merely
  restates a recognisable mark — GitHub, gear, sun/moon, copy — is noise: it
  trails the pointer across the header icon row and covers the panel below.
- Scroll controls for a list live in its panel header, never as a floating
  overlay: the overlay chevron covered the first visible atom. Each direction's
  control renders only while that edge is out of view.
- The Flow Guide drawer dims the console with a flat scrim
  (`.atom-guide__overlay`), never a backdrop blur — the canvas repaints
  continuously and would pay for the blur on every frame.
- The uptime chip's `LOCAL SERVICE` card names its version subjects: **console**
  is `appVersion`, **service** is `build` from `/api/health`. The server reads
  `package.json` first and the installed runtime's `plugin.json` second (the
  installer copies no package manifest), so an installed service can report its
  release instead of `unknown`. A mismatch is called out, and an unreadable
  manifest renders "未上报" with the reason — never a bare `unknown`.


## First Paint, Rendering, Feedback

- Build `Intl.DateTimeFormat` / `Intl.NumberFormat` instances at module scope.
  `Date#toLocaleString(locale, options)` constructs a formatter per call; the
  search dialog called it once per result row per keystroke, and profiling put
  that construction above every other cost of typing. Parse timestamps through
  `getEventTimestamp` (cached per event object), never `Date.parse` inline.
- Per-event predicates (`getTraceRunState`, `isWaitingTraceEvent`,
  `getExceptionOutcome`, `isUserQuestionToolEvent`) may only consult
  module-level `Set`s. A `[...].includes(...)` inside them allocates once per
  event per pass, and a load runs two passes over every event.
- A count that is not known yet is not reported as zero: while the first
  snapshot is in flight RUN HISTORY renders skeleton rows with a `loading…`
  subtitle, and the header marker reads `connecting`. `offline` means a
  connection was established and dropped (`everConnected`); using it for the
  first connection made every reload look like a failure.
- Panels that only appear after an explicit action (`HistorySearch`) live in
  their own chunk, loaded with `lazy()` and preloaded during the first idle
  window (`requestIdleCallback`, timer fallback). The Suspense fallback reuses
  the real panel's class names, so opening never flashes an unstyled frame.
- Action feedback goes through `ConsoleNotices`, never `window.alert`:
  import/clear/reload report success, failure, and "nothing to import" with the
  cause, and the pause that ends the sync budget announces itself once with the
  way back.
- Performance work lands with numbers from the same fixture and script before
  and after (script time, long tasks, chunk size); "feels faster" is not a
  verification. The repeatable driver is `pnpm perf:fixture` (synthetic
  history + timed ingestion) and `pnpm perf:bench` (per-batch derive
  milliseconds per phase); client long tasks read off the performance HUD
  (Settings → 性能) or directly via `window.__astroPerf.snapshot()`.
- The performance HUD is a floating, collapsible, **draggable** panel
  (`src/lib/perf-metrics.ts`), armed only by the Settings → 性能 preference
  (`ASTROX_PERF_HUD`, default off) — the `?perf=1`/`?perf=0` URL parameter is
  retired; the legacy `astro:perf-hud` `"1"` flag is honoured once by
  `resolvePerfHudInitial` (in `src/config/app-config.ts`) and the app removes
  that key on its first write. The app root mounts the panel from a React
  effect keyed on the preference, so toggling the switch mounts and tears the
  panel down live. The host is the pill's box and the panel floats above it,
  so expansion always grows **upward** from wherever the pill sits — a
  bottom-pinned drop can never push the panel off the bottom of the screen. It
  starts anchored to the bottom-right edge, and dragging the pill or the panel
  header re-places it (persisted under `astro:perf-hud-pos` as `{ left,
  bottom }`, clamped back into the viewport on restore and resize). A press
  that never leaves the 4px threshold stays a click, so dropping the HUD never
  toggles it. Collapsed it is one pill with two headline numbers (scroll fps,
  list render average); expanded it shows a tone legend and three tone-coded
  tiles (scroll fps / list render / long tasks, ok-warn-bad by threshold)
  **pinned at the top**, with every metric group rendered expanded below them
  (no disclosure control) — only the label→value rows and usage notes scroll,
  so walking the table never moves the headline numbers. A drag sets the body
  cursor to `grabbing` for its duration. It stays pure DOM outside React so
  the tool measuring the app never enters the app's render path — expansion,
  drag and collapse are DOM state, not component state.
- Cursor affordances follow one convention: clickable things point
  (`button:not(:disabled)`, `[role="button"]`, and Radix menu/select items —
  never `cursor-default` on an operable row), disabled controls read as the
  plain arrow (`button:disabled`, `[aria-disabled="true"]`; the console dims
  instead of using `not-allowed`), busy controls may use `cursor: progress`,
  and draggable handles carry `grab` (→ `grabbing` while held).
- The HistorySearch result rows are memoized end to end (`SearchResult` is
  `React.memo`, the snippet builds once per row, and the row's `onSelect` is
  a stable ref-routed callback): a scroll append or a background app-root
  re-render must not re-render rows already on screen. Batch appends run in a
  `startTransition`.
- The LOG search text is **log-local state** (`AtomicLog`), never app-root
  state: a keystroke re-renders only the log panel, not the studio. Filtering
  reads a `useDeferredValue` copy of the text over the cached per-event
  haystacks (`src/lib/event-search.ts`), and `buildLogEntries` is memoized
  separately from the needle so a keystroke never rebuilds every turn
  separator. App-root flows that need an empty box bump a reset token
  (`logQueryResetToken`), they do not hold the string.
- The LOG header's scroll controls **always reserve their two-button width**
  (`.atomic-log__scroll-controls`): both chevrons stay mounted at all times
  and an unreachable edge is a `disabled` button (dimmed ink, `cursor:
  default`, no hover cues), never an unmount — reserving the width stops the
  sibling search input from resizing on every streamed event.

## Run Trajectory Order

- The trajectory list renders newest first: turns descending, the atoms inside
  a turn descending, and `RUN CONTEXT` (the run preamble) last. It mirrors RUN
  HISTORY so the atom that is executing right now is the first row.
- The model from `buildTrajectoryModel` stays chronological. Selection lookups,
  the "latest atom" test, and the lane overview all depend on that order, so
  `orderTrajectoryNewestFirst` is the only place allowed to reverse — never
  sort the model in place.
- The lane overview above the list remains a left-to-right timeline.

## Explicit Locate Requests

- An explicit locate (the LOG header's 定位 button, the trajectory's locate, a
  search-result pick) must never read as dead. Both targets keep the request
  **pending** until it can act: the canvas flushes it the moment the layout
  commits (`layoutPending` is a dependency of its locate effect, so a click
  made on the routing skeleton still pulses the atom), and the log advances
  its locate ref only *after* the row is found in `visibleEntries`, so a
  search filter cannot swallow the request — it flushes when the row returns.
- The LOG header's locate button is a **dual request** like the trajectory's
  locate: it focuses the topology AND bumps `logLocateRequest` (plus a search
  reset), so the panel the button lives in centers the atom's event row too.
  `focusAtom` alone never moves the log.
- Explicit centering is instant (`scrollTop =`), matching
  `scrollRowWithinContainer` — a smooth animation on the virtualized log gets
  canceled by slice re-renders and reads as no reaction.

## Exception Events

- `src/lib/exception-events.ts` is the single classifier for error and
  exception events. `trace-model.ts` derives run and tool state from it and
  must not grow its own failure or termination name lists.
- Scope and terminality are fixed: tool failures (`PostToolUseFailure`, an
  errored or non-zero `tool_response`) and `PermissionDenied` are recoverable
  `failed` states; `StopFailure` and `Stop` + `status=failed` are terminal
  turn failures; `Interrupt`, `SessionEnd`, and abort statuses are terminal
  `terminated`.
- Precedence is termination > waiting > failure > stop > recovery. Throttling
  evidence on a failure event derives `waiting`, never `failed`.
- Tool events never imply termination. A tool error whose text mentions
  "terminated" stays a tool failure.
- The recorder infers `status` from the canonical event name only when the
  producer omits it (`PostToolUseFailure` / `StopFailure` → `failed`,
  `Interrupt` → `interrupted`). Payload-less clients such as WorkBuddy must
  persist the same status as payload-carrying clients.
- Exception hooks keep the fail-open guarantee: 5 second timeout, exit code 0
  on every path, diagnostics on stderr only.

## Responsive App Layout

- Overlay chrome (nav sheet, side panels) anchors to `--mobile-header-h`,
  declared once on `.studio-shell` per breakpoint. Do not hardcode the header
  height in panel rules.
- The phone breakpoint (`≤620px`) turns the nav and both side panels into
  full-width sheets. An out-of-flow grid child needs `justify-self: stretch`,
  because the base popover rule's `justify-self: end` shrink-wraps it.
- Overlay panels reserve `env(safe-area-inset-*)` and let their inner sections
  shrink (`minmax(0, …)`) so short landscape viewports scroll instead of
  clipping.

## Event Labels

- User-question lifecycle events use the `user.question` / `user.answer`
  display keys.
- `Notification` is displayed as `user.question` (`AskUserQuestion`) in the
  event log.
- `PreCompact` / `PostCompact` cover context compaction for every client that
  reports it; streaming compaction deltas are never recorded.

## ZCode Capture

- ZCode fires exactly seven hook events: `SessionStart`, `UserPromptSubmit`,
  `PreToolUse`, `PermissionRequest`, `PostToolUse`, `PostToolUseFailure`, and
  `Stop`. `Notification`, subagent, and compaction events cannot be captured
  for ZCode.
- ZCode matchers are case-sensitive regular expressions; a `"*"` matcher is an
  invalid regular expression that never matches, so
  `zcode-plugin/hooks/hooks.json` omits matchers instead.
- ZCode validates hook stdout against a strict JSON schema, so the ZCode hook
  commands run `plugin/zcode-adapter.cjs --quiet` and report on stderr only.
- The adapter normalizes ZCode payloads (`toolCallId`, `toolInput`,
  `toolResponse`) onto the canonical names and records a `Stop` with non-empty
  `responseText` as `AgentMessage` followed by `Stop`.
- ASTRO skills ship in `.agents/skills`; `scripts/install-zcode-plugin.mjs`
  copies them to `~/.agents/skills`, which ZCode imports by reference. The
  plugin package itself never carries skill copies.

## WorkBuddy Capture

- WorkBuddy (CodeBuddy Code) pipes the hook stdin but never writes its event
  payload into it: the payload is only logged to its debug service. Session
  and workspace context arrive through the hook environment instead
  (`CLAUDE_SESSION_ID` / `CODEBUDDY_SESSION_ID`, `CLAUDE_PROJECT_DIR` /
  `CODEBUDDY_PROJECT_DIR`, `CLAUDE_PLUGIN_ROOT` / `CODEBUDDY_PLUGIN_ROOT`).
- Because the payload and event name are unavailable at runtime, WorkBuddy
  hook commands name their event with an explicit `--event=<Name>` flag, and
  `plugin/trace-recorder.cjs` falls back to the hook environment for session
  and workspace when the (empty) payload omits them. Both `workbuddy-plugin/hooks/hooks.json`
  and the `workbuddy` client in `scripts/install-plugins.mjs` must keep the
  flag synchronized with their registered event lists.
- Tool inputs, outputs, and prompts are not delivered for WorkBuddy, so
  WorkBuddy traces carry named lifecycle events without tool payload detail.

## Pi Capture

- Pi has no hook protocol; capture is a global extension loaded by jiti from
  `~/.pi/agent/extensions/astro-trace/` and installed by
  `scripts/install-pi-plugin.mjs`.
- Prompt runs pair the `input` event with `before_agent_start`: slash commands
  and other non-agent inputs never create prompt runs.
- Assistant `message_end` derives the terminal event from `stopReason`
  (`error` → `StopFailure`, `aborted` → `Interrupt`, `stop`/`length` →
  `Stop`); `toolUse` keeps the run active. `tool_call` / `tool_result` carry
  the tool lifecycle; message and tool execution deltas stay unmapped.
- Pi sessions are resumable, so claim files record the owning pid and a later
  Pi process takes a session over only after the previous owner exits.
- The extension reads event shapes defensively (Pi adds fields across
  releases) and must never block the agent loop; recording failures fail open.

## Validation

Run these checks after TypeScript or frontend changes:

```bash
pnpm test
pnpm typecheck
pnpm build
```

`site/` has its own tsconfig and is not covered by the root typecheck; verify a
docs change with `pnpm build:docs` or
`./node_modules/.bin/tsc -p site/tsconfig.json --noEmit`.

The repository currently has no separate lint script. Use `git diff --check`
for whitespace validation and keep public helpers covered by focused tests.

For interface work, verify against an isolated data root
(`ASTRO_HOME=/tmp/astro-check ASTRO_PORT=4401 node server/server.mjs`) with three
kinds of data: finished messages inside the window, older messages outside it,
and one executing message. Then `POST /api/events` and confirm the new prompt is
located automatically.

When capture or portable plugin sources change, also run:

```bash
pnpm build:native-plugins
pnpm validate:claude-hooks
```
