# ASTRO User Manual

> Default URL: `http://127.0.0.1:4318`
>
> Default data root: `~/.astrox` for all clients
>
> Scope: this manual uses the PC desktop console as its default and only interface context.

## 1. What It Does

**ASTRO** means **Agent State Trace & Runtime Observations**. It is unrelated
to the Astro web framework.

ASTRO captures, inspects, and replays coding-agent runtime events on the local machine. Typical uses include:

- reviewing prompts, model activity, tools, notifications, and final responses in one run;
- understanding tool execution, observations, memory, quality gates, and output through an execution topology;
- inspecting tool input, output, duration, and raw payload;
- replaying a historical session to locate the state before a failure;
- using one event model across Trae, Claude Code, Codex, DeepSeek Harness, WorkBuddy, browser clients, and custom integrations;
- importing, exporting, and sharing one run as JSONL.

![ASTRO desktop console](assets/astro-desktop.png)

Both side panels are open in the screenshot. The four primary regions are:

| Region | Visible information | Supported actions |
| --- | --- | --- |
| Left `RUNS` | Source, session, initial and follow-up prompt runs, event count, status, and duration | Expand prompt runs, switch sessions, and isolate one turn |
| Center canvas | Execution Topology or Run Trajectory, atom states, domain boundaries, and routed edges | Switch platform and view, enable Deep View, select or locate atoms, and open Flow Guide |
| Right `EVENTS` | Time-ordered event log plus Overview, Input, Output, and Raw JSON for the selection | Search events, locate an event, inspect tool arguments and results, and read the normalized payload |
| Replay footer | Current event position, progress, and Live state | Restart, step backward, play or pause, step forward, seek, and change playback speed |

Cyan marks the current selection, violet marks running state, teal marks
completion, and red marks failure or termination. Edge color and line style
distinguish execution, data, feedback, and persistence relationships; Flow Guide
contains the complete legend.

## 2. Requirements

- A current Node.js LTS release with native ESM support;
- `pnpm` activated through Corepack;
- A browser with ES modules, Web Workers, SSE, ResizeObserver, and modern CSS;
- An available loopback port, starting with `127.0.0.1:4318`.

## 3. Install and Start

Recommended:

```bash
corepack enable
pnpm install
pnpm typecheck
pnpm build
pnpm start
```

The server prints its actual URL and data root. If port `4318` is occupied, it
automatically tries later ports, up to 20 additional values. This path runs the
production build or supports manual service management. Direct hook installation
starts and opens the dashboard immediately; `SessionStart` ensures it is open
for each new Agent session.

Development mode uses separate API and Vite processes. Vite reads the same
`ASTRO_HOST/ASTRO_PORT` environment and defaults to `127.0.0.1:4318`:

```bash
# Terminal 1: API
ASTRO_HOME="$HOME/.astrox" pnpm start

# Terminal 2: frontend
pnpm dev
```

For another API port such as `4320`, set the same `ASTRO_PORT` for both processes.

## 4. Quick Start

### 4.1 Explore the Demo

In `pnpm dev` development mode, the console renders an embedded Demo session
when the real event count is zero. This exercises topology, trajectory,
inspection, and replay without installing hooks. Test mode follows the same policy.

The production output from `pnpm build` never shows Demo data. With no real
events it preserves a truthful empty state.

### 4.2 Capture Agent Activity

Run these commands from the ASTRO repository after completing the
build in section 3.

For native plugin installation, first synchronize the embedded recorders,
server, and built dashboard:

```bash
pnpm build:native-plugins
```

Then install the Codex plugin through the repository marketplace:

```bash
codex plugin marketplace add /absolute/path/to/astro
codex plugin add astro@astro-local
```

Claude Code can load its native package directly:

```bash
claude --plugin-dir /absolute/path/to/astro/claude-plugin
```

It can also be installed through the repository marketplace:

```bash
claude plugin marketplace add /absolute/path/to/astro
claude plugin install astro@astro-local --scope user
```

The sections below describe the direct Hook installer, which remains useful
for Trae and environments where native plugin installation is unavailable.

#### 4.2.1 Codex

Install the current-user hook in `$CODEX_HOME/hooks.json`:

```bash
pnpm install-plugins -- --clients=codex
```

For a non-default Codex home:

```bash
pnpm install-plugins -- --clients=codex --codex-home=/path/to/.codex
```

Restart Codex, run `codex` from the project to observe, and create a new
session. Live events are appended to `~/.astrox/codex/YYYY/MM-DD/HH_mm_ss-<sessionId>/events.jsonl`. Import
existing active and archived rollout files with:

```bash
pnpm import-codex
```

#### 4.2.2 Claude Code

Install project-local hooks:

```bash
pnpm install-plugins -- \
  --clients=claude \
  --scope=project \
  --target=/absolute/path/to/workspace
```

This writes `<workspace>/.claude/settings.local.json`. Install for every
project owned by the current user with:

```bash
pnpm install-plugins -- --clients=claude --scope=user
```

The user-scoped configuration is `~/.claude/settings.json`. Restart Claude
Code, run `claude` from the observed project, and create a new session. Events
are appended to `~/.astrox/claude/YYYY/MM-DD/HH_mm_ss-<sessionId>/events.jsonl`.

#### 4.2.3 DeepSeek Harness

After installing the official `dsh` launcher, add the ASTRO bundle to the
profile you want to observe:

```bash
pnpm install-plugins -- --clients=deepseek --deepseek-profile=web
```

The installer falls back to `npx --yes @deepseek-ai/dsh` when `dsh` is not on
PATH. Use `--dsh-home` for a custom home and `--deepseek-command` for a custom
executable. Restart `dsh web` after installation. Events are appended to
`~/.astrox/deepseek/YYYY/MM-DD/HH_mm_ss-<sessionId>/events.jsonl`.

#### 4.2.4 Trae

Install project-local hooks:

```bash
pnpm install-plugins -- \
  --clients=trae \
  --target=/absolute/path/to/workspace
```

This writes `<workspace>/.trae/hooks.json`. Reopen or reload that workspace
in Trae, then start a new Agent conversation. Events are appended to
`~/.astrox/trae/YYYY/MM-DD/HH_mm_ss-<sessionId>/events.jsonl`.

#### 4.2.5 View the run

By default, installation starts and opens the dashboard immediately. After a
client reload or restart, `SessionStart` records the current Agent session,
checks `<data-root>/dashboard-<port>.pid`, starts the service only when needed,
and opens the selected session. If `4318` is occupied, the browser opens the
selected later port.

To manage the process manually, disable automatic startup and use either
entry point:

```bash
ASTRO_AUTO_OPEN=0 pnpm start
# All clients share the user-level runtime and data root.
node ~/.astrox/plugins/astro/server/server.mjs
```

Select the session in **Run History** and choose the matching platform. Hooks
keep recording while the dashboard is stopped; the dashboard is only required
for the UI and live SSE updates. Set `ASTRO_AUTO_OPEN=0` in the client process
environment to keep prompt-triggered startup disabled.

Install the hook-based clients in one operation with
`pnpm install-plugins`; install the DeepSeek bundle explicitly with
`--clients=deepseek`.
Existing hook commands are preserved. Use `--no-migrate` to skip legacy data
migration or `--astro-home=/path/to/.astrox` to change the data root.

## 5. Console Tour

### 5.1 Header

- Product identity: `ASTRO`.
- Action menu: import, export, and clear.
- `ASTRO EVENT STREAM`: current source and event count.
- Search History: opens global search; `Cmd/Ctrl + K` is the keyboard shortcut.
- Connection state:
  - `accepted`: SSE connected;
  - `offline`: API or SSE unavailable;
  - `demo`: development/test mode is using embedded events because the real count is zero.
- Theme: light, dark, or system; stored in `ASTROX_THEME`.

### 5.2 Global History Search

Open Search History from the header or press `Cmd/Ctrl + K`. It searches every
event already loaded in the browser, not only the currently selected Prompt.
The default time range is the last three hours.

Available filters include:

- 3, 6, 12, or 24 hours, today, yesterday, seven days, or a custom date range;
- one or more Agents;
- one or more run statuses;
- one or more event categories.

Filters combine across groups. Text matching is case-insensitive and supports
exact substrings and ordered fuzzy matches. The result list loads more entries
automatically as it scrolls.

Selecting a result switches to the matching platform when available, selects
the parent Session and Prompt run, opens History and Events, selects the exact
event and mapped atom, exits replay, and locates the topology and LOG rows.
Global History search covers loaded browser data. Server-side `/api/search`
remains a separate API.

### 5.3 Run History

Run History is filtered to the selected agent and, by default, shows the most
recent two days. Scroll to the bottom of the list to reveal one earlier day at
a time; each reveal shows a brief bottom spinner. While the dashboard first
loads events, the list shows a left-side loading indicator before runs appear.

The agent list comes from the toolbar platform dropdown: the configured agents
are listed first and a trailing **Others** catch-all collects runs whose source
is not a configured agent. Selecting a configured agent also switches the
topology platform; selecting **Others** leaves the platform unchanged.

Each parent row represents one session and shows:

- active, complete, or failed status;
- title derived from the first user prompt;
- start time;
- source platform;
- duration; active sessions refresh once per second, default to a 24-hour live
  cap, and become `terminated` when that cap is reached;
- prompt count;
- abbreviated session ID.

Sessions with multiple prompts expand automatically when selected. Their child
rows are labeled `INITIAL` and `FOLLOW-UP 01`, `FOLLOW-UP 02`, and so on.
Each child shows that prompt's title, status, start time, duration, event count,
and abbreviated prompt event ID. A prompt run begins with one
`UserPromptSubmit` and contains every following event before the next prompt.

Click a child row to make that prompt run the active diagnostic scope. Clicking
the parent selects its latest prompt. Only one session thread is expanded at a
time; the child list is capped at 270 px, scrolls independently, and keeps the
selected child visible. The left panel can collapse to a `RUNS` rail to give the
topology more desktop workspace.
The expanded state is stored in `ASTROX_HISTORY_OPEN` and restored after refresh.

### 5.4 Main Workspace

The workspace renders the selected prompt run. It provides:

- **Execution Topology**: semantic atoms grouped into domains;
- **Run Trajectory**: observed steps grouped by turn and Input / Model / Tools lanes.

Toolbar controls:

- platform context: Codex, Claude Code, Trae, and other configured agents,
  plus an **Others** catch-all;
- topology/trajectory switch;
- atom and edge guide;
- all atoms/runtime atoms switch;
- open event panel.

Platform switching does not change raw events. All supported platform contexts
preserve the same stable 27-atom semantics.
The agent dropdown also narrows Run History to the selected agent.
The platform choice is stored in `ASTROX_PLATFORM`.

### 5.5 Event Panel

The upper LOG area:

- orders the newest event first;
- groups rows by turn;
- searches any serialized field in the selected prompt run;
- selects or clears an event by clicking its row;
- locates the mapped atom in the topology;
- provides floating controls for top/bottom scrolling.

The inspector provides:

- `Overview`: state, source, type, time, tool, and call ID;
- `Input`: tool input or prompt;
- `Output`: tool result or response;
- `Raw`: full normalized event;
- copy control for structured JSON.

Selecting a topology atom additionally exposes the atom contract, input/output ports, gate state, and bound event.
The right panel state is stored in `ASTROX_CONSOLE_OPEN`.

### 5.6 Session Status

- `active`: the latest turn has no completion, failure, or termination signal;
  duration updates every second until the configured timeout.
- `complete`: the latest `Stop` is not older than the latest prompt; `Stop` completes only one response.
- `failed`: a failure follows the latest prompt or completion marker.
- `terminated`: an abort, cancellation, `Interrupt`, `SessionEnd`, a newer
  session in the same workspace, or the 24-hour default live timeout ends it.

Timeout termination is an effective UI state. It caps the displayed duration
and stops live animation but does not modify stored events.

A later `UserPromptSubmit` with the same `sessionId` reactivates a completed
session. Follow-up questions continue in that session without a page refresh
and appear as separate child runs. While Live is active, a newly arriving prompt
becomes the selected child automatically. Older child runs remain stable and
can be inspected without receiving later events.

### 5.7 Reading a Timeout in the Console

The same timeout result is applied consistently across the selected diagnostic
scope:

| Surface | Before timeout | At and after timeout |
| --- | --- | --- |
| Session or Prompt status icon | active/waiting color and icon | red `terminated` icon |
| Duration | advances once per second when eligible | fixed at the configured limit |
| Topology | latest active atom and transition may animate | no live transition animation |
| Event log | latest executing row may show a running marker | running marker stops |
| Replay and inspector | available | still available; evidence is not deleted |
| Export | exports original selected events | unchanged |

The timeout does not prove that the external agent process was killed. It means
ASTRO no longer treats that recorded interval as a live execution. Check the
source client and the latest JSONL event when process state matters.

Parent and child rows can differ by design. The Session parent advances only
while its latest Prompt is `active`; a waiting latest Prompt freezes the parent.
The waiting child continues its own duration and can independently reach the
timeout. A historical complete, failed, or terminated run keeps its recorded
duration even when it is longer than the current limit.

## 6. Execution Topology

### 6.1 Nodes

Each node includes:

- idle, running, complete, or failed status;
- matching event or atom-instance count;
- atom label;
- stable atom key;
- turn count where available;
- atom kind or `INFERRED`.

Click a node to select it and synchronize the inspector. Click the same node again to clear selection.

### 6.2 Edges

Edge responsibilities include:

- main execution flow;
- reasoning loop;
- capability invocation;
- record and telemetry flow;
- subagent delegation and return;
- user question or permission interaction.

When the active atom changes, animated particles show the resolved transition path. Selecting an atom highlights directly connected edges.

### 6.3 Full and Runtime Views

The Sparkles control switches between:

- **All atoms**: all 6 domains and 27 atoms;
- **Runtime atoms**: the frequent runtime semantics only.

Use all atoms for architecture, tool internals, or output-quality analysis. Use runtime mode to reduce density during live monitoring.

### 6.4 Atom Guide

The question-mark control opens a guide with:

- edge semantics;
- one tab per domain;
- localized name, stable key, purpose, and I/O counts;
- click-to-locate behavior for every base atom.

## 7. Trajectory View

Trajectory prioritizes observed time order over the complete semantic
architecture and uses only the selected prompt run.

The summary displays:

- turn count;
- step count;
- completed count;
- failed count.

The lane map uses Input, Model, and Tools. The detailed list groups steps by turn and shows event type, summary, timestamp, duration, and status.

Matching `PreToolUse` and `PostToolUse` or `PostToolUseFailure` events with the same `toolUseId` become one tool step. Expand a row to inspect paired input and output.

## 8. Replay

The footer provides:

- restart;
- previous event;
- play/pause;
- next event;
- `0.5x`, `1x`, `2x`, and `4x`;
- `Live` to return to the latest event;
- a range control for direct seeking.

Replay rebuilds the selected prompt run from the prefix ending at the cursor:

- trajectory steps;
- atomic instances;
- always-visible stable edges and their runtime state;
- active atom and transition;
- selected inspector event.

Replay never modifies or appends trace data.

## 9. Import, Export, and Clear

Open the header action menu.

### Import Run

Accepted formats:

- JSON arrays;
- JSONL with one object per line;
- normalized event envelopes;
- raw hook-like payloads.

Imported events remain in browser memory and are not written to server JSONL. Duplicate IDs already imported into the page are ignored.

### Export Run

The selected prompt run is downloaded as:

```text
astro-<source>-<sessionId>-prompt-<number>.jsonl
```

Each line is a complete normalized event from that prompt interval. A session
without `UserPromptSubmit` events falls back to a session-level export named
`astro-<source>-<sessionId>.jsonl`.

### Clear Local Events

After confirmation, the action:

- clears imported events in the page;
- sends `DELETE /api/events` outside demo mode;
- truncates the server JSONL and resets live memory.

The action is destructive. Export any required sessions first.

## 10. Deep Links

The page writes the current selection into:

```text
?source=codex&session=<sessionId>&event=<eventId>
```

Opening the URL selects the matching source, session, containing prompt run,
and event when that trace data exists in the target environment.

## 11. Import Codex History

Import active and archived sessions from the default Codex home:

```bash
pnpm import-codex
```

Import selected rollouts:

```bash
node bin/astro.mjs import-codex /path/to/rollout.jsonl
```

Use another Codex home:

```bash
node bin/astro.mjs import-codex --codex-home=/path/to/.codex
```

Deterministic IDs make unchanged imports idempotent.

## 12. CLI

```text
astro-trace serve
astro-trace install [--target DIR] [--clients trae,claude,codex,deepseek,workbuddy] [--scope user|project]
astro-trace update [--no-deepseek] [--astro-home DIR]
astro-trace doctor [--target DIR] [--scope user|project] [--deepseek-profile NAME]
astro-trace migrate [FILE_OR_DIR] [--astro-home DIR]
astro-trace import-codex [FILE ...] [--codex-home DIR]
astro-trace ingest [FILE] [--source NAME]
```

`astro-trace update` refreshes the already-installed plugin runtime in place
(recorder, `runtime-config`, `storage-paths`, bundled vendor dependencies, the
`dist` and `server` bundles, and the DeepSeek plugin) without touching hook
configurations, `.env`, or captured trace data. Use it after pulling a newer
build; re-run `astro-trace install` only when you also need to refresh hooks
or migrate data.

Ingest generic JSONL from a file:

```bash
node bin/astro.mjs ingest ./trace.jsonl --source custom-agent
```

Ingest from standard input:

```bash
printf '%s\n' \
  '{"sessionId":"s1","eventName":"AgentMessage","payload":{"message":"Done"}}' \
  | node bin/astro.mjs ingest --source custom-agent
```

### 12.1 astrox plugin control

`astrox` is a thin control CLI for the ASTRO plugin: it wraps starting and
stopping the dashboard daemon, refreshing the plugin runtime, and inspecting
status and trace data. Diagnostics, installation, and migration delegate to the
underlying `astro-trace` shown above.

```text
astrox start [--port N] [--host H] [--open] [--no-global] [--bin-dir DIR]
astrox stop
astrox restart
astrox status [--json] [--deepseek-profile web]
astrox info [--json]
astrox update [--no-deepseek]
astrox doctor [options]        run the full astro-trace diagnostics
astrox install [options]       install or refresh hook integrations
astrox migrate [FILE_OR_DIR]   migrate legacy trace data
astrox open                    open the running dashboard in a browser
astrox logs [--lines N]        tail the dashboard log
astrox path                    print ASTRO home, plugin dir, and CLI entry
```

- `start` launches the dashboard daemon (default `127.0.0.1:4318`). It also
  registers this entry as the global `astrox` command: on Unix it symlinks into
  the first writable of `/usr/local/bin`, `~/.local/bin`, or `~/bin`; on Windows
  it writes `%USERPROFILE%\.astrox\bin\astrox.cmd`. An existing symlink already
  pointing at this entry is reused, while one pointing elsewhere is left alone.
  `--no-global` skips registration; `--bin-dir DIR` overrides the candidate
  directories; `--open` opens the browser after launch.
- Once launched, the daemon writes `<ASTRO_HOME>/dashboard-<port>.pid` (with
  `pid` and `url`); the run log lands at `<ASTRO_HOME>/dashboard.log`.
  `logs [--lines N]` tails the last 40 lines by default.
- `stop` sends `SIGTERM` (then `SIGKILL` if needed) to the daemon and clears the
  process; no extra cleanup runs. `restart` is `stop` followed by `start`.
- `status` summarizes the plugin config (config.yaml / .env as OK, WARN, or
  MISSING), the global CLI state, the dashboard run state, and per-client hook
  integrations (codex, claude, workbuddy, trae, deepseek). `--json` emits a
  machine-readable report.
- `info` lists each source's trace file count and byte total (claude, codex,
  copilot, cursor, deepseek, gemini, iflow, llama, opencode, pi, qwen, trae,
  workbuddy, zcode, …) plus the trace root, plugin directory, and global CLI
  path. `--json` behaves the same.
- `update` refreshes the installed plugin runtime in place (equivalent to
  `astro-trace update`); `--no-deepseek` skips the DeepSeek plugin package.

> The control commands require an installed plugin runtime; run `astrox install`
> (or `astro-trace install`) first.

## 13. HTTP API

### 13.1 Health

```bash
curl http://127.0.0.1:4318/api/health
```

### 13.2 Ingest One Event

```bash
curl -X POST http://127.0.0.1:4318/api/events \
  -H 'Content-Type: application/json' \
  -H 'X-Astro-Source: custom-agent' \
  -d '{
    "sessionId": "s1",
    "eventName": "AgentMessage",
    "payload": {
      "message": "Done"
    }
  }'
```

### 13.3 Batch Ingestion

Send a direct array:

```json
[
  {
    "sessionId": "s1",
    "eventName": "SessionStart",
    "payload": {}
  },
  {
    "sessionId": "s1",
    "eventName": "Stop",
    "payload": {
      "message": "Done"
    }
  }
]
```

Or:

```json
{
  "events": []
}
```

### 13.4 Read and Search

```text
GET /api/events
GET /api/events?source=codex&session=<sessionId>
GET /api/events/<eventId>
GET /api/search?q=<query>
GET /api/search?q=<query>&source=codex&session=<sessionId>
GET /api/stream
```

The server search scans nested fields. The current UI LOG search filters only
the selected prompt run, or the session fallback when no prompt exists, and
does not call `/api/search`.

Every initial or reconnected `/api/stream` connection receives a complete
`reset`, then `ready`, and then new `trace` events. The server advertises a
one-second retry, so follow-up turns emitted during disconnection are repaired by
the reconnect snapshot.

## 14. Browser SDK

```js
import { createAstroClient } from "./plugin/browser-client.js";

const trace = createAstroClient({
  source: "browser",
  workspaceId: "my-extension",
});

await trace.startSession({ extension: "my-extension" });
await trace.submitPrompt("Inspect the current page");

const call = await trace.startTool(
  "querySelector",
  { selector: "main" },
);

await trace.finishTool(
  "querySelector",
  call.toolUseId,
  { matches: 1 },
);

await trace.agentMessage("Inspection finished");
await trace.stop({ message: "Done" });
```

The default endpoint is `http://127.0.0.1:4318/api/events`. Browser extension background processes must declare loopback host permission.

## 15. Configuration

Installation creates the shared active files under the installed plugin:

```text
<ASTRO_HOME>/plugins/astro/config.yaml
<ASTRO_HOME>/plugins/astro/.env
```

`config.yaml` contains normal typed settings. `.env` contains local or
sensitive values and may be referenced from YAML with `${NAME}` or
`${NAME:-fallback}`. The repository's `config.example.yaml` and `.env.example`
are source templates; they do not directly configure an installed plugin.

The existing environment names remain supported as overrides:

| Variable | Default | Meaning |
| --- | --- | --- |
| `ASTRO_HOST` | `127.0.0.1` | Bind address |
| `ASTRO_PORT` | `4318` | Preferred port |
| `ASTRO_HOME` | `~/.astrox` | Runtime, plugins, and source-specific event files |
| `ASTRO_TRACE_DIR` | unset | Optional relative or absolute shared trace directory |
| `ASTRO_PROJECT_DIR` | current working directory | Base for a relative `ASTRO_TRACE_DIR` |
| `ASTRO_MAX_BODY_BYTES` | `5242880` | Maximum POST body size |
| `ASTRO_AUTO_OPEN` | `1` | Start and open the dashboard during installation or Agent startup; set `0` to disable |
| `DSH_HOME` | `~/.dsh` | DeepSeek Harness profiles and plugins |
| `DSH_COMMAND` | `dsh` | DeepSeek Harness launcher |
| `CODEBUDDY_HOME` | `~/.codebuddy` | WorkBuddy / CodeBuddy Code settings and plugins |
| `CODEBUDDY_COMMAND` | `codebuddy` | WorkBuddy / CodeBuddy Code CLI used by diagnostics |

`AOT_HOME`, `AGENT_TRACE_*`, and `TRAE_TRACE_*` remain supported only as
deprecated upgrade fallbacks.

Precedence is explicit CLI option, inherited process environment, plugin
`.env`, `config.yaml`, then built-in defaults. `ASTRO_HOME` must be supplied
before installation because it locates the plugin and cannot be set in the
plugin's own `.env`.

The installer creates both files on first installation and preserves them on
upgrade. Edit them directly and restart the Agent or ASTRO process:

```bash
$EDITOR ~/.astrox/plugins/astro/config.yaml
$EDITOR ~/.astrox/plugins/astro/.env
astro-trace doctor
```

The build-time frontend constant `appTimings.activeRunTimeoutMs` in
`src/config/app-config.ts` controls the live timeout and defaults to
`24 * 60 * 60 * 1_000`. After changing it, run `pnpm build` and restart the
static service. Existing JSONL needs no migration because the value controls
only effective display state.

### 15.1 Browser-local Preferences

| Key | Values | Purpose |
| --- | --- | --- |
| `ASTROX_THEME` | `light` / `dark` / `system` | Theme |
| `ASTROX_PLATFORM` | `codex` / `claude` / `trae` | Platform context |
| `ASTROX_HISTORY_OPEN` | `true` / `false` | Left History panel |
| `ASTROX_CONSOLE_OPEN` | `true` / `false` | Right Events/Inspector panel |

Legacy `astro-theme` and `astro-platform` values migrate automatically and
are removed after the new key is written. Invalid or unavailable storage falls
back to defaults without affecting capture.

### 15.2 Upgrade from the previous data layout

The old product used `~/.astrox` and, in earlier builds, a project-local
`.agent-trace/events.jsonl`. The direct Hook installer copies both layouts
into `~/.astrox` unless `--no-migrate` is supplied. Native plugin installation
does not run repository migration scripts. Existing
`HH:mm:ss-<sessionId>` directories are renamed to
`HH_mm_ss-<sessionId>` during migration.

Run migration manually when needed:

```bash
node bin/astro.mjs migrate
node bin/astro.mjs migrate ~/.astrox
node bin/astro.mjs migrate /path/to/.agent-trace
node bin/astro.mjs migrate /path/to/events.jsonl
```

Migration is idempotent: existing event IDs are skipped. Imported source files
are retained; a legacy time-formatted directory is removed only after a
successful rename or conflict-safe merge. Verify before removing or archiving
old imported data:

```bash
find ~/.astrox -type f -name events.jsonl -print
curl http://127.0.0.1:4318/api/health
```

## 16. Data Safety and Backup

- The service binds to loopback by default.
- Trace data is stored only in local JSONL by default.
- Sensitive key names and common secret patterns are redacted before persistence.
- Keep `~/.astrox` outside project repositories.
- Review `payload` manually before sharing because rule-based redaction cannot recognize every domain-specific secret.
- Back up `~/.astrox` for complete sessions, or export selected prompt runs
  through the UI.

Do not expose the service through `0.0.0.0` or a public network without authentication and TLS.

## 17. Troubleshooting

### The UI Shows Demo

Demo is expected only in development/test mode when the real event count is zero.
A production empty state remains empty. Demo in production usually means the page
is using a Vite development server or a stale build.

```bash
curl http://127.0.0.1:4318/api/health
curl http://127.0.0.1:4318/api/events
```

### Connection State Is Offline

Verify the service URL and `/api/stream`. In development, ensure the Vite proxy target matches the API port.

### The Dashboard Does Not Open After the First Prompt

Confirm hooks were installed after `pnpm build` or
`pnpm build:native-plugins`, and verify the installed package contains
`dist/index.html` and `server/server.mjs`. All clients use
`~/.astrox/plugins/astro`. If the recorded process no longer exists, remove
`<data-root>/dashboard-<port>.pid` and submit another prompt.
`ASTRO_AUTO_OPEN=0` intentionally disables automatic startup.

### Agent Runs but No Events Appear

Check:

1. The relevant client hook file exists.
2. The configured `trace-recorder.cjs` path is valid.
3. Hook and server resolve the same `ASTRO_HOME` or `ASTRO_TRACE_DIR`.
4. The session started after hook installation.
5. The JSONL file is receiving new lines. For Trae, check
   `~/.astrox/trae/YYYY/MM-DD/HH_mm_ss-<sessionId>/events.jsonl`.
6. `/api/health.dataRoot` and `traceFiles` point to the same root.
7. Hook stderr does not report `ASTRO event was not recorded`, which indicates persistence failure rather than UI delay.

### The First Turn Appears but Follow-ups Do Not

`Stop` completes a response and must not remove the hook. Verify:

1. Two prompts are submitted in the same live Agent session.
2. The JSONL line count grows and repeated text still receives distinct event IDs.
3. Hook and service resolve the same `ASTRO_HOME`.
4. SSE reconnect begins with a full `reset` containing every turn.
5. The workspace or client was reloaded after hook configuration changed.

### Codex Imports Appear Duplicated

Unchanged files are idempotent. A changed path, row order, or row content changes deterministic IDs and may create new events.

### Topology Remains in the Routing State

Large subagent topologies require more routing work. Check the browser console for Worker errors. The main-thread fallback may briefly block rendering.

### UI and API Search Differ

LOG search is active-session only. `/api/search` scans the selected server-side scope.

### Data Reappears After Clear

A running hook may continue appending events. Also verify that browser-memory imports were cleared.

### A Run Shows Terminated but Has No Termination Event

Compare its displayed duration with `appTimings.activeRunTimeoutMs`. Reaching
the live limit derives `terminated` without adding an event. Inspect the Raw tab
or exported JSONL to distinguish this case from `Interrupt`, `SessionEnd`,
cancel, or abort evidence. A capped duration equal to the configured limit is
the expected timeout signature.

## 18. Verification and Maintenance

Run after changes or before release:

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm build:native-plugins
```

The current automated suite contains 182 tests across the event model, hooks,
continuous turns, SSE reconnects, storage, migration, projection, routing,
preference persistence, environment boundaries, and Vite proxy configuration.

Manual checks:

- desktop panel collapse and expansion;
- no overlap across the three-column workspace, toolbar, and replay footer at `1440 × 900`;
- topology and trajectory views;
- all platform contexts;
- prompt hierarchy expansion, child selection, bounded scrolling, and Live follow;
- replay, seeking, and speed controls;
- import and export;
- SSE increments and reset after truncation;
- atom/log selection and inspector synchronization;
- dark, light, and system themes.
- persisted History, Events, theme, and platform choices after refresh;
- active duration ticking, 24-hour capping, and timeout termination;
- exact threshold behavior at one millisecond before, exactly at, and after the
  configured limit;
- waiting child timeout, frozen waiting parent, and preservation of historical
  terminal durations;
- production empty state without Demo;
- reconnect reset repairing events emitted while offline.

See the [Event Protocol Reference](event-protocol-en.md) for the full schema and
[Operations and Troubleshooting](operations-en.md) for permissions, backup,
recovery, upgrades, and incident procedures.
