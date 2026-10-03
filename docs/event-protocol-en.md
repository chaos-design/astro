# ASTRO Event Protocol Reference

> Protocol version: Schema v2  
> Scope: hook recorder, Codex history import, Browser SDK, HTTP API, JSONL import/export, and frontend projection

## 1. Design Goals

The ASTRO protocol converts lifecycle, message, tool, and subagent signals from different coding agents into one durable event model.

- **Facts first:** standard fields support search and correlation while source detail remains in `payload`.
- **Append only:** one event occupies one JSONL line; normal capture does not rewrite history.
- **Forward compatible:** unknown event names and additional payload fields remain readable.
- **Stable correlation:** sessions, turns, parent/child agents, and tool calls use explicit IDs.
- **Redact before persistence:** common credential fields and secret formats are processed before a write.
- **Local first:** the default root is `~/.astrox`; no remote database is required.

## 2. Canonical Envelope

```json
{
  "schemaVersion": 2,
  "id": "evt-018f5f7f",
  "capturedAt": "2026-09-09T06:30:12.418Z",
  "source": "trae",
  "sourceVersion": null,
  "workspaceId": "58f9d6b37d2a",
  "sessionId": "session-42",
  "turnId": "turn-3",
  "parentId": null,
  "eventName": "PreToolUse",
  "nativeEventName": "PreToolUse",
  "toolUseId": "tool-17",
  "toolName": "exec_command",
  "cwd": "/workspace/example",
  "status": null,
  "sequence": 18,
  "payload": {
    "tool_input": {
      "cmd": "pnpm test"
    }
  },
  "locator": "trace://trae/session-42/evt-018f5f7f"
}
```

### 2.1 Field Reference

| Field | Type | Required | Meaning and generation rule |
| --- | --- | --- | --- |
| `schemaVersion` | number | yes | Writers emit `2`; readers normalize older input. |
| `id` | string | yes | Unique event ID. Live capture normally uses UUIDs; Codex history import uses a deterministic hash. |
| `capturedAt` | ISO 8601 string | yes | Source or capture time, normalized to an ISO string. |
| `source` | string | yes | Normalized producer such as `trae`, `claude`, `codex`, `workbuddy`, or `browser`. |
| `sourceVersion` | string or null | yes | Producer version when available. |
| `workspaceId` | string | yes | Workspace isolation key; defaults to the first 12 SHA-256 characters of absolute `cwd`. |
| `sessionId` | string | yes | Native session ID, or `unknown-session`. |
| `turnId` | string or null | yes | Native turn ID when available. |
| `parentId` | string or null | yes | Parent agent, subagent, or parent execution ID. |
| `eventName` | string | yes | Canonical ASTRO event name; unknown names are preserved. |
| `nativeEventName` | string | yes | Original producer event name. |
| `toolUseId` | string or null | yes | Correlates tool start and result events. |
| `toolName` | string or null | yes | Tool, function, or native item type. |
| `cwd` | string or null | yes | Working directory or browser context URL. |
| `status` | string or null | yes | Native status or an inferred `failed` marker. |
| `sequence` | number or null | yes | Optional producer sequence. |
| `payload` | object | yes | Redacted native business payload and enriched fields. |
| `locator` | string | yes | Stable locator: `trace://source/session/event`. |

## 3. Source Normalization

Source values are lowercased and classified as follows:

| Input contains | Canonical source |
| --- | --- |
| `claude` | `claude` |
| `codex` or `openai` | `codex` |
| `deepseek` or exact `dsh` | `deepseek` |
| `workbuddy` or `codebuddy` | `workbuddy` |
| `trae` | `trae` |
| `browser`, `chrome`, or `extension` | `browser` |
| anything else | a custom name restricted to `a-z0-9._-` |

Custom producers should use a durable product identifier rather than embedding a version or machine name in `source`.

## 4. Canonical Event Names

ASTRO currently recognizes 17 core canonical events:

| Category | Event | Meaning |
| --- | --- | --- |
| Session | `SessionStart` | Session runtime became observable. |
| Session | `SessionEnd` | Session explicitly ended. |
| Session | `Interrupt` | Session or turn was aborted, cancelled, or interrupted. |
| Interaction | `UserPromptSubmit` | A user submitted one turn, including repeated text. |
| Message | `AgentMessage` | Visible intermediate or final agent message. |
| Message | `Reasoning` | Producer-provided reasoning summary or update. |
| Tool | `PreToolUse` | Tool execution started. |
| Tool | `PostToolUse` | Tool execution returned successfully. |
| Tool | `PostToolUseFailure` | Tool execution returned a failure. |
| Interaction | `PermissionRequest` | The agent requested permission or confirmation. |
| Interaction | `Elicitation` | The agent is waiting for structured user input. |
| Interaction | `ElicitationResult` | Requested user input was received. |
| Signal | `Notification` | Runtime signal that has no more specific canonical meaning. |
| Subagent | `SubagentStart` | A child agent started. |
| Subagent | `SubagentStop` | A child agent stopped and returned. |
| Turn | `Stop` | The current response completed; the session subscription remains open. |
| Turn | `StopFailure` | The current response stopped because of a runtime or API failure. |

Rate-limited `StopFailure` events and waiting notifications retain their
native semantics so the UI can show a waiting state. Other unknown names
survive normalization and render with Unknown semantics.

The projection layer maps `PermissionRequest`, `PermissionDenied`,
`Elicitation`, `ElicitationResult`, and `Notification` to the
`user.question` display key. Generic tool lifecycles named
`AskUserQuestion`, `request_user_input`, or `UserQuestion` map to the same
atom. Their start and completion events open and close one waiting interaction.
Persisted `eventName` and `nativeEventName` values remain unchanged for
inspection.

## 5. Codex Mapping

| Codex record | ASTRO event |
| --- | --- |
| `session_meta`, `thread.started` | `SessionStart` |
| `turn.started`, runtime errors, other status signals | `Notification` |
| `turn.completed`, `task_complete` | `Stop` |
| `turn.aborted`, `turn.cancelled`, `turn_aborted` | `Interrupt` |
| tool-like `item.started` | `PreToolUse` |
| tool-like `item.completed` | `PostToolUse` |
| `agent_message`, `assistant_message` | `AgentMessage` |
| `reasoning` | `Reasoning` |
| user-role message | `UserPromptSubmit` |

Tool-like items include `command_execution`, `file_change`, `mcp_tool_call`, `web_search`, `function_call`, and `custom_tool_call`.

The DeepSeek Harness bundle consumes canonical Session events directly:
`user/message` becomes `UserPromptSubmit`, `assistant/message` becomes
`AgentMessage`, `tool/call` and `tool/result` become tool start/result events,
and `turn/end` becomes `Stop` or `Interrupt`. Other Harness events are retained
as `Notification`.

## 6. Identity and Correlation

### 6.1 Session isolation

Consumers must use the complete session key:

```text
source::workspaceId::sessionId
```

Native session IDs alone are not globally unique across platforms or workspaces.

### 6.2 Tool pairing

A `PreToolUse` event pairs with `PostToolUse` or `PostToolUseFailure` through `toolUseId`. The trajectory model renders the pair as one step and calculates its duration. An unmatched start remains running.

### 6.3 Parent/child execution

`parentId` and source fields such as `agent_id` or `subagent_id` identify delegated work. ASTRO creates a dynamic execution domain for observed subagents. Structural steps without direct evidence are marked `INFERRED`.

### 6.4 Turns

An explicit `turnId` takes precedence. When a producer has no turn ID, the trajectory model infers boundaries from prompts, stop events, and ordering. Inference affects presentation only and never rewrites raw events.

The console additionally derives a prompt run at every `UserPromptSubmit`.
That run includes the prompt and all following events before the next prompt.
The first run is classified as `initial`; later runs are `follow-up`. This is a
read-time UI projection, not a new protocol field or persisted record.

## 7. Session State and Duration

`Stop` completes a response, not the session. A later `UserPromptSubmit` with
the same session ID starts a new Prompt run and returns the event-derived state
to `active` until another stop, wait, failure, or termination signal.

### 7.1 Event-derived state

Events are reduced in deterministic order. Later applicable events replace
earlier state:

| Event or condition | Event-derived state | Notes |
| --- | --- | --- |
| `SessionStart` or `UserPromptSubmit` | `active` | A new Prompt starts a new diagnostic interval. |
| Permission, user-question, rate-limit, backoff, or explicit waiting signal | `waiting` | Waiting is not failure or termination. |
| Execution progress after `waiting` or `failed` | `active` | New evidence shows execution resumed. |
| Failure signal | `failed` | Remains until later progress, Prompt, or terminal evidence. |
| `Stop` | `complete` | Completes only the current answer. |
| `Interrupt`, `SessionEnd`, cancel, abort, or equivalent signal | `terminated` | Explicit terminal evidence. |
| Newer session for the same source and workspace | older active session becomes `terminated` | Prevents an abandoned session from remaining live forever. |

This state belongs to the read model. Producers should emit observed events
rather than synthesizing a timeout event.

### 7.2 Duration and effective display state

Completed duration is last event minus first event. For `active` and `waiting`
Prompt runs, the candidate live duration is:

```text
max(recorded span, now - start)
```

The frontend compares that value with
`appTimings.activeRunTimeoutMs`, which defaults to 24 hours:

| Candidate duration | Effective duration | Effective status |
| --- | ---: | --- |
| `< timeout` | candidate duration | event-derived status |
| `= timeout` | timeout | `terminated` |
| `> timeout` | timeout | `terminated` |

Terminal event-derived states bypass the live calculation; their recorded
duration and status are preserved. The Session parent row is stricter than a
Prompt row: it advances only when its latest Prompt is `active`, while the
nested Prompt row advances for `active` and `waiting`.

The timeout is an effective UI projection. It does not append an event, replace
the stored session state, or change JSONL. It stops selected-run live animation
and running markers. The page removes its one-second refresh interval when no
displayed parent or Prompt remains eligible to advance. Reloading recomputes the
same result from events, timestamps, current time, and the configured limit.

### 7.3 Boundary examples

With a 24-hour limit:

- `23:59:59.999` remains live;
- `24:00:00.000` is capped and displayed as `terminated`;
- a 30-hour completed historical run remains complete with a 30-hour duration;
- a waiting nested Prompt times out, while its parent row remains frozen as
  waiting because only an active latest Prompt advances the parent;
- changing the limit affects presentation after rebuilding the frontend and
  does not migrate stored events.

## 8. Ordering and Idempotency

- JSONL preserves append order.
- Repository aggregation sorts by `capturedAt`, then `id`.
- Session construction sorts by `capturedAt`, then `sequence` for equal times.
- API and repository writes deduplicate by event `id`.
- Codex history IDs depend on file path, line number, timestamp, type, and call ID, making unchanged imports repeatable.
- Live hooks generate a new ID for each real event. Identical follow-up questions and answers remain separate events.

Never deduplicate by message text, and never compare sequence numbers across unrelated producers.

## 9. Payload Enrichment

| Event | Canonical payload field | Fallback sources |
| --- | --- | --- |
| `UserPromptSubmit` | `prompt` | message, nested message, textual content |
| `AgentMessage` | `message` | nested message, item text, textual content |
| `PreToolUse` | `tool_input` | item arguments, command, or the item itself |
| `PostToolUse*` | `tool_response` | item output, result, or the item itself |

String tool arguments are parsed as JSON when possible and otherwise preserved verbatim.

## 10. Redaction Before Write

Keys matching common authorization, cookie, password, secret, API key, token, credential, and private-key forms are recursively replaced with `[redacted]`. Strings are also scanned for Bearer tokens, `sk-` keys, common secret assignments, and three-part JWTs.

This is a risk-reduction rule set, not complete DLP. Prompts, source code, paths, and business data may still be sensitive. Inspect a trace before sharing it.

## 11. JSONL Rules

Each physical line must be one complete JSON object. The reader isolates a malformed line and continues with later valid lines. Do not pretty-print one event over multiple lines or concatenate multiple objects on one line.

## 12. HTTP Ingestion Contract

`POST /api/events` accepts a single object, an array, or `{ "events": [...] }`. `X-Astro-Source` may override the source. A successful write returns HTTP 202:

```json
{
  "accepted": 1,
  "events": [
    {
      "id": "evt-018f5f7f",
      "locator": "trace://custom-agent/s1/evt-018f5f7f"
    }
  ]
}
```

`accepted` counts only newly appended IDs. Oversized bodies return 413 and malformed JSON returns 400.

## 13. SSE Contract

Every `GET /api/stream` connection receives this ordered sequence:

1. `reset`: complete current snapshot;
2. `ready`: `eventCount` and `connectedAt`;
3. `trace`: one newly appended event at a time;
4. later `reset`: file truncation, newly discovered trace files, or repository resynchronization.

The server advertises `retry: 1000`. A reconnect receives another full snapshot before live increments, so follow-up turns missed during disconnection are repaired. Clients should still deduplicate `trace` events by ID.

## 14. Import, Export, and Compatibility

- Browser import accepts a JSON array or JSONL.
- Legacy fields such as `event_name`, `session_id`, and `tool_use_id` normalize on read.
- Browser-imported events remain in page memory and are not persisted automatically.
- Export writes the selected prompt run as canonical JSONL. Sessions without a
  prompt event use a session-level compatibility fallback.
- Consumers should preserve unknown payload fields instead of copying only a fixed whitelist.

## 15. Versioning Rules

Any protocol change should:

1. retain old-field read compatibility or ship an explicit migration;
2. define defaults and nullability for new fields;
3. update hook, HTTP, Browser SDK, and import tests;
4. update both architecture guides, both user manuals, and this reference;
5. add idempotency and replay regression coverage for identity or correlation changes.

## 16. Producer Checklist

- Use stable `source`, `workspaceId`, and `sessionId` values.
- Generate a unique `id` for every real event; do not deduplicate by text.
- Reuse one `toolUseId` for tool start and result.
- Supply `turnId`, `parentId`, and monotonic `sequence` when available.
- Emit timezone-aware ISO 8601 timestamps.
- Preserve the source event name in `nativeEventName`.
- Avoid unnecessary credentials and large binary data in payloads.
- Verify persistence and streaming with `/api/health`, `/api/events`, and `/api/stream`.

For implementation ownership, code references, and delivery status, see
[Implementation Details and Delivery Status](implementation-details-en.md).
