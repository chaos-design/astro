# ASTRO for ZCode

ASTRO means **Agent State Trace & Runtime Observations**.

Native ZCode plugin that records lifecycle events to
`~/.astrox/zcode/YYYY/MM-DD/HH_mm_ss-<sessionId>/events.jsonl`. The recorder runs locally, redacts common secret
patterns before persistence, and never sends trace data to a remote service.

## Requirements

- ZCode 0.16.9 or newer with plugin support
- Node.js available as `node`
- An ASTRO source checkout

## Build

From the repository root:

```bash
pnpm install
pnpm build
pnpm build:native-plugins
```

This synchronizes the shared recorder, the ZCode adapter, the server, and the
built dashboard into this plugin and aligns the plugin manifest version with
`package.json`.

## ZCode hook surface

ZCode exposes exactly seven hook events, and this plugin registers all of
them: `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PermissionRequest`,
`PostToolUse`, `PostToolUseFailure`, and `Stop`. Events such as
`Notification`, `SubagentStop`, or `PreCompact` are not available in ZCode, so
the capture cannot record them.

Two ZCode hook behaviors shape the hook commands:

- Matchers are case-sensitive regular expressions matched against tool names
  and prompt text. An omitted matcher matches everything; a `"*"` matcher is
  an invalid regular expression and never matches, so this plugin omits
  matchers instead of copying the Claude `"*"` pattern.
- Hook standard output is parsed as a strict JSON schema, and any extra key
  fails validation. The hook commands therefore run the recorder with
  `--quiet`, which keeps standard output empty and reports diagnostics on
  standard error only.

`plugin/zcode-adapter.cjs` normalizes ZCode payloads before persistence:
`toolCallId` becomes the canonical `toolUseId`, `toolInput`/`toolResponse`
become `tool_input`/`tool_response`, and a `Stop` payload with a non-empty
`responseText` is recorded as an `AgentMessage` event followed by the `Stop`
event so the trajectory projection renders the final reply.

## Test locally

Validate the manifest and hooks against the packaged recorder:

```bash
zcode plugins validate ./zcode-plugin
```

## Install

Add the plugin directory as a local marketplace and install the plugin:

```bash
zcode plugins marketplace add /absolute/path/to/astro/zcode-plugin
zcode plugins install astro@astro-zcode-local
```

Or run the installer from the repository root, which also installs the shared
ASTRO skill into `~/.agents/skills` where ZCode discovers it by reference:

```bash
pnpm install-zcode-plugin
```

In the ZCode desktop app the same steps are available under **Plugin
Marketplace → Add → Add Plugin Marketplace**, then **Install** on the ASTRO
entry. Restart ZCode or start a new session after installation.

Check the installation:

```bash
zcode plugins list
zcode skills list
```

## Use

Run ZCode in the project to observe:

```bash
cd /path/to/workspace
zcode
```

Start a session. The plugin records `SessionStart`, starts the bundled ASTRO
dashboard if needed, and opens the actual local URL with the current session
selected on the first prompt. The first submitted prompt provides the
dashboard handoff even when the runtime starts before the hook fires.

Set `runtime.autoOpen: false` in the shared `config.yaml` or export
`ASTRO_AUTO_OPEN=0` to disable this behavior. Manual startup from the source
checkout remains available:

```bash
pnpm start
```

Select the ZCode run in **Run History**.

The plugin captures sessions, prompts, tool calls and failures, permission
requests, agent replies, and stop events. The dashboard does not need to run
while ZCode is working; the hook appends JSONL directly.

Verify the data file:

```bash
test -s ~/.astrox/zcode/YYYY/MM-DD/HH_mm_ss-<sessionId>/events.jsonl
tail -n 1 ~/.astrox/zcode/YYYY/MM-DD/HH_mm_ss-<sessionId>/events.jsonl
```

## Configuration

On first use the plugin creates the shared files:

```text
~/.astrox/plugins/astro/config.yaml
~/.astrox/plugins/astro/.env
```

Edit `config.yaml` for normal settings. Put local or sensitive values in
`.env`, then reference them from YAML with `${NAME}` or `${NAME:-fallback}`.
Restart ZCode after editing either file.

## Update

After updating the ASTRO checkout, run `pnpm build:native-plugins`, then
reinstall the plugin so ZCode refreshes its cached copy:

```bash
zcode plugins uninstall astro@astro-zcode-local
zcode plugins marketplace update astro-zcode-local
zcode plugins install astro@astro-zcode-local
```

## Remove

```bash
zcode plugins uninstall astro@astro-zcode-local
zcode plugins marketplace remove astro-zcode-local
```

Removing the plugin does not delete captured data under `~/.astrox`.
