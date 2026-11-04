#!/usr/bin/env node
/**
 * Before/after bench for the client-side derive pipeline.
 *
 * AGENTS.md: performance work lands with numbers from the same fixture and
 * script before and after. This script plays exactly what the console does
 * per streaming batch — the session projection, the prompt-run cache, and the
 * canvas projections over the active run — against a synthetic tail appended
 * to one long live session, and reports steady-state per-batch milliseconds
 * per phase.
 *
 * The input is the same fixture `scripts/perf-fixture.mjs --write` produces,
 * so before/after runs are comparable:
 *
 *   node scripts/perf-fixture.mjs --write
 *   node scripts/perf-derive-bench.mjs            # defaults
 *
 * Phases (steady state: the last `--batches - --warm` batches, mean ms):
 *   sessions        createSessionProjection over the growing event list
 *   prompt-runs     buildSessionPromptRuns for every session (WeakMap cached)
 *   flow            buildFlow over the active prompt run's events
 *   projection      projectTraceEvents over the same events
 *   topology        buildExecutionTopology over the same events
 *   first-derive    the one-off full projection over the fixture (ms, total)
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const flags = Object.fromEntries(
  process.argv.slice(2).map((value) => {
    const match = /^--(.+?)(?:=(.*))?$/.exec(value);
    if (!match) {
      return [value, true];
    }
    return [match[1], match[2] ?? true];
  }),
);

function flagValue(name, fallback) {
  return flags[name] !== undefined && flags[name] !== true
    ? String(flags[name])
    : fallback;
}

const home = flagValue("home", "/tmp/astro-perf-fixture");
const batches = Number(flagValue("batches", "200"));
const chunk = Number(flagValue("chunk", "100"));
const warm = Number(flagValue("warm", "40"));
const source = flagValue("source", "zcode");

/** Every `events.jsonl` under the fixture home, sorted chronologically. */
function readFixture(root) {
  const events = [];
  for (const sourceDir of readdirSync(root, { withFileTypes: true })) {
    if (!sourceDir.isDirectory() || sourceDir.name === "plugins") {
      continue;
    }
    const sourcePath = join(root, sourceDir.name);
    for (const sessionDir of readdirSync(sourcePath, { withFileTypes: true })) {
      if (!sessionDir.isDirectory()) {
        continue;
      }
      const file = join(sourcePath, sessionDir.name, "events.jsonl");
      let text;
      try {
        text = readFileSync(file, "utf8");
      } catch {
        continue;
      }
      for (const line of text.split("\n")) {
        if (line.trim()) {
          events.push(JSON.parse(line));
        }
      }
    }
  }
  events.sort(
    (left, right) =>
      Date.parse(left.capturedAt) - Date.parse(right.capturedAt) ||
      String(left.id).localeCompare(String(right.id)),
  );
  return events;
}

const base = readFixture(home);
const {
  createSessionProjection,
  buildSessionPromptRuns,
  buildFlow,
} = await import(new URL("../src/lib/trace-model.ts", import.meta.url));
const { projectTraceEvents } = await import(
  new URL("../src/lib/atomic-projection.ts", import.meta.url)
);
const { buildExecutionTopology } = await import(
  new URL("../src/lib/execution-topology.ts", import.meta.url)
);

// The live session is the one carrying the most events (the fixture's open
// prompt run); its tail is what a streaming agent would keep appending.
const counts = new Map();
for (const event of base) {
  counts.set(event.sessionId, (counts.get(event.sessionId) ?? 0) + 1);
}
let liveId = "";
for (const [id, count] of counts) {
  if (count > (counts.get(liveId) ?? 0)) {
    liveId = id;
  }
}
console.log(
  `fixture: ${base.length} events, live session ${liveId} (${counts.get(liveId)} events)`,
);

// The one-off full projection (the snapshot commit path).
const project = createSessionProjection();
const firstStart = performance.now();
project(base);
const firstMs = performance.now() - firstStart;

// A deterministic appended tail: tool work on the live session, ids and
// timestamps monotonic so re-runs stay stable.
const tail = [];
const tailedAt = Date.now();
for (let index = 0; index < batches * chunk; index += 1) {
  const toolUseId = `bench-tail-${index}`;
  const at = new Date(tailedAt + index * 3).toISOString();
  const toolName = index % 3 === 0 ? "Read" : "Bash";
  tail.push(
    {
      schemaVersion: 2,
      id: `bench-tail-${index}`,
      capturedAt: at,
      source,
      sourceVersion: null,
      workspaceId: "perf-fixture-workspace",
      sessionId: liveId,
      turnId: "bench-tail",
      parentId: null,
      eventName: "PreToolUse",
      nativeEventName: "PreToolUse",
      toolUseId,
      toolName,
      cwd: "/tmp/astro-perf-fixture-project",
      status: null,
      sequence: index * 2,
      payload: { tool_name: toolName, tool_input: { index } },
      locator: `trace://${source}/${liveId}/${toolUseId}`,
    },
    {
      schemaVersion: 2,
      id: `bench-tail-${index}-post`,
      capturedAt: at,
      source,
      sourceVersion: null,
      workspaceId: "perf-fixture-workspace",
      sessionId: liveId,
      turnId: "bench-tail",
      parentId: null,
      eventName: "PostToolUse",
      nativeEventName: "PostToolUse",
      toolUseId,
      toolName,
      cwd: "/tmp/astro-perf-fixture-project",
      status: null,
      sequence: index * 2 + 1,
      payload: { tool_name: toolName, tool_response: { exitCode: 0 } },
      locator: `trace://${source}/${liveId}/${toolUseId}`,
    },
  );
}

const totals = { sessions: 0, "prompt-runs": 0, flow: 0, projection: 0, topology: 0 };
let counted = 0;
let events = base;
let offset = 0;
let sessions;
for (let batch = 0; batch < batches; batch += 1) {
  const nextEnd = offset + chunk;
  offset = nextEnd;
  events = [...events, ...tail.slice(batch * chunk, nextEnd)];
  if (batch < warm) {
    continue;
  }
  counted += 1;
  const t0 = performance.now();
  sessions = project(events);
  const t1 = performance.now();
  const promptRuns = new Map(
    sessions.map((session) => [session.key, buildSessionPromptRuns(session)]),
  );
  const t2 = performance.now();
  const activeEvents =
    promptRuns.get(
      `${source}::perf-fixture-workspace::${liveId}`,
    )?.at(-1)?.events ?? [];
  buildFlow(activeEvents);
  const t3 = performance.now();
  projectTraceEvents(activeEvents, "codex");
  const t4 = performance.now();
  buildExecutionTopology(activeEvents, "codex");
  const t5 = performance.now();
  totals.sessions += t1 - t0;
  totals["prompt-runs"] += t2 - t1;
  totals.flow += t3 - t2;
  totals.projection += t4 - t3;
  totals.topology += t5 - t4;
}

const report = {
  fixture: { events: base.length, live: liveId, liveEvents: counts.get(liveId) },
  batch: { count: batches, chunk, warm, steady: Math.max(1, counted) },
  msPerBatch: {
    "first-derive": Number(firstMs.toFixed(2)),
  },
};
for (const phase of ["sessions", "prompt-runs", "flow", "projection", "topology"]) {
  report.msPerBatch[phase] = Number((totals[phase] / Math.max(1, counted)).toFixed(3));
}
console.log(JSON.stringify(report, null, 2));
