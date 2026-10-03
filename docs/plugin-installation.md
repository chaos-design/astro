# ASTRO Plugin

ASTRO means **Agent State Trace & Runtime Observations**.

This package installs local trace integrations for Trae, Claude Code, Codex,
DeepSeek Harness, and WorkBuddy / CodeBuddy Code.
It does not upload trace data. Portable runtimes bundle the configuration
parsers they need and do not fetch dependencies while an Agent Hook runs.

## Before installation

1. Install a current Node.js LTS release compatible with the package manifest.
2. Install `pnpm` and verify it with `pnpm --version`.
3. Build the dashboard and native plugin runtime:

```bash
cd /absolute/path/to/astro
pnpm install
pnpm typecheck
pnpm build
pnpm build:native-plugins
```

4. Choose one integration per client. Do not install both the native plugin
   and direct hooks for the same Codex, Claude Code, or WorkBuddy environment,
   because both receive the same lifecycle events.

5. Confirm the client process can write the data root. The default is
   `~/.astrox`; Codex direct-hook installation also needs write access to
   `$CODEX_HOME` (normally `~/.codex`). Sandboxed IDEs may require these
   directories to be added to their explicit write allowlist.

## Native client plugins

Build the self-contained recorder, server, and dashboard copies used by the
native plugins:

```bash
pnpm build:native-plugins
```

### Codex plugin

The Codex package lives in `codex-plugin/` and is listed by
`.agents/plugins/marketplace.json`.

```bash
codex plugin marketplace add /absolute/path/to/astro
codex plugin add astro@astro-local
```

Start a new session, open `/hooks`, and trust the ASTRO hooks.
Codex requires explicit trust when a plugin installs or changes command hooks.

Verify discovery and installation:

```bash
codex plugin marketplace list
codex plugin list --json
```

Remove the plugin:

```bash
codex plugin remove astro@astro-local
```

### Claude Code plugin

The Claude Code package lives in `claude-plugin/` and is listed by
`.claude-plugin/marketplace.json`. Test it without installation:

```bash
claude --plugin-dir /absolute/path/to/astro/claude-plugin
```

Install it for the current user:

```bash
claude plugin marketplace add /absolute/path/to/astro
claude plugin install astro@astro-local --scope user
```

Available scopes:

| Scope | Settings file | Use |
| --- | --- | --- |
| `user` | `~/.claude/settings.json` | All projects for the current user |
| `project` | `<workspace>/.claude/settings.json` | Shared, version-controlled project setup |
| `local` | `<workspace>/.claude/settings.local.json` | Local project setup, normally ignored by Git |

Verify or remove the installation:

```bash
claude plugin list
claude plugin uninstall astro@astro-local --scope user
```

The hook-based native plugins include their own recorder, server, and built dashboard,
and remain independent of the original checkout while capturing. Run
`pnpm build:native-plugins` after changing the recorder, server, frontend, or
package version.

### WorkBuddy / CodeBuddy Code plugin

The WorkBuddy package lives in `workbuddy-plugin/`, uses
`.codebuddy-plugin/plugin.json`, and is listed by
`.codebuddy-plugin/marketplace.json`.

```bash
codebuddy plugin validate ./workbuddy-plugin
codebuddy plugin marketplace add /absolute/path/to/astro
codebuddy plugin install astro@astro-local --scope user
```

Its Hook commands use `${CODEBUDDY_PLUGIN_ROOT}` and write to
`~/.astrox/workbuddy/YYYY/MM-DD/HH_mm_ss-<sessionId>/events.jsonl`.
Permission, elicitation, and rate-limit signals are retained so the console
can distinguish waiting runs from explicit termination.

If WorkBuddy does not expose `codebuddy` on `PATH`, add this repository as a
local marketplace from the CodeBuddy Code plugin UI.

### DeepSeek Harness plugin

DeepSeek Harness uses an installable Cordis bundle rather than command hooks.
The package lives in `deepseek-plugin/` and declares its bundle layer in
`package.json`.

Install it into the standard Web profile:

```bash
pnpm install-plugins -- --clients=deepseek --deepseek-profile=web
```

The installer first copies a self-contained package to
`~/.astrox/plugins/astro/deepseek-plugin`, then runs:

```bash
dsh plugin --profile web add file:~/.astrox/plugins/astro/deepseek-plugin
```

When `dsh` is not on PATH, it falls back to
`npx --yes @deepseek-ai/dsh`. Use `--deepseek-command=/path/to/dsh`,
`--deepseek-profile=<name>`, or `--dsh-home=/path/to/.dsh` to override those
defaults. Restart the profile after installation:

```bash
dsh web
```

Remove the bundle with:

```bash
dsh plugin --profile web remove dsh-astro-plugin
```

## Install hooks directly from the repository

Install dependencies and build the dashboard first:

```bash
pnpm install
pnpm build
```

Install all hook-based clients:

```bash
pnpm install-plugins
```

The installer preserves unrelated hooks and refreshes the shared standalone
runtime in `~/.astrox/plugins/astro` for every client.

## Install and use each client

### Codex

Install for the current user:

```bash
pnpm install-plugins -- --clients=codex
```

The hook configuration is `$CODEX_HOME/hooks.json`, normally
`~/.codex/hooks.json`. Use `--codex-home=/path/to/.codex` when Codex stores its
configuration elsewhere.

Restart Codex, run `codex` in the project to observe, and start a new session.
Live events are written to `~/.astrox/codex/YYYY/MM-DD/HH_mm_ss-<sessionId>/events.jsonl`. To add active and
archived sessions created before hook installation:

```bash
pnpm import-codex
```

### Claude Code

Install only for one project:

```bash
pnpm install-plugins -- \
  --clients=claude \
  --scope=project \
  --target=/absolute/path/to/workspace
```

This updates `<workspace>/.claude/settings.local.json`. Install for every
project owned by the current user with:

```bash
pnpm install-plugins -- --clients=claude --scope=user
```

This updates `~/.claude/settings.json`. Restart Claude Code, run `claude` in
the observed project, and start a new session. Events are written to
`~/.astrox/claude/YYYY/MM-DD/HH_mm_ss-<sessionId>/events.jsonl`.

Validate every declared Claude Hook without making a model request:

```bash
pnpm validate:claude-hooks
```

The validator executes each packaged Hook command with representative stdin,
checks its non-blocking response, and verifies the resulting Claude JSONL.

### WorkBuddy / CodeBuddy Code

Install direct user hooks when the native plugin is not suitable:

```bash
pnpm install-plugins -- --clients=workbuddy --scope=user
```

For project-scoped direct hooks, use `--scope=project`; this writes
`<workspace>/.codebuddy/settings.json`. The user-scoped configuration is
`$CODEBUDDY_HOME/settings.json`, normally `~/.codebuddy/settings.json`.

### Trae

Trae installation is project-scoped:

```bash
pnpm install-plugins -- \
  --clients=trae \
  --target=/absolute/path/to/workspace
```

This updates `<workspace>/.trae/hooks.json`. Reopen or reload the workspace in
Trae, then start a new Agent conversation. Events are written to
`~/.astrox/trae/YYYY/MM-DD/HH_mm_ss-<sessionId>/events.jsonl` by default. The
hook sandbox must allow writes to this user-level data root.

The checked-in hooks use `$HOME/.astrox`. The development API and Vite proxy
both default to port `4318` and read the same directory:
`ASTRO_HOME="$HOME/.astrox" pnpm start`. To use another port, set the same
`ASTRO_PORT` in both the API and `pnpm dev` processes.
After changing hook commands, reload the Trae workspace so existing sessions
use the updated configuration.

### DeepSeek Harness

The DeepSeek plugin listens to the native `session/created`, `session/event`,
and `session/disposed` event stream. It maps prompts, model messages, tool
calls/results, completion, and interruption events into ASTRO while preserving
the original Harness event in each payload. Events are written to
`~/.astrox/deepseek/YYYY/MM-DD/HH_mm_ss-<sessionId>/events.jsonl`.

`Stop` finishes a response, not the recording subscription. Every subsequent
`UserPromptSubmit` and `Stop` is appended to the same session, including repeated
prompt text and answers without tool calls. On each SSE connection or
reconnection, the server sends a complete `reset` snapshot before `ready`,
followed by live `trace` events. Failed hook writes report a diagnostic without
blocking the agent. If a turn is absent, compare the hook's `ASTRO_HOME` with
`GET /api/health`'s `dataRoot` before checking the UI.

## Install the portable archive

Build the package with `pnpm build:plugin`. The generated `.tgz` is placed in
`artifacts/`. Set its absolute path, then use the same client options:

```bash
PLUGIN_TGZ=/absolute/path/to/astro-plugin.tgz

pnpm dlx "$PLUGIN_TGZ" install \
  --clients codex,claude,workbuddy \
  --scope user

pnpm dlx "$PLUGIN_TGZ" install \
  --clients trae \
  --target /absolute/path/to/workspace

pnpm dlx "$PLUGIN_TGZ" install \
  --clients deepseek \
  --deepseek-profile web
```

Use `--no-migrate` to skip automatic legacy data migration. Use
`--astro-home /path/to/.astrox` to override the default `~/.astrox` root.

## Shared configuration

Installation automatically creates:

```text
<ASTRO_HOME>/plugins/astro/config.yaml
<ASTRO_HOME>/plugins/astro/.env
```

The files come from the source package's `config.example.yaml` and
`.env.example`. Reinstalling or upgrading ASTRO preserves the active files, so
user changes are not lost.

Use `config.yaml` for normal server, storage, runtime, and client settings. Use
`.env` for machine-specific or sensitive values and reference them from YAML
with `${NAME}` or `${NAME:-fallback}`. Inherited process variables override
plugin `.env`, and explicit CLI options have the highest priority.

`ASTRO_HOME` locates the plugin itself and cannot be set inside the plugin
`.env`. Use `--astro-home` during installation or export it before installing.

After editing configuration, restart the Agent or ASTRO service and run:

```bash
astro-trace doctor
```

The diagnostic output reports paths and validity without printing configured
values.

## Upgrade

For a source checkout:

```bash
git pull
pnpm install
pnpm typecheck
pnpm build
pnpm build:native-plugins
```

Then reinstall the selected native plugin or rerun `pnpm install-plugins`.
The direct installer is idempotent and updates ASTRO commands without
replacing unrelated hooks. It also renames existing
`HH:mm:ss-<sessionId>` directories to `HH_mm_ss-<sessionId>`.

When upgrading from the previous product name, `pnpm install-plugins` or
`astro-trace install` automatically copies events from both
`<workspace>/.agent-trace/events.jsonl` and
flat project/user-level `.astrox/<source>/events.jsonl` files into
`~/.astrox/<source>/YYYY/MM-DD/HH_mm_ss-<sessionId>/events.jsonl`.
Native marketplace installation does not execute migration scripts; run
`node bin/astro.mjs migrate` once in that case. Existing IDs are skipped and
import source files are not deleted. Legacy time-formatted directories are
removed only after a successful rename or conflict-safe merge.

## Automatic dashboard startup

The installer copies the dashboard into the persistent plugin runtime, starts
it, and opens the page immediately. After reloading or restarting the client,
`SessionStart` records the new Agent session, starts the dashboard when needed,
and opens the actual URL with that source and session selected only on startup.
If the dashboard is already running, the hook reports its URL and asks you to
switch to or refresh the existing tab instead of opening a new one.

A PID file at `<data-root>/dashboard-<port>.pid` prevents later prompts from
starting duplicate processes. Every client defaults to `~/.astrox`. If the preferred port is
occupied, the server tries up to 20 later ports and opens the selected address.

Set `ASTRO_AUTO_OPEN=0` in the client environment to disable this behavior.
For manual startup:

```bash
# All clients share the user-level runtime and data root.
node ~/.astrox/plugins/astro/server/server.mjs
```

Open the URL printed by the process, normally `http://127.0.0.1:4318`, then
select the captured session in **Run History** and choose its matching
platform.

Keep the process running for live browser updates. The hooks continue
appending events locally when the dashboard is not running.

## Verify the installation

For a source installation, inspect the generated configuration and data:

```bash
find ~/.astrox -type f -name events.jsonl -print
tail -n 1 ~/.astrox/codex/YYYY/MM-DD/HH_mm_ss-<sessionId>/events.jsonl
tail -n 1 ~/.astrox/claude/YYYY/MM-DD/HH_mm_ss-<sessionId>/events.jsonl
tail -n 1 ~/.astrox/deepseek/YYYY/MM-DD/HH_mm_ss-<sessionId>/events.jsonl
tail -n 1 ~/.astrox/trae/YYYY/MM-DD/HH_mm_ss-<sessionId>/events.jsonl
```

Only clients that have emitted an event have a data file. The packaged CLI
also checks each CLI, native/direct integration, and session-partitioned data:

```bash
pnpm dlx "$PLUGIN_TGZ" doctor --scope user
```

The expected result is:

- the runtime and dashboard report `OK`;
- the selected client CLI and integration report `OK`;
- a source reports `DATA` after at least one event, including the number of
  discovered session files and their total bytes.

### Verify continuous turns

After installation, submit two prompts in the same client session. A valid
capture contains both prompt/answer pairs in the same `events.jsonl`, even if
the text is identical:

```text
SessionStart
UserPromptSubmit  turn 1
AgentMessage      turn 1
Stop              turn 1
UserPromptSubmit  turn 2
AgentMessage      turn 2
Stop              turn 2
```

Keep `curl -N http://127.0.0.1:4318/api/stream` open during the test. The
first events must be `reset` and `ready`; later writes arrive as `trace`.
Reconnect and confirm the new `reset` includes events emitted while disconnected.
In Run History, expand the session and confirm that the two turns appear as
`INITIAL` and `FOLLOW-UP 01`. Selecting either child must isolate its topology,
trajectory, log, replay, and `-prompt-<number>.jsonl` export.

## How capture works

1. Trae, Claude Code, Codex, or WorkBuddy invokes a command hook with JSON on stdin;
   DeepSeek Harness publishes its native session events to the Cordis plugin.
2. The recorder normalizes the event and redacts common secrets.
3. The event is appended to
   `<data-root>/<agent>/YYYY/MM-DD/HH_mm_ss-<sessionId>/events.jsonl`.
4. On `UserPromptSubmit`, the recorder ensures the local dashboard is running
   and opens it unless `ASTRO_AUTO_OPEN=0`.
5. The local dashboard watches all agent directories and broadcasts updates
   to the browser over SSE.

The package uses each client's hook system because that is the interface that
receives prompts and runtime events. It does not modify model requests or send
captured content to a remote service.

## Data layout

```text
~/.astrox/
  plugins/astro/
    plugin.json
    dist/
    plugin/
      storage-paths.cjs
      trace-recorder.cjs
    server/
  dashboard-4318.pid
  claude/YYYY/MM-DD/HH_mm_ss-<sessionId>/events.jsonl
  codex/YYYY/MM-DD/HH_mm_ss-<sessionId>/events.jsonl
  deepseek/YYYY/MM-DD/HH_mm_ss-<sessionId>/events.jsonl
  trae/YYYY/MM-DD/HH_mm_ss-<sessionId>/events.jsonl
  browser/YYYY/MM-DD/HH_mm_ss-<sessionId>/events.jsonl
```

Agent names are normalized to lowercase before their directory is created.
The recorder redacts common credentials before writing JSONL.

## Permission and path diagnostics

```bash
mkdir -p "$HOME/.astrox"
test -w "$HOME/.astrox"
curl -s http://127.0.0.1:4318/api/health
```

Use the health response as the source of truth:

- `dataRoot` must match the Hook's resolved `ASTRO_HOME` or
  `ASTRO_TRACE_DIR`;
- `traceFiles` must contain the session file that is growing;
- `eventCount` must increase after a new prompt;
- `clientCount` is greater than zero while a dashboard tab has an active SSE connection.

The recorder exits successfully even when observation fails so it cannot block
the Agent. Persistence failures are written to stderr as
`ASTRO event was not recorded (...)`. Treat that message as data loss for the
current event and fix permissions, disk space, or path configuration before
continuing.

For full upgrade, backup, recovery, Demo-environment, and incident procedures,
see [Operations and Troubleshooting](operations-en.md).
