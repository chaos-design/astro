# ASTRO Operations and Troubleshooting

> For local installation, upgrades, permissions, data maintenance, and recovery. See the [User Manual](user-manual-en.md) for product workflows and the [Event Protocol Reference](event-protocol-en.md) for schema details.

## 1. Runtime Model

ASTRO has three independently operating parts:

1. **Recorder:** client hooks or an SDK append events to JSONL even when the dashboard is stopped.
2. **Local service:** discovers trace files, maintains in-memory indexes, and serves HTTP, SSE, and production assets.
3. **Browser console:** receives snapshots and increments over SSE, then builds sessions, trajectories, and topology in the browser.

A dashboard failure must not interrupt the agent. A recorder write failure is reported as a diagnostic while the hook still returns a continue result. That individual event cannot be recovered unless the producer has importable history.

## 2. Deployment Modes

| Mode | Use | Runtime source | Data root |
| --- | --- | --- | --- |
| Source production | Local use and post-development validation | checkout `dist` and `server` | `~/.astrox` |
| Development | React, service, or protocol changes | Vite + Node service | `~/.astrox` or override |
| Native Codex plugin | Codex marketplace/plugin support | embedded `codex-plugin` copy | `~/.astrox` |
| Native Claude plugin | Claude Code plugin support | embedded `claude-plugin` copy | `~/.astrox` |
| Native WorkBuddy plugin | CodeBuddy Code plugin support | embedded `workbuddy-plugin` copy | `~/.astrox` |
| DeepSeek Harness bundle | `dsh` profile plugin | embedded `deepseek-plugin` copy | `~/.astrox` |
| Direct hook install | Trae or clients without native plugins | `~/.astrox/plugins/astro` | `~/.astrox` |
| Portable archive | Installation from another workspace | unpacked tgz runtime | `~/.astrox` |

Do not install both a native plugin and direct hooks for the same client environment. Both receive the same lifecycle signals and create duplicate events.

## 3. First Deployment

### 3.1 Requirements

- a current Node.js LTS release;
- pnpm managed through Corepack;
- a writable `ASTRO_HOME`;
- an available loopback port;
- a browser with EventSource, Web Worker, and modern CSS support.

### 3.2 Build and start

```bash
corepack enable
pnpm install
pnpm test
pnpm typecheck
pnpm build
pnpm start
```

The preferred URL is `http://127.0.0.1:4318`. If occupied, the server tries up to 20 later ports and prints the selected URL.

### 3.3 Development mode

Vite reads `ASTRO_HOST` and `ASTRO_PORT`; its default proxy target is `http://127.0.0.1:4318`:

```bash
# Terminal 1
ASTRO_HOME="$HOME/.astrox" pnpm start

# Terminal 2
pnpm dev
```

When using a non-default API port, both processes need the same value:

```bash
# Terminal 1
ASTRO_PORT=4320 pnpm start

# Terminal 2
ASTRO_PORT=4320 pnpm dev
```

## 4. Runtime and Data Layout

```text
~/.astrox/
  plugins/astro/
    dist/
    plugin/
    server/
  dashboard-4318.pid
  trae/YYYY/MM-DD/HH_mm_ss-<sessionId>/events.jsonl
  claude/YYYY/MM-DD/HH_mm_ss-<sessionId>/events.jsonl
  codex/YYYY/MM-DD/HH_mm_ss-<sessionId>/events.jsonl
  deepseek/YYYY/MM-DD/HH_mm_ss-<sessionId>/events.jsonl
  workbuddy/YYYY/MM-DD/HH_mm_ss-<sessionId>/events.jsonl
  browser/YYYY/MM-DD/HH_mm_ss-<sessionId>/events.jsonl
  <custom-source>/YYYY/MM-DD/HH_mm_ss-<sessionId>/events.jsonl
```

Follow-up events reuse the first directory created for a session. Crossing a minute, an hour, or a `Stop` event does not split the session into another file.

### 4.1 Permissions

The client process needs permission to:

- create `~/.astrox` and nested source/date/session directories;
- append to `events.jsonl`;
- create, read, and remove `dashboard-<port>.pid`;
- read the standalone runtime under `~/.astrox/plugins/astro`.

A direct Codex install also writes `$CODEX_HOME/hooks.json`, normally `~/.codex/hooks.json`. A user-scoped Claude install writes `~/.claude/settings.json`. A project-scoped Trae install writes `<workspace>/.trae/hooks.json`. DeepSeek installation uses `dsh plugin` to update `$DSH_HOME/profiles/<profile>`, with `$DSH_HOME=~/.dsh` by default.

In a sandboxed IDE, explicitly allow writes to the actual `ASTRO_HOME` and the selected client configuration directory. Do not point `ASTRO_HOME` at a read-only checkout.

### 4.2 Quick permission check

```bash
mkdir -p "$HOME/.astrox"
test -w "$HOME/.astrox"
find "$HOME/.astrox" -type f -name events.jsonl -print
```

If a hook reports `ASTRO event was not recorded`, check permissions and confirm the hook and service resolve the same `ASTRO_HOME` first.

## 5. Configuration and Precedence

| Variable | Default | Purpose |
| --- | --- | --- |
| `ASTRO_HOST` | `127.0.0.1` | HTTP/SSE bind host and Vite proxy host. |
| `ASTRO_PORT` | `4318` | Preferred service port and PID filename port. |
| `ASTRO_HOME` | `~/.astrox` | Runtime and per-source data root. |
| `ASTRO_TRACE_DIR` | unset | Absolute or relative trace directory override. |
| `ASTRO_PROJECT_DIR` | current directory | Base for a relative trace directory. |
| `ASTRO_MAX_BODY_BYTES` | `5242880` | HTTP ingestion body limit. |
| `ASTRO_AUTO_OPEN` | `1` | Start the dashboard from installation or agent events. |
| `CODEX_HOME` | `~/.codex` | Codex configuration and history root. |

The installer creates `<ASTRO_HOME>/plugins/astro/config.yaml` and `.env` from
the repository templates. The recorder, CLI, service, installer, DeepSeek
adapter, and Vite proxy load the same files.

New `ASTRO_*` variables take precedence. `AOT_HOME`, `AGENT_TRACE_*`, and `TRAE_TRACE_*` remain compatibility fallbacks only.

The live-run timeout is a frontend build-time policy rather than a process
environment variable. Change `appTimings.activeRunTimeoutMs` in
`src/config/app-config.ts`; the default is 24 hours.

### 5.1 Changing the Live-Run Timeout

Use an explicit millisecond expression so reviews can verify the intended unit:

```ts
export const appTimings = {
  activeRunTimeoutMs: 24 * 60 * 60 * 1_000,
  // ...
} as const;
```

After changing the value:

```bash
pnpm test
pnpm typecheck
pnpm build
```

Restart the static service or reinstall packaged plugins when they carry their
own `dist/index.html`. No JSONL migration is required. A browser that still has
an older build open continues using the older timeout until refreshed.

Do not implement the setting independently in the server, recorder, or each
row component. Those paths would create conflicting status decisions. The
frontend config remains the single policy owner; pure display helpers receive
the policy as an argument.

### 5.2 Shared Runtime Configuration

The active files are:

```text
<ASTRO_HOME>/plugins/astro/config.yaml
<ASTRO_HOME>/plugins/astro/.env
```

The installer creates both files once and preserves them during upgrades.
Normal settings belong in YAML. Keep machine-specific or sensitive values in
`.env` and reference them as `${NAME}` or `${NAME:-fallback}` from YAML.

Precedence is CLI, inherited environment, legacy inherited environment, plugin
`.env`, legacy plugin `.env`, YAML, then built-in defaults. `ASTRO_HOME` is a
bootstrap setting and is ignored inside the plugin `.env`; use `--astro-home`
or set it in the parent process before installation.

Run `astro-trace doctor` after editing the files. It reports file validity and
configuration sources without displaying values.

## 6. Automatic Startup and PID Coordination

When the recorder writes `SessionStart` or `UserPromptSubmit`, it:

1. checks `ASTRO_AUTO_OPEN`;
2. locates the packaged server and built dashboard;
3. reads `dashboard-<requestedPort>.pid`;
4. reports the existing URL without opening duplicate tabs when a compatible service runs;
5. removes a stale or incompatible PID and starts a detached service;
6. waits for the service to select a port, then opens a source/session deep link.

Manual mode:

```bash
ASTRO_AUTO_OPEN=0 node ~/.astrox/plugins/astro/server/server.mjs
```

The PID file is coordination metadata, not trace data. Remove it only after confirming its process no longer exists.

## 7. Health Checks

### 7.1 Service health

```bash
curl -s http://127.0.0.1:4318/api/health
```

| Field | Meaning |
| --- | --- |
| `status` | `ok` for a healthy service. |
| `pid` | Service process ID. |
| `url` | Selected listening URL. |
| `clientCount` | Connected SSE clients. |
| `eventCount` | Aggregated repository event count. |
| `dataRoot` | Actual scanned root. |
| `traceFiles` | Every currently discovered JSONL file. |

Treat `dataRoot` and `traceFiles` as authoritative when diagnosing path mismatches.

### 7.2 Events and stream

```bash
curl -s http://127.0.0.1:4318/api/events
curl -N http://127.0.0.1:4318/api/stream
```

The stream should emit `reset` first and `ready` second. New writes produce `trace`. The server advertises a one-second reconnect delay and sends another full reset after reconnect to repair missed events.

### 7.3 CLI doctor

`astro-trace doctor` verifies the standalone runtime, dashboard, Codex/Claude
native or direct integrations, the DeepSeek Harness profile bundle, and the
actual file count and byte total under each session-partitioned source
directory. `DATA` means at least one non-empty `events.jsonl` exists; use
`/api/health.traceFiles` to confirm the files loaded by the running service.

## 8. Continuous Multi-turn Acceptance Test

Expected sequence for one session:

```text
SessionStart
UserPromptSubmit  turn 1
AgentMessage      turn 1
Stop              turn 1
UserPromptSubmit  turn 2
AgentMessage      turn 2
Stop              turn 2
```

Verify that:

- hooks remain active after `Stop`;
- repeated question or answer text still receives distinct IDs;
- every event appends to the same session directory;
- an open SSE connection receives every follow-up;
- reconnect `reset` includes events emitted while disconnected;
- Run History expands the session into `INITIAL` and numbered `FOLLOW-UP`
  children, each with only its own prompt interval;
- selecting an older child scopes topology, trajectory, log, replay, and export
  to that interval; clicking the parent returns to the latest prompt;
- active duration advances every second, stops after completion, and resumes
  its live calculation after a new prompt; at the 24-hour default limit it is
  capped and displayed as `terminated`.

### 8.1 Timeout Acceptance Matrix

For practical manual verification, temporarily use a short test-only value,
rebuild, and restore the default before release.

| Case | Setup | Expected result |
| --- | --- | --- |
| Before threshold | inspect an active Prompt at `limit - 1 ms` | status remains `active`; duration is not capped |
| Exact threshold | advance the same Prompt to `limit` | status becomes `terminated`; duration equals `limit` |
| Beyond threshold | advance to more than `limit` | duration remains equal to `limit` |
| Waiting Prompt | produce a permission/user-question wait and cross the limit | child becomes `terminated`; no synthetic event appears |
| Waiting parent | latest child is waiting | parent duration freezes and parent remains `waiting` |
| Historical terminal run | load a complete run longer than the test limit | original status and duration remain unchanged |
| Reload | refresh an expired selected run | the same effective state is reconstructed |

Confirm the selected expired run has no running log marker or live topology
transition. Export its JSONL and verify that no timeout event was appended.

## 9. Backup and Restore

### 9.1 Full backup

Stop active producers for a consistent snapshot, or accept that files may continue growing during the copy:

```bash
cp -R "$HOME/.astrox" "$HOME/.astrox-backup-$(date +%Y%m%d-%H%M%S)"
```

The PID file and `plugins/astro` can be regenerated. Source session directories contain the durable observations.

### 9.2 One session

Copy the session `events.jsonl` for a complete session backup. **Export run** in
the UI exports the selected prompt interval as
`astro-<source>-<sessionId>-prompt-<number>.jsonl`; it remains canonical JSONL
and can be imported again.

### 9.3 Restore

Place source session directories back under `ASTRO_HOME` and start the service. The repository discovers new files every 500 ms and emits a full reset. Canonical JSONL can also be restored through `astro-trace ingest`.

## 10. Migration

The direct hook installer renames legacy `HH:mm:ss-<sessionId>` directories to
the canonical `HH_mm_ss-<sessionId>` layout. It also migrates project-local
`.agent-trace/events.jsonl`, legacy `.aot` roots, flat
`.astrox/<source>/events.jsonl`, and project-local session-partitioned ASTRO
data.

```bash
node bin/astro.mjs migrate
node bin/astro.mjs migrate /path/to/events.jsonl
node bin/astro.mjs migrate /path/to/legacy-root
```

Layout migration removes a legacy directory only after a successful rename or
conflict-safe merge. Imported sources are retained, and duplicate event IDs are
skipped. Native marketplace installation does not run repository migration
scripts automatically.

## 11. Upgrade Procedure

```bash
git pull
pnpm install
pnpm test
pnpm typecheck
pnpm build
pnpm build:native-plugins
```

Reinstall the selected native plugin or rerun `pnpm install-plugins`. The direct installer updates ASTRO commands while preserving unrelated hooks.

Before and after upgrade, confirm the data root is unchanged, native recorder copies are synchronized, old sessions remain readable, new follow-up turns append, production empty state contains no Demo, and local UI preferences migrate.

## 12. Browser-local State

| Key | Values | Purpose |
| --- | --- | --- |
| `ASTROX_THEME` | `light`, `dark`, `system` | Theme. |
| `ASTROX_PLATFORM` | `codex`, `claude`, `deepseek`, `trae`, `workbuddy` | Topology platform context. |
| `ASTROX_HISTORY_OPEN` | boolean string | Left History panel. |
| `ASTROX_CONSOLE_OPEN` | boolean string | Right Events/Inspector panel. |

Legacy `astro-theme` and `astro-platform` values are read and removed after writing the new key. If localStorage is unavailable, preferences remain page-local and trace data is unaffected.

## 13. Environment and Demo Boundary

- Vite development and test modes may show built-in Demo events when the real count is zero.
- A production build must preserve a truthful empty state and never synthesize a run.
- Demo presentation does not change server `eventCount` or write JSONL.
- Use `/api/health` and `/api/events` as the source of truth during diagnosis.

## 14. Incident Matrix

| Symptom | Check first | Recovery |
| --- | --- | --- |
| Page does not open | process, port, `dist/index.html` | Start manually and use the printed URL. |
| UI says offline | `/api/stream`, Vite proxy | Align `ASTRO_HOST/PORT`; restore SSE. |
| First turn exists, follow-ups do not | loaded hooks and growing JSONL | Reload client configuration; ensure `Stop` did not remove hooks. |
| JSONL grows, UI does not | `dataRoot`, `traceFiles`, SSE reset | Align roots; reconnect or restart service. |
| Follow-up exists but is not listed | Prompt hierarchy and selected session | Expand the session row; verify each `UserPromptSubmit` has a unique event ID. |
| Recorder reports no write | permissions and disk state | Restore access/space; re-import history when available. |
| Duplicate events | native plugin plus direct hook | Keep one integration per client. |
| Events return after clear | active hooks still append | Stop the agent before clearing. |
| Port is not 4318 | preferred port occupied | Use the printed/PID URL or release the port. |
| Active duration is frozen | session status, timeout, and page JavaScript | Confirm the latest event is a new prompt and the page is running; `terminated` at 24 hours is expected by default. |
| Parent is waiting while child duration still advances | latest Prompt is a waiting state | Expected: parent rows advance only for active; waiting child rows keep their own clock until timeout. |
| Terminated status has no matching JSONL event | displayed duration equals timeout | Expected derived state; use Raw/export to rule out explicit interrupt or cancel evidence. |
| Demo appears in production | dev server or stale build | Rebuild production and serve through the local service. |

## 15. Capacity and Maintenance

The current model targets local single-machine observation:

- repository and browser hold the full event set;
- `GET /api/events` has no pagination;
- search scans nested fields without an index;
- JSONL has no automatic rotation, compression, or retention;
- new files are discovered every 500 ms and each file is polled every 250 ms;
- routing defaults to at most 500 nodes and 1,000 edges.

Archive old date directories while the service is stopped for long-running installations. Team deployment requires authentication, TLS, authorization, persistent indexing, pagination, and retention policy.

## 16. Release Checklist

- `pnpm test`: all current 182 tests pass.
- `pnpm typecheck`: no TypeScript errors.
- `pnpm build`: production build succeeds.
- `pnpm build:native-plugins`: native copies are synchronized.
- Source production and development modes connect to the expected API.
- All hook clients record repeated-text follow-up turns.
- Initial and reconnected SSE streams send a complete reset first.
- Multi-prompt sessions expose isolated `INITIAL` and `FOLLOW-UP` child runs.
- Selecting a child scopes topology, log, replay, deep links, and export.
- Active duration ticks, caps at 24 hours by default, and changes to `terminated`.
- Threshold checks pass immediately before, exactly at, and after the limit.
- Waiting child, frozen waiting parent, historical terminal duration, and
  reload reconstruction match the acceptance matrix.
- Expired selections stop running markers and topology transitions without
  adding a timeout event.
- History, Events, theme, and platform preferences survive refresh.
- Production empty state contains no Demo.
- Import, export, clear, and deep links work.
- The dashboard and presentation have no overlap at their target desktop viewports and scale down without horizontal overflow.
