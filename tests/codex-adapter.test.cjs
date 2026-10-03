const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  adaptCodexRows,
  importCodexFiles,
} = require("../plugin/codex-adapter.cjs");

const rows = [
  {
    timestamp: "2026-09-07T08:00:00.000Z",
    type: "session_meta",
    payload: { id: "codex-session", cwd: "/tmp/project" },
  },
  {
    timestamp: "2026-09-07T08:00:01.000Z",
    type: "event_msg",
    payload: { type: "user_message", message: "Find the failing test" },
  },
  {
    timestamp: "2026-09-07T08:00:02.000Z",
    type: "response_item",
    payload: {
      type: "function_call",
      call_id: "call-1",
      name: "shell",
      arguments: '{"cmd":"npm test"}',
    },
  },
  {
    timestamp: "2026-09-07T08:00:03.000Z",
    type: "response_item",
    payload: {
      type: "function_call_output",
      call_id: "call-1",
      output: "12 tests passed",
    },
  },
];

test("adapts persisted Codex rollout rows into paired trace events", () => {
  const events = adaptCodexRows(rows, { fileKey: "rollout.jsonl" });

  assert.deepEqual(
    events.map((event) => event.eventName),
    ["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse"],
  );
  assert.ok(events.every((event) => event.source === "codex"));
  assert.ok(events.every((event) => event.sessionId === "codex-session"));
  assert.equal(events[2].toolUseId, "call-1");
  assert.equal(events[3].toolUseId, "call-1");
  assert.deepEqual(events[2].payload.tool_input, { cmd: "npm test" });
});

test("uses deterministic IDs to deduplicate repeated history imports", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "astro-codex-"));
  const rollout = path.join(root, "rollout.jsonl");
  fs.writeFileSync(
    rollout,
    `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`,
    "utf8",
  );
  const environment = {
    ASTRO_PROJECT_DIR: root,
    ASTRO_TRACE_DIR: "trace",
  };

  const first = importCodexFiles([rollout], environment);
  const second = importCodexFiles([rollout], environment);

  assert.equal(first.length, rows.length);
  assert.equal(second.length, 0);
  fs.rmSync(root, { recursive: true, force: true });
});
