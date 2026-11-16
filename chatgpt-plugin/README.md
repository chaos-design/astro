# ASTRO for ChatGPT

ASTRO means **Agent State Trace & Runtime Observations**.

Native ChatGPT plugin that records lifecycle events to
`~/.astrox/chatgpt/YYYY/MM-DD/HH_mm_ss-<sessionId>/events.jsonl`. The recorder runs locally, redacts common secret
patterns before persistence, and never sends trace data to a remote service.

## Requirements

- ChatGPT CLI with `chatgpt plugin` support
- Node.js available as `node`
- An ASTRO source checkout

## Build and install

From the repository root:

```bash
pnpm install
pnpm build
pnpm build:native-plugins
chatgpt plugin marketplace add /absolute/path/to/astro
chatgpt plugin add astro@astro-local
```

Start a new ChatGPT session and open `/hooks`. Review and trust the
ASTRO hooks before using the session.

Check the installation:

```bash
chatgpt plugin marketplace list
chatgpt plugin list --json
```

## Configuration

On first use the plugin creates the shared files:

```text
~/.astrox/plugins/astro/config.yaml
~/.astrox/plugins/astro/.env
```

Edit `config.yaml` for normal settings. Put local or sensitive values in
`.env`, then reference them from YAML with `${NAME}` or
`${NAME:-fallback}`. Restart ChatGPT after editing either file.

## Use

Run ChatGPT in the project to observe:

```bash
cd /path/to/workspace
chatgpt
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

Select the ChatGPT run in **Run History**. Existing ChatGPT rollout history can be
imported with `pnpm import-chatgpt`.

The plugin captures session start/end, prompts, tool start/result, permission,
compaction, subagent, stop, and interrupt events. The dashboard does not need
to run while ChatGPT is working; the Hook appends JSONL directly.

Verify the data file:

```bash
test -s ~/.astrox/chatgpt/YYYY/MM-DD/HH_mm_ss-<sessionId>/events.jsonl
tail -n 1 ~/.astrox/chatgpt/YYYY/MM-DD/HH_mm_ss-<sessionId>/events.jsonl
```

## Update

After updating the ASTRO checkout, run `pnpm build:native-plugins`, then remove
and add the plugin again so ChatGPT refreshes its cached copy.

```bash
chatgpt plugin remove astro@astro-local
chatgpt plugin add astro@astro-local
```

## Remove

```bash
chatgpt plugin remove astro@astro-local
```

Removing the plugin does not delete captured data under `~/.astrox`.
