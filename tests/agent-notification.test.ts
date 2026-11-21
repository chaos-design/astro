import assert from "node:assert/strict";
import test from "node:test";

import {
  INTERACTION_NOTIFICATION_CHANNELS,
  INTERACTION_NOTIFICATION_KINDS,
  INTERACTION_NOTIFICATION_TARGETS,
  describeInteractionOutcome,
} from "../src/lib/agent-notification.ts";
import {
  buildAgentNotification,
  validateAgentNotification,
} from "../plugin/interaction-contract.mjs";

const NOW = Date.UTC(2026, 10, 15, 10, 0, 0);

test("the documented kind, target and channel sets are the only accepted ones", () => {
  assert.deepEqual(INTERACTION_NOTIFICATION_KINDS, [
    "answer_applied",
    "answer_cancelled",
    "interaction_timeout",
    "fallback_prompt",
    "question_replaced",
    "device_takeover",
  ]);
  assert.deepEqual(INTERACTION_NOTIFICATION_TARGETS, ["agent", "user", "both"]);
  assert.deepEqual(INTERACTION_NOTIFICATION_CHANNELS, [
    "additionalContext",
    "systemMessage",
    "permissionDecisionReason",
    "terminalSequence",
    "sse",
    "trace",
  ]);
});

test("an answered notification names counts and source, never the answers", () => {
  const summary = describeInteractionOutcome("answered", 2, 1);
  assert.match(summary, /answered 2 questions/);
  assert.match(summary, /skipped 1/);
  assert.doesNotMatch(
    summary,
    /React|Vue|answer is|answers are: /,
    "the summary must not carry the answer text",
  );

  const notification = buildAgentNotification(
    {
      requestId: "irq-12345678",
      kind: "answer_applied",
      channel: "additionalContext",
      sessionId: "sess-1",
      toolUseId: "call-1",
      summary,
      detail: { answered: 2, skipped: 1, answeredBy: "console" },
    },
    { now: NOW },
  );
  assert.equal(notification.schemaVersion, 1);
  assert.equal(notification.kind, "answer_applied");
  assert.equal(notification.target, "agent");
  assert.equal(notification.ttlMs, 0);
  assert.equal(notification.at, new Date(NOW).toISOString());
  assert.equal(
    validateAgentNotification(notification).valid,
    true,
    validateAgentNotification(notification).errors.join("; "),
  );
  assert.doesNotMatch(JSON.stringify(notification), /React|Vue/);
});

test("cancelled, timeout and expired each get their own sentence", () => {
  assert.match(describeInteractionOutcome("cancelled", 0, 0), /cancelled/);
  assert.match(describeInteractionOutcome("timeout", 0, 0), /expired without/);
  assert.match(describeInteractionOutcome("expired", 0, 0), /session ended/);
});

test("summary is clamped to 500 characters and rejects control characters", () => {
  const long = "a".repeat(600);
  const notification = buildAgentNotification(
    {
      requestId: "irq-12345678",
      kind: "fallback_prompt",
      channel: "trace",
      summary: long,
    },
    { now: NOW },
  );
  assert.equal(notification.summary.length, 500);
  assert.equal(validateAgentNotification(notification).valid, true);

  const broken = { ...notification, summary: "bad\u0007summary" };
  assert.equal(validateAgentNotification(broken).valid, false);
  const empty = { ...notification, summary: "   " };
  assert.equal(validateAgentNotification(empty).valid, false);
});

test("an unknown kind, target or channel is rejected", () => {
  const base = buildAgentNotification(
    {
      requestId: "irq-12345678",
      kind: "answer_applied",
      channel: "sse",
      summary: "User answered 1 question via console.",
    },
    { now: NOW },
  );
  assert.equal(validateAgentNotification(base).valid, true);
  assert.equal(
    validateAgentNotification({ ...base, kind: "answer_maybe" }).valid,
    false,
  );
  assert.equal(
    validateAgentNotification({ ...base, target: "everyone" }).valid,
    false,
  );
  assert.equal(
    validateAgentNotification({ ...base, channel: "stdout" }).valid,
    false,
  );
});
