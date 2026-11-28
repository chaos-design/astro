import assert from "node:assert/strict";
import test from "node:test";

import {
  payloadField,
  resolveInputPayload,
  resolveOutputPayload,
} from "../src/lib/inspector-payload.ts";
import type { TraceEvent } from "../src/types/trace.ts";

const NOW = "2026-11-28T12:00:00.000Z";

let sequence = 0;
function event(
  eventName: string,
  payload: TraceEvent["payload"],
): TraceEvent {
  sequence += 1;
  return {
    schemaVersion: 1,
    id: `evt-${sequence}`,
    capturedAt: NOW,
    source: "zcode",
    sourceVersion: null,
    workspaceId: "ws",
    sessionId: "sess",
    turnId: null,
    parentId: null,
    eventName,
    nativeEventName: eventName,
    toolUseId: null,
    toolName: null,
    cwd: null,
    status: null,
    sequence,
    payload,
    locator: "trace://sess",
  };
}

/**
 * The one payload resolution behind the inspector's Input / Output tabs and
 * the global overlay dialog. A row must preview its own data in every surface:
 * the resolver never ends on a fabricated `{message: null}` stub, because a
 * prompt row (or a recovered Reasoning) has real content one level down that
 * the Agent view body renders while the stub hid it.
 */
test("a prompt row's output side falls back to its own payload", () => {
  const prompt = event("UserPromptSubmit", {
    message: null,
    prompt: "图1重构一下，更古香古色一点",
    attachmentsSummary: "1:image;image.png",
    mode: "yolo",
  });
  const resolved = resolveOutputPayload(prompt, null);
  assert.equal(resolved, prompt.payload);
  // The content the panes extract from that payload is the prompt itself, so
  // the dialog's Preview pane agrees with the Agent view's step body.
  assert.equal((resolved as TraceEvent["payload"]).prompt, "图1重构一下，更古香古色一点");
});

test("a tool result row reads its own captured result before the pair close", () => {
  const close = event("PostToolUse", { tool_response: { output: "pair" } });
  const own = event("PostToolUse", { tool_response: { output: "own" } });
  assert.deepEqual(resolveOutputPayload(own, close), { output: "own" });

  // A call row with no result yet falls through to the paired close.
  const call = event("PreToolUse", { tool_input: { command: "ls" } });
  assert.deepEqual(resolveOutputPayload(call, close), { output: "pair" });
});

test("a recovered thinking step resolves through the text spelling", () => {
  const recovered = event("Reasoning", {
    client: "zcode",
    recoveredFrom: "transcript",
    transcriptKey: "reasoning:1:abc",
    messageId: "m1",
    text: "先检查派生层",
  });
  assert.deepEqual(resolveOutputPayload(recovered, null), {
    message: "先检查派生层",
  });

  // Long-lived adapters stamp the same thinking under `message` — the wrapper
  // shape stays identical so the related pane keeps one rendering.
  const adapter = event("Reasoning", { message: "adapter thinking" });
  assert.deepEqual(resolveOutputPayload(adapter, null), {
    message: "adapter thinking",
  });
});

test("an empty placeholder never shadows the real camel spelling", () => {
  const result = event("PostToolUse", {
    tool_response: {},
    toolResponse: { output: "real" },
  });
  assert.deepEqual(resolveOutputPayload(result, null), { output: "real" });

  const call = event("PreToolUse", {
    tool_input: {},
    toolInput: { command: "ls" },
  });
  assert.deepEqual(resolveInputPayload(call, call), { command: "ls" });
});

test("a payload-less event resolves without a fabricated stub", () => {
  const bare = event("Stop", {});
  assert.deepEqual(resolveOutputPayload(bare, null), {});
  assert.deepEqual(resolveInputPayload(bare, bare), {});
  assert.equal(resolveOutputPayload(null, null), null);
});

test("the input side reads a prompt atom from its start and a call from its arguments", () => {
  const prompt = event("UserPromptSubmit", {
    prompt: "重构一下",
    message: null,
  });
  assert.equal(resolveInputPayload(prompt, prompt), prompt.payload);

  const call = event("PreToolUse", { tool_input: { command: "pnpm test" } });
  assert.deepEqual(resolveInputPayload(call, call), { command: "pnpm test" });

  // A generic event without arguments falls back to its own payload instead
  // of the former `{prompt: undefined, message: null, source: undefined}`.
  const note = event("Notification", { message: "权限询问" });
  assert.equal(resolveInputPayload(note, note), note.payload);
});

test("payloadField skips the recorder's placeholders and picks the first real value", () => {
  assert.equal(payloadField(null, undefined, {}, "real"), "real");
  assert.deepEqual(payloadField({ a: 1 }, { b: 2 }), { a: 1 });
  assert.equal(payloadField(null, undefined), null);
});
