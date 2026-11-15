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

function isAlreadyInstalled(groups) {
  return groups.some((group) =>
    (group?.hooks || []).some((handler) =>
      String(handler?.command || "").includes(HOOK_MARKER) ||
      (Array.isArray(handler?.args) &&
        handler.args.some((arg) => String(arg).includes(HOOK_MARKER))),
    ),
  );
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
    event: "PermissionRequest",
    matcher: DEFAULT_MATCHER,
  };
  for (const arg of argv) {
    if (arg === "--apply") {
      options.apply = true;
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
  const { config, added } = mergeHookConfig(current, options.client, options);
  process.stdout.write(
    `${JSON.stringify(config, null, 2)}\n` +
      (added ? `# one decision-hook group added to ${target}\n`
             : `# already installed in ${target}; nothing to add\n`),
  );
  if (!options.apply) {
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
