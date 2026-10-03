# ASTRO for WorkBuddy / CodeBuddy Code

ASTRO means **Agent State Trace & Runtime Observations**.

This native CodeBuddy plugin records WorkBuddy coding-agent lifecycle events
to:

```text
~/.astrox/workbuddy/YYYY/MM-DD/HH_mm_ss-<sessionId>/events.jsonl
```

The recorder runs locally, redacts common secret patterns before persistence,
and does not send trace data to a remote service.

## Requirements

- WorkBuddy with CodeBuddy Code plugin support
- Node.js available as `node`
- An ASTRO source checkout

## Build

From the repository root:

```bash
pnpm install
pnpm build
pnpm build:native-plugins
```

## Validate and test locally

Use the CodeBuddy Code CLI exposed by your WorkBuddy installation:

```bash
codebuddy plugin validate ./workbuddy-plugin
codebuddy --plugin-dir /absolute/path/to/astro/workbuddy-plugin
```

## Install

Add the repository as a local marketplace and install ASTRO:

```bash
codebuddy plugin marketplace add /absolute/path/to/astro
codebuddy plugin install astro@astro-local --scope user
```

Use `--scope project` for a shared project installation or `--scope local`
for an uncommitted project installation. Restart CodeBuddy Code or start a
new session after installation.

## Configuration

On first use the plugin creates the shared files:

```text
~/.astrox/plugins/astro/config.yaml
~/.astrox/plugins/astro/.env
```

Edit `config.yaml` for normal settings. Put local or sensitive values in
`.env`, then reference them from YAML with `${NAME}` or
`${NAME:-fallback}`. Restart CodeBuddy Code after editing either file.

## Captured states

The plugin captures session, prompt, tool, permission, notification,
subagent, task, context-compaction, elicitation, completion, failure, and
worktree lifecycle events. Permission prompts, elicitation, and rate-limit
failures remain in a waiting state until a later progress or terminal event
is observed.

Set `runtime.autoOpen: false` in the shared `config.yaml` to disable automatic
dashboard startup.

## Remove

```bash
codebuddy plugin uninstall astro@astro-local --scope user
```

Removing the plugin does not delete captured data under `~/.astrox`.
