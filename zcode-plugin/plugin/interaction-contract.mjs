/**
 * AskUserQuestion interaction contract: the five message shapes, their field
 * limits and the functions that validate and build them.
 *
 * This module is the single definition shared by every runtime in the chain:
 * the interaction hook (`scripts/interaction-hook.mjs`), the local service
 * (`server/interaction-store.mjs`), the console (`src/lib/interaction-contract.ts`)
 * and the agent-notification helper. It is plain ESM with no Node or DOM API,
 * because the service ships without `src/` and the console bundles it.
 *
 * The validators are intentionally total: they never throw on untrusted input,
 * they return `{ valid, errors }`. Builders throw on programmer error, and the
 * hook's top-level `try` turns that into the fail-open empty stdout.
 */

export const INTERACTION_SCHEMA_VERSION = 1;

export const INTERACTION_HOOK_EVENTS = ["PreToolUse", "PermissionRequest"];
export const INTERACTION_TOOLS = ["AskUserQuestion", "ExitPlanMode"];
export const INTERACTION_ACTIONS = [
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
];
/** Actions that conclude a request; only these may carry `final: true`. */
export const INTERACTION_FINAL_ACTIONS = ["submit", "cancel", "timeout", "expire"];
export const INTERACTION_RESULT_STATUSES = ["answered", "cancelled", "timeout", "expired"];
export const INTERACTION_NOTIFICATION_KINDS = [
  "answer_applied",
  "answer_cancelled",
  "interaction_timeout",
  "fallback_prompt",
  "question_replaced",
  "device_takeover",
];
export const INTERACTION_NOTIFICATION_TARGETS = ["agent", "user", "both"];
export const INTERACTION_NOTIFICATION_CHANNELS = [
  "additionalContext",
  "systemMessage",
  "permissionDecisionReason",
  "terminalSequence",
  "sse",
  "trace",
];

export const INTERACTION_LIMITS = Object.freeze({
  minQuestions: 1,
  maxQuestions: 4,
  minOptions: 2,
  maxOptions: 8,
  questionLength: 500,
  headerLength: 40,
  labelLength: 120,
  textLength: 2000,
  eventBytes: 8192,
  answersChars: 4000,
  summaryLength: 500,
  notificationString: 10000,
  // Default synchronous window when the installer passes no `--timeout`.
  hookTimeoutMs: 5000,
  // Validation ceiling for a configured window: the installer may register a
  // longer hook timeout (default 600 s) so the console can answer for as long
  // as the host actually waits. `hookTimeoutMs` stays the no-flag default.
  maxHookTimeoutMs: 3_600_000,
  ttlMarginMs: 500,
});

const QUESTION_KEYS = new Set(["question", "header", "options", "multiSelect", "required"]);
const EVENT_REQUIRED = [
  "requestId",
  "eventId",
  "seq",
  "action",
  "deviceId",
  "at",
];

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asString(value) {
  return typeof value === "string" ? value : "";
}

function isIsoTimestamp(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function byteLength(value) {
  return new TextEncoder().encode(value).length;
}

/** FNV-1a over UTF-16 code units; deterministic across Node and the browser. */
function hashText(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function stableId(prefix, seed) {
  return `${prefix}-${hashText(seed)}${hashText(`${seed}:salt`).slice(0, 8)}`;
}

function optionLabel(option) {
  if (typeof option === "string") {
    return option.trim();
  }
  if (!isRecord(option)) {
    return "";
  }
  for (const key of ["label", "name", "value", "title"]) {
    const value = option[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

/** Normalize the host's option spelling into `{ label, description? }`. */
export function normalizeQuestionOptions(options) {
  if (!Array.isArray(options)) {
    return [];
  }
  return options
    .map((option) => {
      const label = optionLabel(option);
      const description = isRecord(option) && typeof option.description === "string"
        ? option.description.trim()
        : "";
      return description ? { label, description } : { label };
    })
    .filter((option) => option.label);
}

/** `ttlMs ≤ timeoutMs - 500`, floored at zero; the default is the 5 s window. */
export function resolveInteractionTtl(timeoutMs = INTERACTION_LIMITS.hookTimeoutMs) {
  const timeout = Number.isFinite(timeoutMs) && timeoutMs > 0
    ? timeoutMs
    : INTERACTION_LIMITS.hookTimeoutMs;
  return Math.max(0, Math.min(timeout - INTERACTION_LIMITS.ttlMarginMs, timeout));
}

export function isFinalInteractionAction(action) {
  return INTERACTION_FINAL_ACTIONS.includes(action);
}

export function validateQuestionDescriptor(value) {
  const errors = [];
  if (!isRecord(value)) {
    return { valid: false, errors: ["question must be an object"] };
  }
  for (const key of Object.keys(value)) {
    if (!QUESTION_KEYS.has(key)) {
      errors.push(`unknown question field: ${key}`);
    }
  }
  const question = asString(value.question).trim();
  if (!question) {
    errors.push("question text is required");
  } else if (question.length > INTERACTION_LIMITS.questionLength) {
    errors.push(`question text exceeds ${INTERACTION_LIMITS.questionLength} characters`);
  }
  const header = asString(value.header).trim();
  if (header.length > INTERACTION_LIMITS.headerLength) {
    errors.push(`header exceeds ${INTERACTION_LIMITS.headerLength} characters`);
  }
  if (value.multiSelect !== undefined && typeof value.multiSelect !== "boolean") {
    errors.push("multiSelect must be a boolean");
  }
  if (value.required !== undefined && typeof value.required !== "boolean") {
    errors.push("required must be a boolean");
  }
  const options = Array.isArray(value.options) ? value.options : null;
  if (!options) {
    errors.push("options must be an array");
  } else {
    if (
      options.length < INTERACTION_LIMITS.minOptions ||
      options.length > INTERACTION_LIMITS.maxOptions
    ) {
      errors.push(
        `options must contain ${INTERACTION_LIMITS.minOptions}..${INTERACTION_LIMITS.maxOptions} entries`,
      );
    }
    const labels = new Set();
    for (const option of options) {
      const label = optionLabel(option);
      if (!label) {
        errors.push("every option needs a label");
        continue;
      }
      if (label.length > INTERACTION_LIMITS.labelLength) {
        errors.push(`option label exceeds ${INTERACTION_LIMITS.labelLength} characters`);
      }
      if (labels.has(label)) {
        errors.push(`duplicate option label: ${label}`);
      }
      labels.add(label);
    }
  }
  return { valid: errors.length === 0, errors };
}

export function validateInteractionRequest(value) {
  const errors = [];
  if (!isRecord(value)) {
    return { valid: false, errors: ["request must be an object"] };
  }
  if (typeof value.requestId !== "string" || !/^irq-[a-z0-9]{8,64}$/.test(value.requestId)) {
    errors.push("requestId must be an irq- id");
  }
  if (value.schemaVersion !== INTERACTION_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${INTERACTION_SCHEMA_VERSION}`);
  }
  if (!INTERACTION_HOOK_EVENTS.includes(value.hookEventName)) {
    errors.push("hookEventName must be PreToolUse or PermissionRequest");
  }
  if (!INTERACTION_TOOLS.includes(value.toolName)) {
    errors.push("toolName must be AskUserQuestion or ExitPlanMode");
  }
  if (typeof value.sessionId !== "string" || !value.sessionId.trim()) {
    errors.push("sessionId is required");
  }
  if (typeof value.source !== "string" || !value.source.trim()) {
    errors.push("source is required");
  }
  if (!isIsoTimestamp(value.createdAt)) {
    errors.push("createdAt must be an ISO timestamp");
  }
  if (!isIsoTimestamp(value.expiresAt)) {
    errors.push("expiresAt must be an ISO timestamp");
  } else if (
    isIsoTimestamp(value.createdAt) &&
    Date.parse(value.expiresAt) < Date.parse(value.createdAt)
  ) {
    errors.push("expiresAt must not precede createdAt");
  }
  if (
    !Number.isInteger(value.ttlMs) ||
    value.ttlMs < 0 ||
    value.ttlMs >
      INTERACTION_LIMITS.maxHookTimeoutMs - INTERACTION_LIMITS.ttlMarginMs
  ) {
    errors.push(
      `ttlMs must be an integer within 0..${
        resolveInteractionTtl(INTERACTION_LIMITS.maxHookTimeoutMs)
      }`,
    );
  }
  if (!Number.isInteger(value.revision) || value.revision < 1) {
    errors.push("revision must be a positive integer");
  }
  if (!Array.isArray(value.questions)) {
    errors.push("questions must be an array");
  } else {
    if (
      value.questions.length < INTERACTION_LIMITS.minQuestions ||
      value.questions.length > INTERACTION_LIMITS.maxQuestions
    ) {
      errors.push(
        `questions must contain ${INTERACTION_LIMITS.minQuestions}..${INTERACTION_LIMITS.maxQuestions} entries`,
      );
    }
    for (const question of value.questions) {
      const result = validateQuestionDescriptor(question);
      errors.push(...result.errors);
    }
  }
  return { valid: errors.length === 0, errors };
}

export function validateInteractionEvent(value, context = {}) {
  const errors = [];
  if (!isRecord(value)) {
    return { valid: false, errors: ["event must be an object"] };
  }
  for (const key of EVENT_REQUIRED) {
    if (!(key in value)) {
      errors.push(`${key} is required`);
    }
  }
  if (typeof value.requestId !== "string" || !/^irq-[a-z0-9]{8,64}$/.test(value.requestId)) {
    errors.push("requestId must be an irq- id");
  }
  if (typeof value.eventId !== "string" || !value.eventId.trim()) {
    errors.push("eventId is required");
  }
  if (!Number.isInteger(value.seq) || value.seq < 1) {
    errors.push("seq must be a positive integer");
  } else if (Number.isInteger(context.previousSeq) && value.seq <= context.previousSeq) {
    errors.push("seq must increase");
  }
  if (!INTERACTION_ACTIONS.includes(value.action)) {
    errors.push("action is not a known interaction action");
  }
  if (typeof value.deviceId !== "string" || !value.deviceId.trim()) {
    errors.push("deviceId is required");
  }
  if (!isIsoTimestamp(value.at)) {
    errors.push("at must be an ISO timestamp");
  }
  const hasText = typeof value.text === "string" && value.text.trim().length > 0;
  const hasOption = typeof value.optionLabel === "string" && value.optionLabel.trim().length > 0;
  if (hasText && hasOption) {
    errors.push("text and optionLabel are mutually exclusive");
  }
  if (value.final === true && !isFinalInteractionAction(value.action)) {
    errors.push(`action ${value.action} cannot be final`);
  }
  if (value.final !== undefined && typeof value.final !== "boolean") {
    errors.push("final must be a boolean");
  }
  if (value.action === "select" || value.action === "deselect") {
    if (!hasOption) {
      errors.push(`${value.action} requires optionLabel`);
    }
    if (typeof value.question !== "string" || !value.question.trim()) {
      errors.push(`${value.action} requires question`);
    }
  }
  if (value.action === "text") {
    if (!hasText) {
      errors.push("text action requires text");
    } else if (value.text.trim().length > INTERACTION_LIMITS.textLength) {
      errors.push(`text exceeds ${INTERACTION_LIMITS.textLength} characters`);
    }
    if (typeof value.question !== "string" || !value.question.trim()) {
      errors.push("text action requires question");
    }
  }
  if (value.action === "edit") {
    for (const key of ["previous", "next"]) {
      if (typeof value[key] !== "string" || !value[key].trim()) {
        errors.push(`edit requires ${key}`);
      }
    }
    if (typeof value.question !== "string" || !value.question.trim()) {
      errors.push("edit requires question");
    }
  }
  if (value.action === "skip" && (typeof value.question !== "string" || !value.question.trim())) {
    errors.push("skip requires question");
  }
  if (value.action === "replace") {
    if (!Number.isInteger(value.revision) || value.revision < 2) {
      errors.push("replace requires revision >= 2");
    } else if (Number.isInteger(context.revision) && value.revision <= context.revision) {
      errors.push("replace revision must increase");
    }
    if (!Array.isArray(value.questions) || !value.questions.length) {
      errors.push("replace requires questions");
    } else {
      for (const question of value.questions) {
        errors.push(...validateQuestionDescriptor(question).errors);
      }
    }
  }
  if (value.action === "submit" && value.answers !== undefined) {
    if (!isRecord(value.answers)) {
      errors.push("submit answers must be an object");
    }
  }
  if (byteLength(JSON.stringify(value)) > INTERACTION_LIMITS.eventBytes) {
    errors.push(`event exceeds ${INTERACTION_LIMITS.eventBytes} bytes`);
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Validate an answer map against the questions that produced it.
 *
 * - keys must match the question text verbatim; unknown keys are dropped
 * - a value is a declared label, a comma-joined list of declared labels, or —
 *   when `allowText` is set — free text produced by a `text` action
 * - multi-select tokens are canonicalized to the declared option order
 * - the serialized map must stay within 4000 characters
 */
export function validateAnswers(value, questions, options = {}) {
  const errors = [];
  const answers = {};
  const allowText = options.allowText === true;
  if (!isRecord(value)) {
    return { valid: false, errors: ["answers must be an object"], answers };
  }
  const byQuestion = new Map();
  for (const question of Array.isArray(questions) ? questions : []) {
    if (!isRecord(question) || typeof question.question !== "string") {
      continue;
    }
    const labels = normalizeQuestionOptions(question.options).map((option) => option.label);
    byQuestion.set(question.question, {
      labels,
      multiSelect: question.multiSelect === true,
      required: question.required !== false,
    });
  }
  for (const [rawQuestion, rawAnswer] of Object.entries(value)) {
    const question = rawQuestion.trim();
    const target = byQuestion.get(question);
    if (!target || typeof rawAnswer !== "string") {
      continue;
    }
    const answer = rawAnswer.trim();
    if (!answer) {
      continue;
    }
    const tokens = answer
      .split(",")
      .map((token) => token.trim())
      .filter(Boolean);
    const declared = tokens.every((token) => target.labels.includes(token));
    if (declared) {
      if (tokens.length > 1 && !target.multiSelect) {
        errors.push(`question "${question}" does not accept multiple answers`);
        continue;
      }
      const order = new Map(target.labels.map((label, index) => [label, index]));
      answers[question] = [...new Set(tokens)]
        .sort((left, right) => order.get(left) - order.get(right))
        .join(", ");
      continue;
    }
    if (allowText && answer.length <= INTERACTION_LIMITS.textLength) {
      answers[question] = answer;
      continue;
    }
    errors.push(`answer for "${question}" is not a declared option`);
  }
  for (const [question, meta] of byQuestion) {
    if (meta.required && !(question in answers)) {
      errors.push(`question "${question}" is required`);
    }
  }
  const serialized = JSON.stringify(answers);
  if (serialized.length > INTERACTION_LIMITS.answersChars) {
    errors.push(`answers exceed ${INTERACTION_LIMITS.answersChars} characters`);
  }
  return { valid: errors.length === 0, errors, answers };
}

/**
 * Build a request. The id is deterministic for the same host call, so a host
 * that retries a hook writes the same record instead of a second one.
 */
export function buildInteractionRequest(input, options = {}) {
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const timeoutMs = options.timeoutMs ?? INTERACTION_LIMITS.hookTimeoutMs;
  const ttlMs = resolveInteractionTtl(timeoutMs);
  const questionResult = validateQuestions(input.questions);
  if (!questionResult.valid) {
    throw new TypeError(`invalid questions: ${questionResult.errors.join("; ")}`);
  }
  const seed = [
    input.source || "generic",
    input.sessionId || "",
    input.toolUseId || "",
    input.hookEventName || "",
    String(input.revision || 1),
    JSON.stringify(input.questions),
  ].join("|");
  return {
    requestId: stableId("irq", seed),
    schemaVersion: INTERACTION_SCHEMA_VERSION,
    hookEventName: input.hookEventName,
    toolName: input.toolName,
    toolUseId: input.toolUseId || null,
    sessionId: input.sessionId,
    source: input.source || "generic",
    cwd: input.cwd || "",
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttlMs).toISOString(),
    ttlMs,
    revision: input.revision || 1,
    questions: input.questions.map((question) => ({
      question: question.question.trim(),
      header: asString(question.header).trim(),
      options: normalizeQuestionOptions(question.options),
      multiSelect: question.multiSelect === true,
      required: question.required !== false,
    })),
  };
}

function validateQuestions(questions) {
  const errors = [];
  if (!Array.isArray(questions) || !questions.length) {
    return { valid: false, errors: ["questions must be a non-empty array"] };
  }
  for (const question of questions) {
    errors.push(...validateQuestionDescriptor(question).errors);
  }
  return { valid: errors.length === 0, errors };
}

export function buildInteractionResult(request, status, answers, options = {}) {
  if (!INTERACTION_RESULT_STATUSES.includes(status)) {
    throw new TypeError(`unknown interaction status: ${status}`);
  }
  const answeredAt = Number.isFinite(options.now) ? options.now : Date.now();
  const createdAt = Date.parse(request?.createdAt || "");
  return {
    requestId: request?.requestId || "",
    status,
    answers: status === "answered" ? { ...answers } : {},
    answeredBy: options.answeredBy || "console",
    answeredAt: new Date(answeredAt).toISOString(),
    elapsedMs: Number.isFinite(createdAt) ? Math.max(0, answeredAt - createdAt) : 0,
  };
}

export function validateAgentNotification(value) {
  const errors = [];
  if (!isRecord(value)) {
    return { valid: false, errors: ["notification must be an object"] };
  }
  if (value.schemaVersion !== INTERACTION_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${INTERACTION_SCHEMA_VERSION}`);
  }
  if (typeof value.notificationId !== "string" || !value.notificationId.trim()) {
    errors.push("notificationId is required");
  }
  if (typeof value.requestId !== "string" || !value.requestId.trim()) {
    errors.push("requestId is required");
  }
  if (!INTERACTION_NOTIFICATION_KINDS.includes(value.kind)) {
    errors.push("kind is not a known notification kind");
  }
  if (!INTERACTION_NOTIFICATION_TARGETS.includes(value.target)) {
    errors.push("target is not a known notification target");
  }
  if (!INTERACTION_NOTIFICATION_CHANNELS.includes(value.channel)) {
    errors.push("channel is not a known notification channel");
  }
  const summary = asString(value.summary).trim();
  if (!summary || summary.length > INTERACTION_LIMITS.summaryLength) {
    errors.push(`summary must be 1..${INTERACTION_LIMITS.summaryLength} characters`);
  }
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(summary)) {
    errors.push("summary must not contain control characters");
  }
  if (typeof value.detail === "object" && value.detail !== null) {
    const serialized = JSON.stringify(value.detail);
    if (serialized.length > INTERACTION_LIMITS.notificationString) {
      errors.push("detail exceeds the host string limit");
    }
  }
  if (typeof value.at !== "string" || !isIsoTimestamp(value.at)) {
    errors.push("at must be an ISO timestamp");
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Summaries name the outcome and the count, never the answers themselves:
 * an answer can carry a credential the user typed into an "Other" field.
 */
export function buildAgentNotification(input, options = {}) {
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const notification = {
    schemaVersion: INTERACTION_SCHEMA_VERSION,
    notificationId: input.notificationId ||
      stableId("ntf", `${input.requestId}|${input.kind}|${input.channel}`),
    requestId: input.requestId,
    kind: input.kind,
    target: input.target || "agent",
    channel: input.channel,
    sessionId: input.sessionId || "",
    toolUseId: input.toolUseId || null,
    at: new Date(now).toISOString(),
    summary: String(input.summary || "").trim().slice(0, INTERACTION_LIMITS.summaryLength),
    detail: input.detail || {},
    ttlMs: input.ttlMs ?? 0,
  };
  return notification;
}

/**
 * Host-side aggregation, mirrored so tests and the console can explain why a
 * request fell back to the native prompt: `deny > ask > allow`.
 */
export function aggregateDecisionOutputs(outputs) {
  const decisions = (Array.isArray(outputs) ? outputs : [])
    .map((output) => {
      const specific = output?.hookSpecificOutput;
      return specific?.permissionDecision ?? specific?.decision?.behavior ?? "";
    })
    .filter(Boolean);
  if (decisions.includes("deny")) {
    return "deny";
  }
  if (decisions.includes("ask")) {
    return "ask";
  }
  if (decisions.includes("allow")) {
    return "allow";
  }
  return "none";
}
