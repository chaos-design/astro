const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const test = require("node:test");

/**
 * The recorder runs inside the agent's hook, so the host owns its deadline.
 * A pipe the host forgets to close used to hold the recorder until that
 * deadline; ZCode logged it as `PreToolUse` `outcome: timed_out` at 5005ms.
 * These tests pin the two budgets: a stalled pipe gives up on the idle
 * budget and still records what arrived, while a payload that keeps
 * streaming is read to its end.
 */

const recorder = path.join(__dirname, "..", "plugin", "trace-recorder.cjs");

function makeHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "astro-stdin-budget-"));
}

/** Every events.jsonl under a home, flattened. */
function readEvents(home) {
  const files = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(target);
      } else if (entry.name === "events.jsonl") {
        files.push(target);
      }
    }
  };
  walk(home);
  return files.flatMap((file) =>
    fs
      .readFileSync(file, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line)),
  );
}

test("a stalled stdin still records the payload within the idle budget", async () => {
  const home = makeHome();
  const startedAt = Date.now();
  const child = spawn(
    process.execPath,
    [recorder, "--source=zcode", "--quiet"],
    {
      env: {
        ...process.env,
        ASTRO_HOME: home,
        ASTRO_AUTO_OPEN: "0",
        ASTRO_STDIN_TIMEOUT_MS: "400",
      },
      stdio: ["pipe", "ignore", "ignore"],
    },
  );
  // A complete payload, but no `end()`: the host abandoned the pipe.
  child.stdin.write(
    JSON.stringify({
      session_id: "stalled-stdin",
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "echo hi" },
      cwd: "/tmp/astro-stdin-budget",
    }),
  );
  const exitCode = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("recorder did not exit after its stdin budget"));
    }, 8_000);
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
  const elapsed = Date.now() - startedAt;

  assert.equal(exitCode, 0);
  // The budget plus process start; a loaded machine may take a second or two
  // more, but it must never approach the host's own 5s hook deadline.
  assert.ok(elapsed < 5_000, `recorder took ${elapsed}ms`);
  const events = readEvents(home);
  assert.equal(events.length, 1);
  assert.equal(events[0].eventName, "PreToolUse");
  assert.equal(events[0].sessionId, "stalled-stdin");
  assert.equal(events[0].toolName, "Bash");
});

test("a payload that keeps streaming is read to its end", () => {
  const home = makeHome();
  // Two chunks with a pause shorter than the idle budget: the total cap must
  // not cut the second one off just because the first arrived late.
  const payload = {
    session_id: "streaming-stdin",
    hook_event_name: "PostToolUse",
    tool_name: "Write",
    tool_input: { file_path: "/tmp/a.ts", content: "x".repeat(64 * 1024) },
    cwd: "/tmp/astro-stdin-budget",
  };
  const text = JSON.stringify(payload);
  const half = Math.floor(text.length / 2);
  const result = spawnSync(
    process.execPath,
    [recorder, "--source=zcode", "--quiet"],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        ASTRO_HOME: home,
        ASTRO_AUTO_OPEN: "0",
        ASTRO_STDIN_TIMEOUT_MS: "400",
      },
      input: `${text.slice(0, half)}${text.slice(half)}`,
      timeout: 10_000,
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const events = readEvents(home);
  assert.equal(events.length, 1);
  assert.equal(events[0].eventName, "PostToolUse");
  assert.equal(events[0].sessionId, "streaming-stdin");
  assert.equal(
    events[0].payload.tool_input.content.length,
    64 * 1024,
    "the whole payload must be recorded, not a truncated prefix",
  );
});
