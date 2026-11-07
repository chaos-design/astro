#!/usr/bin/env node
/**
 * Repeatable performance fixture for the streaming derive pipeline.
 *
 * AGENTS.md asks that performance work lands with before/after numbers from
 * the same fixture and script. This is that script: it generates a synthetic
 * history shaped like real capture data (one executing session with a long
 * prompt-run history plus a set of finished sessions), so every optimization
 * pass measures against identical input.
 *
 * Two modes:
 *
 *   --write  drop ready-to-load `events.jsonl` files into an ASTRO_HOME tree
 *            (the service walks for `events.jsonl`, so this layout is all
 *            it needs):
 *
 *              <home>/<source>/<session>/events.jsonl
 *
 *   --inject POST the same events, in batches, at a running service and time
 *            each round trip (server-side append + broadcast cost):
 *
 *              node scripts/perf-fixture.mjs --inject --port 4401
 *
 * The client side is measured with the built-in HUD: open the console at
 * `?perf=1` against a service that serves this fixture (either written to a
 * scratch ASTRO_HOME or injected) and read `window.__astroPerf.snapshot()`
 * after the snapshot lands and a few live batches have streamed.
 *
 * Defaults target the known bottleneck: one session whose newest prompt has
 * accumulated tens of thousands of events, so every 120 ms batch re-derives
 * that one session's prompt runs, state, and canvas projections.
 */

import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";

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

const sessions = Number(flagValue("sessions", "30"));
const finishedEvents = Number(flagValue("events", "200"));
const liveEvents = Number(flagValue("live-events", "20000"));
const batch = Number(flagValue("batch", "400"));
const source = flagValue("source", "zcode");
const home = flagValue("home", "/tmp/astro-perf-fixture");
const port = Number(flagValue("port", "5678"));
const inject = Boolean(flags.inject);
const write = Boolean(flags.write);

if (!inject && !write) {
  console.error(
    "usage: node scripts/perf-fixture.mjs --write [--home DIR] | --inject [--port N]",
  );
  console.error("  --sessions N        finished sessions (default 30)");
  console.error("  --events N          tool events per finished session (default 200)");
  console.error("  --live-events N     events in the executing session's newest prompt (default 20000)");
  console.error("  --inject            POST the fixture at a running service (timed)");
  console.error("  --write             write events.jsonl files into an ASTRO_HOME tree");
  process.exit(1);
}

const prompts = [
  "设置一个定时任务，从晚上 23 点到早上 9 点，每隔 45 分钟执行一次服务巡检",
  "定时任务：生成与 Agent 相关的面试真题，按难度分级输出并附参考答案要点",
  "梳理仓库的测试脚本，补齐缺失用例的说明文档并归档到 docs",
  "把事件派生流水线改成增量式，避免每个批次重算整段历史",
];

function minutesAgoIso(minutes) {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

/** One canonical event, shaped exactly like a recorder-produced record. */
function canonicalEvent(sessionId, capturedAt, eventName, payload, extra) {
  return {
    schemaVersion: 2,
    id: randomUUID(),
    capturedAt,
    source,
    sourceVersion: null,
    workspaceId: "perf-fixture-workspace",
    sessionId,
    turnId: payload.turn_id || null,
    parentId: null,
    eventName,
    nativeEventName: eventName,
    toolUseId: extra?.toolUseId ?? null,
    toolName: extra?.toolName ?? null,
    cwd: "/tmp/astro-perf-fixture-project",
    status: extra?.status ?? null,
    sequence: extra?.sequence ?? null,
    payload,
    locator: `trace://${source}/${sessionId}/${randomUUID()}`,
  };
}

function buildFinishedSession(index) {
  const sessionId = `perf-finished-${String(index).padStart(2, "0")}`;
  const start = Date.parse(minutesAgoIso(480 - index * 14));
  const prompt = prompts[index % prompts.length];
  const events = [
    canonicalEvent(
      sessionId,
      new Date(start).toISOString(),
      "SessionStart",
      { model: "ACCOUNT:BIGMODEL-START-PLAN/GLM-5.3-Flash" },
    ),
    canonicalEvent(
      sessionId,
      new Date(start + 400).toISOString(),
      "UserPromptSubmit",
      { prompt, turn: 1, turn_id: `perf-turn-${index}` },
    ),
  ];
  // A finished session is one prompt of repeated tool work. Payloads stay
  // small: the fixture measures the derive pipeline, not JSON sizes.
  for (let step = 0; step < finishedEvents; step += 1) {
    const toolUseId = randomUUID();
    const toolName = step % 2 ? "Bash" : "Read";
    const when = start + 500 + step * 30;
    events.push(
      canonicalEvent(
        sessionId,
        new Date(when).toISOString(),
        "PreToolUse",
        { tool_name: toolName, tool_input: { command: `step-${step} --index ${index}` } },
        { toolUseId, toolName, sequence: step },
      ),
      canonicalEvent(
        sessionId,
        new Date(when + 20).toISOString(),
        "PostToolUse",
        { tool_name: toolName, tool_response: { exitCode: 0, output: `ok ${step}` } },
        { toolUseId, toolName, sequence: step + 1 },
      ),
    );
  }
  events.push(
    canonicalEvent(
      sessionId,
      new Date(start + 500 + finishedEvents * 31).toISOString(),
      "Stop",
      { responseText: "任务完成。" },
      { status: "complete" },
    ),
  );
  return { sessionId, events };
}

/** The executing session: three closed prompts plus one open, long one. */
function buildLiveSession() {
  const sessionId = "perf-live-01";
  const openStart = Date.now() - 60_000;
  const closedStart = openStart - 5 * 60_000;
  const events = [
    canonicalEvent(
      sessionId,
      new Date(closedStart).toISOString(),
      "SessionStart",
      { model: "ACCOUNT:BIGMODEL-START-PLAN/GLM-5.3-Flash" },
    ),
  ];
  for (const promptIndex of [0, 1]) {
    const when = closedStart + promptIndex * 90_000;
    events.push(
      canonicalEvent(
        sessionId,
        new Date(when).toISOString(),
        "UserPromptSubmit",
        { prompt: prompts[promptIndex], turn: promptIndex + 1, turn_id: `perf-live-${promptIndex + 1}` },
      ),
    );
    for (let step = 0; step < 40; step += 1) {
      const toolUseId = randomUUID();
      const toolWhen = when + 500 + step * 30;
      events.push(
        canonicalEvent(
          sessionId,
          new Date(toolWhen).toISOString(),
          "PreToolUse",
          { tool_name: "Bash", tool_input: { command: `live-${promptIndex}-${step}` } },
          { toolUseId, toolName: "Bash", sequence: step },
        ),
        canonicalEvent(
          sessionId,
          new Date(toolWhen + 20).toISOString(),
          "PostToolUse",
          { tool_name: "Bash", tool_response: { exitCode: 0 } },
          { toolUseId, toolName: "Bash", sequence: step + 1 },
        ),
      );
    }
    events.push(
      canonicalEvent(
        sessionId,
        new Date(when + 500 + 40 * 31).toISOString(),
        "Stop",
        { responseText: "已完成。" },
        { status: "complete" },
      ),
    );
  }
  // The open prompt: a large history ending in a recent final event, so the
  // run is fresh (inside the live window) when the console opens.
  events.push(
    canonicalEvent(
      sessionId,
      new Date(openStart).toISOString(),
      "UserPromptSubmit",
      { prompt: prompts[3], turn: 4, turn_id: "perf-live-4" },
    ),
  );
  const stepMs = Math.max(1, Math.floor((60_000 - 200) / Math.max(1, liveEvents)));
  for (let step = 0; step < liveEvents; step += 1) {
    const toolUseId = randomUUID();
    const toolName = step % 3 === 0 ? "Read" : "Bash";
    events.push(
      canonicalEvent(
        sessionId,
        new Date(openStart + step * stepMs).toISOString(),
        "PreToolUse",
        { tool_name: toolName, tool_input: { index: step } },
        { toolUseId, toolName, sequence: step },
      ),
    );
  }
  events.push(
    canonicalEvent(
      sessionId,
      new Date(Date.now() - 10_000).toISOString(),
      "PostToolUse",
      { tool_name: "Bash", tool_response: { exitCode: 0 } },
      { toolUseId: randomUUID(), toolName: "Bash", sequence: liveEvents },
    ),
  );
  return { sessionId, events };
}

const all = [
  buildLiveSession(),
  ...Array.from({ length: sessions }, (_, index) => buildFinishedSession(index)),
];
const totalEvents = all.reduce((sum, session) => sum + session.events.length, 0);

if (write) {
  // The default scratch home is replaced wholesale: a previous fixture's
  // timestamps would otherwise age the live run out of the window.
  if (home === "/tmp/astro-perf-fixture") {
    rmSync(home, { recursive: true, force: true });
  }
  for (const session of all) {
    const directory = `${home}/${source}/${session.sessionId}`;
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      `${directory}/events.jsonl`,
      `${session.events.map((event) => JSON.stringify(event)).join("\n")}\n`,
      "utf8",
    );
  }
  console.log(`wrote ${totalEvents} events (${all.length} sessions) under ${home}`);
  console.log(`open the service against it: ASTRO_HOME=${home} node server/server.mjs, then the console at ?perf=1`);
}

if (inject) {
  const base = `http://127.0.0.1:${port}`;
  const flat = all.flatMap((session) => session.events);
  const started = performance.now();
  for (let offset = 0; offset < flat.length; offset += batch) {
    const chunk = flat.slice(offset, offset + batch);
    const roundStart = performance.now();
    const response = await fetch(`${base}/api/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(chunk),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(
        `inject batch ${Math.floor(offset / batch) + 1} failed: ${response.status} ${body.error ?? ""}`,
      );
    }
    const roundMs = performance.now() - roundStart;
    console.log(`batch ${Math.floor(offset / batch) + 1}: ${chunk.length} events in ${roundMs.toFixed(1)} ms`);
  }
  console.log(`injected ${flat.length} events at ${base} in ${Math.round(performance.now() - started)} ms`);
}
