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
  event names.
- Treat unrelated working-tree changes as user-owned and do not revert them.
- A behavior change is only complete when `docs/user-manual-*.md`,
  `docs/conventions-*.md`, this file, `docs/index.md`, and `site/src/docs.ts`
  agree with it.

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
- The live index is machine-wide: `collectLiveRunKeys` runs over every session,
  not the agent-scoped list, and live runs of other agents join the history
  pool. The dropdown scopes the finished history; it must never hide the
  message that is executing right now.
- A live message is marked on the row (status accent plus a `RUNNING` /
  `WAITING` capsule) and in the panel header (`N LIVE` chip that scrolls the
  first live row into view), so the executing message is findable without
  scrolling.
- Selection styling outranks the live accent; a selected live row keeps its
  selection border.
- Executing runs are pinned to the top of the list, ordered by their latest
  activity, and stay inside the visible time window whatever their `start`
  (`collectLiveRunKeys` → `selectVisibleRunHistory` / `pinLiveRunHistory`). A
  session resumed today began days ago; without the pin its new prompt would
  sort below every run that merely started later, and the window would drop it
  mid-execution. Finished runs fall back to newest-first order.
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
  selects the executing run — never `sessions[0]`, which is the newest start
  and therefore never a resumed run.
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
  advancing one day at a time, and disappears when `canLoadMoreRunHistory` is
  false. Switching agent or changing the default range resets the width to the
  preference.
- The empty state names the configured range, so a short window never reads as
  "no history at all".

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
- The dialog is a two-pane card: `.settings-nav` (外观 / 运行历史 / 画布 / 面板 /
  关于) beside a `.settings-pane` that renders only the active section, carried by
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

## Run History Prompt Thread

- The expanded Prompt list is **measured**, not estimated: a `ResizeObserver` in
  `RunHistoryItem` sizes it to `scrollHeight` up to
  `appLayout.historyPromptListMaxHeight` (300 px), and a thread that overshoots
  the ceiling by less than 1.25× is shown whole. `rows × fixed estimate` clipped
  the last row whenever a title wrapped — exactly the two-message thread where
  that row is the whole second message.
- The estimate stays as the first-paint fallback only. `max-height` must not be
  re-added in CSS: it would clip the measured height again.

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
- Every icon control has an `aria-label` and a tooltip that names the action.
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


## Run Trajectory Order

- The trajectory list renders newest first: turns descending, the atoms inside
  a turn descending, and `RUN CONTEXT` (the run preamble) last. It mirrors RUN
  HISTORY so the atom that is executing right now is the first row.
- The model from `buildTrajectoryModel` stays chronological. Selection lookups,
  the "latest atom" test, and the lane overview all depend on that order, so
  `orderTrajectoryNewestFirst` is the only place allowed to reverse — never
  sort the model in place.
- The lane overview above the list remains a left-to-right timeline.

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
