# ASTRO for Codex

ASTRO means **Agent State Trace & Runtime Observations**.

Native Codex plugin that records lifecycle events to
`~/.astrox/codex/YYYY/MM-DD/HH_mm_ss-<sessionId>/events.jsonl`. The recorder runs locally, redacts common secret
patterns before persistence, and never sends trace data to a remote service.

## Requirements

- Codex CLI with `codex plugin` support
- Node.js available as `node`
- An ASTRO source checkout

## Build and install

From the repository root:

```bash
pnpm install
pnpm build
pnpm build:native-plugins
codex plugin marketplace add /absolute/path/to/astro
codex plugin add astro@astro-local
```

Start a new Codex session and open `/hooks`. Review and trust the
ASTRO hooks before using the session.

Check the installation:

```bash
codex plugin marketplace list
codex plugin list --json
```

## Configuration

On first use the plugin creates the shared files:

```text
~/.astrox/plugins/astro/config.yaml
~/.astrox/plugins/astro/.env
```

Edit `config.yaml` for normal settings. Put local or sensitive values in
`.env`, then reference them from YAML with `${NAME}` or
`${NAME:-fallback}`. Restart Codex after editing either file.

## Use

Run Codex in the project to observe:

```bash
cd /path/to/workspace
codex
```

Start a new Agent session. The plugin records `SessionStart`, starts the
bundled ASTRO dashboard if needed, and opens the actual local URL with the
current session selected. The first submitted prompt provides a fallback when
the runtime does not emit `SessionStart`.

Set `runtime.autoOpen: false` in the shared `config.yaml` to disable this
behavior. Manual startup from the source checkout remains available:

```bash
pnpm start
```

Select the Codex run in **Run History**. Existing Codex rollout history can be
imported with `pnpm import-codex`.

The plugin captures session start/end, prompts, tool start/result, permission,
compaction, subagent, stop, and interrupt events. The dashboard does not need
to run while Codex is working; the Hook appends JSONL directly.

Verify the data file:

```bash
test -s ~/.astrox/codex/YYYY/MM-DD/HH_mm_ss-<sessionId>/events.jsonl
tail -n 1 ~/.astrox/codex/YYYY/MM-DD/HH_mm_ss-<sessionId>/events.jsonl
```

## Update

After updating the ASTRO checkout, run `pnpm build:native-plugins`, then remove
and add the plugin again so Codex refreshes its cached copy.

```bash
codex plugin remove astro@astro-local
codex plugin add astro@astro-local
```

## Remove

```bash
codex plugin remove astro@astro-local
```

Removing the plugin does not delete captured data under `~/.astrox`.
