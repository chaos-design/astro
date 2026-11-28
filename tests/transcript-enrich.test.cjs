const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  MAX_READ_BYTES,
  enrichFromTranscript,
  isEnrichEvent,
  payloadsFromEntries,
  readTranscriptEvents,
} = require("../plugin/transcript-enrich.cjs");

/**
 * Hook-only clients (WorkBuddy / CodeBuddy / Claude / ZCode) never put the
 * model's thinking or its intermediate replies in a hook payload; those live
 * in the transcript the hook names. These tests pin the three transcript
 * shapes, the incremental cursor, the id de-duplication and the byte budget —
 * the four ways a "one word missing" bug would show up.
 */

function makeDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "astro-transcript-"));
}

function writeLines(file, entries) {
  fs.writeFileSync(
    file,
    `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
    "utf8",
  );
}

const workbuddyEntries = [
  {
    id: "01a1ae35-d144",
    timestamp: 1793924115200,
    type: "message",
    role: "user",
    content: [{ type: "input_text", text: "帮我看看这个 bug" }],
  },
  {
    id: "01a1ae35-dc6b",
    timestamp: 1793924140300,
    type: "reasoning",
    providerData: { messageId: "01a1ae35dc6b799498ace4cdeae1b884" },
    content: [],
    rawContent: [
      {
        type: "reasoning_text",
        text: "先定位 projection：buildAgentView 是纯函数，\n第二段思考也必须逐字保留。",
      },
    ],
  },
  {
    id: "01a1ae35-e111",
    timestamp: 1793924150000,
    type: "message",
    role: "assistant",
    content: [
      { type: "output_text", text: "根因在 projection 的 `end` 边界。" },
      { type: "output_text", text: "修复后 12 个用例通过。" },
    ],
  },
];

test("WorkBuddy transcript yields thinking and reply verbatim", () => {
  const directory = makeDir();
  const transcript = path.join(directory, "session.jsonl");
  writeLines(transcript, workbuddyEntries);
  const first = readTranscriptEvents({
    transcriptPath: transcript,
    sessionId: "session-1",
    cwd: "/tmp/project",
    source: "workbuddy",
    now: "2026-11-26T00:00:00.000Z",
  });

  const reasoning = first.payloads.filter((p) => p.eventName === "Reasoning");
  const messages = first.payloads.filter((p) => p.eventName === "AgentMessage");
  assert.equal(reasoning.length, 1);
  assert.equal(messages.length, 1);
  assert.equal(
    reasoning[0].payload.text,
    "先定位 projection：buildAgentView 是纯函数，\n第二段思考也必须逐字保留。",
  );
  assert.equal(
    messages[0].payload.message,
    "根因在 projection 的 `end` 边界。\n\n修复后 12 个用例通过。",
  );
  assert.equal(messages[0].payload.streamed, false);
  assert.equal(messages[0].payload.messageId, "01a1ae35-e111");
  assert.equal(
    reasoning[0].payload.recoveredFrom,
    "transcript",
    "a recovered step must be marked as such",
  );
  // The user turn is already captured by the host hook: re-emitting it would
  // invent a reply the model never wrote.
  assert.equal(first.payloads.length, 2);
});

test("a second read only returns what was appended", () => {
  const directory = makeDir();
  const transcript = path.join(directory, "session.jsonl");
  writeLines(transcript, workbuddyEntries);
  const first = readTranscriptEvents({
    transcriptPath: transcript,
    sessionId: "session-2",
    source: "workbuddy",
  });
  assert.equal(first.payloads.length, 2);

  fs.appendFileSync(
    transcript,
    `${JSON.stringify({
      id: "01a1ae35-f222",
      timestamp: 1793924999000,
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "补充一条：rail 也要跟随。" }],
    })}\n`,
    "utf8",
  );
  const second = readTranscriptEvents({
    transcriptPath: transcript,
    sessionId: "session-2",
    state: first.state,
    source: "workbuddy",
  });
  assert.equal(second.payloads.length, 1);
  assert.equal(second.payloads[0].payload.message, "补充一条：rail 也要跟随。");
});

test("Claude transcript reads thinking blocks and assistant text", () => {
  const directory = makeDir();
  const transcript = path.join(directory, "claude.jsonl");
  writeLines(transcript, [
    {
      type: "user",
      uuid: "u-1",
      timestamp: "2026-11-26T01:00:00.000Z",
      message: { role: "user", content: [{ type: "text", text: "跑测试" }] },
    },
    {
      type: "assistant",
      uuid: "a-1",
      timestamp: "2026-11-26T01:00:02.000Z",
      message: {
        id: "msg_01",
        role: "assistant",
        content: [
          { type: "thinking", thinking: "先跑一遍基线，再改。" },
          { type: "text", text: "基线 983 通过。" },
          { type: "tool_use", id: "toolu_1", name: "Bash", input: {} },
        ],
      },
    },
  ]);
  const result = readTranscriptEvents({
    transcriptPath: transcript,
    sessionId: "claude-1",
    source: "claude",
  });
  assert.equal(result.payloads.length, 2);
  const [reasoning, message] = result.payloads;
  assert.equal(reasoning.eventName, "Reasoning");
  assert.equal(reasoning.payload.text, "先跑一遍基线，再改。");
  assert.equal(message.eventName, "AgentMessage");
  assert.equal(message.payload.message, "基线 983 通过。");
  assert.equal(message.payload.messageId, "msg_01");
});

test("Codex rollout reads response_item reasoning and agent_message", () => {
  const directory = makeDir();
  const transcript = path.join(directory, "rollout.jsonl");
  writeLines(transcript, [
    {
      type: "response_item",
      payload: {
        type: "reasoning",
        summary: [{ type: "summary_text", text: "先看 diff，再落测试。" }],
      },
    },
    {
      type: "event_msg",
      payload: { type: "agent_message", message: "diff 已确认，开始补用例。" },
    },
  ]);
  const result = readTranscriptEvents({
    transcriptPath: transcript,
    sessionId: "codex-1",
    source: "chatgpt",
  });
  assert.equal(result.payloads.length, 2);
  assert.equal(result.payloads[0].payload.text, "先看 diff，再落测试。");
  assert.equal(result.payloads[1].payload.message, "diff 已确认，开始补用例。");
});

test("a rotated transcript path does not duplicate remembered entries", () => {
  const first = makeDir();
  const second = makeDir();
  const firstPath = path.join(first, "transcript.jsonl");
  const secondPath = path.join(second, "transcript.jsonl");
  writeLines(firstPath, workbuddyEntries);
  writeLines(secondPath, workbuddyEntries);
  const one = readTranscriptEvents({
    transcriptPath: firstPath,
    sessionId: "zcode-1",
    source: "zcode",
  });
  assert.equal(one.payloads.length, 2);
  // ZCode hands every hook a fresh temp directory: the state carries the ids
  // but not a usable offset.
  const two = readTranscriptEvents({
    transcriptPath: secondPath,
    sessionId: "zcode-1",
    state: one.state,
    source: "zcode",
  });
  assert.equal(two.payloads.length, 0);
});

test("a huge transcript is read in bounded chunks and resumes", () => {
  const directory = makeDir();
  const transcript = path.join(directory, "big.jsonl");
  const filler = "x".repeat(4096);
  const entries = Array.from({ length: 120 }, (_, index) => ({
    id: `big-${index}`,
    type: "message",
    role: "assistant",
    content: [{ type: "output_text", text: `${index}:${filler}` }],
  }));
  writeLines(transcript, entries);
  const first = readTranscriptEvents({
    transcriptPath: transcript,
    sessionId: "big-1",
    source: "workbuddy",
  });
  assert.ok(
    first.bytesRead <= MAX_READ_BYTES,
    `read ${first.bytesRead} bytes, cap ${MAX_READ_BYTES}`,
  );
  assert.ok(first.payloads.length > 0);
  assert.ok(first.payloads.length < entries.length, "the tail must remain");
  assert.equal(first.truncated, true);

  let state = first.state;
  let total = first.payloads.length;
  for (let round = 0; round < 40; round += 1) {
    const next = readTranscriptEvents({
      transcriptPath: transcript,
      sessionId: "big-1",
      state,
      source: "workbuddy",
    });
    total += next.payloads.length;
    state = next.state;
    if (!next.truncated) {
      break;
    }
  }
  assert.equal(total, entries.length, "every entry must arrive exactly once");
});

test("more than 200 entries in one read are all captured", () => {
  const directory = makeDir();
  const transcript = path.join(directory, "many.jsonl");
  // Short entries let the whole file fit in one bounded read. The cursor used
  // to skip past all of them while parsing only the last 200 — a silent loss.
  const entries = Array.from({ length: 250 }, (_, index) => ({
    id: `many-${index}`,
    timestamp: 1793924115000 + index,
    type: "message",
    role: "assistant",
    content: [{ type: "output_text", text: `message ${index}` }],
  }));
  writeLines(transcript, entries);
  const result = readTranscriptEvents({
    transcriptPath: transcript,
    sessionId: "many-1",
    source: "workbuddy",
  });
  assert.equal(result.payloads.length, entries.length);
  assert.deepEqual(
    result.payloads.map((payload) => payload.payload.message),
    entries.map((entry) => entry.content[0].text),
  );
});

test("one entry larger than the read window is captured whole", () => {
  const directory = makeDir();
  const transcript = path.join(directory, "long.jsonl");
  const text = `HEAD${"A".repeat(MAX_READ_BYTES + 1024)}TAIL`;
  writeLines(transcript, [
    {
      id: "long-1",
      timestamp: 1793924115000,
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text }],
    },
  ]);
  const result = readTranscriptEvents({
    transcriptPath: transcript,
    sessionId: "long-1",
    source: "workbuddy",
  });
  assert.equal(result.payloads.length, 1);
  assert.equal(result.payloads[0].payload.message, text);
  assert.equal(result.truncated, false);
});

test("a corrupt line costs that line only", () => {
  const directory = makeDir();
  const transcript = path.join(directory, "corrupt.jsonl");
  fs.writeFileSync(
    transcript,
    `${JSON.stringify(workbuddyEntries[2])}\n{not json}\n${JSON.stringify({
      id: "after-corrupt",
      type: "reasoning",
      rawContent: [{ type: "reasoning_text", text: "坏行之后仍然要读。" }],
    })}\n`,
    "utf8",
  );
  const result = readTranscriptEvents({
    transcriptPath: transcript,
    sessionId: "corrupt-1",
    source: "workbuddy",
  });
  assert.equal(result.payloads.length, 2);
  assert.equal(result.payloads[1].payload.text, "坏行之后仍然要读。");
});

test("only events that can close a message spend a transcript read", () => {
  for (const name of ["Stop", "PostToolUse", "AgentMessage", "SessionEnd"]) {
    assert.equal(isEnrichEvent(name), true, name);
  }
  for (const name of ["PreToolUse", "SessionStart", "PermissionRequest"]) {
    assert.equal(isEnrichEvent(name), false, name);
  }
});

test("payloads keep a stable id so the recorder writes each step once", () => {
  const payloads = payloadsFromEntries(workbuddyEntries, {
    sessionId: "stable-1",
    cwd: "/tmp",
    source: "workbuddy",
    remembered: new Set(),
    now: "2026-11-26T00:00:00.000Z",
  });
  assert.equal(payloads.length, 2);
  assert.equal(payloads[0].sessionId, "stable-1");
  assert.equal(payloads[0].source, "workbuddy");
  assert.match(payloads[0].id, /^transcript:stable-1:reasoning:/);
  assert.match(payloads[1].id, /^transcript:stable-1:message:/);
});

test("enrichFromTranscript persists the cursor beside the session", () => {
  const directory = makeDir();
  const transcript = path.join(directory, "session.jsonl");
  const stateDirectory = path.join(directory, "transcript-state");
  writeLines(transcript, workbuddyEntries);
  const first = enrichFromTranscript({
    transcriptPath: transcript,
    stateDirectory,
    stateKey: "workbuddy-persist-1",
    sessionId: "persist-1",
    source: "workbuddy",
  });
  assert.equal(first.length, 2);
  assert.equal(
    fs.existsSync(path.join(stateDirectory, "workbuddy-persist-1.json")),
    true,
  );
  const second = enrichFromTranscript({
    transcriptPath: transcript,
    stateDirectory,
    stateKey: "workbuddy-persist-1",
    sessionId: "persist-1",
    source: "workbuddy",
  });
  assert.equal(second.length, 0, "the persisted cursor must not re-emit");
});

test("a missing transcript is silent", () => {
  assert.deepEqual(
    enrichFromTranscript({
      transcriptPath: path.join(makeDir(), "nope.jsonl"),
      stateDirectory: makeDir(),
      sessionId: "missing-1",
      source: "workbuddy",
    }),
    [],
  );
});

test("the recorder writes recovered steps before the hook event", () => {
  const { spawnSync } = require("node:child_process");
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "astro-enrich-home-"));
  const transcript = path.join(home, "host-transcript.jsonl");
  writeLines(transcript, workbuddyEntries);
  const recorder = path.join(__dirname, "..", "plugin", "trace-recorder.cjs");
  const payload = {
    session_id: "recorder-enrich-1",
    cwd: "/tmp/astro-enrich",
    hook_event_name: "Stop",
    transcript_path: transcript,
    last_assistant_message: "根因在 projection 的 `end` 边界。",
  };
  const run = () =>
    spawnSync(process.execPath, [recorder, "--source=workbuddy", "--quiet"], {
      encoding: "utf8",
      env: { ...process.env, ASTRO_HOME: home, ASTRO_AUTO_OPEN: "0" },
      input: JSON.stringify(payload),
      timeout: 10_000,
    });

  const first = run();
  assert.equal(first.status, 0, first.stderr);
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
  assert.equal(files.length, 1);
  const names = fs
    .readFileSync(files[0], "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .map((event) => event.eventName);
  assert.deepEqual(names, ["Reasoning", "AgentMessage", "Stop"]);

  // A second hook on the same transcript must not replay the recovered steps.
  const second = run();
  assert.equal(second.status, 0, second.stderr);
  const after = fs
    .readFileSync(files[0], "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .map((event) => event.eventName);
  assert.deepEqual(after, ["Reasoning", "AgentMessage", "Stop", "Stop"]);
});

test("a host --event flag does not rename recovered steps", () => {
  const { spawnSync } = require("node:child_process");
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "astro-event-flag-"));
  const transcript = path.join(home, "host.jsonl");
  writeLines(transcript, workbuddyEntries);
  const recorder = path.join(__dirname, "..", "plugin", "trace-recorder.cjs");
  // WorkBuddy always names the host event on the command line: the recovered
  // steps must keep Reasoning / AgentMessage instead of inheriting "Stop".
  const result = spawnSync(
    process.execPath,
    [recorder, "--source=workbuddy", "--event=Stop", "--quiet"],
    {
      encoding: "utf8",
      env: { ...process.env, ASTRO_HOME: home, ASTRO_AUTO_OPEN: "0" },
      input: JSON.stringify({
        session_id: "event-flag-1",
        cwd: "/tmp/astro-event-flag",
        hook_event_name: "Stop",
        transcript_path: transcript,
      }),
      timeout: 10_000,
    },
  );
  assert.equal(result.status, 0, result.stderr);
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
  const names = fs
    .readFileSync(files[0], "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .map((event) => event.eventName);
  assert.deepEqual(names, ["Reasoning", "AgentMessage", "Stop"]);
});

test("the recorder can be told to skip transcript reads", () => {
  const { spawnSync } = require("node:child_process");
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "astro-enrich-off-"));
  const transcript = path.join(home, "host-transcript.jsonl");
  writeLines(transcript, workbuddyEntries);
  const recorder = path.join(__dirname, "..", "plugin", "trace-recorder.cjs");
  const result = spawnSync(
    process.execPath,
    [recorder, "--source=workbuddy", "--quiet"],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        ASTRO_HOME: home,
        ASTRO_AUTO_OPEN: "0",
        ASTRO_TRANSCRIPT_ENRICH: "0",
      },
      input: JSON.stringify({
        session_id: "recorder-enrich-off",
        cwd: "/tmp/astro-enrich",
        hook_event_name: "Stop",
        transcript_path: transcript,
      }),
      timeout: 10_000,
    },
  );
  assert.equal(result.status, 0, result.stderr);
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
  const events = fs
    .readFileSync(files[0], "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  assert.deepEqual(
    events.map((event) => event.eventName),
    ["Stop"],
    "the kill switch must leave the host event untouched",
  );
});

test("a Trae-style conversation transcript yields thinking and replies", () => {
  const directory = makeDir();
  const transcript = path.join(directory, "conversation.jsonl");
  writeLines(transcript, [
    { role: "user", content: "把这个按钮改成主色" },
    {
      role: "assistant",
      reasoning: "先找按钮的样式定义，再改 token。",
      content: "已在 `button.css` 里改用主色。",
    },
    { role: "assistant", content: "另外补了 hover 态。" },
  ]);
  const result = readTranscriptEvents({
    transcriptPath: transcript,
    sessionId: "trae-1",
    source: "trae",
  });
  assert.equal(result.payloads.length, 3);
  assert.equal(result.payloads[0].eventName, "Reasoning");
  assert.equal(result.payloads[0].payload.text, "先找按钮的样式定义，再改 token。");
  assert.equal(result.payloads[1].eventName, "AgentMessage");
  assert.equal(result.payloads[1].payload.message, "已在 `button.css` 里改用主色。");
  assert.equal(result.payloads[2].payload.message, "另外补了 hover 态。");
});

test("the recorder finds a Trae transcript under its own key", () => {
  const { spawnSync } = require("node:child_process");
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "astro-trae-enrich-"));
  const transcript = path.join(home, "trae-conversation.jsonl");
  writeLines(transcript, [
    { role: "assistant", reasoning: "先读 hooks.json。", content: "已经接入 hook。" },
  ]);
  const recorder = path.join(__dirname, "..", "plugin", "trace-recorder.cjs");
  const result = spawnSync(
    process.execPath,
    [recorder, "--source=trae", "--quiet"],
    {
      encoding: "utf8",
      env: { ...process.env, ASTRO_HOME: home, ASTRO_AUTO_OPEN: "0" },
      input: JSON.stringify({
        session_id: "trae-e2e-1",
        cwd: "/tmp/trae-project",
        hook_event_name: "Stop",
        // Trae's hook carries the transcript under a session-file spelling.
        session_file: transcript,
      }),
      timeout: 10_000,
    },
  );
  assert.equal(result.status, 0, result.stderr);
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
  const names = fs
    .readFileSync(files[0], "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .map((event) => event.eventName);
  assert.deepEqual(names, ["Reasoning", "AgentMessage", "Stop"]);
});

test("an explicit transcript path covers hosts that publish none", () => {
  const { spawnSync } = require("node:child_process");
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "astro-env-transcript-"));
  const transcript = path.join(home, "exported-conversation.jsonl");
  writeLines(transcript, [
    { role: "assistant", reasoning: "先把 hook 载荷读出来。", content: "已接入。" },
  ]);
  const recorder = path.join(__dirname, "..", "plugin", "trace-recorder.cjs");
  // Trae's hook carries no transcript at all; the escape hatch is the
  // environment, not a guessed file location.
  const result = spawnSync(process.execPath, [recorder, "--source=trae", "--quiet"], {
    encoding: "utf8",
    env: {
      ...process.env,
      ASTRO_HOME: home,
      ASTRO_AUTO_OPEN: "0",
      ASTRO_TRANSCRIPT_PATH: transcript,
    },
    input: JSON.stringify({
      session_id: "trae-env-1",
      cwd: "/tmp/trae-project",
      hook_event_name: "Stop",
    }),
    timeout: 10_000,
  });
  assert.equal(result.status, 0, result.stderr);
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
  const names = fs
    .readFileSync(files[0], "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .map((event) => event.eventName);
  assert.deepEqual(names, ["Reasoning", "AgentMessage", "Stop"]);
});

test("every thinking spelling recovers as reasoning, never as a reply", () => {
  const directory = makeDir();
  const transcript = path.join(directory, "spelling.jsonl");
  writeLines(transcript, [
    // A dedicated `thought` entry (some hosts spell the entry itself this way).
    { type: "thought", thinking: "先查 hook 配置。" },
    // A localized block type riding on an assistant message.
    {
      type: "message",
      role: "assistant",
      content: [
        { type: "深度思考", text: "先读派生层。" },
        { type: "text", text: "已修复。" },
      ],
    },
    // DeepSeek-style reasoning_content on a plain record.
    { role: "assistant", reasoning_content: "再看投影顺序。", content: "完成。" },
    // A `thought` field on a message entry's own block.
    {
      type: "message",
      role: "assistant",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thought: "按 messageId 对齐。" },
          { type: "text", text: "对齐了。" },
        ],
      },
    },
  ]);
  const payloads = readTranscriptEvents({
    transcriptPath: transcript,
    sessionId: "spelling-1",
    source: "generic",
  }).payloads;
  const reasoning = payloads
    .filter((p) => p.eventName === "Reasoning")
    .map((p) => p.payload.text);
  const replies = payloads
    .filter((p) => p.eventName === "AgentMessage")
    .map((p) => p.payload.message);
  assert.deepEqual(
    reasoning,
    ["先查 hook 配置。", "先读派生层。", "再看投影顺序。", "按 messageId 对齐。"],
  );
  assert.deepEqual(replies, ["已修复。", "完成。", "对齐了。"]);
  // No text double-counts: each spelling's thinking stays out of the reply
  // and each reply stays out of the thinking.
  for (const reply of replies) {
    assert.ok(!reasoning.includes(reply), `${reply} leaked into thinking`);
  }
});

test("every thinking spelling recovers as reasoning, never as a reply", () => {
  const directory = makeDir();
  const transcript = path.join(directory, "spelling.jsonl");
  writeLines(transcript, [
    // A dedicated `thought` entry (some hosts spell the entry itself this way).
    { type: "thought", thinking: "先查 hook 配置。" },
    // A localized block type riding on an assistant message.
    {
      type: "message",
      role: "assistant",
      content: [
        { type: "深度思考", text: "先读派生层。" },
        { type: "text", text: "已修复。" },
      ],
    },
    // DeepSeek-style reasoning_content on a plain record.
    { role: "assistant", reasoning_content: "再看投影顺序。", content: "完成。" },
    // A `thought` field on a message entry's own block.
    {
      type: "message",
      role: "assistant",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thought: "按 messageId 对齐。" },
          { type: "text", text: "对齐了。" },
        ],
      },
    },
  ]);
  const payloads = readTranscriptEvents({
    transcriptPath: transcript,
    sessionId: "spelling-1",
    source: "generic",
  }).payloads;
  const reasoning = payloads
    .filter((p) => p.eventName === "Reasoning")
    .map((p) => p.payload.text);
  const replies = payloads
    .filter((p) => p.eventName === "AgentMessage")
    .map((p) => p.payload.message);
  assert.deepEqual(
    reasoning,
    ["先查 hook 配置。", "先读派生层。", "再看投影顺序。", "按 messageId 对齐。"],
  );
  assert.deepEqual(replies, ["已修复。", "完成。", "对齐了。"]);
  // No text double-counts: each spelling's thinking stays out of the reply
  // and each reply stays out of the thinking.
  for (const reply of replies) {
    assert.ok(!reasoning.includes(reply), `${reply} leaked into thinking`);
  }
});
