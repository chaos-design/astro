const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

/**
 * Transcript enrichment: recover the assistant's own artifacts from the host
 * transcript.
 *
 * Hook-only clients (WorkBuddy / CodeBuddy / Claude / ZCode) deliver tool
 * events and lifecycle events — `PreToolUse`, `PostToolUse`, `Stop` — but the
 * model's *thinking* and its intermediate replies are not part of any hook
 * payload. They do live in the transcript the host names on every hook
 * (`payload.transcript_path`): one JSONL file per session. Reading it is the
 * only way those clients can show what OpenCode and Pi already report
 * themselves, and it must be done without ever blocking the agent:
 *
 * - **Incremental**: a persisted byte offset per transcript means a hook only
 *   reads the bytes appended since the last one. A rewound/shrunk file resets
 *   to 0 (the host rotated or rewrote it).
 * - **Bounded**: one read takes at most {@link MAX_READ_BYTES}; whatever does
 *   not fit stays for the next hook, so a huge transcript can never turn a
 *   hook into a long task.
 * - **Idempotent**: every entry's own id is remembered (bounded ring) and
 *   stamped as the canonical `messageId`, so a re-read after a crash, a
 *   duplicated hook, or a host that replays its tail cannot duplicate a step.
 *   The id is also what `buildAgentView` groups prefix snapshots by.
 * - **Fail-open**: an unknown shape, a missing file, a corrupt line or a
 *   malformed cursor yields no events — never an error the recorder would
 *   report as a failed hook.
 *
 * Only {@link REASONING_EVENT} and {@link MESSAGE_EVENT} are emitted: those are
 * the two canonical events the Agent view already projects, so this module adds
 * capture, not a second rendering path.
 */

const REASONING_EVENT = "Reasoning";
const MESSAGE_EVENT = "AgentMessage";

/** One read never exceeds this many bytes; the rest waits for the next hook. */
const MAX_READ_BYTES = 256 * 1024;
/** One read never parses more than this many entries. */
const MAX_ENTRIES = 200;
/** Remembered entry ids per transcript, oldest evicted first. */
const MAX_REMEMBERED_IDS = 4000;
/**
 * Cursor file name inside the state directory. One file per session: the
 * captured session's *directory* is timestamped per run, so a cursor stored
 * there would be lost on the next hook and the whole transcript replayed.
 */
const STATE_FILE = "transcript-state.json";

function stringValue(value) {
  return typeof value === "string" ? value : "";
}

function hashText(text) {
  return crypto.createHash("sha1").update(text).digest("hex").slice(0, 16);
}

/**
 * The reasoning body of one transcript entry, across the shapes the hosts
 * write: WorkBuddy's `rawContent[].reasoning_text`, Claude's
 * `message.content[].thinking`, Codex's `payload.summary[].text` /
 * `payload.content[].reasoning_text`, plus the plain `text` / `message` keys
 * some releases use. Empty string when the entry carries no thinking.
 */
function reasoningText(entry) {
  const parts = [];
  const push = (value) => {
    const text = stringValue(value);
    if (text.trim()) {
      parts.push(text);
    }
  };
  const type = stringValue(entry.type);
  const payloadType = stringValue(entry.payload?.type);
  if (type === "reasoning" || payloadType === "reasoning") {
    push(entry.text);
    push(entry.thinking);
    push(entry.reasoning);
    for (const node of [entry.rawContent, entry.content]) {
      if (Array.isArray(node)) {
        for (const part of node) {
          if (part && typeof part === "object") {
            push(part.text);
            push(part.thinking);
          }
        }
      }
    }
    const payload = entry.payload;
    if (payload && typeof payload === "object") {
      if (Array.isArray(payload.summary)) {
        for (const part of payload.summary) {
          push(part && typeof part === "object" ? part.text : part);
        }
      }
      if (Array.isArray(payload.content)) {
        for (const part of payload.content) {
          if (part && typeof part === "object") {
            push(part.text);
            push(part.thinking);
          }
        }
      }
      push(payload.text);
    }
  }
  // A plain conversation record (`{role: "assistant", reasoning: "..."}`) is
  // what several IDE hooks write; the same text under `thinking` is read too.
  if (stringValue(entry.role) === "assistant") {
    push(entry.reasoning);
    push(entry.thinking);
  }
  // An assistant turn can carry its thinking as one content block among its
  // text blocks (Claude). Reading it here is what keeps a turn's reasoning
  // even though the same entry also produces the reply.
  const message = entry.message;
  if (message && typeof message === "object" && Array.isArray(message.content)) {
    for (const part of message.content) {
      if (
        part &&
        typeof part === "object" &&
        (part.type === "thinking" || part.type === "reasoning")
      ) {
        push(part.thinking);
        push(part.text);
      }
    }
  }
  return parts.join("\n\n");
}

/**
 * The assistant's reply body of one entry. Only assistant-authored text
 * counts: a user message or a tool result is already captured by the host
 * event (and re-emitting it would create a reply the model never wrote).
 */
function assistantText(entry) {
  const role =
    stringValue(entry.role) ||
    stringValue(entry.message?.role) ||
    stringValue(entry.payload?.role);
  if (role && role !== "assistant") {
    return "";
  }
  const parts = [];
  const push = (value) => {
    const text = stringValue(value);
    if (text.trim()) {
      parts.push(text);
    }
  };
  const content = entry.content;
  if (typeof content === "string") {
    push(content);
  } else if (Array.isArray(content)) {
    for (const part of content) {
      if (!part || typeof part !== "object") {
        continue;
      }
      const type = stringValue(part.type);
      if (
        type === "output_text" ||
        type === "text" ||
        !type
      ) {
        push(part.text);
      }
    }
  }
  const messageContent = entry.message?.content;
  if (typeof messageContent === "string") {
    push(messageContent);
  } else if (Array.isArray(messageContent)) {
    for (const part of messageContent) {
      if (part && typeof part === "object" && part.type === "text") {
        push(part.text);
      }
    }
  }
  if (stringValue(entry.payload?.type) === "agent_message") {
    push(entry.payload?.message);
  }
  return parts.join("\n\n");
}

function entryKind(entry) {
  const type = stringValue(entry.type);
  const payloadType = stringValue(entry.payload?.type);
  const messageRole = stringValue(entry.message?.role);
  if (type === "reasoning" || payloadType === "reasoning") {
    return "reasoning";
  }
  if (type === "event_msg" && payloadType === "agent_message") {
    return "message";
  }
  if (payloadType === "message") {
    return stringValue(entry.payload?.role) === "assistant"
      ? "message"
      : "";
  }
  if (type === "message") {
    // WorkBuddy / CodeBuddy write their conversation turns as `message`
    // entries; a reasoning entry is its own type, so only assistant turns
    // become replies.
    return stringValue(entry.role) === "assistant" ? "message" : "";
  }
  if (type === "assistant" || messageRole === "assistant") {
    return "message";
  }
  // A bare conversation record with only a role (some IDE hook transcripts
  // write `{role: "assistant", content: "..."}` and nothing else).
  if (stringValue(entry.role) === "assistant") {
    return "message";
  }
  return "";
}

function entryTimestamp(entry, fallback) {
  const raw = entry.timestamp ?? entry.createdAt ?? entry.created_at;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    // WorkBuddy stores epoch milliseconds; Codex stores ISO strings.
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
  }
  if (typeof raw === "string" && raw.trim()) {
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
  }
  return fallback;
}

function entryId(entry) {
  const candidates = [
    entry.id,
    // Claude splits one assistant message into several transcript entries that
    // share `message.id`; that id is the message identity every other adapter
    // reports, so it outranks the per-entry uuid.
    entry.message?.id,
    entry.uuid,
    entry.payload?.id,
    entry.payload?.item_id,
  ];
  for (const candidate of candidates) {
    const id = stringValue(candidate).trim();
    if (id) {
      return id;
    }
  }
  return "";
}

/** A stable id for an entry that carries none: time + body digest. */
function syntheticEntryId(entry, body) {
  const stamp =
    entry.timestamp ?? entry.createdAt ?? entry.payload?.timestamp ?? "";
  return `t-${String(stamp)}-${hashText(`${entryKind(entry)}:${body}`)}`;
}

function emptyState(transcriptPath) {
  return {
    path: transcriptPath,
    offset: 0,
    ids: [],
  };
}

/** Whether a host event is worth a transcript read (cheap: an offset stat). */
const ENRICH_EVENTS = new Set([
  "AgentMessage",
  "PostToolUse",
  "PostToolUseFailure",
  "SessionEnd",
  "Stop",
  "StopFailure",
  "UserPromptSubmit",
]);

function isEnrichEvent(eventName) {
  return ENRICH_EVENTS.has(eventName);
}

/**
 * Turns a parsed transcript tail into canonical payloads. Split from the file
 * read so the shapes can be tested without a filesystem.
 */
function payloadsFromEntries(entries, options) {
  const {
    sessionId,
    cwd,
    source,
    remembered,
    now,
    fallbackCapturedAt,
  } = options;
  const payloads = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const kind = entryKind(entry);
    if (!kind) {
      continue;
    }
    // One entry can carry both artifacts: Claude writes a turn's thinking and
    // its text as sibling blocks of the same assistant message.
    const bodies = [];
    const reasoning = reasoningText(entry);
    if (reasoning.trim()) {
      bodies.push({ body: reasoning, kind: "reasoning" });
    }
    if (kind === "message") {
      const reply = assistantText(entry);
      if (reply.trim()) {
        bodies.push({ body: reply, kind: "message" });
      }
    }
    if (!bodies.length) {
      continue;
    }
    const id = entryId(entry) || syntheticEntryId(entry, bodies[0].body);
    const messageId = entryId(entry) || id;
    for (const { body, kind: bodyKind } of bodies) {
      // The digest keeps two blocks of one message distinct (Claude can write
      // a turn's thinking and its text as separate entries sharing
      // `message.id`) while still collapsing a re-read of the same block.
      const scoped = `${bodyKind}:${id}:${hashText(body)}`;
      if (remembered.has(scoped)) {
        continue;
      }
      const capturedAt = entryTimestamp(entry, fallbackCapturedAt || now);
      payloads.push({
        eventName: bodyKind === "reasoning" ? REASONING_EVENT : MESSAGE_EVENT,
        id: `transcript:${sessionId}:${scoped}`,
        sessionId,
        cwd,
        source,
        capturedAt,
        nativeEventName: "transcript",
        payload: {
          // The transcript is the host's own record, not a hook payload: mark
          // the origin so the LOG can tell a recovered step from a live one.
          client: source,
          recoveredFrom: "transcript",
          // Provenance: the exact transcript entry block this step came from.
          // Also the de-duplication key, so a re-read of the same block is
          // recognised even when the entry carries no id of its own.
          transcriptKey: scoped,
          messageId,
          ...(bodyKind === "reasoning"
            ? { text: body }
            : { message: body, streamed: false }),
        },
      });
    }
  }
  return payloads;
}

/**
 * Reads the transcript's new tail and returns canonical payloads plus the next
 * cursor. `state` is the persisted cursor (or `null` for a first read).
 */
function readTranscriptEvents(options) {
  const {
    transcriptPath,
    sessionId,
    cwd,
    source,
    state = null,
    now = new Date().toISOString(),
  } = options;
  if (!transcriptPath || typeof transcriptPath !== "string") {
    return { payloads: [], state, bytesRead: 0, truncated: false };
  }
  let stats;
  try {
    stats = fs.statSync(transcriptPath);
  } catch {
    return { payloads: [], state, bytesRead: 0, truncated: false };
  }
  // The remembered ids survive a path change: ZCode hands the hook a fresh
  // temp directory per invocation, so the same session transcript arrives
  // under a new name each time. Only the byte offset is per-file.
  const sameFile = Boolean(state && state.path === transcriptPath);
  const previous = {
    path: transcriptPath,
    offset: sameFile && Number.isFinite(state.offset) ? state.offset : 0,
    ids: Array.isArray(state?.ids) ? state.ids : [],
  };
  // A shrunk or rewritten file invalidates the offset: start over rather than
  // slicing into the middle of an unrelated payload.
  const start =
    stats.size >= previous.offset ? previous.offset : 0;
  if (start >= stats.size) {
    return {
      payloads: [],
      state: previous,
      bytesRead: 0,
      truncated: false,
    };
  }
  const readBytes = Math.min(MAX_READ_BYTES, stats.size - start);
  const buffer = Buffer.alloc(readBytes);
  let bytesRead = 0;
  try {
    const fd = fs.openSync(transcriptPath, "r");
    try {
      bytesRead = fs.readSync(fd, buffer, 0, readBytes, start);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return { payloads: [], state: previous, bytesRead: 0, truncated: false };
  }
  const chunk = buffer.subarray(0, bytesRead).toString("utf8");
  // Only complete lines are consumed: a write can land mid-line, and the
  // remainder must be read again with its head attached.
  const lastNewline = chunk.lastIndexOf("\n");
  const complete = lastNewline >= 0 ? chunk.slice(0, lastNewline + 1) : "";
  const nextOffset = start + Buffer.byteLength(complete, "utf8");
  const entries = [];
  for (const line of complete.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      entries.push(JSON.parse(trimmed));
    } catch {
      // A corrupt line costs that line only; the cursor still advances past
      // it so a poison record cannot stall the reader forever.
    }
  }
  const remembered = new Set(
    Array.isArray(previous.ids) ? previous.ids : [],
  );
  const payloads = payloadsFromEntries(entries.slice(-MAX_ENTRIES), {
    sessionId,
    cwd,
    source,
    remembered,
    now,
  });
  for (const payload of payloads) {
    const key = payload.payload.transcriptKey;
    if (key) {
      remembered.add(key);
    }
  }
  const ids = [...remembered].slice(-MAX_REMEMBERED_IDS);
  return {
    payloads,
    state: { path: transcriptPath, offset: nextOffset, ids },
    bytesRead,
    truncated: nextOffset < stats.size,
  };
}

function readStateFile(file) {
  try {
    const raw = fs.readFileSync(file, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function writeStateFile(file, state) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const target = file;
    const temporary = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(state)}\n`, "utf8");
    fs.renameSync(temporary, target);
  } catch {
    // A read-only session directory costs repeated reads, not a failed hook.
  }
}

/**
 * The recorder's single entry point: read new transcript entries for one host
 * event and persist the cursor. Returns the payloads to append *before* the
 * host event so the LOG reads chronologically.
 *
 * `stateDirectory` must be stable across hooks of one session (the recorder
 * passes `<ASTRO_HOME>/transcript-state`); `stateKey` names the per-session
 * file so two sessions never share a cursor.
 */
function enrichFromTranscript(options) {
  const {
    transcriptPath,
    stateDirectory,
    stateKey,
    sessionId,
    cwd,
    source,
    now,
  } = options;
  if (!transcriptPath || !stateDirectory) {
    return [];
  }
  const stateFile = path.join(stateDirectory, `${stateKey || "session"}.json`);
  const state = readStateFile(stateFile);
  const result = readTranscriptEvents({
    transcriptPath,
    sessionId,
    cwd,
    source,
    state,
    now,
  });
  if (!result.payloads.length) {
    if (result.state && result.state !== state) {
      writeStateFile(stateFile, result.state);
    }
    return [];
  }
  writeStateFile(stateFile, result.state);
  return result.payloads;
}

module.exports = {
  MAX_READ_BYTES,
  MESSAGE_EVENT,
  REASONING_EVENT,
  STATE_FILE,
  assistantText,
  enrichFromTranscript,
  entryKind,
  isEnrichEvent,
  payloadsFromEntries,
  readStateFile,
  readTranscriptEvents,
  reasoningText,
  writeStateFile,
};
