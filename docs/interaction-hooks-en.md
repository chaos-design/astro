# AskUserQuestion Interaction Hook Flow Design

> **Status: planned / not implemented.** This document specifies the channel
> model, timing, data structures, message formats and field constraints for a
> future design where the ASTRO console or an external device handles an
> `AskUserQuestion` interaction. The repository currently implements **only
> auto-approval** (`scripts/auto-approve-question-hook.mjs`); the capture chain
> stays read-only and the service has no approve/answer/reply endpoint. Nothing
> here is a promise of current behavior. For working configuration, see
> `docs/plugin-installation.md`.

## 1. Diagram review

The original "Hook observation channel and decision channel" diagram has six
nodes: host hook event → left "ASTRO recorder (`continue:true` / empty
`--quiet` stdout, JSONL only, exit 0)" → "host still prompts"; right "decision
hook (`hookSpecificOutput: allow` + `updatedInput / answers`)" → "host
auto-approves". Checked against `ce513d8` and the follow-up documentation, the
diagram is **incomplete**.

| # | Missing | Current fact | Section |
| --- | --- | --- | --- |
| A | Two decision protocols collapsed into one `allow` | `PreToolUse` uses `permissionDecision:"allow"` + top-level `updatedInput` (`modifiedInput` on CodeBuddy); `PermissionRequest` uses `decision.behavior:"allow"` + `decision.updatedInput` | §2, §6.2 |
| B | No fail-open third branch | Unmatched events, missing fields or parse errors → empty stdout + exit 0, host falls back to its prompt | §2, §6.2, §7 |
| C | Decision hook drawn as always present | Off by default; `install-auto-approve-hook.mjs` is dry-run until `--apply`, backs up, is idempotent, and supports `--remove --apply`; ZCode needs `hooks.enabled:true`, `hooks.events`, and a new session | §2.1, §7 |
| D | No aggregation or non-bypassable rules | `deny > ask > allow`; explicit deny rules, plan-mode write bans and hard tool limits win; the recorder's `{continue:true}` is neutral | §2, §9 |
| E | Observation channel stops at JSONL | JSONL → `GET /api/stream` (`reset` / `trace` / `ready` / `resume`) → console `user.question` preview with `prompts` / `message` / `plan` / `answers` | §2, §6.3 |
| F | Root cause of the app switch not labelled | `POST /api/events` only writes TraceEvents; `/api/stream` is one-way; there is no reverse answer channel | §2.1, §6.3 |
| G | No host coverage differences | Three configs (Claude / ZCode / CodeBuddy); Codex, OpenCode, Pi and DeepSeek Harness have no command-hook decision channel | §2.1, §9 |
| H | No `answers` semantics | Keys are exact question text, values are option labels, multi-select is comma-joined; `ANSWER=all` and `ASTRO_AUTO_APPROVE_ANSWERS` override; injected by the host hook, not produced by the agent | §5.4, §6.2 |
| I | No human-interaction loop | Only auto-approval is drawn; option clicks, text input, cancel, timeout, result return and Agent notification are absent | §3–§8 (all planned) |

## 2. Complete channel model

```mermaid
flowchart TB
  H["Host hook event<br/>PreToolUse / PermissionRequest"] --> O["ASTRO recorder<br/>read-only, fail-open"]
  H --> D["Optional decision hook<br/>off by default, --apply registers"]
  H -.->|planned| I["Interaction hook<br/>external UI handles input"]
  O -->|"stdout: continue:true / empty (--quiet), exit 0"| J["JSONL → /api/stream SSE"]
  J --> U["Console user.question preview<br/>questions / message / plan / answers"]
  D -->|"allow + updatedInput(answers); empty stdout on error"| AGG["Host aggregation<br/>deny &gt; ask &gt; allow"]
  I -.->|"InteractionResult (planned)"| AGG
  AGG -->|allow| GO["Auto-approved, no app switch"]
  AGG -->|"no decision / timeout / explicit deny"| PROMPT["Native permission prompt"]
  O -.->|"no approve/answer endpoint"| PROMPT
```

### 2.1 Implemented vs planned

- **Implemented**: read-only recorder contract; two stdout decision shapes,
  fail-open, `answers`, custom answer maps, installer/removal and ZCode config
  validation; console parsing of `questions` / `message` / `plan` / `answers`.
- **Planned (this design)**: interaction hook, external UI, bidirectional answer
  service, SSE interaction events, `InteractionEvent` / `InteractionResult` /
  `AgentNotification` messages, and any new `/api/*` route. None exist today.
- The service exposes only `GET /api/stream` (one-way) and `POST /api/events`
  (TraceEvent writer). Neither can return an answer to the host.

## 3. Execution timing

### 3.1 Synchronous decision window (implemented)

Host fires `PreToolUse` / `PermissionRequest` → matching hooks run in parallel
(5 s in this repo, ZCode `timeoutMs: 5000`) → each reads stdin, writes stdout,
exits 0 → host aggregates `deny > ask > allow` → the tool runs and the recorder
captures `PostToolUse`. `Notification` has **no decision control**.

### 3.2 Human interaction (planned)

```mermaid
sequenceDiagram
  participant Agent as Host Agent
  participant Hook as Interaction Hook
  participant Bridge as Local interaction service (planned)
  participant UI as Console / external device
  participant Store as TraceStore / SSE
  Agent->>Hook: stdin: InteractionRequest (PreToolUse or PermissionRequest)
  Hook->>Bridge: register pending request (requestId, TTL, questions)
  Hook->>Store: write PermissionRequest TraceEvent
  Bridge->>UI: SSE interaction.open
  UI->>Bridge: InteractionEvent (select / text / edit / cancel / submit)
  Bridge->>Hook: aggregate into InteractionResult (answers)
  Hook->>Agent: stdout: allow + updatedInput.answers
  Hook->>Agent: additionalContext / systemMessage (notification)
  Agent->>Hook: PostToolUse (tool_response with answers)
  Hook->>Store: write PostToolUse TraceEvent
  Store->>UI: SSE trace (preview shows Answers)
```

### 3.3 Timeout and fallback (critical)

Hooks are **synchronous and blocking**. Human response time usually exceeds the
5-second window, so a hook must never wait indefinitely. Pick exactly one:

1. **Fast path (recommended)**: poll once within `min(ttlMs, timeout - 500ms)`.
   On a hit, return `allow + updatedInput.answers`; on a miss, **empty stdout +
   exit 0** so the native prompt appears. Record the real choice later via
   `PostToolUse`.
2. **Re-entry path**: return `deny` with `permissionDecisionReason`, letting the
   agent ask again next turn. Costs a model turn; cap retries at 1 per
   `requestId`.

Never let the hook time out, `exit 2`, or return `continue:false`; all three
break the fail-open boundary.

## 4. Interaction behavior matrix

| Behavior | Trigger | `action` | Payload | Result | Idempotency / constraint |
| --- | --- | --- | --- | --- | --- |
| Single-select click | Option card | `select` | `question`, `optionLabel` | Overwrites that answer | Highest `seq` wins per `requestId` + `question` |
| Multi-select / deselect | `multiSelect:true` | `select` / `deselect` | `optionLabel` | Labels joined in `options` order | Deduplicate; no repeated label |
| Free-text input | "Other" field | `text` | `text` | Becomes that answer | 1..2000 chars, trimmed, no executable markup |
| Edit an answer | Repeated click or typing | `edit` | `previous`, `next` | Replaces answer | Keep `revision` for audit |
| Submit | Confirm / Enter | `submit` | Full `answers` snapshot | Produces `InteractionResult` | All required questions must be covered |
| Cancel | Cancel / Esc | `cancel` | `reason?` | No `answers`; native prompt | Do not write `deny`; `final:true` ends the request |
| Skip | Optional question | `skip` | `question` | Omitted from `answers` | Only when `required:false` |
| Timeout | `expiresAt` reached | `timeout` | `elapsedMs` | Native prompt | Single timer, no replay |
| Duplicate submit | Double click / retry | repeated `submit` | Same `requestId` | Ignored | `requestId` + `final` |
| Device takeover | Phone/desktop answers first | `takeover` | `deviceId` | Other devices read-only | First `final` wins; broadcast `interaction.close` |
| Session invalidated | Session end / interrupt | `expire` | `sessionId` | Drop pending request | Never emit a late decision |
| Question replaced | Agent rewrote questions | `replace` | New `questions` | Rebuild request | Increment `revision`, invalidate old `requestId` |
| Non-question tool | `Bash` / `Write` | — | — | Empty stdout, exit 0 | Matcher stays `AskUserQuestion|ExitPlanMode` |
| Hook crash / bad output | Script error | — | — | Native prompt | Empty stdout + exit 0; stderr diagnostics only |

## 5. Data structures (planned)

These five shapes are **message contracts**, not existing TypeScript types.
Field names follow the snake_case convention of `TraceEvent.payload`.

### 5.1 QuestionDescriptor

```json
{
  "question": "Which framework?",
  "header": "Framework",
  "options": [
    { "label": "React", "description": "Component library" },
    { "label": "Vue", "description": "Progressive framework" }
  ],
  "multiSelect": false,
  "required": true
}
```

`question`: 1..500 chars, preserved verbatim as the `answers` key.
`header`: 0..40 chars, display only. `options`: 2..8 unique labels of 1..120
chars, optional `description`. `multiSelect`: default `false`, comma-joins
labels in `options` order. `required`: default `true`; only `false` allows `skip`.

### 5.2 InteractionRequest

```json
{
  "requestId": "irq-01J8Z...",
  "schemaVersion": 1,
  "hookEventName": "PermissionRequest",
  "toolName": "AskUserQuestion",
  "toolUseId": "call_001",
  "sessionId": "sess_73e39835",
  "source": "zcode",
  "cwd": "/workspace/demo",
  "createdAt": "2026-11-15T14:00:00.000Z",
  "expiresAt": "2026-11-15T14:00:04.500Z",
  "ttlMs": 4500,
  "revision": 1,
  "questions": ["...QuestionDescriptor..."]
}
```

`requestId` is an idempotency key (UUID/ULID). `hookEventName` ∈
{`PreToolUse`, `PermissionRequest`}; `toolName` ∈
{`AskUserQuestion`, `ExitPlanMode`}; `ttlMs ≤ hookTimeoutMs - 500`;
`expiresAt` is ISO 8601; `questions` has 1..4 entries. No tokens, credentials or
full source text.

### 5.3 InteractionEvent

```json
{
  "requestId": "irq-01J8Z...",
  "eventId": "iev-01J8Z...",
  "seq": 7,
  "action": "select",
  "deviceId": "console",
  "at": "2026-11-15T14:00:02.120Z",
  "question": "Which framework?",
  "optionLabel": "React",
  "text": null,
  "final": false
}
```

`action` ∈ `select` / `deselect` / `text` / `edit` / `submit` / `cancel` /
`skip` / `timeout` / `takeover` / `expire` / `replace`. `seq` strictly increases;
`final:true` only on `submit` / `cancel` / `timeout` / `expire`; `text` and
`optionLabel` are mutually exclusive; `replace` carries new `questions` and
`revision+1`; one event ≤ 8 KiB.

### 5.4 InteractionResult

```json
{
  "requestId": "irq-01J8Z...",
  "status": "answered",
  "answers": { "Which framework?": "React", "Pick tools": "A, B" },
  "answeredBy": "console",
  "answeredAt": "2026-11-15T14:00:03.000Z",
  "elapsedMs": 3000
}
```

`status` ∈ `answered` / `cancelled` / `timeout` / `expired`. On `answered`, each
key must exactly equal a `questions[].question`; each value must be a declared
label, comma-joined multi-select labels, or free text from a `text` action.
Unknown keys, empty values and plan content are dropped; serialized `answers`
≤ 4000 chars. Other statuses require `answers: {}`.

### 5.5 AgentNotification

See §8.2.

## 6. Message formats

### 6.1 Host → hook (stdin, implemented)

One line of JSON + newline. Claude / CodeBuddy use `tool_name`, `tool_input`,
`tool_use_id`; ZCode supplies both camelCase and snake_case aliases.

```json
{
  "hook_event_name": "PermissionRequest",
  "session_id": "sess_73e39835",
  "tool_name": "AskUserQuestion",
  "tool_use_id": "call_001",
  "tool_input": {
    "questions": [
      { "question": "Which framework?", "header": "Framework",
        "options": [{ "label": "React" }, { "label": "Vue" }], "multiSelect": false }
    ]
  }
}
```

### 6.2 Hook → host (stdout, implemented)

```json
// PreToolUse
{ "hookSpecificOutput": { "hookEventName": "PreToolUse",
  "permissionDecision": "allow", "permissionDecisionReason": "auto-approved",
  "updatedInput": { "questions": ["..."], "answers": { "Which framework?": "React" } } } }

// PermissionRequest
{ "hookSpecificOutput": { "hookEventName": "PermissionRequest",
  "decision": { "behavior": "allow",
    "updatedInput": { "questions": ["..."], "answers": { "Which framework?": "React" } } } } }
```

`updatedInput` is a **full replacement**: echo the original `questions` or host
schema validation fails. CodeBuddy `PreToolUse` uses `modifiedInput`
(`ASTRO_AUTO_APPROVE_INPUT_FIELD=modifiedInput`). `ExitPlanMode` echoes `plan` /
`planFilePath` / `allowedPrompts` and produces no `answers`. Fail-open: no stdout
and exit 0, diagnostics on stderr only. Never use `decision:"block"`,
`continue:false` or exit 2 to mean "no opinion". `additionalContext`,
`systemMessage` and `permissionDecisionReason` are capped at 10,000 characters
by the host.

### 6.3 Interaction channel messages (planned)

`GET /api/stream` frames are `event: <name>\ndata: <JSON>\n\n`; today the names
are only `reset` / `trace` / `ready` / `resume`. The design adds:

```
event: interaction.open
data: {"requestId":"irq-01J8Z...","questions":["..."],"expiresAt":"...","revision":1}

event: interaction.update
data: {"requestId":"irq-01J8Z...","eventId":"iev-...","seq":7,"action":"select"}

event: interaction.close
data: {"requestId":"irq-01J8Z...","status":"answered","answeredBy":"console"}
```

Frames ≤ 8 KiB; `requestId` is idempotent; `interaction.close` fires exactly
once; reconnect rebuilds from `reset` rather than replaying interaction history.
`POST /api/events` accepts only TraceEvent structures (§6.4) and **must not** be
used to carry answers back to the host: writing is one-way.

### 6.4 TraceEvent projection

Interaction produces only existing canonical events; no new event names:

| Stage | `eventName` | Key `payload` fields | Display key |
| --- | --- | --- | --- |
| Question raised | `PreToolUse` / `PermissionRequest` | `tool_input.questions`, `tool_input.plan` | `user.question` |
| Answer returned | `PostToolUse` | `tool_input.answers`, `tool_response.answers` | `user.answer` |
| Cancel / denial | `PermissionDenied` | `reason`, `retry` | `user.question` (failure) |
| Notification | `Notification` | `message`, `notification_type` | `user.question` |

Required `TraceEvent` fields are listed in `docs/event-protocol-en.md` §2.1
(`schemaVersion: 2`, `source`, `sessionId`, `eventName`, `nativeEventName`,
`payload`, `locator`, ...). `answers` is injected by the host hook, redacted per
§10 of that document, and only parsed for display by
`src/lib/user-question-content.ts`; persisted events are never rewritten.

## 7. Triggers and timeout boundaries

| Time | Trigger | Message | Timeout / fallback |
| --- | --- | --- | --- |
| T0 | Host fires `PreToolUse` | Recorder writes `PreToolUse`; interaction hook creates `InteractionRequest` | none |
| T0+ | Permission needed | `PermissionRequest` + `interaction.open` | `ttlMs ≤ timeout-500` |
| T1 | UI rendered | optional `interaction.update` | never blocks the hook |
| T2 | Each click / keystroke commit | one `InteractionEvent` with increasing `seq` | ≤ 8 KiB per event |
| T3 | Submit | `interaction.close` + `InteractionResult` | all required questions covered |
| T4 | Hook returns | `allow + updatedInput.answers` or empty stdout | must return on time |
| T5 | Tool completes | `PostToolUse` + `tool_response.answers` | SSE `trace` refreshes the preview |
| T6 | Notify Agent | `additionalContext` / `systemMessage` | ≤ 10,000 chars |
| T7 | No response / cancel / crash | empty stdout + exit 0 | native prompt takes over |

ZCode extras: user-level `hooks.enabled:true`; project-level hooks ignored;
configuration snapshotted at session start (open a new session); failures in
`~/.zcode/cli/log/zcode-<date>.jsonl`.

## 8. Agent notification message design

### 8.1 Four channels

| Channel | Audience | Use | Constraint |
| --- | --- | --- | --- |
| `hookSpecificOutput.additionalContext` | Agent (model context) | "User answered; answers are in `tool_input.answers`" | Read on the next model request, not shown as a chat message |
| `systemMessage` | Human (terminal / UI warning) | "Answered from an external device", "Timed out, fell back to prompt" | Not model context; discarded by `Notification` / `StopFailure` |
| `permissionDecisionReason` | Agent or human (event dependent) | Explain a `deny`; on `allow` only reaches the debug log | Must not impersonate an answer |
| `terminalSequence` | Terminal | Bell / title / desktop notification | Works on events that discard `systemMessage` |

`Notification` hooks have **no decision control** and must not try to change a
permission outcome.

### 8.2 AgentNotification structure

```json
{
  "schemaVersion": 1,
  "notificationId": "ntf-01J8Z...",
  "requestId": "irq-01J8Z...",
  "kind": "answer_applied",
  "target": "agent",
  "channel": "additionalContext",
  "sessionId": "sess_73e39835",
  "toolUseId": "call_001",
  "at": "2026-11-15T14:00:03.100Z",
  "summary": "User answered 2 questions via console; answers are in tool_input.answers.",
  "detail": { "answered": 2, "skipped": 0, "answeredBy": "console", "elapsedMs": 3000 },
  "ttlMs": 0
}
```

`kind` ∈ `answer_applied` / `answer_cancelled` / `interaction_timeout` /
`fallback_prompt` / `question_replaced` / `device_takeover`.
`target` ∈ `agent` / `user` / `both`; `channel` ∈ `additionalContext` /
`systemMessage` / `permissionDecisionReason` / `terminalSequence` / `sse` /
`trace`.

### 8.3 Field constraints

- `summary`: 1..500 chars, plain text, no Markdown injection, control
  characters or executable fragments; contains counts and origin only, never
  the full `answers`.
- `detail`: counts, device id and elapsed time only; no tokens, full paths,
  source code or full plan text.
- `notificationId` + `requestId` form the idempotency key; one `kind` per
  request; `ttlMs` defaults to 0 and is ≤ 1000 for `sse` / `trace`.
- Redact before writing to trace (`docs/event-protocol-en.md` §10).
- Notifications never replace decisions: no `continue:false`, no `exit 2`.
- Never wrap a hook-provided answer as `UserPromptSubmit` or a user message;
  doing so corrupts prompt-run hierarchy.

### 8.4 Prohibited behavior

1. Presenting `answers` as an agent-produced `tool_response`.
2. Returning decision fields from a `Notification` hook.
3. Putting full answers or secrets in `systemMessage`.
4. Using `POST /api/events` as a host answer channel.
5. Blocking a hook past its timeout while waiting for a human.

## 9. Security and constraint summary

| Dimension | Constraint |
| --- | --- |
| Matcher | `AskUserQuestion|ExitPlanMode` only; never `*` or empty; ZCode uses exact name lists |
| Aggregation | `deny > ask > allow`; explicit deny, plan-mode write bans and hard limits are not bypassable |
| Default | Decision hook not installed until `--apply`; interaction hook is planned and must not default on |
| Failure | Empty stdout + exit 0; stderr diagnostics only; never partial JSON |
| Idempotency | `requestId` + `seq` + `final`; duplicate submits ignored; one `interaction.close` |
| Sizes | ≤ 8 KiB per event; `answers` ≤ 4000 chars; notification strings ≤ 10,000 chars |
| Time | `ttlMs ≤ hookTimeoutMs - 500`; ISO 8601 `expiresAt`; single timer, no replay |
| Data | Raw `TraceEvent` immutable; `answers` display-only; redact before write |
| Clients | Codex / OpenCode / Pi / DeepSeek Harness have no command-hook decision channel |

## 10. Verification (design stage)

1. Every A–I item in §1 has a landing section in §2–§9; all planned items are
   labelled.
2. Validate §6.1 stdin fields and §5.4 `answers` keys against a real ZCode
   `PermissionRequest(AskUserQuestion)` trace and `parseUserQuestionContent()`.
3. Negative decisions: non-question tools, invalid JSON and missing `questions`
   produce empty stdout + exit 0.
4. Negative notifications: summary truncation, duplicate idempotency keys,
   `Notification` events returning no decision.
5. Post-implementation host check: Claude `/hooks` shows the group and the
   transcript says `Allowed by PermissionRequest hook`; ZCode uses a new session
   with no `hook.run.failed` in its log.

## 11. Implementation task breakdown

The executable backlog lives in
`plans/planing/03-ask-user-question-implementation-breakdown.md` (32 tasks,
A1–F5, all pending). This section gives only the stage overview and dependency
order; each task's file paths, acceptance check and prerequisite are defined in
that plan.

| Stage | Tasks | Deliverable | Depends on | Stage acceptance |
| --- | --- | --- | --- | --- |
| A Contracts and validation | 5 | `src/lib/interaction-contract.ts` + tests | none | Five message types and four validators pass positive and negative cases |
| B Hook decision window | 6 | `scripts/interaction-hook.mjs` + tests | A | Both stdout shapes, ExitPlanMode echo and four fail-open cases pass |
| C Interaction service and SSE | 6 | `server/interaction-store.mjs`, four `/api/interactions` routes, three SSE frames | A | Atomic writes, seq / final idempotency and single-timer timeout pass |
| D Console interaction | 6 | `interaction-reducer.ts`, `interaction-panel.tsx` | C | Single / multi-select, text, cancel, closed state and Answers linkage pass |
| E Notification and observation | 4 | `agent-notification.ts`, notification output, redaction | B, C | Summary limits, notification writes and Prompt hierarchy pass |
| F Install and acceptance | 5 | Standalone installer, host integration record, doc status update | all | Negative tests pass, planned labels removed, docs consistent |

Dependency order: `A → B`, `A → C`; `B` and `C` can run in parallel; `D → C`;
`E → B` and `E → C`; `F → all`. Within a stage, follow the numeric order. Each
task touches at most 1–2 source files plus one test file and its acceptance
check is one runnable assertion or one spawn command; vague "finish module"
wording is not allowed.

This document remains **planned / unimplemented**. Only after F5, and never
before all 32 tasks are checked, may the status label change to "implemented".

## 12. References

- `docs/plugin-installation.md` — current optional auto-approve hook setup.
- `docs/event-protocol-en.md` §2 / §4 / §9 / §10 — TraceEvent schema,
  projection, payload enrichment and redaction.
- `docs/architecture-en.md` §6 — TraceStore and SSE snapshot semantics.
- `AGENTS.md` — invariants for user-question classification, preview parsing and
  the decision-hook channel.
- `plans/planing/03-ask-user-question-implementation-breakdown.md` — 32
  implementation tasks with per-task paths and acceptance checks.
