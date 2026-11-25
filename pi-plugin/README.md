# ASTRO Pi Agent Capture

A zero-dependency [Pi](https://github.com/badlogic/pi-mono) extension that
records Pi coding-agent sessions into ASTRO's local event stream, so Pi runs
appear in the same console, search, and replay surfaces as every other
supported client.

## How it works

Pi auto-discovers extensions from `~/.pi/agent/extensions/` (global) and
`.pi/extensions/` (project-local) and loads them with jiti, so TypeScript
works without a build step. The extension maps Pi's extension events onto the
ASTRO canonical event protocol:

| Pi event | ASTRO event |
| --- | --- |
| `session_start` | `SessionStart` |
| `input` → `before_agent_start` | `UserPromptSubmit` |
| `message_end` (assistant) | `Reasoning`, `AgentMessage`, then `Stop` / `StopFailure` / `Interrupt` by `stopReason` |
| `tool_call` | `PreToolUse` |
| `tool_result` | `PostToolUse` / `PostToolUseFailure` |
| `user_bash` | `Notification` |
| `model_select` | `Notification` |
| `session_before_compact` / `session_compact` | `PreCompact` / `PostCompact` |
| `session_shutdown` | `SessionEnd` |

Prompt runs pair `input` with `before_agent_start`, so slash commands and
other non-agent inputs never create prompt runs. Events are batched (150 ms),
secret-redacted by the shared recorder, and appended under
`~/.astrox/pi/YYYY/MM-DD/HH_mm_ss-<sessionId>/events.jsonl`; the local
dashboard launches automatically when needed.

## Install

```bash
pnpm install-pi-plugin
```

The installer copies the extension to `~/.pi/agent/extensions/astro-trace/`
together with the shared recorder, so the installed copy is self-contained and
independent of the ASTRO repository location. Restart Pi (or start a new
session) to activate it. `--pi-home=<dir>` redirects the install for testing.

## Sessions and claims

A session is recorded by exactly one live extension instance. Pi sessions are
resumable, so claim files under `~/.astrox/pi/.claims/` store the owning pid;
a later Pi process takes a session over only after the previous owner has
exited. This keeps resumed sessions recording instead of going silent after
the first Pi process ends.

## Scope notes

- `message_start` / `message_update` drive throttled in-flight
  `AgentMessage{streamed:true}` snapshots (one per 800ms per message) so the
  console shows the text while the step is still running; `message_end` then
  writes the single complete message. The update's accumulated text is read
  first, so every snapshot is a prefix of that final text. These updates stay
  unmapped in `mapping.ts`; the accumulation lives in `index.ts`.
- Turn markers and tool execution progress are intentionally unmapped:
  `tool_call` / `tool_result` already cover the tool lifecycle.
- Event payloads are read defensively, so Pi updates that add fields keep
  working; capture fails open and never blocks the agent loop.
