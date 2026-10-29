# ASTRO Data Definitions Reference

> Scope: the persisted `TraceEvent` model, identity keys, read-time projections,
> and storage layout.
> For full behavioral rules on event semantics, write contracts, and redaction,
> see the ASTRO Event Protocol Reference.

## 1. Glossary

| Term | Definition |
| --- | --- |
| TraceEvent | The smallest persisted fact in ASTRO. Every client signal is normalized into this structure before storage. |
| Session | One continuous agent execution context within a source, identified by `sessionId`. |
| Workspace | The spatial isolation dimension of events, identified by `workspaceId`. |
| Source | The client type that produced the event, e.g. `claude`, `codex`, `workbuddy`. |
| Prompt sub-run | A read-time interval derived by the console from each `UserPromptSubmit`, covering that prompt plus everything before the next one. |
| Execution domain | A grouping the console dynamically creates for each observed executor (main agent or subagent) within a session. |
| Atom | The smallest execution node on the topology graph, folded from atom events or paired tool events. |
| Trajectory | A turn-ordered view linking messages and tool steps. |
| Projection | UI state derived from events at read time (status, duration, topology, trajectory); never persisted or written back. |

## 2. Storage Layout

All clients share a user-level data root, `~/.astrox` by default, overridable
with `--astro-home`:

```text
~/.astrox/
├── <source>/YYYY/MM-DD/HH_mm_ss-<sessionId>/events.jsonl
├── plugins/astro/                       # console server and frontend bundle
│   └── server/server.mjs
└── dashboard-<port>.pid                 # console process marker
```

- Directories are layered by source, date, and session; `<source>` matches the
  event `source` field as a lowercase safe name.
- `events.jsonl` is an append-only JSON Lines file with one `TraceEvent` per line.
- A session directory is never renamed once created; new sessions get new directories.

## 3. TraceEvent Fields

The current `schemaVersion` is `2`. Field semantics and generation rules:

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `schemaVersion` | number | yes | Write protocol version; readers normalize older formats. |
| `id` | string | yes | Unique event ID. UUID for live capture; deterministic hash for Codex history imports. |
| `capturedAt` | ISO 8601 string | yes | Source time or capture time. |
| `source` | string | yes | Normalized source name. |
| `sourceVersion` | string \| null | yes | Source client version, `null` when unknown. |
| `workspaceId` | string | yes | Workspace isolation key; defaults to the first 12 hex chars of the SHA-256 of the absolute `cwd`. |
| `sessionId` | string | yes | Source-side session ID; `unknown-session` when unavailable. |
| `turnId` | string \| null | yes | Source-side turn ID, `null` without explicit turns. |
| `parentId` | string \| null | yes | Parent agent, subagent, or parent execution relation ID. |
| `eventName` | string | yes | Canonical event name; unknown names are preserved verbatim. |
| `nativeEventName` | string | yes | The source's original event name. |
| `toolUseId` | string \| null | yes | Correlation key between a tool start and its result. |
| `toolName` | string \| null | yes | Tool, function, or source item type. |
| `cwd` | string \| null | yes | Working directory or browser context URL when the event happened. |
| `status` | string \| null | yes | Source status; when absent, inferred from the canonical event name as `failed` (`PostToolUseFailure`, `StopFailure`) or `interrupted` (`Interrupt`). |
| `sequence` | number \| null | yes | Optional source sequence, `null` when unreliable. |
| `payload` | object | yes | Redacted source payload plus supplemental fields. |
| `locator` | string | yes | Copyable reference: `trace://source/session/event`. |

## 4. Identity Keys

| Key | Composition | Purpose |
| --- | --- | --- |
| Event ID | UUID or deterministic hash | Deduplication and single-event lookup. |
| Session key | `source::workspaceId::sessionId` | Frontend session isolation; `sessionId` alone would leak across platforms. |
| Workspace key | `workspaceId` | Workspace-level aggregation. |
| Tool pairing key | `toolUseId` | Folds `PreToolUse` with `PostToolUse` / `PostToolUseFailure` into one trajectory step. |
| Locator | `trace://source/session/event` | Human-readable cross-system reference. |

## 5. Source Normalization

| Input contains | Canonical source |
| --- | --- |
| `claude` | `claude` |
| `codex` or `openai` | `codex` |
| `deepseek` or exact `dsh` | `deepseek` |
| `workbuddy` or `codebuddy` | `workbuddy` |
| `trae` | `trae` |
| `browser`, `chrome`, or `extension` | `browser` |
| anything else | a custom source name limited to `a-z0-9._-` |

## 6. Canonical Event Types

17 core event types are currently recognized:

| Category | Event | Meaning |
| --- | --- | --- |
| Session | `SessionStart` | Session runtime created or first observable. |
| Session | `SessionEnd` | Session explicitly ended. |
| Session | `Interrupt` | Session or turn aborted, cancelled, or interrupted. |
| Interaction | `UserPromptSubmit` | User submitted one turn of input. |
| Message | `AgentMessage` | Intermediate or final visible agent message. |
| Message | `Reasoning` | Reasoning summary or update. |
| Tool | `PreToolUse` | Tool call started. |
| Tool | `PostToolUse` | Tool call returned successfully. |
| Tool | `PostToolUseFailure` | Tool call returned with a failure. |
| Interaction | `PermissionRequest` | Permission or confirmation requested. |
| Interaction | `Elicitation` | Waiting for structured user input. |
| Interaction | `ElicitationResult` | Requested user input received. |
| Signal | `Notification` | Runtime notice that fits no other semantics. |
| Subagent | `SubagentStart` | Subagent started executing. |
| Subagent | `SubagentStop` | Subagent finished and returned. |
| Turn | `Stop` | Current answer or turn completed. |
| Turn | `StopFailure` | Current answer stopped by a runtime or API fault. |

## 7. Read-Time Projections

### 7.1 Event-derived Status

| Status | Trigger |
| --- | --- |
| `active` | `SessionStart` / `UserPromptSubmit`, or execution progress after `waiting` / `failed`. |
| `waiting` | Permission request, user question, rate limiting, backoff, or explicit wait signal. |
| `failed` | Failure signal, held until progress, a new prompt, or terminal evidence. |
| `complete` | `Stop` (ends the current answer only). |
| `terminated` | `Interrupt`, `SessionEnd`, or equivalent termination evidence. |

Exception precedence is **termination > waiting > failure > stop > recovery**:
tool failures and user rejections are recoverable `failed` states, turn-level
failures (`StopFailure`, `Stop` + `failed`) and aborts are terminal, and
throttled failures derive `waiting`. Full boundaries, per-client entry points,
and payload rules live in the event protocol reference §4.1; the read-model
classifier is `src/lib/exception-events.ts`.

### 7.2 Prompt Sub-runs

Each `UserPromptSubmit` derives a prompt sub-run covering that prompt plus every
event before the next one; the first is classified `initial`, later ones
`follow-up`. Sub-runs are read-time projections and add no protocol fields.

### 7.3 Duration and Timeout

A completed run's duration is the last event minus the first. For `active` /
`waiting` sub-runs the live candidate is
`max(recorded span, now - start)` compared against `appTimings.activeRunTimeoutMs`
(24 hours by default): at or beyond the threshold the effective status becomes
`terminated` and the duration is capped. Timeout is a UI-only projection; no
events are added and stored state is untouched.

## 8. Ordering and Deduplication

- Within a file, append order is preserved; cross-file aggregation sorts by
  `capturedAt` then `id`.
- The session model sorts same-timestamp events by `sequence`.
- Deduplication is by `id`; an existing ID is never appended twice.
- Never deduplicate by message text, and never assume `sequence` values are
  comparable across sources.

## 9. Evolution Constraints

- `events.jsonl` is append-only; written events are immutable.
- Read-time projections (status, duration, topology, trajectory, timeout) never
  write back to events nor add persisted records.
- Field evolution goes through `schemaVersion`; readers stay backward compatible.
