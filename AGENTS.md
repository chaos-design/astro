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
  session. Durable events carry no location envelope, so
  `opencodeEventDirectory` keeps every host spelling plus a per-session
  remembered directory — dropping that fallback lost the main agent's text.
  `session.text.delta` is accumulated into throttled `AgentMessage` snapshots so
  content is visible while the agent executes; the claim is taken only once an
  event actually maps to a trace, never on an unmapped event.
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
  Paired-event duration (the start→result span of a closed pair, e.g.
  `PreToolUse` → `PostToolUse`/`PostToolUseFailure`) lives only in
  `src/lib/trace-model.ts` (`buildPairDurations`, reusing `createFlowEntries`
  pairing); unpaired events are never counted, and a turn's
  `totalPairDuration` counts each closed pair once even though both halves and
  every projected atom carry the same span. The LOG row, the trajectory data
  layer (`pairDuration` / `totalPairDuration`), and the hover block card all
  read from this one source.
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
- A new `public/` file must be addressed through `assetUrl()` in
  `src/lib/asset-url.ts`, never with an origin-root path such as `/icons/…`:
  GitHub Pages mounts this console at `/astro/`, so a root path leaves the
  project prefix and 404s (it broke the agent dropdown's brand marks).
  `scripts/verify-console-build.mjs` fails the build on origin-root asset URLs.
  The helper is currently exercised only by its test — the last `public/`
  assets (the agent brand marks) were inlined into the bundle — but it stays as
  the single definition to call if a `public/` resource is ever added back.
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
  push to `main` (the formal release) and to any `feat/**`, `feature/**`,
  `fix/**` or `hotfix/**` branch —
  prefix filters, so a new branch needs no workflow edit and every commit is
  verifiable on the live page — plus `workflow_dispatch` from *any* branch; the
  most recent qualifying build publishes over the single shared Pages site. The
  `deploy-pages` job carries its own job-level `concurrency` group
  (`console-preview-pages`, `cancel-in-progress`) so deploys from *different*
  branches serialize against one another and "most recent build wins" holds
  across branches. The deploy job clears the run's stale `github-pages`
  artifacts before uploading: a deploy that failed after uploading (a
  transient artifact-metadata hiccup) leaves its artifact behind, a rerun
  uploads a second one, and `deploy-pages` refuses ambiguity — without the
  cleanup every later rerun of that run keeps failing. The same upload is only
  *eventually* visible to the ListArtifacts metadata that `deploy-pages` reads:
  a 2026-11-23 run finalized the artifact and still failed with "No artifacts
  named github-pages were found" ~400 ms later. After uploading, a bounded poll
  waits for the name to appear before deploying — the cleanup guarantees the
  visible artifact is the one just uploaded. The workflow-level
  group is ref-agnostic
  (`console-preview-ci-<lane>`, `cancel-in-progress`): a newly triggered
  push/dispatch run cancels every in-flight push/dispatch run across all
  branches — the CI race — so a slower, older build can no longer overtake a
  fresher result. PR builds sit in their own lane (`-pr`) so they never cancel
  the deploy-triggering runs: a feature branch with an open PR enqueues its PR
  run just after the push run and would otherwise cancel it, losing the Pages
  preview (the PR run never deploys). The
  repository's `github-pages` environment must allow the same prefixes
  (Settings → Environments → deployment branch policies, `feat/*`, `feature/*`,
  `fix/*` and `hotfix/*`); without that the deploy job fails before a runner is assigned,
  with no steps and an "environment protection rules" annotation. The docs and
  console still must not fight over the one Pages site. The Pages artifact is
  *only* the console: `scripts/verify-console-build.mjs` asserts the relative
  asset shape, the shipped favicon/sample dataset, and the absence of docs-site
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
  put the Claude message that was executing at the top of the ChatGPT history.
- A neighbouring agent that is running is signalled by a live dot in the agent
  picker (`scopeLiveRunIndex().sources` → `AgentSelect liveAgents`). Cross-agent
  messages are reached by switching the dropdown, never by adding their rows to
  the open agent's history.
- Switching agent clears the open selection (`activeSessionKey`,
  `activePromptRunKey`, `selectedEventId`, `selectedAtomId`). When the new scope
  has a message executing now, `selectScopeFallbackRun` (`run-history-window.ts`)
  lands on that live message instead of the newest finished one — a resumed run
  can start days ago, and opening the finished row leaves the footer Live button
  dark. The same helper drives the footer Live jump, so both entry points land
  on the message the pinned list and `N LIVE` name. Without a live run the
  fallback is the newest run of the scope (`filteredSessions[0]`), never
  `sessions[0]`. The first paint uses the same live-first fallback, so `N LIVE`
  never names a run the canvas did not open; an explicit `?session=` deep link
  still wins and moves the dropdown to that agent instead of leaving the canvas
  on a run the list cannot show.
- A live message is marked on the row (status accent plus a `RUNNING` /
  `WAITING` capsule) and in the panel header (`N LIVE` chip that scrolls the
  first live row into view), so the executing message is findable without
  scrolling. `isUserQuestionWaitingRun` (`run-history-state.ts`) is the one
  presentation rule for a run blocked on a user question: the recorded status
  stays `waiting` (long freshness window, IDLE stale wording) but RUN HISTORY
  shows the RUNNING capsule, icon, STATUS and live accent. A rate-limit /
  signal wait keeps its WAITING capsule; an answered question is `active` and
  never reads as waiting.
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
  Finished runs are ordered by **last execution time** (`end`, `pinLiveRunHistory`
  sorts that group too): a thread that began days ago but just received and
  completed a follow-up rises above runs that merely started later. Without it
  the finished group kept its `start`-descending input order and a fresh reply
  on an old thread stayed buried. `selectScopeFallbackRun` uses the same key so
  the row opened on a scope change matches the row the list shows first.
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
- `appDefaults.taskCompletionChime` is the single default of the task-completion
  chime (Settings → 通知, **on by default** so the notification works without
  hunting for a switch). That switch is its only off control: the
  sound is generated locally with the Web Audio API in
  `src/lib/task-completion-chime.ts` — no audio asset, so a deployed console under
  a project path needs no `assetUrl()` call. The tone is keyed by the recorded
  terminal status in that same module (`getChimeTone`): complete ascends, failed
  descends, terminated is a neutral double tap. A style
  (`appDefaults.chimeStyle`, options in `chimeStyleOptions` in the same config
  file, `ASTROX_CHIME_STYLE`) picks the timbre — waveform, loudness and note
  patterns in the chime module's style table — and the status contour rule holds
  within every style; the settings dialog previews the current style with one
  button per terminal status. A batch plays one sound, chosen
  by `resolveChimeStatus` (failed > terminated > complete) — a batch that also
  failed must not be announced with the success chime. The terminal transition
  itself is detected by `collectTerminalTransitions` from the **recorded** status
  (`getRunHistoryDisplayStatus`), never the freshness/timeout display status, so
  a live run that merely *looks* terminated does not chime. The effect in
  `app.tsx` seeds its known-terminal set from the first real snapshot (already
  finished history stays silent), removes a key while the run is live so a
  resumed run can chime again, and skips Demo entirely. Refs hold this state, not
  React state, so a streamed batch never re-renders the studio just to record a
  completion.
- The dialog is a two-pane card: `.settings-nav` (外观 / 运行历史 / 布局 / 性能 /
  通知 / 关于) beside a `.settings-pane` that renders only the active section,
  carried by
  a vertical Radix `Tabs` so arrow keys work. A single stacked column scrolled the
  whole dialog or squeezed the controls on a short window. Header and footer are
  fixed and only the pane scrolls; Done merely closes it. A preference that also
  has an inline control in the header or toolbar is listed here as well.
  **Layout is one section, not two**: the canvas default view / runtime-atoms
  switch and the two panel switches would otherwise be two menus for one
  question, so they live in one section as two labelled `SettingsGroup`s
  (画布 / 面板) with their own descriptions. The question panel's placement is
  listed there too (`ASTROX_QUESTION_PANEL_MODE`), next to the panel switches
  it belongs to.
- Every choice / preview button group in the dialog divides its row equally:
  `.settings-options` and `.settings-chime-preview` share one grid rule,
  `repeat(var(--settings-columns, 4), minmax(0, 1fr))`, so three options fill
  three equal thirds and four fill four quarters. The chime previews set the
  same token to 3 instead of growing a separate column rule. The two footer
  actions keep their own equal `min-width` in the action bar.
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
- The pause also freezes the **displayed** clock: the service card's uptime
  (and the header pill) holds the reading it had when the pause began, the
  uptime accrued during the pause is never displayed again, and a new service
  process resets the whole clock. The policy lives with the other pause rules
  (`applyUptimePause` / `resolveDisplayedUptime` in `src/lib/sync-budget.ts`);
  do not grow a second freeze accumulator in the component.
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
- Query-parameter writes for the current position live only in
  `src/lib/console-location.ts`. Switching agent rewrites `agent` immediately
  and replaces `session` / `event` with the new agent's newest run when its
  filter has data (the canvas lands on the same message); only an empty filter
  leaves the old deep link gone. That way a `?session=` of the agent just left
  can never win over the dropdown on the next reload (deep links outrank the
  filter). Connection parameters such
  as `?api=` are preserved, and the legacy `?source=` is replaced, never
  accumulated.

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
  dependency. The agent marks in `src/components/agent-icons.tsx` are built by
  a local `createBrandIcon` factory with a keyed element per path node — do not
  switch them back to lucide's `createLucideIcon`, which renders its path nodes
  without keys and warns on every multi-path mark.
- Every icon control keeps an `aria-label`; a **tooltip is opt-in**. Add one
  only when the glyph cannot carry the meaning on its own (the chevrons that
  say *which* panel collapses, the action menu, the topology/trajectory
  switches) or when it adds state or consequence the icon cannot show (the
  `N LIVE` rules, the reload control while it is loading). A card that merely
  restates a recognisable mark — GitHub, gear, sun/moon, copy — is noise: it
  trails the pointer across the header icon row and covers the panel below.
- List scroll controls live in the panel header beside the list's search box
  (LOG, global history search), never as a floating overlay: an overlay chevron
  covered the first visible row. Both directions stay mounted and the header
  reserves their width; an unreachable edge is a `disabled` button rather than
  an unmount, so the sibling search input never shifts as the list scrolls.
- The Flow Guide drawer dims the console with a flat scrim
  (`.atom-guide__overlay`), never a backdrop blur — the canvas repaints
  continuously and would pay for the blur on every frame.
- The uptime chip's `LOCAL SERVICE` card names its version subjects: **console**
  is `appVersion`, **service** is `build` from `/api/health`. The server reads
  `package.json` first and the installed runtime's `plugin.json` second (the
  installer copies no package manifest), so an installed service can report its
  release instead of `unknown`. A mismatch is called out, and an unreadable
  manifest renders "未上报" with the reason — never a bare `unknown`. A **capture plugins** group reports
  `/api/health.captureVersions`: the long-lived adapters (opencode / pi) stamp
  their own `package.json` version as `payload.captureVersion` on every event
  (single source of truth = that adapter's manifest), the service aggregates it
  per source. Drift is `stale: true` when two stamped versions wrote, **or** an
  unstamped event (a process running pre-stamp code) is at least as recent as
  the newest stamped one — counting only stamped versions missed the real bug,
  because a still-running old process writes no stamp at all. `stale` is
  derived from event timestamps, not wall-clock freshness. The card shows the
  `v旧(未标记)` bucket and, when stale, a copyable host-specific restart command
  (`captureRestartCommand`: `opencode service restart` or a Pi session hint) —
  it never claims to have restarted a process a browser cannot touch.
- The card's restart button is honest about the browser boundary. With a live
  health response it posts `/api/restart` and waits for the new pid; with no
  service it does **not** fetch a dead port — it copies
  `buildServiceCliCommands(apiBase, origin)` (repo: `pnpm service:up --port=N`,
  installed bundle: `ASTRO_PORT=N astro-trace serve`) and the notice states
  exactly whether the clipboard succeeded. A same-origin page takes its port
  from `window.location`, not the default 5678. `scripts/service-cli.mjs` is the
  out-of-band control surface: `up` restarts a running service or starts a
  downed one on the same port (installed runtime wins, checkout server is the
  fallback), `status` / `start` / `stop` are the single actions; `restart` on a
  downed service starts it rather than waiting for a dead health endpoint. The
  global CLI has the same start-or-restart alias, `astrox up`, so installed
  bundles do not need the repository scripts. A
  handover waits for a **new pid**, never reports the old process as ready.
  A static page cannot spawn a local process; pretending otherwise would leave
  the reader staring at an offline card with a dead button.


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
- The virtualized LOG measures its row / turn heights **without depending on
  the metrics it writes**: `AtomicLog` reads them from a ref, so the layout
  effect runs only when the entries change. Measuring on `metrics` itself made
  each `setMetrics` mount a new slice whose first row had a different height,
  looping until React threw error #185 on the deployed console. The estimate is
  the *tallest* mounted row of each kind, so a sliding window cannot clip a
  wrapped row or flip the height by swapping the first row.

## Run Trajectory Order

- The trajectory list renders newest first: turns descending, the atoms inside
  a turn descending, and `RUN CONTEXT` (the run preamble) last. It mirrors RUN
  HISTORY so the atom that is executing right now is the first row.
- The model from `buildTrajectoryModel` stays chronological. Selection lookups,
  the "latest atom" test, and the lane overview all depend on that order, so
  `orderTrajectoryNewestFirst` is the only place allowed to reverse — never
  sort the model in place.
- The lane overview above the list remains a left-to-right timeline. `normalizeSlotStatus`
  maps `waiting` onto `active` (like `running`), so a blocked User Question slot
  keeps the running pulse instead of decaying to `idle` — "executing" has one
  meaning shared with `isLiveRunStatus`.

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
- The inspector's Input tab renders `user.question` payloads (display key, so
  `Notification` included) as a Preview/Code pair like the prompt input:
  `src/lib/markdown-preview.ts` validates and sanitizes the markdown once —
  invalid or empty sources fall back to the captured text, and the question
  shapes are extracted only in `src/lib/user-question-content.ts`. That single
  extractor also reads plan approvals: ZCode and Claude Code emit
  `PermissionRequest` with `toolName: ExitPlanMode` and the Markdown plan in
  `tool_input.plan` (no `questions` array and no `message`), which the preview
  renders as a `Plan` section. Do not synthesize a `message` for that shape in
  an adapter or the recorder. The preview decision must not use
  `isUserQuestionStartEvent`: that predicate drives run state (question starts,
  not answers), while the preview follows the display key, so an answer row
  still previews its payload.
- A captured answer has one rendering: `src/components/answer-rows.tsx`, used
  by the floating card's result, the docked question surface and the inspector's
  historical Answers section. It reconstructs selected options through
  `matchAnswerOptions` in `src/lib/question-panel-model.ts` (whole comma tokens
  matching a declared label, so "Paris, France" never lights a "France" chip),
  paints them as highlighted chips, and renders any remaining free text as
  Markdown. `QuestionResultList` keeps the request's answer order through
  `resultAnswerRows`; do not re-derive answers from drafts after the result
  arrives — the app clears drafts on close, which is why historical selections
  used to lose their highlight.
- Turning an inspector payload into a Markdown preview document lives only in
  `src/lib/payload-markdown.ts` (`payloadToMarkdown`: a captured result is found
  at any depth — `captured`, `tool_response`, `output`, `result` and their nested
  content arrays — and returned as its real text, so a tool result renders as
  the Markdown it is instead of a wall of field labels and fenced JSON; a `plan`
  nested in `tool_input` is read the same way; a JSON result is fenced for the
  highlighter; an `answers` map becomes question → Markdown-answer rows, a
  `questions` list a numbered list with option bullets, and a captured result
  with no single text shows as readable field lines rather than a JSON dump —
  the inspector/overlay's `{ contract, captured }` wrapper previews only
  `captured`, leaving the `contract` topology metadata to the Raw tab); Markdown parsing, syntax highlighting and HTML sanitizing
  live only in `src/lib/markdown-preview.ts` (`renderMarkdownPreview`, with
  highlight.js registering only the languages captured payloads carry; shell
  fences go through a dedicated escaped tokenizer that colours commands,
  flags, assignments and variables, since the stock bash grammar left real
  captured commands almost monochrome). A
  fence that names its language is wrapped in a `.md-code` header whose badge
  stays **outside** the scrolling `<pre>` — it keeps its place while wide
  code pans; the token map in `styles.css` colours every class the
  registered grammars emit (names, tag names and json/yaml keys read on the
  dedicated `--code-accent`, diff lines carry addition/deletion tints) — the
  near-white the name family used to inherit read as unstyled code.
  `.markdown-preview` restores `list-style` and block layout for lists:
  Tailwind's preflight resets `list-style` globally and a flex column
  blockifies `li` away from `list-item` — either one alone silently dropped
  every bullet and ordered number. GFM task lists swap their marker for the
  checkbox. The
  Input/Output/Raw tabs and the global expand layer share these two sources;
  `src/components/payload-overlay.tsx` only renders them — it must not grow a
  second conversion or sanitizer. The expand control opens a Dialog (portaled
  to the document body) whose payload always follows the current event and tab,
  never a global newest request. Its left rail is the run's **message chain in
  the LOG's own data standard**: every event of the run the LOG renders, from
  the same `buildLogEntries(activeEvents, …)` result (`overlayAtoms` in
  app.tsx), split by the same turn separators `buildTraceTurnIndex` produces —
  the pipeline-atom rail (one row per platform atom, bound to each atom's
  newest event) could not reproduce the chain, so a rail row is one *event*
  with the harness atom id it commits to. It is a view of the **single**
  console selection, never a second one — picking a row calls
  `handleOverlaySelectEvent`, which writes the same state the LOG's select
  handler writes (the picked event plus `getAtomIdForEvent`), so the overlay
  cannot highlight A while the canvas / LOG / inspector stay on B. The dialog
  only receives `atoms` / `selectedEventId` / `onSelectAtom` and follows the
  main selection reactively. The rail renders **newest first**
  (`[...atoms].reverse()` in the dialog): the first-executed event is at the
  bottom, matching RUN HISTORY and LOG, and turn separators are keyed by
  position, never by the turn value. Its rows **reuse the LOG row itself**
  (`.atomic-log__row`): shared `formatLogSequence` number, `atomTypeLabel` TYPE
  badge, event-meta tone colour, timestamp, action / summary, the closed-pair
  duration badge and the shared `PairLinkMarker` — the same `PairLinkMarker`
  component the LOG and trajectory render, extracted to
  `src/components/pair-link-marker.tsx`; `payload-overlay.tsx` must not grow a
  second row implementation, type taxonomy or tone map. The rail-only CSS
  overrides give the chain room to be read (wider rail, one step larger type,
  wrapping key / two-line summary) — a name must never ellipsize into
  `trajectory.pr…` again; their selectors carry the `.atomic-log__row` scope so
  they out-rank the base row rules that follow later in the file. Rail rows
  carry **no hover styling** (sweeping the pointer changes nothing; selected /
  running / pair-partner rows keep their own state, which the base `:hover`
  rule would otherwise out-rank), and the selected row is one more step of type
  with a brighter selection treatment — the step being inspected must be
  unmistakable at a glance. Arrow/Home/End move focus between rows. The head
  is **one row** — a growing search box, two jump-to-edge buttons
  (both mounted with reserved width, the unreachable edge disabled), the Live
  toggle — and
  the rail has its **own search box** (rail-local state, the LOG's
  deferred-needle pattern, matching the rows' display fields AND the row
  event's payload content through the shared per-event haystacks
  `searchEvent` → `matchesEventQuery`; the input carries a clear button, and a
  turn whose rows all miss disappears with its separator). Its duration badge
  uses the **same stepped ladder as the LOG list** (`formatDurationMs` in
  `src/lib/duration-label.ts` — <10s `ms`, <1m `s`, then `m` / `h` / `d`, one
  dominant unit per tier): the same closed pair reads with the same unit in
  both surfaces. No second composite formatter may grow in the overlay. The rail
  header carries a **Live toggle** that
  mirrors the console's live following: availability keys off the *recorded*
  status (`getRunHistoryDisplayStatus` — the RUNNING capsule the RUN HISTORY
  card keeps printing, STALE marker included), never the freshness-terminated
  display, so a run that went silent stays clickable until a terminal event
  lands; arming rides the session's newest prompt run
  with no explicit atom selection (like the footer Live jump) and then only
  *scrolls* the selected row into view as new events land — never a selection
  change, or Live following dies mid-question; picking any row disarms. Armed
  is the follow posture (selection cleared): a genuinely executing message
  keeps advancing to its newest atom, a STALE one lands on its newest event
  and resumes following the moment it produces an event again. Armed
  it breathes (a `payload-follow-breathe` halo); the label is the console's
  own Live mark. A follow advance replaces the preview content **under the
  reader** while keeping both panes' scroll positions (an onScroll memo
  restored after each commit — a streamed message lands as a new event every
  ~800ms and grows beneath the reader without moving the line they were on);
  only a row **the reader picked in the rail** re-anchors both panes to the
  top, and a switch to the Code view resets the memo so coming back opens
  from the start. The `{ __html }` wrapper passed to `dangerouslySetInnerHTML`
  is **memoized on the html string** (`previewHtml` / `MarkdownView`'s
  `html`): React compares the wrapper by object identity, so an inline
  literal re-set identical markup on every app tick — the console re-renders
  each second while the dialog is open — and every rewrite recreated the
  children, resetting a horizontal scroll inside a wide code block about
  once a second. The memo lets React skip identical markup.
  The layer keeps **three readings behind one
  toggle**: `Agent` (the default) is the event sequence projected as the
  artifacts an Agent produced, `Preview` is the rendered content (Markdown
  headings, GFM task lists, highlighted code, question/option/answer lists)
  and `Code` is the untouched structured JSON. The Agent projection lives only
  in `src/lib/agent-view.ts` (`buildAgentView`, a pure function): snapshots with
  one `messageId` merge into one reply with a count, a broken prefix records a
  diagnostic and keeps every step, legacy id-less captures only fold adjacent
  `startsWith` chains, every Reasoning event is its own block with the real
  captured text shown by default (all hook spellings folded by `extractText`
  in `trace-model.ts`), tool commands read only from the paired `PreToolUse`
  through `getToolCallCommand` without mutating events, and questions bind only
  to the blocking start event through `parseUserQuestionContent`.
  `src/components/agent-transcript.tsx` only consumes that projection; payload
  text still goes through `MarkdownView` / the shared payload helpers and
  questions through `QuestionContent` / `QuestionPreview`. Steps and rail rows
  commit through the same `onSelectAtom` state. A reader scrolled back keeps
  their position: the overlay's `agentLocateRequest` is bumped only by an
  explicit pick, live follow counts new steps behind a bottom-centered pill
  without moving the reader, and the bottom / latest-step tests live only in
  `src/lib/agent-transcript-scroll.ts` (`isAgentTranscriptAtBottom`,
  `isLatestStepVisible`). The affordance has exactly three reads, never two at
  once: while the reader sits on the newest step the trailing loading row
  shows only at the bottom; whenever the newest step has scrolled out of view
  — a manual gesture or an explicit locate of an older step alike — the bottom
  row is hidden and the centered pinned pill carries the loading state with its
  pending-step count; once the run has ended that same pill becomes a plain
  scroll-to-bottom control. Returning to the newest step resumes automatic
  appending, each content kind carries its own accent with bodies highlighted
  through one `contentToMarkdown`, and the trailing loading row is shown only
  while the run is still executing. The related-field inventory is
  shared with Preview in `src/components/related-fields.tsx` and folds long
  values per field, never per pane. `Preview` is split into two panes — the atom's real content
  (Markdown / highlighted code, or the question list) and the related data
  (timestamps, paths, ids, annotations / explanations) — and the pane titles
  stay **pinned** while their bodies scroll under them. The split lives only
  in `src/lib/payload-preview.ts`; the dialog caches a prepared preview per
  event id, **scoped by the inspector tab** (`cacheScope`), via
  `payloadForAtom(atomId, eventId)` / `variantForAtom(atomId, eventId)` — a
  picked row resolves its *own* event's payload (one atom aggregates many
  events, so the resolver is row-event-first: a tool-call row reads its own
  `tool_input`, a result row its `tool_response`, a prompt row its payload;
  `payloadField` in app.tsx skips the recorder's empty `{}` placeholder — the
  recorder writes `tool_input: {}` when only the camel spelling exists, and
  letting it shadow `toolInput.command` once blanked every tool call's Input
  preview), and the pane previews the payload's **core information**, never the raw
  envelope: a split with prose renders as Markdown, one without falls to the
  shared core extractor `payloadToMarkdown` (which reads the camel
  `toolResponse` spelling and renders a `structuredPatch` as a highlighted
  diff), and only a payload with nothing to say falls back to highlighted
  JSON (`fallbackPayloadMarkdown` — switching rows must always
  change the pane, never sit empty). The generic view is **content-only**:
  metadata keys stay out (they are labelled in the related-data pane),
  field-name headings are not printed, and a string value is fenced with its
  inferred language (`inferCodeLanguage` / `fenceCode` — json / diff / xml /
  typescript / python / bash; a wrong guess colours prose into noise, so weak
  signals additionally require code punctuation or a multi-line body — a
  single-line shell command qualifies through flags, chains, variables or a
  `VAR=value` prefix, and a shebang qualifies on its own). Every text the
  result extractor unwraps (`payloadToMarkdown`, `resultToMarkdown`) goes
  through this one fence decision, so a captured tool command never falls back
  to an uncoloured paragraph. A
  keyword match is **per-line** evidence only: a text carrying Markdown block
  structure (headings, lists, emphasis, links, fences, tables) is a document
  and renders as one — its own fenced code highlighted, wide code blocks and
  tables scrolling inside their block — never wholesale-fenced into a
  horizontally scrolling monospace wall because one line inside looks like
  code (an `export type …` sketch inside an agent's plan); json / diff / xml
  self-identify and fence unconditionally, and `#` lines are comments in
  shell / Python, never document evidence there. The
  related-data pane lists **every captured field** via `collectPayloadFields`
  (content keys, empty strings, null/false/0 and nested dotted paths included —
  annotations first). An array of objects keeps its shape: each element opens
  with an indexed **group row** (`questions[0]`, `questions[0].options[1]`,
  the walk's `groupHeader`) and its members indent beneath it, so repeated
  bare keys (`label`, `label`, `label`) stay attributable to their element;
  only annotations **outside** any array float to the pane top, a note inside
  an element must not leave its group. Folding is **per value**, never per
  pane: only a value
  past `RELATED_VALUE_MAX_CHARS` (200) gets its own 展开 / 收起 on that row, so a
  long path cannot hide the short fields beside it. `splitPayloadPreview` stays
  the single content-extraction definition; the field inventory is a separate,
  purpose-built walk, not a second filter in the component. The two pane titles
  stay pinned while their bodies scroll. Switching rows in the
  rail is a lookup, never a repeated Markdown parse. Its preview is type-aware:
  a payload carrying a structured `questions` list renders `QuestionPreview`
  (the shared read-only question / option / answer list) whatever the row's
  display key — an unclassified question-tool row (OpenCode writes a plain
  `question` tool call) must not fall to the flattened `### Questions` Markdown;
  free-form `message` / `plan` text keeps the Markdown path unless the row is
  already question-keyed, so a prompt or command payload is never swallowed by
  the Question heading — and an answers-only payload with no
  question / plan falls back to the Markdown answer preview so the overlay is
  never blank. The read-only question
  list (`QuestionPreview` → `StaticQuestionContent`) leads with a question count
  and a capture-order hint, numbers each question, marks answered ones, and
  prints the selected labels on a dedicated line; captured selections use a
  stronger selected-chip treatment than the live option buttons.
  The docked answer form and the floating card share one 提交 / Cancel order and
  one button label, and the "N questions · one submit" hint lives above the
  question list rather than in the action bar.
- "What counts as a user question" lives only in `src/lib/trace-event-kind.ts`
  (`isUserQuestionEvent` / `isUserQuestionStartEvent`): question-named events,
  a `Pre/PostToolUse` naming the question tool, plus a
  `notification_type=permission_prompt` `Notification` whose text or tool field
  names `AskUserQuestion`. The tool-name set matches **exactly** normalized
  names (`AskUserQuestion`, `request_user_input`, …, OpenCode's bare
  `question`); prose matching searches sentences and therefore keeps the
  unambiguous names only — "question" alone is a noun of every sentence, so it
  never joins the prose matcher. Generic `idle_prompt` / `auth_success`
  notifications
  and permission prompts for other tools (Bash, DeferExecuteTool) stay runtime
  signals. **Whether it blocks is a separate decision** in the same module:
  `isBlockingUserQuestionStartEvent` requires answerable parameters (a non-empty
  `questions` or `plan`). A parameterless `PermissionRequest` / permission
  notification is host **system authorization**: it displays as
  `permission.request` and never puts the run in `waiting` or mounts an answer
  box. A bare `PermissionRequest(Bash/Edit)` projects onto
  `harness-action-gate`; a permission notification naming a question tool stays
  on `harness-user-question` in the `delta` phase so the canvas is already there
  when WorkBuddy's real `questions` arrive with a later `PreToolUse` — the
  parameterized question then takes over the same atom and is reachable. An
  explicit question event (Elicitation, a question-named event, a question-tool
  lifecycle row) blocks without the parameter check.
- `PreToolUse` / `PostToolUse` of `ExitPlanMode` keep their `tool.call` /
  `tool.result` display keys. `hasPlanContent()` in the same extractor lets the
  inspector preview their plan without adding `exitplanmode` to the
  user-question classifier, which would change projection, waiting state and
  topology counts.
- The harness `user-question` atom binds the newest question **start** event
  (the actual user question) in `src/lib/execution-topology.ts`; the answer
  event only closes its status. Binding the last matched event made the
  inspector read the answer payload instead of the question. `userQuestionSummary()`
  in `src/lib/user-question-content.ts` is the one display text for a question
  — LOG summaries, the atomic projection and the inspector overview all read
  it; a question row must never fall back to the tool name.
- When the displayed question has a live `InteractionRequest`, the question
  surface (`src/components/question-content.tsx`) becomes answerable — the dock
  below the inspector tabs and the Input tab render that one component, and
  Overview no longer mounts a second answer box. One toolbar row owns only the
  view switch (Preview / Code) and the placement switch — the question itself is
  never foldable, so there is no collapse button; Preview shows the question list
  with option chips, Code shows the raw payload only — no options and no answer
  bar. While a request is open the options are buttons and the
  Submit / Cancel bar is a sibling of the scrolling body, pinned to the bottom
  of whichever container holds the surface; once it closes (or for a captured
  question with no request) the same chips render as static `spans`, so nothing
  looks answerable when there is nothing to answer. `src/lib/question-interaction.ts` owns
  the one match rule (tool id first, then session + verbatim question text,
  then — for the textless plan approval — the session's newest open
  ExitPlanMode request). When a view scope is supplied, `questionMatchesCurrentView()`
  first requires the question event inside the selected prompt run, an atom id
  that resolves from that same event, and a matching session/source; the
  floating card and the inspector both use it. Switching agent or message
  therefore removes the answer surface instead of answering a stale request.
  `answerInteractionQuestions()` in
  `src/lib/interaction-client.ts` is the one batch sender: every question gets a
  `text` event with increasing seq, then a single `submit` carrying the full
  answer map; `answerInteractionQuestion()` is only its one-element wrapper.
  The answer key is always the descriptor's verbatim question text — never a
  row index or the selected log event. The host closes a request on the first
  submit, so a multi-descriptor AskUserQuestion must be answered in one batch,
  not one question at a time. Single-select descriptors render one-click quick
  answer buttons above the free-text row (a plan approval is an Approve/Reject
  pair); multi-select options are toggles whose draft is kept in declared option
  order, with typed text as the submitted value (no separate Set action).
  Every option click — single or multi — only fills its draft and highlights
  the choice; the single Submit button sends the batch once all required
  questions are answered. `src/lib/question-panel-model.ts` is the one builder
  for those answer maps. The inspector grid item must keep `min-width: 0`: the
  surface wraps long question text inside the panel width and scrolls its body
  under a pinned submit bar, so an AskUserQuestion can never widen the 320px
  log column. A blocked/rejected submit keeps the draft and raises
  a notice — clearing it would make a failed answer look sent. A close result
  only splits comma-joined answers for multi-select descriptors; free text such
  as "Paris, France" stays one answer. The
  inspector's question binding mirrors the display fallback: a plan-content
  tool row answers like the question atom.
  The floating interaction panel uses the same strict current-message/current-atom
  binding as the inspector, never a global newest request. It is a live answer
  affordance only: `isQuestionActionable()` in `src/lib/question-interaction.ts`
  (delegating to `isPromptExecuting`, so both `active`/running and `waiting`
  count) gates the floating card and the inspector's answer controls. The gate
  keys off the *session* status the RUN HISTORY card shows (`getRunHistoryDisplayState`
  over the active session), not the selected prompt run — drilling into an older
  message or atom must not freeze the question while the task is still
  executing. Once the session reaches a terminal state, or the reader replays a
  captured snapshot, no card floats and the inspector question goes read-only —
  the event stays a preview, never an answerable request. It follows the
  question lifecycle: the card enters with an animation when its bound request
  opens, the header chevron collapses it to a one-line summary (a new request
  remounts the card via its `requestId` key and re-expands), the question list
  has a mode-dependent maximum scroll height while the footer stays pinned to
  the card's bottom edge, and when the request closes the app keeps the card
  mounted (`--settling`, `INTERACTION_SETTLE_MS`) so the result stays readable
  ~2.4s before it slides away. A stream reset that wiped the record dismisses
  it at once instead of showing a stale question. `dock-full` / `float`
  (`src/lib/question-panel-model.ts`, which also normalizes the retired
  `dock-half` / `half` / `bottom` / `side` values) are the one shared placement
  of both surfaces: `dock-full` renders that same question surface under the
  inspector tabs and fills the detail area, and only `float` puts the card over
  the canvas, so the card still requires the highlighted atom to be the
  question. Until the reader switches layouts by hand, the mode follows the run
  state (`autoQuestionPanelMode`: an answerable question floats so it stays next
  to the run it blocks, a finished or captured one docks full); only an explicit
  switch is persisted, so a derived default is not frozen across reloads. The
  docked layout expands a historical question the reader selected, which is how
  a closed request is re-opened for reading, and uses tighter rows so more of the
  question fits; the floating card puts one option per full-width row for quick
  answering. A collapsed EVENTS column has no region to dock into, so
  `questionDocked` in `app.tsx` falls back to the card for the synchronous
  window. Questions inside the card are never foldable (only the whole card
  collapses from its header), its question list scrolls edge to edge — the card
  carries no outer padding, the rows carry the gutters — so the scrollbar rides
  the card border, and the keyboard shortcut legend sits in the card header
  between the summary and the status so the footer keeps only the Submit / Cancel
  buttons, in that order (the docked footer matches). The
  dock keeps the closed result (`QuestionResultList`) where the answer box was,
  mirroring the card's settle window.
  For faster answering the floating card focuses its first option and binds
  digit keys to the first question's options, Enter to submit, Escape to
  cancel; `resolvePanelKey` in `src/lib/interaction-panel-model.ts` is the one
  decision source and refuses every shortcut while the card is read-only. The
  listener lives on the card, never on `document`, so search and dialogs keep
  their keys; text fields handle Enter as a one-batch submit and otherwise own
  their keystrokes.
  The countdown bar is one CSS animation from the request's own timestamps;
  `interactionTimeLeft` is the pure ratio for any numeric display of it.
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
- ZCode plan approval arrives as `PermissionRequest` with
  `toolName: "ExitPlanMode"` and `tool_input: { plan: "<Markdown>",
  allowedPrompts? }`. The adapter preserves it verbatim; the capture side does
  not drop the plan text. `src/lib/user-question-content.ts` is the only reader
  of that shape for the `user.question` preview.
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
- Older WorkBuddy builds omitted the payload entirely, so the recorder falls
  back to hook-environment session/workspace and those traces carry named
  lifecycle events without tool detail. Current WorkBuddy builds **do** write
  `tool_input` (including AskUserQuestion `questions`) to hook stdin: the
  captured `PreToolUse` carries them, and the opt-in interaction hook parses the
  same payload to register an answerable request. Do not assume the empty-payload
  shape or drop the env fallback — both spellings must keep working.
- WorkBuddy has no `PermissionRequest` hook. While the host asks permission to
  call `AskUserQuestion` the only signal is
  `Notification { notification_type: "permission_prompt", message: "needs your
  permission to use AskUserQuestion" }`; the tool's real `questions` arrive with
  a later `PreToolUse`. That notification is a system authorization (see Event
  Labels): recognise only permission prompts naming a question tool, never let
  the parameterless shape block the run, and keep it on the User Question atom
  so the later parameterized question is reachable from the same spot. That
  follow-up `PreToolUse` is answerable from the console when the interaction
  hook is installed for `--client=codebuddy` (it registers on `PreToolUse` and
  returns the answer in `modifiedInput`); the recorder still writes the event.

## Pi Capture

- Pi has no hook protocol; capture is a global extension loaded by jiti from
  `~/.pi/agent/extensions/astro-trace/` and installed by
  `scripts/install-pi-plugin.mjs`.
- `resolvePiSessionId` (`pi-plugin/session.ts`) is the one session-id rule for
  CLI, Web and SDK hosts: `ctx.sessionManager.getSessionId()`, `ctx.sessionId`,
  `ctx.session.id`, `event.sessionId`, `event.session.id`, `PI_SESSION_ID`, then
  a stable `pi-process-<pid>-<cwd>` fallback. Reading only `ctx.sessionManager`
  dropped every main-Agent event in hosts without that context while the
  headless subagent children still recorded. Claims and live-text buffers key
  on this *origin* id; the events are written with the display id below.
- Named Pi subagents run in their own child processes. `readSubagentIdentity`
  reads `PI_SUBAGENT_DEPTH` / `PI_SUBAGENT_STACK` / `PI_SUBAGENT_DELEGATION`
  and the persisted `pi-subagent:delegation` custom entry in the child's
  session JSONL (only an entry whose `childSessionId` matches is accepted),
  then writes the child's events under `parentSessionId` with
  `subagentAgent` / `subagentHandle` / `subagentSessionId`. An orphan
  `subagent.*` session must never replace the main Agent's own history.
- Prompt runs pair the `input` event with `before_agent_start`: slash commands
  and other non-agent inputs never create prompt runs.
- Assistant `message_end` derives the terminal event from `stopReason`
  (`error` → `StopFailure`, `aborted` → `Interrupt`, `stop`/`length` →
  `Stop`); `toolUse` keeps the run active. `tool_call` / `tool_result` carry
  the tool lifecycle. `message_start` / `message_update` keep the console's
  text in sync while the step is still executing: the extension accumulates
  live text per message id (reading the update's accumulated text first, so
  every snapshot is a prefix of the final `message_end` text — re-fired or
  reordered deltas cannot drift the two apart) and enqueues throttled
  `AgentMessage{streamed:true}` snapshots every 800ms, the same carrier
  opencode derives from `session.text.delta`. Pi fires these for every role,
  so a non-assistant `message_start` / `message_end` must never clear an
  assistant buffer that is still filling. `message_end` clears the buffer
  and writes the one complete message with its model / provider / usage.
  `message_update` stays unmapped in `mapping.ts`; the accumulation lives in
  `index.ts`, not the pure mapping layer. Tool execution deltas stay unmapped.
- Pi sessions are resumable, so claim files record the owning pid and a later
  Pi process takes a session over only after the previous owner exits.
- The extension reads event shapes defensively (Pi adds fields across
  releases) and must never block the agent loop; recording failures fail open.

## Optional Decision Hook (auto-approve user questions)

- ASTRO's capture hooks stay read-only. `scripts/auto-approve-question-hook.mjs`
  is a **separate host-side handler**, never installed by
  `install-plugins.mjs` and off by default. It reads hook stdin and returns
  `hookSpecificOutput` with `allow` plus a full `updatedInput` (`answers` for
  `AskUserQuestion`, echoed `plan` for `ExitPlanMode`). Unmatched or broken
  input yields empty stdout and exit 0, so the normal prompt returns.
- `scripts/install-auto-approve-hook.mjs` is dry-run by default; `--apply`
  merges one matcher-limited group (`AskUserQuestion|ExitPlanMode`) into user
  settings, preserves unrelated keys/hooks, is idempotent, and backs up the
  file. ZCode needs `hooks.enabled: true` in `~/.zcode/cli/config.json` and a
  new session. Never reuse a recorder's `--source=` for the decision hook:
  `isInstalled()` would overwrite it on the next installer run.
- Keep the decision hook out of `plugin/` and `*-plugin/`. Changing recorder
  stdout would break fail-open, the six mirrored `trace-recorder.cjs` files and
  every stdout assertion. Explicit deny rules, plan-mode write bans and hard
  tool limits still win over an `allow`; keep recorders `--quiet` so their
  stdout does not join the `deny > ask > allow` aggregation.
- Protocol and installer behavior is pinned by `tests/auto-approve-hook.test.mjs`;
  host configuration and verification live in `docs/plugin-installation.md`
  ("Optional: auto-approve user questions").

## AskUserQuestion Interaction Hook

- `docs/interaction-hooks-{zh,en}.md` is the **contract source** for the
  observation / decision / interaction channel model: five message shapes
  (`QuestionDescriptor`, `InteractionRequest`, `InteractionEvent`,
  `InteractionResult`, `AgentNotification`), the SSE frames, TraceEvent
  projection and Agent notification channels. Change it before changing the
  implementation.
- One implementation lives in `plugin/interaction-contract.mjs` (+ `.d.mts`);
  `src/lib/interaction-contract.ts` and `src/lib/agent-notification.ts` are typed
  facades. The installed runtime copies only `plugin/`, `server/` and `dist/`,
  so the contract must never move under `src/`.
- Capture stays read-only. The interaction hook (`scripts/interaction-hook.mjs`)
  is a separate opt-in hook: it registers at `POST /api/interactions`, polls
  `<ASTRO_HOME>/interactions/<id>.json` inside `ttlMs = timeout - 500`, and
  returns `allow` with `updatedInput.answers` only for an `answered` result.
  Cancelled, timed out or unreachable service → empty stdout + exit 0. The
  hook parses every host payload spelling — ZCode's camelCase `toolCallId`
  included — so a plan approval's request always carries the tool id the
  console matches on.
- It does **not** write a `PermissionRequest` TraceEvent: the recorder already
  captures the same host event, and a second write produced two identical
  question rows in the LOG. Records of the outcome are the recorder's
  `PostToolUse` (`tool_input.answers`) plus one `Notification` written by the
  service on close (counts and device only, never an answer value).
- The service keeps interactions in memory and writes exactly one result file
  per request (tmp + rename). Routes: `POST /api/interactions`,
  `POST /api/interactions/:id/events`, `POST /api/interactions/:id/close`,
  `GET /api/interactions/:id`; `/api/stream` adds `interaction.open` /
  `update` / `close` and clears them on `reset` / `reset-same`. Writing an
  answer back is the `close` route plus the result file — never
  `POST /api/events`. When the **last** stream client leaves, a one-second grace
  absorbs an EventSource reconnect; if no client returns, `cancelOrphaned()`
  finishes every open request as `cancelled/service` through the same `finish()`
  path. The frames are never replayed, so a disconnected reader must not hold
  the host for the rest of its window, but a one-second blip must not throw away
  a live question either. Creating a new record removes any old result file for
  the same deterministic id before the hook can poll it.
- `Notification` hooks have no decision control; never wrap an answer as
  `UserPromptSubmit`. `additionalContext` / `systemMessage` /
  `permissionDecisionReason` are capped at 10,000 characters and only
  `PreToolUse` can carry the first two (ZCode's strict stdout schema rejects
  extra keys on `PermissionRequest`). The CodeBuddy / WorkBuddy `modifiedInput`
  channel is stricter still: `preToolUseOutput` drops `additionalContext` and
  `systemMessage` whenever `inputField === "modifiedInput"`, leaving only the
  decision, reason and modified input — exactly the shape the auto-approve hook
  emits. The console may flash the question atom on `interaction.open`, but only
  through `shouldLocateInteractionRequest` (same session and source, reader
  following live), and only as a locate pulse: never change the selection, or
  Live following dies mid-question.
- A hook is synchronous: the answer window **is** the hook's registered
  timeout, written by the installer (`--timeout`, seconds, default 600) into
  both the host's hook configuration and the hook's `--timeout` argument, so
  the request's TTL can never outlive the host's wait — never block past it,
  `exit 2` or emit `continue: false`. While a console page is attached to
  `/api/stream` the whole window is answerable; with no console connected the
  service closes the request as `cancelled` at once (interaction frames are
  never replayed on reconnect, so nobody could answer it) and the host's
  native prompt returns immediately. The contract validates a configured
  window against `maxHookTimeoutMs` (1 h), with `hookTimeoutMs` (5 s) staying
  the no-flag default.
- Cancel / Escape applies the close result **locally** as soon as the POST
  succeeds: `cancelInteraction` dispatches `close` from the response (the service
  wraps it as `{ requestId, result, duplicate }`), and the SSE close frame stays
  authoritative for other devices. Relying on the frame alone left a card still
  answerable after a 200 close whenever the frame was lost to a reconnect or the
  request had already been closed by the service. The reducer's "already closed"
  guard makes the second close a no-op.
- `scripts/install-interaction-hook.mjs` reuses the merge / validate / remove
  helpers of `install-auto-approve-hook.mjs` (parameterized by `hookMarker`,
  `events`, `hookArgs`). Dry-run by default, backup on `--apply`, `--remove`
  keeps recorder and decision groups. Default event is `PermissionRequest`;
  `--events=` widens it. Do not install both hooks on the same event:
  auto-approve answers immediately and makes the panel pointless.
- Catalog entries for these docs live in `docs/index.md` and
  `site/src/docs.ts` (`sectionBySlug` + `readingOrder`).
- `plans/pending/03-ask-user-question-implementation-breakdown.md` is the
  executable backlog (32 tasks, A1–F5). 31 are ticked; F3 (real host acceptance)
  is partially met: the ZCode clean-log item holds on this machine (2026-11-22
  real host session, 111 allowed / 0 failed), but Claude `/hooks` visibility and
  the interaction-hook closed loop still need a drivable host (claude config-only,
  zcode / codebuddy GUI apps with no headless CLI), so F3 stays unchecked, the
  plan stays pending and is not archived. Do not write "host acceptance passed"
  anywhere before all three F3 items are done.

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
