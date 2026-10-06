---
name: astro-trace
description: Use when inspecting, verifying, or troubleshooting coding-agent session traces captured by ASTRO — finding the events.jsonl for a run, reading the local trace API, starting or checking the dashboard, importing Codex history, or diagnosing why an agent session was not recorded. Covers all captured clients (ZCode, Claude Code, Codex, OpenCode, Trae, WorkBuddy, DeepSeek).
---

# ASTRO trace inspection

ASTRO (Agent State Trace & Runtime Observations) is a local-first
observability app for coding-agent traces. Capture plugins append canonical
JSONL events per session; this skill locates, reads, and verifies that data.
Nothing is uploaded; all data stays under the ASTRO data root.

## Data layout

Every captured session is one directory with one `events.jsonl`:

```text
<ASTRO_HOME>/<source>/YYYY/MM-DD/HH_mm_ss-<sessionId>/events.jsonl
```

- `ASTRO_HOME` defaults to `~/.astrox` (override with `ASTRO_HOME` / `AOT_HOME`,
  or `ASTRO_TRACE_DIR` for a per-project trace root).
- `source` is the lowercase client name: `zcode`, `claude`, `codex`,
  `opencode`, `trae`, `workbuddy`, `deepseek`, `browser`.
- Session directory names use underscores in the time part
  (`HH_mm_ss-<sessionId>`), never colons.
- Each JSONL line is one immutable `TraceEvent` (schemaVersion 2): `eventName`
  (`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`,
  `PostToolUseFailure`, `PermissionRequest`, `AgentMessage`, `Stop`, …),
  `source`, `sessionId`, `cwd`, `toolName`, `capturedAt`, and a redacted
  `payload`. Raw client payloads keep their native fields (for example ZCode
  hooks send `hookEventName`, `toolCallId`, `responseText`) — never rewrite
  persisted events; derive status, duration, and topology at read time.

Find the newest trace for a source:

```bash
find ~/.astrox/zcode -name events.jsonl -print | sort | tail -1
tail -n 1 ~/.astrox/zcode/YYYY/MM-DD/HH_mm_ss-<sessionId>/events.jsonl
```

## Local server and dashboard

The server (default `http://127.0.0.1:4318`, override with `ASTRO_PORT`)
watches every source directory and streams updates over SSE:

- `GET /api/health` — source of truth for `dataRoot`, `traceFiles`,
  `eventCount`, and `clientCount`. If a hook event seems missing, compare the
  health `dataRoot` with the `ASTRO_HOME` the hook resolved before anything
  else.
- `GET /api/stream` — SSE: first `reset` (full snapshot) then `ready`, later
  writes arrive as `trace` events.

Start the dashboard manually from a source checkout with
`ASTRO_HOME="$HOME/.astrox" pnpm start`, or from an installed runtime with
`node ~/.astrox/plugins/astro/server/server.mjs`. Capture hooks start it
automatically on `SessionStart`/`UserPromptSubmit` unless
`ASTRO_AUTO_OPEN=0`; a PID file at `<ASTRO_HOME>/dashboard-<port>.pid`
prevents duplicate processes.

## CLI

The `astro-trace` binary (repository `bin/astro.mjs`) supports:

- `astro-trace doctor` — reports resolved paths and configuration validity
  without printing configured values. Run it after config changes.
- `astro-trace import-codex` — idempotent import of existing Codex rollout
  JSONL; unchanged re-imports add nothing.
- `astro-trace migrate` — one-time migration of legacy flat event files into
  the per-session directory layout.

## Diagnosing missing capture

1. Confirm the client integration exists at all: `zcode plugins list`,
   `claude plugin list`, or the matching client equivalent.
2. Check `<ASTRO_HOME>/<source>/` exists and has fresh session directories;
   only clients that emitted at least one event have data files.
3. Run `curl -s http://127.0.0.1:4318/api/health` and confirm `dataRoot`
   matches the client's `ASTRO_HOME` and `eventCount` increases after a new
   prompt.
4. Recorder failures never block the agent; they write
   `ASTRO event was not recorded (...)` to the client's stderr. Treat that
   line as data loss for that event and fix permissions, disk space, or path
   configuration.
5. ZCode specifics: only seven hook events exist (`SessionStart`,
   `UserPromptSubmit`, `PreToolUse`, `PermissionRequest`, `PostToolUse`,
   `PostToolUseFailure`, `Stop`); `Notification`, subagent, and compaction
   events are not captured for ZCode. The plugin marketplace name is
   `astro-zcode-local` and the shared ASTRO skill is installed by reference in
   `.agents/skills`, not inside the plugin cache.
