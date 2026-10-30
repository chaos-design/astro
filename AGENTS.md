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

- `isLiveRunStatus` is the single definition of a live run (`active` and
  `waiting`). RUN HISTORY must not invent extra live states.
- A live message is marked on the row (status accent plus a `RUNNING` /
  `WAITING` capsule) and in the panel header (`N LIVE` chip that scrolls the
  first live row into view), so the executing message is findable without
  scrolling.
- Selection styling outranks the live accent; a selected live row keeps its
  selection border.
- Executing runs are pinned to the top of the list, ordered by their latest
  activity, and stay inside the visible day window whatever their `start`
  (`collectLiveRunKeys` → `selectVisibleRunHistory` / `pinLiveRunHistory`). A
  session resumed today began yesterday; without the pin its new prompt would
  sort below every run that merely started later, and with a one-day window it
  would not be listed at all. Finished runs fall back to newest-first order.
- The same live key set drives the pin, the day-window exemption, the `N LIVE`
  count, and the live-only filter. Do not derive a second one — a row that is
  pinned but not counted (or the reverse) reads as a bug.
- "Running again" means a historical session that received a new prompt, even
  days later: it must land in that live key set so the `N LIVE` filter can
  find it. Its clock (see Run Timeout Invariant) is the new prompt's, not the
  session's.
- Finished messages (`complete` / `failed` / `terminated`) do not auto-locate
  the last atom: `getPromptAtomSelection` returns `null` for every non-live
  status, and only an explicit atom pick locates the topology.

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

The repository currently has no separate lint script. Use `git diff --check`
for whitespace validation and keep public helpers covered by focused tests.

When capture or portable plugin sources change, also run:

```bash
pnpm build:native-plugins
pnpm validate:claude-hooks
```
