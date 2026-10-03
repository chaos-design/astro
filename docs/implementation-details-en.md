# ASTRO Implementation Details and Delivery Status

Updated: 2026-09-10

This reference turns the project's design decisions into a maintainable view of
delivery. It answers four questions:

1. Is the capability implemented?
2. Which layer owns the behavior?
3. Which code and tests provide evidence?
4. What boundary or next step remains?

## 1. Status Definitions

- **Implemented:** executable code exists with focused automated coverage or
  directly inspectable rendering evidence.
- **Planned:** the target behavior and interface are designed, but full
  integration and release acceptance are not complete.
- **Documentation:** the item organizes facts, presentation material, and
  interview material rather than adding runtime behavior.

Implemented does not mean unbounded. Planned behavior must not be presented as
a current user promise.

## 2. Delivery Matrix

| Topic | Status | Result | Primary evidence |
| --- | --- | --- | --- |
| Active-run timeout | Implemented | An advancing run is capped at 24 hours by default and derives `terminated` | `src/config/app-config.ts`, `src/lib/trace-model.ts`, `tests/trace-model.test.ts` |
| Session message status | Implemented | The latest semantic event drives status, and a new Prompt can reactivate a terminal session | `src/lib/trace-status.ts`, `src/lib/trace-model.ts`, `tests/trace-model-boundaries.test.ts` |
| Prompt-run isolation | Implemented | Every `UserPromptSubmit` starts an independent diagnostic interval | `src/lib/trace-model.ts`, `src/app.tsx`, `tests/trace-model.test.ts` |
| Parent duration and expand control | Implemented | A parent advances only when its latest Prompt is `active`; expansion is separate from row selection | `src/lib/run-history-state.ts`, `src/app.tsx`, `tests/run-history-state.test.ts` |
| Global history search and atom location | Implemented | Combined filters locate the Session, Prompt, log row, inspector, and topology atom | `src/lib/history-search.ts`, `src/components/history-search.tsx`, `tests/history-search.test.ts` |
| User-question projection | Implemented | Question, permission, and notification events project to `user.question` | `src/lib/trace-event-kind.ts`, `src/lib/atomic-projection.ts`, `tests/user-question-projection.test.ts` |
| Event-directory migration | Implemented | New directories use `HH_mm_ss`; legacy colon paths migrate without data loss | `plugin/storage-paths.cjs`, `scripts/migrate-data.mjs`, `tests/migrate-data.test.js` |
| History status guide | Implemented | The Guide reuses real status icons and explains parent/child state | `src/config/atom-guide-copy.ts`, `src/app.tsx`, `tests/atom-guide-copy.test.ts` |
| Guide observability markers | Implemented | The observability list uses semantic bullets without changing ordered steps | `src/app.tsx`, `src/styles.css` |
| Topology domain-label readability | Implemented | Larger domain labels improve fitted-canvas readability without geometry changes | `src/styles.css`, `tests/atom-node-typography-contract.test.ts` |
| Plugin YAML and `.env` configuration | Implemented | One installed, shared configuration source is loaded by every entry point | `config.example.yaml`, `plugin/runtime-config.cjs`, `tests/runtime-config.test.cjs` |
| Documentation and HTML synchronization | Documentation | This reference owns delivery status; the decks adapt it for their audiences | `docs/index.md` and the two self-contained HTML files |

Runtime configuration is generated automatically during installation, retained
across upgrades, and packaged with the native integrations.

## 3. Runtime State and Prompt Isolation

### 3.1 State Is Derived from Events

`TraceEvent[]` is the source of truth. The status reducer processes meaningful
events in timestamp and capture order:

| Event meaning | Derived status |
| --- | --- |
| Prompt, Session start, or execution progress | `active` |
| Permission, elicitation, rate-limit, or retry wait | `waiting` |
| Successful `Stop` | `complete` |
| Hook, tool, or non-zero-exit failure | `failed` |
| Interrupt, cancel, termination, or Session end | `terminated` |

Unknown events do not erase the latest recognized state. A later
`UserPromptSubmit` can reactivate the same Session from any terminal state
because `Stop` completes one response rather than the whole Session.

### 3.2 Prompt Is the Smallest Diagnostic Scope

`buildSessionPromptRuns` partitions events at every `UserPromptSubmit`. After a
Prompt is selected, topology, trajectory, log, inspector, replay, and export
consume only that interval. Historical Prompts do not absorb later events.
Legacy data without Prompt events falls back to the complete Session.

The Session parent uses the latest Prompt's display status. The Prompt child is
the only selected run row; the parent groups children and selects the latest
Prompt. The expand control is a separate interaction target and cannot
accidentally select the row.

### 3.3 Duration and Timeout

The page owns one shared one-second clock. Pure helpers receive the recorded
run, `now`, and `appTimings.activeRunTimeoutMs`; components do not read the
clock independently.

- A Session parent advances only while its latest Prompt is `active`.
- A Prompt child advances while `active` or `waiting`.
- An advancing candidate reaches a default 24-hour cap and derives
  `terminated`.
- Existing `complete`, `failed`, and `terminated` durations are not truncated.
- Expiry stops the Live indicator, topology animation, and running log marker.
- No synthetic event is appended, JSONL is not rewritten, and persisted status
  is not replaced.

The same events, time, and configuration therefore reproduce the same display
state after a reload.

## 4. Search, Question Events, and Coordinated Location

### 4.1 Client-Side Global Index

`buildHistorySearchIndex` rebuilds when loaded Sessions change. Each entry
contains its parent Session and Prompt, status, source, time, event label,
summary, and normalized searchable text. Search supports:

- case-insensitive substring and ordered fuzzy matching;
- combined time, Agent, status, and event-category filters;
- intersection across filter groups and union within one group;
- cheap structured predicates before text scoring;
- automatic result batching with `IntersectionObserver`.

This searches data already loaded by the client. It is distinct from
server-side `/api/search` and does not promise access to unloaded history.

### 4.2 One Selection Locates Every View

Selecting a result changes the source platform, Session, and Prompt; selects
the exact event and mapped atom; exits replay; opens History and LOG; and sends
independent location requests to the topology and event list. Each scroll
container owns its own reveal operation.

Manual atom selection, the executing atom, and the selected event's atom follow
an explicit priority. A locate request uses a short color pulse and restrained
dimming. Reduced-motion mode keeps static emphasis.

### 4.3 User-Question Semantics

`PermissionRequest`, `PermissionDenied`, `Elicitation`,
`ElicitationResult`, and `Notification` display as `user.question`. Generic
tool events named `AskUserQuestion`, `request_user_input`, or `UserQuestion`
also map to that atom. A start waits for user input; its completion closes the
same instance.

## 5. Storage Layout and Migration

The canonical path is:

```text
<ASTRO_HOME>/<source>/YYYY/MM-DD/HH_mm_ss-<sessionId>/events.jsonl
```

`plugin/storage-paths.cjs` is the only path-generation implementation. The
migrator continues to recognize legacy `HH:mm:ss-<sessionId>` directories:

1. Rename directly when the destination does not exist.
2. Merge `events.jsonl` when the destination exists.
3. Deduplicate parseable events by `id`.
4. Preserve and deduplicate ID-less or malformed rows by exact text.
5. Remove the legacy directory only after a successful destination write.
6. Keep repeated migration idempotent.

The Repository discovers either layout during migration, while all new writes
use underscores.

## 6. Guide and Topology Readability

The History legend reuses the same Lucide status icons and semantic colors as
Run History. It also explains that a parent follows the latest Prompt and falls
back to Session state when no Prompt exists.

The Guide observability list keeps semantic `ul` / `li` markup and native
`disc` markers. Domain headings increase from 8 px to 12 px and descriptions
from 8 px to 10 px. These changes improve fitted-canvas readability without
changing domain geometry, node positions, or orthogonal routes.

## 7. Runtime Configuration

The installer creates two user-owned files under
`<ASTRO_HOME>/plugins/astro`:

```text
~/.astrox/plugins/astro/
├── config.yaml
└── .env
```

Responsibilities:

- `config.yaml` stores typed server, runtime, storage, and client settings.
- `.env` stores machine-specific or private values referenced from YAML.
- Agents, the CLI, service, and Vite proxy consume one shared loader.
- Precedence is CLI, process environment, legacy environment, plugin `.env`,
  YAML, then built-in defaults.
- `${NAME}` and `${NAME:-fallback}` interpolate string scalars only and never
  execute shell code.
- First installation creates active files; upgrades preserve user files.
- `doctor` reports paths, validity, and source layers without printing secrets.

`ASTRO_HOME` is a bootstrap value that locates the configuration files. The
plugin `.env` cannot relocate itself. Changing `ASTRO_HOME` requires
reinstalling integrations so Hook commands, runtime, and configuration remain
colocated.

Release verification:

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm build:native-plugins
pnpm validate:claude-hooks
git diff --check
```

## 8. Maintenance and Verification

Change the owning pure helper and focused tests before synchronizing this
reference, reader-facing guides, and both HTML decks. Do not maintain
conflicting copies of behavior in README files, components, and presentations.

| Responsibility | Code | Tests |
| --- | --- | --- |
| State, Prompt, and timeout | `src/lib/trace-model.ts`, `src/lib/run-history-state.ts` | `tests/trace-model.test.ts`, `tests/run-history-state.test.ts` |
| Search and location | `src/lib/history-search.ts`, `src/app.tsx` | `tests/history-search.test.ts`, `tests/atom-selection.test.ts` |
| User-question projection | `src/lib/trace-event-kind.ts`, `src/lib/atomic-projection.ts` | `tests/user-question-projection.test.ts` |
| Storage migration | `plugin/storage-paths.cjs`, `scripts/migrate-data.mjs` | `tests/storage-paths.test.cjs`, `tests/migrate-data.test.js` |
| Guide and readability | `src/config/atom-guide-copy.ts`, `src/styles.css` | `tests/atom-guide-copy.test.ts`, `tests/atom-node-typography-contract.test.ts` |
| Runtime configuration | `plugin/runtime-config.cjs` and installation entry points | `tests/runtime-config.test.cjs` plus packaging, Hook, and integration suites |
