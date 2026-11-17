#!/usr/bin/env node
/**
 * Register the opt-in interaction hook in a host's user settings.
 *
 * This is the human fast path, not the decision hook: the host asks its normal
 * question, the console renders the same questions, and an answer travels back
 * inside the host's short decision window. It is installed explicitly, one
 * client at a time, and never runs during `pnpm install-plugins`.
 *
 * Dry-run by default, backups on `--apply`, and `--remove` strips only handlers
 * that name this hook — ASTRO's recorder groups and the auto-approve decision
 * hook keep their place. The shared merge/validate/remove helpers live in
 * `install-auto-approve-hook.mjs`; there is one definition of a hook group.
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  getConfigPath,
  mergeHookConfig,
  removeHookConfig,
  validateHookConfig,
} from "./install-auto-approve-hook.mjs";

const HOOK_SCRIPT = resolve(import.meta.dirname, "interaction-hook.mjs");
const HOOK_MARKER = "interaction-hook.mjs";
const MATCHER = "AskUserQuestion|ExitPlanMode";
// The console's answer window is the hook's synchronous window: the installer
// writes the same number of seconds into the host's hook timeout and the
// hook's `--timeout` argument, so the request's TTL can never outlive the
// host's wait. Ten minutes covers walking to the console and answering; with
// no console attached the service closes the request at once and the host's
// native prompt appears immediately.
const DEFAULT_TIMEOUT_SECONDS = 600;
const MAX_TIMEOUT_SECONDS = 3600;
// CodeBuddy only documents `modifiedInput` on PreToolUse; PermissionRequest
// hosts use `decision.updatedInput`. Register the event each host actually
// understands instead of forcing one event on all three.
const DEFAULT_EVENTS = {
  claude: ["PermissionRequest"],
  zcode: ["PermissionRequest"],
  codebuddy: ["PreToolUse"],
};
const SOURCE_BY_CLIENT = {
  claude: "claude",
  codebuddy: "workbuddy",
  zcode: "zcode",
};
const CLIENTS = new Set(Object.keys(SOURCE_BY_CLIENT));

const clientLabels = {
  claude: "Claude Code",
  codebuddy: "CodeBuddy",
  zcode: "ZCode",
};

/** A source id, the hook window, and for CodeBuddy the PreToolUse input field. */
export function hookArgsFor(client, timeoutSeconds = DEFAULT_TIMEOUT_SECONDS) {
  const args = [
    `--source=${SOURCE_BY_CLIENT[client]}`,
    `--timeout=${timeoutSeconds}`,
  ];
  if (client === "codebuddy") {
    args.push("--input-field=modifiedInput");
  }
  return args;
}

/** Clamp the window to what the contract's validation accepts. */
export function parseTimeoutSeconds(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_TIMEOUT_SECONDS;
  }
  return Math.min(Math.floor(parsed), MAX_TIMEOUT_SECONDS);
}

export function parseArgs(argv) {
  const options = {
    client: "claude",
    apply: false,
    remove: false,
    events: null,
    timeoutSeconds: DEFAULT_TIMEOUT_SECONDS,
  };
  for (const arg of argv) {
    if (arg === "--apply") {
      options.apply = true;
    } else if (arg === "--remove") {
      options.remove = true;
    } else if (arg.startsWith("--")) {
      const [key, ...rest] = arg.slice(2).split("=");
      const value = rest.join("=");
      if (key === "client" || key === "home" || key === "settings" ||
          key === "hook-path" || key === "events") {
        if (key === "events") {
          const events = value
            .split(",")
            .map((event) => event.trim())
            .filter(Boolean);
          if (events.length) {
            options.events = events;
          }
        } else {
          options[key === "hook-path" ? "hookPath" : key] = value;
        }
      } else if (key === "timeout") {
        options.timeoutSeconds = parseTimeoutSeconds(value);
      }
    }
  }
  if (!CLIENTS.has(options.client)) {
    throw new Error(`unsupported client: ${options.client}`);
  }
  if (!options.events) {
    options.events = [...DEFAULT_EVENTS[options.client]];
  }
  return options;
}

/**
 * Compute the next configuration and, with `apply`, write it with a backup.
 * Exported so the dry-run / backup / remove behavior is testable without a
 * second copy of the file logic in the test.
 */
export function runInstaller(options, io = {}) {
  const log = io.log || ((line) => process.stdout.write(`${line}\n`));
  const client = options.client;
  if (!CLIENTS.has(client)) {
    throw new Error(`unsupported client: ${client}`);
  }
  const timeoutSeconds = options.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS;
  const target = options.settings || getConfigPath(client, options.home);
  const current = existsSync(target)
    ? JSON.parse(readFileSync(target, "utf8") || "{}")
    : {};
  const shared = {
    events: options.events?.length ? options.events : DEFAULT_EVENTS[client],
    hookArgs: hookArgsFor(client, timeoutSeconds),
    hookMarker: HOOK_MARKER,
    hookPath: options.hookPath || HOOK_SCRIPT,
    label: "interaction-hook",
    matcher: MATCHER,
    // The merge helpers read `timeoutMs` (ZCode, milliseconds) and `timeout`
    // (Claude/CodeBuddy, seconds) from this same object.
    timeout: timeoutSeconds,
    timeoutMs: timeoutSeconds * 1000,
  };
  const result = options.remove
    ? removeHookConfig(current, client, shared)
    : mergeHookConfig(current, client, shared);
  const { config } = result;
  log(JSON.stringify(config, null, 2));
  const summary = options.remove
    ? `# ${result.removed} interaction-hook handler(s) removed from ${target}`
    : result.added
      ? `# one interaction-hook group added to ${target}`
      : `# already installed in ${target}; nothing to add`;
  log(summary);

  const validation = options.remove
    ? undefined
    : validateHookConfig(config, client, shared);
  if (validation && !validation.valid) {
    log(`# validation failed: ${validation.errors.join("; ")}`);
    return { target, config, written: false, validation };
  }

  if (!options.apply) {
    log("# dry run: no file written. Re-run with --apply to save.");
    return { target, config, written: false, removed: result.removed, validation };
  }
  let backup = "";
  if (existsSync(target)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    backup = `${target}.astro-backup-${stamp}`;
    copyFileSync(target, backup);
    writeFileSync(target, `${JSON.stringify(config, null, 2)}\n`);
    log(`# saved ${target} (backup: ${backup})`);
  } else {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, `${JSON.stringify(config, null, 2)}\n`);
    log(`# created ${target}`);
  }
  // Hook configuration is snapshotted when a session starts. Saying it here is
  // cheaper than explaining a hook that silently did nothing in the session
  // the reader already had open.
  log(`# open a new ${clientLabels[client]} session; hooks are read at session start`);
  log(`# answer window: ${timeoutSeconds}s while a console page is attached; with no console connected the host's native prompt returns at once`);
  if (client === "codebuddy") {
    log("# CodeBuddy PreToolUse answers arrive in modifiedInput.");
  }
  if (client === "zcode") {
    log("# ZCode requires hooks.enabled=true at the user level; this installer sets it.");
  }
  return { target, config, written: true, backup, removed: result.removed, validation };
}

function isMain() {
  return (
    Boolean(process.argv[1]) &&
    resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
  );
}

if (isMain()) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const result = runInstaller(options);
    if (result.validation && !result.validation.valid) {
      process.stderr.write("invalid interaction-hook configuration; nothing written\n");
      process.exitCode = 1;
    }
  } catch (error) {
    process.stderr.write(
      `[astro:interaction-install] ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
