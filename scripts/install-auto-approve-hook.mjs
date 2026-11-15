#!/usr/bin/env node
/**
 * Register the optional auto-approve decision hook in a host's user settings.
 *
 * This is deliberately opt-in and dry-run by default: it never runs during
 * `pnpm install-plugins`, never writes to a running session's config without
 * `--apply`, never removes existing hook groups, and never modifies ASTRO's
 * own recorder hooks. Run `--apply` only after reading the printed diff.
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HOOK_SCRIPT = resolve(
  import.meta.dirname,
  "auto-approve-question-hook.mjs",
);
const HOOK_MARKER = "auto-approve-question-hook.mjs";
const DEFAULT_MATCHER = "AskUserQuestion|ExitPlanMode";
const CLIENTS = new Set(["claude", "codebuddy", "zcode"]);

export function getConfigPath(client, home = homedir()) {
  if (client === "zcode") {
    return join(home, ".zcode", "cli", "config.json");
  }
  if (client === "codebuddy") {
    return join(home, ".codebuddy", "settings.json");
  }
  return join(home, ".claude", "settings.json");
}

function referencesHook(handler) {
  return (
    String(handler?.command || "").includes(HOOK_MARKER) ||
    (Array.isArray(handler?.args) &&
      handler.args.some((arg) => String(arg).includes(HOOK_MARKER)))
  );
}

function isAlreadyInstalled(groups) {
  return groups.some((group) => (group?.hooks || []).some(referencesHook));
}

/**
 * Validate the merged configuration before it is written. Only the group this
 * installer owns is checked, so unrelated user hooks with an empty matcher are
 * never rejected. ZCode additionally requires the user-level enable flag and
 * an `events` map rather than Claude's event-keyed `hooks` object.
 */
export function validateHookConfig(config, client, options = {}) {
  if (!CLIENTS.has(client)) {
    return { valid: false, errors: [`unsupported client: ${client}`] };
  }
  const errors = [];
  const event = options.event || "PermissionRequest";
  const hooks = config?.hooks;
  if (!hooks || typeof hooks !== "object" || Array.isArray(hooks)) {
    return { valid: false, errors: ["hooks must be an object"] };
  }
  if (client === "zcode" && hooks.enabled !== true) {
    errors.push("hooks.enabled must be true");
  }
  const container = client === "zcode" ? hooks.events : hooks;
  if (!container || typeof container !== "object" || Array.isArray(container)) {
    errors.push(
      client === "zcode" ? "hooks.events must be an object" : "hooks must be an object",
    );
    return { valid: false, errors };
  }
  const groups = container[event];
  if (!Array.isArray(groups)) {
    errors.push(`${event} hook groups must be an array`);
    return { valid: false, errors };
  }
  const own = groups.filter((group) =>
    (group?.hooks || []).some(referencesHook),
  );
  if (!own.length) {
    errors.push("decision-hook group is missing");
  }
  for (const group of own) {
    const matcher = String(group?.matcher || "");
    if (!matcher || matcher === "*") {
      errors.push("matcher must be a name list, not empty or '*'");
    }
    for (const handler of group.hooks || []) {
      const hasCommand = Boolean(String(handler?.command || "").trim());
      const hasArgs = Array.isArray(handler?.args) && handler.args.length > 0;
      if (!hasCommand && !hasArgs) {
        errors.push("handler needs a command or args");
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

/** Remove only this tool's handlers, keeping every other hook group and key. */
export function removeHookConfig(config, client, options = {}) {
  if (!CLIENTS.has(client)) {
    throw new Error(`unsupported client: ${client}`);
  }
  const source = config && typeof config === "object" && !Array.isArray(config)
    ? config
    : {};
  const next = { ...source };
  const hooks = { ...(next.hooks || {}) };
  const event = options.event || "PermissionRequest";
  let removed = 0;
  const strip = (groups) =>
    (Array.isArray(groups) ? groups : [])
      .map((group) => {
        const before = Array.isArray(group?.hooks) ? group.hooks : [];
        const kept = before.filter((handler) => {
          if (referencesHook(handler)) {
            removed += 1;
            return false;
          }
          return true;
        });
        return { ...group, hooks: kept };
      })
      .filter((group) => group.hooks.length > 0);
  if (client === "zcode") {
    const events = { ...(hooks.events || {}) };
    const kept = strip(events[event]);
    if (kept.length) {
      events[event] = kept;
    } else {
      delete events[event];
    }
    hooks.events = events;
  } else {
    const kept = strip(hooks[event]);
    if (kept.length) {
      hooks[event] = kept;
    } else {
      delete hooks[event];
    }
  }
  next.hooks = hooks;
  return { config: next, removed };
}

/**
 * Merge one decision-hook group into a settings object without touching any
 * other key or hook group. Exported so the installer can be tested against a
 * temporary HOME without writing to the real user configuration.
 */
export function mergeHookConfig(config, client, options = {}) {
  if (!CLIENTS.has(client)) {
    throw new Error(`unsupported client: ${client}`);
  }
  const source = config && typeof config === "object" && !Array.isArray(config)
    ? config
    : {};
  const next = { ...source };
  const event = options.event || "PermissionRequest";
  const matcher = options.matcher || DEFAULT_MATCHER;
  const hookPath = options.hookPath || HOOK_SCRIPT;

  if (client === "zcode") {
    const hooks = { ...(next.hooks || {}) };
    const events = { ...(hooks.events || {}) };
    const groups = Array.isArray(events[event]) ? [...events[event]] : [];
    const added = !isAlreadyInstalled(groups);
    if (added) {
      groups.push({
        matcher,
        hooks: [
          {
            type: "process",
            command: "node",
            args: [hookPath],
            enabled: true,
            timeoutMs: 5000,
          },
        ],
      });
    }
    events[event] = groups;
    hooks.events = events;
    // ZCode ignores all hooks unless this flag is set at the user level.
    hooks.enabled = true;
    next.hooks = hooks;
    return { config: next, added };
  }

  const hooks = { ...(next.hooks || {}) };
  const groups = Array.isArray(hooks[event]) ? [...hooks[event]] : [];
  const added = !isAlreadyInstalled(groups);
  if (added) {
    groups.push({
      matcher,
      hooks: [
        {
          type: "command",
          command: `node "${hookPath}"`,
          timeout: 5,
        },
      ],
    });
  }
  hooks[event] = groups;
  next.hooks = hooks;
  return { config: next, added };
}

function parseArgs(argv) {
  const options = {
    client: "claude",
    apply: false,
    remove: false,
    event: "PermissionRequest",
    matcher: DEFAULT_MATCHER,
  };
  for (const arg of argv) {
    if (arg === "--apply") {
      options.apply = true;
    } else if (arg === "--remove") {
      options.remove = true;
    } else if (arg.startsWith("--")) {
      const [key, ...rest] = arg.slice(2).split("=");
      const value = rest.join("=");
      if (key === "client" || key === "event" || key === "matcher" ||
          key === "home" || key === "settings" || key === "hook-path") {
        options[key === "hook-path" ? "hookPath" : key] = value;
      }
    }
  }
  if (!CLIENTS.has(options.client)) {
    throw new Error(`unsupported client: ${options.client}`);
  }
  return options;
}

function isMain() {
  return (
    Boolean(process.argv[1]) &&
    resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
  );
}

if (isMain()) {
  const options = parseArgs(process.argv.slice(2));
  const target = options.settings || getConfigPath(options.client, options.home);
  let current = {};
  if (existsSync(target)) {
    current = JSON.parse(readFileSync(target, "utf8") || "{}");
  }
  const result = options.remove
    ? removeHookConfig(current, options.client, options)
    : mergeHookConfig(current, options.client, options);
  const { config } = result;
  const summary = options.remove
    ? `# ${result.removed} decision-hook handler(s) removed from ${target}\n`
    : result.added
      ? `# one decision-hook group added to ${target}\n`
      : `# already installed in ${target}; nothing to add\n`;
  process.stdout.write(`${JSON.stringify(config, null, 2)}\n${summary}`);
  const validation = options.remove
    ? null
    : validateHookConfig(config, options.client, options);
  if (validation && !validation.valid) {
    process.stdout.write(`# validation failed: ${validation.errors.join("; ")}\n`);
    process.stderr.write("invalid hook configuration; nothing written\n");
    process.exitCode = 1;
  } else if (!options.apply) {
    process.stdout.write("# dry run: no file written. Re-run with --apply to save.\n");
  } else if (existsSync(target)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backup = `${target}.astro-backup-${stamp}`;
    copyFileSync(target, backup);
    writeFileSync(target, `${JSON.stringify(config, null, 2)}\n`);
    process.stdout.write(`# saved ${target} (backup: ${backup})\n`);
  } else {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, `${JSON.stringify(config, null, 2)}\n`);
    process.stdout.write(`# created ${target}\n`);
  }
}
