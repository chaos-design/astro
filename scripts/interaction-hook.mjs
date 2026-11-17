#!/usr/bin/env node
/**
 * Opt-in interaction hook: let the ASTRO console answer a user question inside
 * the host's synchronous decision window.
 *
 * The window is the hook's registered timeout — the installer writes it from
 * `--timeout` (seconds, default 600) into both the host's hook configuration
 * and this script's `--timeout` argument, so the request's TTL always stays
 * inside what the host actually waits. While the console is attached to the
 * stream the whole window is answerable; with no console connected the service
 * closes the request at once and this hook fails open immediately. It registers
 * the request with the local service, polls the result file the service writes
 * when the console answers, and returns the host's allow decision if an answer
 * arrived. Every other outcome — no service, no answer, a slow console, bad
 * input, an unsupported tool — is the documented fail-open: empty stdout and
 * exit 0, so the host shows its normal prompt.
 *
 * It is NOT part of the capture chain and it does not replace
 * `auto-approve-question-hook.mjs`: that one answers without a human, this one
 * carries a human answer back. Both are installed explicitly, one at a time.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  INTERACTION_LIMITS,
  buildAgentNotification,
  buildInteractionRequest,
  resolveInteractionTtl,
  validateAnswers,
} from "../plugin/interaction-contract.mjs";
import storagePaths from "../plugin/storage-paths.cjs";
const { resolveAstroHome } = storagePaths;

const DEFAULT_EVENTS = ["PreToolUse", "PermissionRequest"];
const DEFAULT_TOOLS = ["AskUserQuestion", "ExitPlanMode"];
const DIAGNOSTIC_PREFIX = "[astro:interaction]";
const PLAN_QUESTION = "Approve this plan?";
const PLAN_OPTIONS = [{ label: "Approve" }, { label: "Reject" }];

function splitList(value, fallback) {
  if (typeof value !== "string" || !value.trim()) {
    return fallback;
  }
  const parts = value
    .split(/[,|]/)
    .map((item) => item.trim())
    .filter(Boolean);
  return parts.length ? parts : fallback;
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function optionsFromEnvironment(env = process.env) {
  const port = positiveInteger(env.ASTRO_PORT, 5678);
  return {
    events: splitList(env.ASTRO_INTERACTION_EVENTS, DEFAULT_EVENTS),
    tools: splitList(env.ASTRO_INTERACTION_TOOLS, DEFAULT_TOOLS),
    timeoutMs: positiveInteger(
      env.ASTRO_INTERACTION_TIMEOUT_MS,
      INTERACTION_LIMITS.hookTimeoutMs,
    ),
    pollMs: Math.max(10, positiveInteger(env.ASTRO_INTERACTION_POLL_MS, 100)),
    service:
      String(env.ASTRO_INTERACTION_SERVICE || "").trim() ||
      `http://127.0.0.1:${port}`,
    source: String(env.ASTRO_INTERACTION_SOURCE || "").trim(),
    inputField:
      env.ASTRO_INTERACTION_INPUT_FIELD === "modifiedInput"
        ? "modifiedInput"
        : "updatedInput",
    home: resolveAstroHome(env),
  };
}

export function optionsFromArgv(argv = process.argv.slice(2)) {
  const options = {};
  for (const arg of argv) {
    if (arg.startsWith("--source=")) {
      const value = arg.slice("--source=".length).trim();
      if (value) {
        options.source = value;
      }
    } else if (arg.startsWith("--input-field=")) {
      const value = arg.slice("--input-field=".length).trim();
      if (value === "modifiedInput" || value === "updatedInput") {
        options.inputField = value;
      }
    } else if (arg.startsWith("--timeout=")) {
      // Seconds, matching the `timeout` field the installer writes into the
      // host's hook configuration. The window must never exceed what the host
      // actually waits, or a killed hook leaves an unanswerable request open.
      const seconds = positiveInteger(arg.slice("--timeout=".length).trim(), 0);
      if (seconds > 0) {
        options.timeoutMs = seconds * 1000;
      }
    }
  }
  return options;
}

function field(payload, names) {
  for (const name of names) {
    const value = payload?.[name];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function recordField(payload, names) {
  for (const name of names) {
    const value = payload?.[name];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value;
    }
  }
  return null;
}

/** Normalize host spellings; null when this payload is not a question call. */
export function parseHostPayload(payload, options = {}) {
  const events = options.events ?? DEFAULT_EVENTS;
  const tools = options.tools ?? DEFAULT_TOOLS;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const hookEventName = field(payload, [
    "hook_event_name",
    "hookEventName",
    "eventName",
    "hook_event",
  ]);
  const toolName = field(payload, ["tool_name", "toolName", "name"]);
  if (!events.includes(hookEventName) || !tools.includes(toolName)) {
    return null;
  }
  const toolInput = recordField(payload, ["tool_input", "toolInput"]);
  if (!toolInput) {
    return null;
  }
  const questions = Array.isArray(toolInput.questions) ? toolInput.questions : [];
  const plan = typeof toolInput.plan === "string" ? toolInput.plan.trim() : "";
  // ExitPlanMode carries a plan instead of questions; require one of the two
  // so a payload-less permission request never manufactures an interaction.
  if (toolName === "AskUserQuestion" && !questions.length) {
    return null;
  }
  if (toolName === "ExitPlanMode" && !plan) {
    return null;
  }
  return {
    hookEventName,
    toolName,
    toolInput,
    questions,
    plan,
    sessionId: field(payload, ["session_id", "sessionId"]) || "unknown-session",
    // ZCode reports tool identity as camelCase toolCallId (the adapter maps it
    // onto toolUseId for capture); accept every host spelling here too.
    toolUseId: field(payload, ["tool_use_id", "toolUseId", "toolCallId", "call_id"]),
    cwd: field(payload, ["cwd", "working_directory", "project_dir"]),
    source:
      options.source ||
      field(payload, ["source", "agent", "client"]) ||
      "generic",
  };
}

export function buildRequest(payload, options = {}) {
  const host = parseHostPayload(payload, options);
  if (!host) {
    return null;
  }
  return {
    host,
    request: buildInteractionRequest(
      {
        hookEventName: host.hookEventName,
        toolName: host.toolName,
        toolUseId: host.toolUseId,
        sessionId: host.sessionId,
        source: host.source,
        cwd: host.cwd,
        // ExitPlanMode has no questions array; the console still needs one
        // decision to render, and its answer only gates the allow below.
        questions:
          host.toolName === "AskUserQuestion"
            ? host.questions
            : [
                {
                  question: PLAN_QUESTION,
                  header: "Plan",
                  options: PLAN_OPTIONS,
                  required: true,
                },
              ],
      },
      { timeoutMs: options.timeoutMs },
    ),
  };
}

async function postJson(fetchImpl, url, body) {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response || !response.ok) {
    throw new Error(`POST ${url} failed with ${response?.status ?? "no response"}`);
  }
  return response;
}

export function resultPath(requestId, options = {}) {
  return join(
    options.home || resolveAstroHome(process.env),
    "interactions",
    `${requestId}.json`,
  );
}

function readResultFile(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Every host-supported answer shape, or null when the host should keep its
 * normal prompt. Exported so the protocol can be asserted without spawning.
 */
export function buildHookOutput(host, request, result, options = {}) {
  if (!result || result.requestId !== request.requestId) {
    return null;
  }
  if (result.status !== "answered" || !result.answers) {
    return null;
  }
  const inputField = options.inputField ?? "updatedInput";
  if (host.toolName === "ExitPlanMode") {
    // Plan approval echoes the plan input; there are no answers to inject.
    // Only an explicit Approve becomes a decision — Reject and anything else
    // fall through to the host's native prompt, never to a synthesized deny.
    if (result.answers[PLAN_QUESTION] !== PLAN_OPTIONS[0].label) {
      return null;
    }
    const updatedInput = { ...host.toolInput };
    return host.hookEventName === "PreToolUse"
      ? preToolUseOutput("allow", updatedInput, inputField, options.reason)
      : permissionRequestOutput("allow", updatedInput);
  }
  const validated = validateAnswers(result.answers, request.questions, {
    allowText: true,
  });
  if (!validated.valid) {
    return null;
  }
  const updatedInput = { ...host.toolInput, answers: validated.answers };
  if (host.hookEventName === "PreToolUse") {
    // CodeBuddy validates PreToolUse stdout strictly: a decision carries only
    // hookEventName / permissionDecision / reason / modifiedInput. Adding the
    // notification extras would make the host reject the whole answer, so they
    // are dropped exactly for the `modifiedInput` channel (the same shape the
    // auto-approve hook uses). PermissionRequest hosts keep the updatedInput
    // frame and likewise receive no extras.
    const notification =
      inputField === "modifiedInput" ? undefined : options.notification;
    return preToolUseOutput(
      "allow",
      updatedInput,
      inputField,
      options.reason,
      notification,
    );
  }
  // PermissionRequest hosts read the decision from `decision.behavior` and do
  // not take `additionalContext`; keep the frame to the documented keys so
  // ZCode's strict stdout schema keeps accepting it.
  return permissionRequestOutput("allow", updatedInput);
}

function preToolUseOutput(decision, input, inputField, reason, notification) {
  const output = {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: decision,
      permissionDecisionReason:
        reason || "Answered in the ASTRO console",
      [inputField]: input,
    },
  };
  if (notification?.summary) {
    output.hookSpecificOutput.additionalContext = truncate(notification.summary);
    output.systemMessage = truncate(notification.systemMessage || notification.summary);
  }
  return output;
}

function permissionRequestOutput(behavior, input) {
  return {
    hookSpecificOutput: {
      hookEventName: "PermissionRequest",
      decision: { behavior, updatedInput: input },
    },
  };
}

function truncate(value) {
  const text = String(value || "");
  return text.length > INTERACTION_LIMITS.notificationString
    ? text.slice(0, INTERACTION_LIMITS.notificationString)
    : text;
}

/**
 * Both host channels are built from the contract's AgentNotification so the
 * 500-character summary limit and the "counts, never answers" rule apply here
 * too. `additionalContext` reaches the next model request, `systemMessage`
 * reaches the human; neither may carry an answer value.
 */
export function notificationFor(host, request, result) {
  const answered = Object.keys(result.answers || {}).length;
  const skipped = request.questions.filter(
    (question) =>
      question.required === false && !result.answers?.[question.question],
  ).length;
  const detail = {
    answered,
    skipped,
    answeredBy: result.answeredBy || "console",
    elapsedMs: result.elapsedMs || 0,
  };
  const agent = buildAgentNotification({
    requestId: request.requestId,
    kind: "answer_applied",
    target: "agent",
    channel: "additionalContext",
    sessionId: request.sessionId,
    toolUseId: request.toolUseId,
    summary: `User answered ${answered} question${answered === 1 ? "" : "s"} in the ASTRO console; the answers are in tool_input.answers.`,
    detail,
  });
  const user = buildAgentNotification({
    requestId: request.requestId,
    kind: "answer_applied",
    target: "user",
    channel: "systemMessage",
    sessionId: request.sessionId,
    toolUseId: request.toolUseId,
    summary: `ASTRO: ${answered} answer${answered === 1 ? "" : "s"} applied to ${host.toolName}.`,
    detail,
  });
  return { summary: agent.summary, systemMessage: user.summary };
}

/**
 * The whole hook as a pure-ish function: injected `fetchImpl`, clock, sleep
 * and result reader keep the three outcome branches testable without a
 * service or a real 4.5-second wait.
 */
export async function runInteractionHook(input, options = {}) {
  const env = options.env || process.env;
  const settings = { ...optionsFromEnvironment(env), ...(options.settings || {}) };
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const now = options.now || (() => Date.now());
  const sleep = options.sleep || delay;
  const readResult = options.readResult || readResultFile;

  let payload;
  try {
    payload = JSON.parse(String(input || "{}"));
  } catch {
    return { stdout: "", reason: "invalid JSON" };
  }
  const built = buildRequest(payload, settings);
  if (!built) {
    return { stdout: "", reason: "not a question call" };
  }
  const { host, request } = built;

  // One write only: the request the console answers. The recorder already
  // writes the PermissionRequest row for the log; writing it here too put two
  // identical question rows in the LOG (the hook and the recorder run in
  // parallel for the same host event). A missing service must not turn into a
  // broken host hook.
  try {
    await postJson(fetchImpl, `${settings.service}/api/interactions`, request);
  } catch (error) {
    return { stdout: "", reason: `register: ${error.message}`, request };
  }

  const path = resultPath(request.requestId, settings);
  const deadline = now() + request.ttlMs;
  let result = null;
  for (;;) {
    result = readResult(path);
    const status = result?.status;
    if (status === "answered" || status === "cancelled") {
      break;
    }
    if (now() + settings.pollMs > deadline) {
      break;
    }
    await sleep(settings.pollMs);
  }

  const output = buildHookOutput(host, request, result, {
    inputField: settings.inputField,
    notification: result?.status === "answered"
      ? notificationFor(host, request, result)
      : null,
  });
  if (!output) {
    return { stdout: "", reason: "no answer within the hook window", request };
  }
  return { stdout: `${JSON.stringify(output)}\n`, request };
}

async function readStdin() {
  let input = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) {
    input += chunk;
  }
  return input;
}

function isMain() {
  const entry = process.argv[1];
  return Boolean(entry) && import.meta.url === pathToFileURL(entry).href;
}

if (isMain()) {
  try {
    const result = await runInteractionHook(await readStdin(), {
      settings: optionsFromArgv(),
    });
    if (result.stdout) {
      process.stdout.write(result.stdout);
    } else if (result.reason) {
      process.stderr.write(`${DIAGNOSTIC_PREFIX} no decision: ${result.reason}\n`);
    }
  } catch (error) {
    // Fail open: never emit a partial decision and never exit non-zero, or a
    // broken hook would block the agent instead of restoring the prompt.
    process.stderr.write(
      `${DIAGNOSTIC_PREFIX} no decision: ${error instanceof Error ? error.message : String(error)}\n`,
    );
  }
}

export { resolveInteractionTtl };
