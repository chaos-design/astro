#!/usr/bin/env node
/**
 * Optional, opt-in decision hook: answer an agent's user question without a
 * round trip to the app. It is NOT part of the ASTRO capture chain — the
 * recorders stay read-only and fail-open. Install it explicitly with
 * `scripts/install-auto-approve-hook.mjs` (dry-run by default).
 *
 * Hosts read one line of JSON from stdin and parse a JSON object from stdout.
 * An empty stdout with exit code 0 means "no decision", so the host shows its
 * normal prompt. Anything unexpected also falls back to that prompt.
 */

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_EVENTS = ["PreToolUse", "PermissionRequest"];
const DEFAULT_TOOLS = ["AskUserQuestion", "ExitPlanMode"];

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

export function optionsFromEnvironment(env = process.env) {
  return {
    events: splitList(env.ASTRO_AUTO_APPROVE_EVENTS, DEFAULT_EVENTS),
    tools: splitList(env.ASTRO_AUTO_APPROVE_TOOLS, DEFAULT_TOOLS),
    answer: env.ASTRO_AUTO_APPROVE_ANSWER === "last" ? "last" : "first",
    inputField:
      env.ASTRO_AUTO_APPROVE_INPUT_FIELD === "modifiedInput"
        ? "modifiedInput"
        : "updatedInput",
  };
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

function optionLabels(question) {
  const options = Array.isArray(question?.options) ? question.options : [];
  return options
    .map((option) => {
      if (typeof option === "string") {
        return option.trim();
      }
      if (!option || typeof option !== "object" || Array.isArray(option)) {
        return "";
      }
      for (const key of ["label", "name", "value", "title"]) {
        if (typeof option[key] === "string" && option[key].trim()) {
          return option[key].trim();
        }
      }
      return "";
    })
    .filter(Boolean);
}

function buildUpdatedInput(tool, toolInput, answer) {
  if (!toolInput || typeof toolInput !== "object" || Array.isArray(toolInput)) {
    return null;
  }
  if (tool !== "AskUserQuestion") {
    // ExitPlanMode (and any other explicitly allowed tool) still needs its
    // input echoed back: an `allow` without updatedInput is ignored by hosts
    // for tools that require user interaction.
    return { ...toolInput };
  }
  const questions = Array.isArray(toolInput.questions)
    ? toolInput.questions
    : [];
  if (!questions.length) {
    return null;
  }
  const answers = {};
  for (const question of questions) {
    if (!question || typeof question.question !== "string" || !question.question.trim()) {
      return null;
    }
    const labels = optionLabels(question);
    if (!labels.length) {
      return null;
    }
    answers[question.question] = answer === "last" ? labels.at(-1) : labels[0];
  }
  // updatedInput is a full replacement object, so the original questions must
  // be echoed back alongside the answers.
  return { ...toolInput, answers };
}

/**
 * Return the hookSpecificOutput decision, or null when the host should keep
 * its normal permission flow. Exported so tests can verify the protocol
 * without spawning a process.
 */
export function buildDecision(payload, options = {}) {
  const events = options.events ?? DEFAULT_EVENTS;
  const tools = options.tools ?? DEFAULT_TOOLS;
  const answer = options.answer ?? "first";
  const inputField = options.inputField ?? "updatedInput";
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const event = field(payload, [
    "hook_event_name",
    "hookEventName",
    "eventName",
    "hook_event",
  ]);
  const tool = field(payload, ["tool_name", "toolName", "name"]);
  if (!events.includes(event) || !tools.includes(tool)) {
    return null;
  }
  const toolInput = payload.tool_input ?? payload.toolInput;
  const updatedInput = buildUpdatedInput(tool, toolInput, answer);
  if (!updatedInput) {
    return null;
  }
  if (event === "PreToolUse") {
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        permissionDecisionReason: "Auto-approved by the ASTRO optional decision hook",
        [inputField]: updatedInput,
      },
    };
  }
  return {
    hookSpecificOutput: {
      hookEventName: "PermissionRequest",
      decision: {
        behavior: "allow",
        updatedInput,
      },
    },
  };
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
  return (
    Boolean(entry) && import.meta.url === pathToFileURL(resolve(entry)).href
  );
}

if (isMain()) {
  try {
    const payload = JSON.parse((await readStdin()) || "{}");
    const decision = buildDecision(payload, optionsFromEnvironment());
    if (decision) {
      process.stdout.write(`${JSON.stringify(decision)}\n`);
    }
  } catch (error) {
    // Fail open: never emit a partial decision and never exit non-zero, or a
    // broken hook would block the agent instead of restoring the prompt.
    process.stderr.write(
      `[astro:auto-approve] no decision: ${error instanceof Error ? error.message : String(error)}\n`,
    );
  }
}
