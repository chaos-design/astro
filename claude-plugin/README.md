# ASTRO for Claude Code

ASTRO means **Agent State Trace & Runtime Observations**.

Native Claude Code plugin that records lifecycle events to
`~/.astrox/claude/YYYY/MM-DD/HH_mm_ss-<sessionId>/events.jsonl`. The recorder runs locally, redacts common secret
patterns before persistence, and never sends trace data to a remote service.

## Requirements

- Claude Code with plugin support
- Node.js available as `node`
- An ASTRO source checkout

## Build

From the repository root:

```bash
pnpm install
pnpm build
pnpm build:native-plugins
```

This synchronizes the shared recorder, server, and built dashboard into this
plugin and aligns the plugin manifest version with `package.json`.

## Test locally

Validate the manifest and execute every declared Hook against the packaged
recorder:

```bash
claude plugin validate ./claude-plugin
pnpm validate:claude-hooks
```

Load the plugin directly for one Claude Code session:

```bash
claude --plugin-dir /absolute/path/to/astro/claude-plugin
```

## Install

Add this repository as a local marketplace and install the plugin:

```bash
claude plugin marketplace add /absolute/path/to/astro
claude plugin install astro@astro-local --scope user
```

Use `--scope project` for shared project configuration or `--scope local` for
an uncommitted project installation. Restart Claude Code or start a new
session after installation.

Check the installation:

```bash
claude plugin list
```

## Configuration

On first use the plugin creates the shared files:

```text
~/.astrox/plugins/astro/config.yaml
~/.astrox/plugins/astro/.env
```

Edit `config.yaml` for normal settings. Put local or sensitive values in
`.env`, then reference them from YAML with `${NAME}` or
`${NAME:-fallback}`. Restart Claude Code after editing either file.

## Use

Run Claude Code in the project to observe:

```bash
cd /path/to/workspace
claude
```

Start a new Agent session. The plugin records `SessionStart`, starts the
bundled ASTRO dashboard if needed, and opens the actual local URL with the
current session selected. The first submitted prompt provides a fallback when
the runtime does not emit `SessionStart`.

Set `runtime.autoOpen: false` in the shared `config.yaml` to disable this
behavior.
Manual startup from the source checkout remains available:

```bash
pnpm start
```

Select the Claude Code run in **Run History**.

The plugin captures sessions, prompts, tool results and failures, permissions,
notifications, subagents, compaction, and stop events. The dashboard does not
need to run while Claude Code is working; the Hook appends JSONL directly.

Verify the data file:

```bash
test -s ~/.astrox/claude/YYYY/MM-DD/HH_mm_ss-<sessionId>/events.jsonl
tail -n 1 ~/.astrox/claude/YYYY/MM-DD/HH_mm_ss-<sessionId>/events.jsonl
```

## Update

After updating the ASTRO checkout, run `pnpm build:native-plugins`, then
reinstall the plugin so Claude Code refreshes its cached copy.

```bash
claude plugin uninstall astro@astro-local --scope user
claude plugin install astro@astro-local --scope user
```

## Remove

```bash
claude plugin uninstall astro@astro-local --scope user
```

Removing the plugin does not delete captured data under `~/.astrox`.
