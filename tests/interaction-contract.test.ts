import assert from "node:assert/strict";
import test from "node:test";

import {
  INTERACTION_ACTIONS,
  INTERACTION_FINAL_ACTIONS,
  INTERACTION_HOOK_EVENTS,
  INTERACTION_LIMITS,
  INTERACTION_NOTIFICATION_CHANNELS,
  INTERACTION_NOTIFICATION_KINDS,
  INTERACTION_NOTIFICATION_TARGETS,
  INTERACTION_RESULT_STATUSES,
  INTERACTION_SCHEMA_VERSION,
  INTERACTION_TOOLS,
  buildAgentNotification,
  buildInteractionRequest,
  buildInteractionResult,
  isFinalInteractionAction,
  resolveInteractionTtl,
  validateAgentNotification,
  validateAnswers,
  validateInteractionEvent,
  validateInteractionRequest,
  validateQuestionDescriptor,
} from "../src/lib/interaction-contract.ts";
import { describeInteractionOutcome } from "../src/lib/agent-notification.ts";

function question(overrides = {}) {
  return {
    question: "Which framework?",
    header: "Framework",
    options: [
      { label: "React", description: "Component library" },
      { label: "Vue", description: "Progressive framework" },
    ],
    ...overrides,
  };
}

const validInput = {
  hookEventName: "PermissionRequest" as const,
  toolName: "AskUserQuestion" as const,
  toolUseId: "call_001",
  sessionId: "session-1",
  source: "zcode",
  cwd: "/workspace/demo",
  questions: [question()],
};

test("A1: the five message shapes expose their closed enum sets", () => {
  assert.equal(INTERACTION_SCHEMA_VERSION, 1);
  assert.deepEqual(INTERACTION_HOOK_EVENTS, ["PreToolUse", "PermissionRequest"]);
  assert.deepEqual(INTERACTION_TOOLS, ["AskUserQuestion", "ExitPlanMode"]);
  assert.deepEqual(INTERACTION_ACTIONS, [
    "select",
    "deselect",
    "text",
    "edit",
    "submit",
    "cancel",
    "skip",
    "timeout",
    "takeover",
    "expire",
    "replace",
  ]);
  assert.deepEqual(INTERACTION_FINAL_ACTIONS, [
    "submit",
    "cancel",
    "timeout",
    "expire",
  ]);
  assert.deepEqual(INTERACTION_RESULT_STATUSES, [
    "answered",
    "cancelled",
    "timeout",
    "expired",
  ]);
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
  assert.equal(isFinalInteractionAction("submit"), true);
  assert.equal(isFinalInteractionAction("select"), false);
});

test("A2: question descriptors accept 1..4 questions and 2..8 unique labels", () => {
  assert.deepEqual(validateQuestionDescriptor(question()), {
    valid: true,
    errors: [],
  });
  const four = buildInteractionRequest({
    ...validInput,
    questions: Array.from({ length: 4 }, (_, index) =>
      question({ question: `Question ${index}?` }),
    ),
  });
  assert.equal(validateInteractionRequest(four).valid, true);

  const eightLabels = question({
    options: Array.from({ length: 8 }, (_, index) => ({ label: `Option ${index}` })),
  });
  assert.equal(validateQuestionDescriptor(eightLabels).valid, true);

  assert.match(
    validateQuestionDescriptor(question({ options: [{ label: "One" }] })).errors.join(),
    /2\.\.8/,
  );
  assert.match(
    validateQuestionDescriptor(
      question({
        options: Array.from({ length: 9 }, (_, index) => ({ label: `Option ${index}` })),
      }),
    ).errors.join(),
    /2\.\.8/,
  );
  assert.match(
    validateQuestionDescriptor(
      question({ options: [{ label: "React" }, { label: "React" }] }),
    ).errors.join(),
    /duplicate option label/,
  );
  assert.match(
    validateQuestionDescriptor(question({ question: "   " })).errors.join(),
    /question text is required/,
  );
  assert.match(
    validateQuestionDescriptor(question({ header: "x".repeat(41) })).errors.join(),
    /header exceeds 40/,
  );
});

test("A2: a request accepts 1..4 questions and rejects five", () => {
  const request = buildInteractionRequest(validInput);
  assert.equal(validateInteractionRequest(request).valid, true);
  const five = {
    ...request,
    questions: Array.from({ length: 5 }, (_, index) =>
      question({ question: `Question ${index}?` }),
    ),
  };
  assert.match(validateInteractionRequest(five).errors.join(), /1\.\.4/);
  const zero = { ...request, questions: [] };
  assert.match(validateInteractionRequest(zero).errors.join(), /1\.\.4/);
});

test("A3: events reject unknown actions, backward seq and illegal final flags", () => {
  const request = buildInteractionRequest(validInput);
  const base = {
    requestId: request.requestId,
    eventId: "iev-1",
    seq: 2,
    action: "select",
    deviceId: "console",
    at: new Date().toISOString(),
    question: "Which framework?",
    optionLabel: "React",
  };
  assert.equal(validateInteractionEvent(base, { previousSeq: 1 }).valid, true);

  assert.match(
    validateInteractionEvent({ ...base, action: "teleport" }).errors.join(),
    /not a known interaction action/,
  );
  assert.match(
    validateInteractionEvent({ ...base, seq: 1 }, { previousSeq: 1 }).errors.join(),
    /seq must increase/,
  );
  assert.match(
    validateInteractionEvent({ ...base, seq: 0 }).errors.join(),
    /seq must be a positive integer/,
  );
  assert.match(
    validateInteractionEvent({ ...base, final: true }).errors.join(),
    /cannot be final/,
  );
  // `submit` may conclude a request; the same flag on `select` may not.
  assert.equal(
    validateInteractionEvent({ ...base, action: "submit", final: true }).valid,
    true,
  );
});

test("A3: text and optionLabel are mutually exclusive and events stay under 8 KiB", () => {
  const request = buildInteractionRequest(validInput);
  const base = {
    requestId: request.requestId,
    eventId: "iev-1",
    seq: 1,
    action: "select",
    deviceId: "console",
    at: new Date().toISOString(),
    question: "Which framework?",
  };
  assert.match(
    validateInteractionEvent({
      ...base,
      optionLabel: "React",
      text: "React",
    }).errors.join(),
    /mutually exclusive/,
  );
  const oversized = {
    ...base,
    action: "submit",
    final: true,
    answers: { "Which framework?": "React" },
    reason: "x".repeat(INTERACTION_LIMITS.eventBytes + 1),
  };
  assert.match(
    validateInteractionEvent(oversized).errors.join(),
    /exceeds 8192 bytes/,
  );
  const textTooLong = {
    ...base,
    action: "text",
    text: "x".repeat(INTERACTION_LIMITS.textLength + 1),
  };
  assert.match(
    validateInteractionEvent(textTooLong).errors.join(),
    /text exceeds 2000/,
  );
});

test("A3: replace requires new questions and a higher revision", () => {
  const request = buildInteractionRequest(validInput);
  const replace = {
    requestId: request.requestId,
    eventId: "iev-1",
    seq: 1,
    action: "replace",
    deviceId: "console",
    at: new Date().toISOString(),
    revision: 2,
    questions: [question({ question: "Pick a runtime?" })],
  };
  assert.equal(validateInteractionEvent(replace, { revision: 1 }).valid, true);
  assert.match(
    validateInteractionEvent({ ...replace, revision: 2 }, { revision: 2 }).errors.join(),
    /revision must increase/,
  );
  assert.match(
    validateInteractionEvent({ ...replace, questions: [] }).errors.join(),
    /replace requires questions/,
  );
});

test("A4: answers must use the question text verbatim and declared labels", () => {
  const questions = [
    question({ question: "Which framework?" }),
    question({
      question: "Pick tools",
      options: [{ label: "A" }, { label: "B" }, { label: "C" }],
      multiSelect: true,
    }),
  ];
  const result = validateAnswers(
    {
      "Which framework?": "Vue",
      "Pick tools": "C,A",
      "Not a question": "React",
    },
    questions,
  );
  assert.equal(result.valid, true);
  assert.deepEqual(result.answers, {
    "Which framework?": "Vue",
    "Pick tools": "A, C",
  });
  assert.equal("Not a question" in result.answers, false);

  const wrongLabel = validateAnswers({ "Which framework?": "Svelte" }, [questions[0]]);
  assert.equal(wrongLabel.valid, false);
  assert.match(wrongLabel.errors.join(), /not a declared option/);

  const missingRequired = validateAnswers({}, [questions[0]]);
  assert.equal(missingRequired.valid, false);
  assert.match(missingRequired.errors.join(), /is required/);

  const optional = validateAnswers({}, [question({ required: false })]);
  assert.equal(optional.valid, true);

  const multiOnSingle = validateAnswers(
    { "Which framework?": "React, Vue" },
    [questions[0]],
  );
  assert.match(multiOnSingle.errors.join(), /does not accept multiple answers/);

  const tooLong = validateAnswers(
    {
      "One?": "x".repeat(INTERACTION_LIMITS.textLength),
      "Two?": "y".repeat(INTERACTION_LIMITS.textLength),
      "Three?": "z".repeat(INTERACTION_LIMITS.textLength),
    },
    [
      question({ question: "One?" }),
      question({ question: "Two?" }),
      question({ question: "Three?" }),
    ],
    { allowText: true },
  );
  assert.match(tooLong.errors.join(), /exceed 4000 characters/);
});

test("A4: free text is accepted only when the caller allows it", () => {
  const questions = [question()];
  const strict = validateAnswers({ "Which framework?": "something else" }, questions);
  assert.equal(strict.valid, false);
  const text = validateAnswers(
    { "Which framework?": "something else" },
    questions,
    { allowText: true },
  );
  assert.equal(text.valid, true);
  assert.deepEqual(text.answers, { "Which framework?": "something else" });
  const tooLongText = validateAnswers(
    { "Which framework?": "x".repeat(INTERACTION_LIMITS.textLength + 1) },
    questions,
    { allowText: true },
  );
  assert.equal(tooLongText.valid, false);
});

test("A5: buildInteractionRequest is idempotent with ISO dates and a 4500 ms TTL", () => {
  const now = Date.UTC(2026, 10, 15, 14, 0, 0);
  const first = buildInteractionRequest(validInput, { now, timeoutMs: 5000 });
  const second = buildInteractionRequest(validInput, { now: now + 10, timeoutMs: 5000 });
  assert.equal(first.requestId, second.requestId);
  assert.match(first.requestId, /^irq-[a-z0-9]{8,64}$/);
  assert.equal(first.ttlMs, 4500);
  assert.equal(first.createdAt, "2026-11-15T14:00:00.000Z");
  assert.equal(first.expiresAt, "2026-11-15T14:00:04.500Z");
  assert.equal(new Date(first.expiresAt).toISOString(), first.expiresAt);
  assert.equal(validateInteractionRequest(first).valid, true);
  assert.equal(resolveInteractionTtl(5000), 4500);
  assert.equal(resolveInteractionTtl(1000), 500);
  assert.equal(resolveInteractionTtl(0), 4500);
  assert.notEqual(
    buildInteractionRequest({ ...validInput, toolUseId: "call_002" }, { now }).requestId,
    first.requestId,
  );

  // An installer-configured window (the 600 s default) validates against the
  // contract ceiling, not against the 5 s no-flag default.
  const longWindow = buildInteractionRequest(validInput, { now, timeoutMs: 600000 });
  assert.equal(longWindow.ttlMs, 599500);
  assert.equal(validateInteractionRequest(longWindow).valid, true);
  assert.equal(
    validateInteractionRequest({ ...longWindow, ttlMs: 3_600_000 }).valid,
    false,
  );
});

test("A5: results and notifications are built from the same contract", () => {
  const request = buildInteractionRequest(validInput, {
    now: Date.UTC(2026, 10, 15, 14, 0, 0),
  });
  const result = buildInteractionResult(
    request,
    "answered",
    { "Which framework?": "React" },
    { now: Date.parse(request.createdAt) + 3000, answeredBy: "console" },
  );
  assert.equal(result.status, "answered");
  assert.equal(result.elapsedMs, 3000);
  assert.deepEqual(result.answers, { "Which framework?": "React" });

  const cancelled = buildInteractionResult(request, "cancelled", {}, {
    now: Date.parse(request.createdAt) + 100,
  });
  assert.deepEqual(cancelled.answers, {});

  const notification = buildAgentNotification({
    requestId: request.requestId,
    kind: "answer_applied",
    channel: "additionalContext",
    summary: describeInteractionOutcome("answered", 1, 0),
    detail: { answered: 1, answeredBy: "console", elapsedMs: 3000 },
  });
  assert.deepEqual(validateAgentNotification(notification), { valid: true, errors: [] });
  assert.equal(notification.summary.includes("React"), false);
  assert.match(notification.notificationId, /^ntf-/);

  const tooLong = buildAgentNotification({
    requestId: request.requestId,
    kind: "answer_applied",
    channel: "additionalContext",
    summary: "x".repeat(501),
  });
  // The builder truncates to the host limit; a raw 501-character summary is
  // still rejected by the validator.
  assert.equal(tooLong.summary.length, 500);
  assert.deepEqual(validateAgentNotification(tooLong), { valid: true, errors: [] });
  assert.equal(
    validateAgentNotification({ ...notification, summary: "x".repeat(501) }).valid,
    false,
  );
});
