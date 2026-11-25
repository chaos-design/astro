# ASTRO OpenCode Plugin

Records OpenCode sessions into the local ASTRO trace store so they show up in the
ASTRO dashboard next to Claude Code, ChatGPT, Trae, CodeBuddy and DeepSeek runs.

## Install

```sh
pnpm run install-opencode-plugin
```

The script copies this plugin plus the canonical recorder and its vendored
runtime dependencies into `~/.config/opencode/plugins/astro-capture/`. OpenCode
discovers global plugins there automatically, so no `opencode.json` entry is
needed. Re-running the script replaces the installed copy, so it doubles as the
upgrade path. It also removes a stale absolute-path entry from
`opencode.json` if one exists, because the same plugin must not load twice.

Activation: start a new session, or run `opencode service restart`.

Traces land in `$ASTRO_HOME/opencode/YYYY/MM-DD/HH_mm_ss-<session>/events.jsonl`
(`~/.astrox` by default) and the dashboard opens on the first prompt.

## Event mapping

The plugin subscribes to the server event stream (`ctx.event.subscribe`) and maps
OpenCode events onto ASTRO's canonical event names:

| OpenCode event | ASTRO event |
| --- | --- |
| `session.created` | `SessionStart` |
| `session.inbox.enqueued` (user item) | `UserPromptSubmit` |
| `session.step.started` | `Notification` |
| `session.tool.called` | `PreToolUse` |
| `session.tool.success` | `PostToolUse` (status `failed` on non-zero exit) |
| `session.tool.failed` | `PostToolUseFailure` |
| `permission.asked` | `PermissionRequest` |
| `permission.replied` (reject) | `PermissionDenied` |
| `session.reasoning.ended` | `Reasoning` |
| `session.text.ended` | `AgentMessage` |
| `session.step.ended` (`finish: stop`) | `Stop` |
| `session.step.failed` (aborted) | `Interrupt` |
| `session.step.failed` (other) | `StopFailure` |
| `session.execution.failed`, `session.error` | `StopFailure` |
| `session.execution.interrupted` | `Interrupt` |
| `session.deleted` | `SessionEnd` |

Stream deltas, tool progress and usage updates are not mapped as standalone
trace events: they carry no trajectory meaning and would dominate the store.
Assistant text is the exception — `session.text.delta` is accumulated per message
and written as throttled `AgentMessage` snapshots (marked `streamed: true`) so the
console can show what the main agent is saying while it is still executing;
`session.text.ended` still writes the complete value. Reasoning, tool progress and
usage deltas remain unmapped.

## Design notes

- **Ownership.** The event stream is global and OpenCode runs one plugin
  instance per location, so several instances can observe the same session.
  The first instance to create `~/.astrox/opencode/.claims/<session>.claim`
  records that session; the others stay silent. A claim failure other than an
  existing claim fails open, because a duplicated trace is cheaper than a lost
  one. A session is claimed only when an event actually maps to a trace — an
  unmapped event must not lock the session away from the instance that will
  record it. See `claim.ts`.
- **Location.** Durable events (`session.text.*`, `session.step.*`) have no
  location envelope. `opencodeEventDirectory` reads every host spelling
  (`location.directory`, `data.location.directory`, `data.info.location.directory`)
  and remembers it per session, so text from a main session created before the
  plugin loaded is not dropped by the location gate.
- **Tool names.** `session.tool.called` and `session.tool.success` omit the tool
  name; only `session.tool.input.started` carries it, so the plugin remembers it
  per call id and attaches it to the tool events.
- **Terminal dedupe.** A declined tool reports both `session.step.failed` and
  `session.execution.interrupted`; the second identical terminal event is
  dropped, and a new `Notification` (model step) resets the dedupe.
- **Recording path.** The recorder is loaded in-process when the module system
  allows it and events are flushed in one batch every 150 ms; otherwise the
  plugin falls back to spawning `node plugin/trace-recorder.cjs`. Never rely on
  `process.execPath` — inside the OpenCode service it points at the OpenCode
  binary, not at Node.
- **Unmapped by design.** `session.idle` and `session.compaction.*` exist but
  their payloads have not been verified against a real stream, so they are left
  unmapped rather than guessed.

## Tests

```sh
node --test tests/opencode-mapping.test.ts tests/opencode-claim.test.ts
```