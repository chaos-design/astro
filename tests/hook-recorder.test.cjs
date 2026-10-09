const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const {
  appendTraceEvent,
  createDashboardUrl,
  createTraceEvent,
  launchDashboardForEvents,
  redactValue,
  resolveAstroHome,
  resolveTraceFile,
} = require("../plugin/hook-recorder.cjs");
const { formatSessionPath } = require("../plugin/storage-paths.cjs");

test("redacts sensitive keys and inline credentials", () => {
  const result = redactValue({
    apiKey: "secret-value",
    headers: { Authorization: "Bearer super-secret-token" },
    command: "curl -H 'Authorization: Bearer abcdefghijklmnop'",
  });

  assert.equal(result.apiKey, "[redacted]");
  assert.equal(result.headers.Authorization, "[redacted]");
  assert.match(result.command, /Bearer \[redacted\]/);
  assert.doesNotMatch(JSON.stringify(result), /super-secret|abcdefghijklmnop/);
});

test("normalizes hook input into a trace event", () => {
  const event = createTraceEvent(
    {
      session_id: "session-1",
      hook_event_name: "PreToolUse",
      tool_use_id: "tool-1",
      tool_name: "RunCommand",
      cwd: "/tmp/project",
    },
    {
      source: "claude",
      capturedAt: "2026-09-07T08:00:00.000Z",
    },
  );

  assert.equal(event.schemaVersion, 2);
  assert.equal(event.source, "claude");
  assert.equal(event.sessionId, "session-1");
  assert.equal(event.eventName, "PreToolUse");
  assert.equal(event.toolName, "RunCommand");
  assert.equal(event.capturedAt, "2026-09-07T08:00:00.000Z");
  assert.match(event.locator, /^trace:\/\/claude\/session-1\//);
});

test("preserves retryable StopFailure events for waiting-state detection", () => {
  const event = createTraceEvent(
    {
      session_id: "session-rate-limit",
      hook_event_name: "stop_failure",
      reason: "rate_limit",
      error: "Too many requests; retry_after=3",
      cwd: "/tmp/project",
    },
    {
      source: "Claude Code",
      capturedAt: "2026-09-07T08:00:00.000Z",
    },
  );

  assert.equal(event.eventName, "StopFailure");
  assert.equal(event.nativeEventName, "stop_failure");
  assert.equal(event.status, "failed");
});

test("normalizes CodeBuddy input to the WorkBuddy source", () => {
  const event = createTraceEvent(
    {
      session_id: "workbuddy-session",
      hook_event_name: "UserPromptSubmit",
      prompt: "Inspect this workspace",
      cwd: "/tmp/project",
    },
    {
      source: "CodeBuddy Code",
      capturedAt: "2026-09-07T08:00:00.000Z",
    },
  );

  assert.equal(event.source, "workbuddy");
  assert.equal(event.eventName, "UserPromptSubmit");
});

test("appends one valid JSONL event to the configured directory", () => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "trae-trace-"));
  const environment = {
    TRAE_PROJECT_DIR: projectDir,
    TRAE_TRACE_DIR: "capture",
  };
  const payload = {
    session_id: "session-2",
    hook_event_name: "Stop",
    last_assistant_message: "Done",
  };

  const event = appendTraceEvent(payload, environment);
  const traceFile = resolveTraceFile(payload, environment);
  const lines = fs.readFileSync(traceFile, "utf8").trim().split("\n");

  assert.equal(lines.length, 1);
  assert.deepEqual(JSON.parse(lines[0]), event);
  fs.rmSync(projectDir, { recursive: true, force: true });
});

test("accepts a minimal generic event envelope without nesting payload", () => {
  const event = createTraceEvent(
    {
      id: "browser-event",
      sessionId: "browser-session",
      eventName: "AgentMessage",
      payload: { message: "Done" },
    },
    { source: "browser" },
  );

  assert.deepEqual(event.payload, { message: "Done" });
  assert.equal(event.source, "browser");
  assert.equal(event.sessionId, "browser-session");
});

test("stores each agent under the configured ASTRO data root", () => {
  const astroHome = fs.mkdtempSync(path.join(os.tmpdir(), "astro-home-"));
  const environment = { ASTRO_HOME: astroHome };
  const payload = {
    session_id: "session-3",
    hook_event_name: "SessionStart",
  };

  const event = appendTraceEvent(payload, environment, {
    source: "Claude Code",
    capturedAt: "2026-09-07T08:00:00.000Z",
  });
  const traceFile = resolveTraceFile(event, environment, {
    source: "Claude Code",
  });

  assert.equal(
    traceFile,
    path.join(
      astroHome,
      "claude",
      ...formatSessionPath(
        new Date("2026-09-07T08:00:00.000Z"),
        "session-3",
      ),
      "events.jsonl",
    ),
  );
  assert.equal(fs.existsSync(traceFile), true);
  fs.rmSync(astroHome, { recursive: true, force: true });
});

test("prefers ASTRO_HOME while accepting AOT_HOME as a legacy fallback", () => {
  assert.equal(
    resolveAstroHome({
      ASTRO_HOME: "/tmp/astro-new",
      AOT_HOME: "/tmp/astro-legacy",
    }),
    "/tmp/astro-new",
  );
  assert.equal(
    resolveAstroHome({ AOT_HOME: "/tmp/astro-legacy" }),
    "/tmp/astro-legacy",
  );
  assert.equal(
    resolveAstroHome({ ASTRO_HOME: "~/.astrox" }),
    path.join(os.homedir(), ".astrox"),
  );
});

test("uses the shared user data root for Trae hooks", () => {
  assert.equal(
    resolveAstroHome({
      TRAE_PROJECT_DIR: "/tmp/trae-project",
    }),
    path.join(os.homedir(), ".astrox"),
  );
  assert.equal(
    resolveTraceFile(
      {
        capturedAt: "2026-09-07T08:00:00.000Z",
        cwd: "/tmp/trae-project",
        sessionId: "trae-session",
      },
      { TRAE_PROJECT_DIR: "/tmp/trae-project" },
      { source: "trae" },
    ),
    path.join(
      os.homedir(),
      ".astrox",
      "trae",
      ...formatSessionPath(
        new Date("2026-09-07T08:00:00.000Z"),
        "trae-session",
      ),
      "events.jsonl",
    ),
  );
});

test("keeps later events from the same session in its first time directory", () => {
  const astroHome = fs.mkdtempSync(path.join(os.tmpdir(), "astro-session-"));
  const environment = { ASTRO_HOME: astroHome };
  const first = appendTraceEvent(
    {
      session_id: "long-session",
      hook_event_name: "SessionStart",
      timestamp: "2026-09-07T08:59:59.000Z",
    },
    environment,
    { source: "trae" },
  );
  const second = appendTraceEvent(
    {
      session_id: "long-session",
      hook_event_name: "Stop",
      timestamp: "2026-09-08T09:00:01.000Z",
    },
    environment,
    { source: "trae" },
  );

  assert.equal(
    resolveTraceFile(first, environment, { source: "trae" }),
    resolveTraceFile(second, environment, { source: "trae" }),
  );
  assert.equal(
    fs.readFileSync(
      resolveTraceFile(first, environment, { source: "trae" }),
      "utf8",
    ).trim().split("\n").length,
    2,
  );
  fs.rmSync(astroHome, { recursive: true, force: true });
});

test("launches the dashboard once after a submitted prompt", () => {
  const astroHome = fs.mkdtempSync(path.join(os.tmpdir(), "astro-launch-"));
  const environment = {
    ASTRO_HOME: astroHome,
    ASTRO_PORT: "4400",
  };
  let spawnCount = 0;
  let spawnOptions;
  const dependencies = {
    dashboardFile: "/tmp/astro/server/server.mjs",
    isProcessRunning: () => false,
    probeDashboardPort: () => ({ state: "free" }),
    spawn: (_command, _arguments, options) => {
      spawnCount += 1;
      spawnOptions = options;
      return { pid: 43210, unref() {} };
    },
  };

  assert.equal(
    launchDashboardForEvents(
      [{
        eventName: "UserPromptSubmit",
        source: "trae",
        sessionId: "session-live",
      }],
      environment,
      dependencies,
    ),
    true,
  );
  assert.equal(spawnCount, 1);
  assert.equal(spawnOptions.env.ASTRO_OPEN_BROWSER, "1");
  assert.equal(spawnOptions.env.ASTRO_OPEN_SOURCE, "trae");
  assert.equal(spawnOptions.env.ASTRO_OPEN_SESSION, "session-live");
  assert.equal(
    JSON.parse(
      fs.readFileSync(path.join(astroHome, "dashboard-4400.pid"), "utf8"),
    ).pid,
    43210,
  );
  assert.equal(
    launchDashboardForEvents(
      [{
        eventName: "UserPromptSubmit",
        source: "trae",
        sessionId: "session-live",
      }],
      environment,
      {
        ...dependencies,
        isProcessRunning: (pid) => pid === 43210,
        onAlreadyRunning: (message) => assert.match(message, /already starting/),
      },
    ),
    false,
  );
  assert.equal(spawnCount, 1);
  fs.rmSync(astroHome, { recursive: true, force: true });
});

test("only reopens an installed dashboard when explicitly requested", () => {
  const astroHome = fs.mkdtempSync(path.join(os.tmpdir(), "astro-reopen-"));
  const dashboardFile = "/tmp/astro/server/server.mjs";
  const pidFile = path.join(astroHome, "dashboard-4400.pid");
  fs.writeFileSync(
    pidFile,
    `${JSON.stringify({
      pid: 43210,
      server: dashboardFile,
      url: "http://127.0.0.1:4402",
    })}\n`,
    "utf8",
  );
  let openedUrl = "";

  assert.equal(
    launchDashboardForEvents(
      [{
        eventName: "SessionStart",
        source: "trae",
        sessionId: "session-current",
      }],
      { ASTRO_HOME: astroHome, ASTRO_PORT: "4400" },
      {
        dashboardFile,
        isProcessRunning: () => true,
        reopenExisting: true,
        openDashboard: (url) => {
          openedUrl = url;
          return true;
        },
      },
    ),
    true,
  );
  assert.equal(
    openedUrl,
    createDashboardUrl("http://127.0.0.1:4402", {
      source: "trae",
      sessionId: "session-current",
    }),
  );
  fs.rmSync(astroHome, { recursive: true, force: true });
});

test("notifies instead of opening tabs for repeated prompts and new sessions", (t) => {
  const astroHome = fs.mkdtempSync(path.join(os.tmpdir(), "astro-reuse-"));
  t.after(() => fs.rmSync(astroHome, { recursive: true, force: true }));
  const dashboardFile = "/tmp/astro/server/server.mjs";
  const pidFile = path.join(astroHome, "dashboard-4400.pid");
  const record = JSON.stringify({
    pid: 43210,
    server: dashboardFile,
    url: "http://127.0.0.1:4402",
  });
  fs.writeFileSync(pidFile, record);

  for (const sessionId of ["session-first", "session-next"]) {
    for (const eventName of ["SessionStart", "UserPromptSubmit"]) {
      let notice = "";
      const event = { eventName, sessionId, source: "trae" };
      const launched = launchDashboardForEvents(
        [event],
        { ASTRO_HOME: astroHome, ASTRO_PORT: "4400" },
        {
          dashboardFile,
          isProcessRunning: (pid) => pid === 43210,
          openDashboard: () => assert.fail("must not open another tab"),
          spawn: () => assert.fail("must not start another server"),
          onAlreadyRunning: (message) => { notice = message; },
        },
      );
      assert.equal(launched, false);
      assert.ok(notice.includes(createDashboardUrl("http://127.0.0.1:4402", event)));
      assert.match(notice, /Switch to the existing dashboard tab or refresh/);
      assert.equal(fs.readFileSync(pidFile, "utf8"), record);
    }
  }
});

test("disabled auto-open does not launch, reopen, or notify", () => {
  assert.equal(launchDashboardForEvents(
    [{ eventName: "SessionStart" }],
    { ASTRO_AUTO_OPEN: "0" },
    {
      dashboardFile: "/tmp/astro/server/server.mjs",
      spawn: () => assert.fail("must not launch"),
      openDashboard: () => assert.fail("must not open"),
      onAlreadyRunning: () => assert.fail("must not notify"),
    },
  ), false);
});

test("hook output reports the reused page and preserves quiet-mode stdout", (t) => {
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), "astro-hook-output-"));
  t.after(() => fs.rmSync(runtime, { recursive: true, force: true }));
  for (const directory of ["plugin", "server", "dist"]) {
    fs.mkdirSync(path.join(runtime, directory));
  }
  for (const file of [
    "runtime-config.cjs",
    "trace-recorder.cjs",
    "storage-paths.cjs",
  ]) {
    fs.copyFileSync(
      path.join(__dirname, "..", "plugin", file),
      path.join(runtime, "plugin", file),
    );
  }
  for (const file of ["config.example.yaml", ".env.example"]) {
    fs.copyFileSync(
      path.join(__dirname, "..", file),
      path.join(runtime, file),
    );
  }
  fs.cpSync(
    path.join(__dirname, "..", "codex-plugin", "plugin", "vendor"),
    path.join(runtime, "plugin", "vendor"),
    { recursive: true },
  );
  const dashboardFile = path.join(runtime, "server", "server.mjs");
  fs.writeFileSync(dashboardFile, "");
  fs.writeFileSync(path.join(runtime, "dist", "index.html"), "");
  fs.writeFileSync(path.join(runtime, "dashboard-4400.pid"), JSON.stringify({
    pid: process.pid,
    server: dashboardFile,
    url: "http://127.0.0.1:4402",
  }));

  for (const quiet of [false, true]) {
    const result = spawnSync(
      process.execPath,
      [
        path.join(runtime, "plugin", "trace-recorder.cjs"),
        "--source=trae",
        ...(quiet ? ["--quiet"] : []),
      ],
      {
        encoding: "utf8",
        env: { ...process.env, ASTRO_HOME: runtime, ASTRO_PORT: "4400", ASTRO_AUTO_OPEN: "1" },
        input: JSON.stringify({ hook_event_name: "SessionStart", session_id: "output-session" }),
        timeout: 5_000,
      },
    );
    assert.equal(result.status, 0);
    if (quiet) {
      assert.equal(result.stdout, "");
      assert.match(result.stderr, /ASTRO is already running/);
    } else {
      const output = JSON.parse(result.stdout);
      assert.equal(output.continue, true);
      assert.match(output.systemMessage, /ASTRO is already running/);
      assert.match(output.systemMessage, /session=output-session/);
      assert.equal(result.stderr, "");
    }
  }
});

test("reuses a compatible dashboard from another ASTRO installation", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "astro-compatible-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const createRuntime = (name) => {
    const runtime = path.join(root, name);
    for (const directory of ["dist", "plugin", "server"]) {
      fs.mkdirSync(path.join(runtime, directory), { recursive: true });
    }
    fs.writeFileSync(path.join(runtime, "dist", "index.html"), "");
    fs.writeFileSync(
      path.join(runtime, "plugin", "trace-recorder.cjs"),
      "",
    );
    const dashboardFile = path.join(runtime, "server", "server.mjs");
    fs.writeFileSync(dashboardFile, "");
    return dashboardFile;
  };
  const existingDashboard = createRuntime("native-plugin");
  const requestedDashboard = createRuntime("shared-runtime");
  const astroHome = path.join(root, "data");
  fs.mkdirSync(astroHome);
  fs.writeFileSync(
    path.join(astroHome, "dashboard-4401.pid"),
    `${JSON.stringify({
      pid: 12345,
      server: existingDashboard,
      url: "http://127.0.0.1:4401",
    })}\n`,
  );
  let notice = "";

  assert.equal(
    launchDashboardForEvents(
      [{ eventName: "SessionStart", source: "codex" }],
      { ASTRO_HOME: astroHome, ASTRO_PORT: "4401" },
      {
        dashboardFile: requestedDashboard,
        isProcessRunning: (pid) => pid === 12345,
        spawn: () => assert.fail("must not start another ASTRO server"),
        onAlreadyRunning: (message) => {
          notice = message;
        },
      },
    ),
    false,
  );
  assert.match(notice, /ASTRO is already running/);
});

test("restarts the dashboard when a stale pid belongs to another server", () => {
  const astroHome = fs.mkdtempSync(path.join(os.tmpdir(), "astro-stale-"));
  const pidFile = path.join(astroHome, "dashboard-4401.pid");
  fs.writeFileSync(
    pidFile,
    `${JSON.stringify({
      pid: 12345,
      server: "/tmp/old-astro/server/server.mjs",
    })}\n`,
    "utf8",
  );
  let spawnCount = 0;
  const dependencies = {
    dashboardFile: "/tmp/new-astro/server/server.mjs",
    isProcessRunning: (pid) => pid === 12345,
    probeDashboardPort: () => ({ state: "free" }),
    spawn: () => {
      spawnCount += 1;
      return { pid: 54321, unref() {} };
    },
  };

  assert.equal(
    launchDashboardForEvents(
      [{ eventName: "UserPromptSubmit" }],
      { ASTRO_HOME: astroHome, ASTRO_PORT: "4401" },
      dependencies,
    ),
    true,
  );

  const updatedPid = JSON.parse(fs.readFileSync(pidFile, "utf8"));
  assert.equal(spawnCount, 1);
  assert.equal(updatedPid.pid, 54321);
  assert.equal(updatedPid.server, dependencies.dashboardFile);
  fs.rmSync(astroHome, { recursive: true, force: true });
});

test("skips launching when an ASTRO instance already owns the port", (t) => {
  const astroHome = fs.mkdtempSync(path.join(os.tmpdir(), "astro-port-"));
  t.after(() => fs.rmSync(astroHome, { recursive: true, force: true }));
  const pidFile = path.join(astroHome, "dashboard-4400.pid");
  let notice = "";

  assert.equal(
    launchDashboardForEvents(
      [{
        eventName: "UserPromptSubmit",
        source: "trae",
        sessionId: "session-port",
      }],
      { ASTRO_HOME: astroHome, ASTRO_PORT: "4400" },
      {
        dashboardFile: "/tmp/astro/server/server.mjs",
        probeDashboardPort: () => ({
          state: "astro",
          pid: 999,
          url: "http://127.0.0.1:4400",
        }),
        spawn: () => assert.fail("must not start another server"),
        onAlreadyRunning: (message) => {
          notice = message;
        },
      },
    ),
    false,
  );
  assert.match(notice, /ASTRO is already running/);
  assert.match(notice, /session=session-port/);
  // The stale pid record is refreshed from the health probe payload.
  assert.deepEqual(JSON.parse(fs.readFileSync(pidFile, "utf8")), {
    pid: 999,
    server: "",
    url: "http://127.0.0.1:4400",
  });
});

test("skips launching when an unknown process occupies the port", (t) => {
  const astroHome = fs.mkdtempSync(path.join(os.tmpdir(), "astro-port-"));
  t.after(() => fs.rmSync(astroHome, { recursive: true, force: true }));
  let notice = "";

  assert.equal(
    launchDashboardForEvents(
      [{ eventName: "SessionStart", source: "trae" }],
      { ASTRO_HOME: astroHome, ASTRO_PORT: "4400" },
      {
        dashboardFile: "/tmp/astro/server/server.mjs",
        probeDashboardPort: () => ({ state: "occupied" }),
        spawn: () => assert.fail("must not start another server"),
        onAlreadyRunning: (message) => {
          notice = message;
        },
      },
    ),
    false,
  );
  assert.match(notice, /Port 4400 is already in use/);
  assert.equal(
    fs.existsSync(path.join(astroHome, "dashboard-4400.pid")),
    false,
  );
});

test("reopens the dashboard found by the port probe when requested", (t) => {
  const astroHome = fs.mkdtempSync(path.join(os.tmpdir(), "astro-port-"));
  t.after(() => fs.rmSync(astroHome, { recursive: true, force: true }));
  let openedUrl = "";

  assert.equal(
    launchDashboardForEvents(
      [{
        eventName: "UserPromptSubmit",
        source: "trae",
        sessionId: "session-reopen",
      }],
      { ASTRO_HOME: astroHome, ASTRO_PORT: "4400" },
      {
        dashboardFile: "/tmp/astro/server/server.mjs",
        reopenExisting: true,
        probeDashboardPort: () => ({
          state: "astro",
          pid: 999,
          url: "http://127.0.0.1:4400",
        }),
        openDashboard: (url) => {
          openedUrl = url;
          return true;
        },
        spawn: () => assert.fail("must not start another server"),
      },
    ),
    true,
  );
  assert.equal(
    openedUrl,
    createDashboardUrl("http://127.0.0.1:4400", {
      source: "trae",
      sessionId: "session-reopen",
    }),
  );
});
