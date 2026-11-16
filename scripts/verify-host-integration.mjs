#!/usr/bin/env node
/**
 * Repeatable equivalence check for the real-host acceptance item (plan F3).
 *
 * This script feeds real captured hook payloads to the real hook processes and
 * checks the generated host configuration against Claude Code / ZCode /
 * CodeBuddy Code schemas. It does NOT replace launching a host: `/hooks`
 * visibility, transcript wording and the ZCode session log still need a host
 * session. The host availability probe records what the current machine can
 * and cannot verify, and the runbook lists the exact remaining F3 steps for a
 * host-equipped machine.
 *
 * The check is a pure function (`runHostIntegrationCheck`) so it can be
 * imported and asserted without spawning anything; the `isMain` guard is the
 * only place that spawns, prints, or writes the report file.
 */

import { spawnSync } from "node:child_process";
import { existsSync, globSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseHostPayload, buildRequest, buildHookOutput } from "./interaction-hook.mjs";
import { buildInteractionResult } from "../plugin/interaction-contract.mjs";

const root = resolve(import.meta.dirname, "..");

function realPayload() {
  const traces = globSync(join(homedir(), ".astrox", "zcode", "**", "events.jsonl"));
  for (const file of traces) {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (!line.trim()) continue;
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      const payload = event?.payload;
      if (
        event?.eventName === "PermissionRequest" &&
        (payload?.toolName === "AskUserQuestion" || payload?.tool_name === "AskUserQuestion") &&
        Array.isArray(payload?.tool_input?.questions)
      ) {
        return { payload, path: file };
      }
    }
  }
  return null;
}

function spawnHook(script, input) {
  return spawnSync(process.execPath, [join(root, "scripts", script)], {
    input: JSON.stringify(input),
    encoding: "utf8",
    cwd: root,
    env: { ...process.env, ASTRO_AUTO_APPROVE_REQUEST_TIMEOUT_MS: "600" },
  });
}

/**
 * Build the six equivalence checks. Each is a named assertion that either
 * returns a human detail string or throws; the caller turns throws into
 * `fail` rows. `real` returns a captured ZCode payload or null, `spawn`
 * drives the hook processes, and both are injectable so tests stay
 * deterministic without touching the real home directory.
 */
function buildChecks(payload, spawn, real) {
  const checks = [];
  const captured = real();
  const activePayload = captured?.payload ?? payload;
  const check = (name, fn) => {
    try {
      const detail = fn();
      checks.push({ name, status: "pass", detail: detail || "" });
    } catch (error) {
      checks.push({ name, status: "fail", detail: error.message });
    }
  };

  check("captured payload source", () => {
    if (!captured) {
      return "no local ZCode trace; inline fixture used";
    }
    return `${captured.path} (${activePayload.tool_input.questions.length} questions)`;
  });

  check("auto-approve hook emits a real-host PermissionRequest decision", () => {
    const result = spawn("auto-approve-question-hook.mjs", activePayload);
    if (result.status !== 0) {
      throw new Error(`exit ${result.status}: ${result.stderr.trim()}`);
    }
    const output = JSON.parse(result.stdout);
    const decision = output.hookSpecificOutput?.decision;
    if (decision?.behavior !== "allow" || !decision.updatedInput?.answers) {
      throw new Error("missing decision.behavior allow or updatedInput.answers");
    }
    const answers = decision.updatedInput.answers;
    for (const question of activePayload.tool_input.questions) {
      if (!(question.question in answers)) {
        throw new Error(`answer key does not match question text: ${question.question}`);
      }
    }
    return `${Object.keys(answers).length} answers, keys match question text`;
  });

  check("interaction hook fails open with no host service", () => {
    const result = spawn("interaction-hook.mjs", activePayload);
    if (result.status !== 0) {
      throw new Error(`exit ${result.status}: ${result.stderr.trim()}`);
    }
    if (result.stdout !== "") {
      throw new Error(`expected empty stdout, got: ${result.stdout.slice(0, 120)}`);
    }
    return "empty stdout, exit 0 (host prompt remains)";
  });

  check("interaction decision matches Claude PreToolUse schema", () => {
    const host = parseHostPayload({ ...activePayload, hook_event_name: "PreToolUse" });
    const { request } = buildRequest({ ...activePayload, hook_event_name: "PreToolUse" });
    const answers = Object.fromEntries(
      activePayload.tool_input.questions.map((q) => [q.question, q.options[0].label ?? q.options[0]]),
    );
    const result = buildInteractionResult(request, "answered", answers, { answeredBy: "console" });
    const output = buildHookOutput(host, request, result);
    if (output?.hookSpecificOutput?.permissionDecision !== "allow") {
      throw new Error("missing permissionDecision allow");
    }
    if (!output.hookSpecificOutput.updatedInput?.answers) {
      throw new Error("missing updatedInput.answers");
    }
    return "permissionDecision + updatedInput.answers";
  });

  check("interaction decision matches ZCode strict PermissionRequest schema", () => {
    const host = parseHostPayload(activePayload);
    const { request } = buildRequest(activePayload);
    const answers = Object.fromEntries(
      activePayload.tool_input.questions.map((q) => [q.question, q.options[0].label ?? q.options[0]]),
    );
    const result = buildInteractionResult(request, "answered", answers, { answeredBy: "console" });
    const output = buildHookOutput(host, request, result);
    const decision = output?.hookSpecificOutput?.decision;
    if (decision?.behavior !== "allow" || !decision.updatedInput?.answers) {
      throw new Error("missing decision.behavior allow or updatedInput.answers");
    }
    const keys = Object.keys(output);
    const nested = Object.keys(output.hookSpecificOutput);
    if (keys.join() !== "hookSpecificOutput" || nested.join() !== "hookEventName,decision") {
      throw new Error(`unexpected ZCode stdout keys: ${keys}/${nested}`);
    }
    return "hookSpecificOutput.decision.behavior, strict key set";
  });

  check("installer generates valid Claude / ZCode / CodeBuddy configurations", () => {
    const home = mkdtempSync(join(tmpdir(), "astro-host-acceptance-"));
    try {
      const generated = {};
      for (const client of ["claude", "zcode", "codebuddy"]) {
        const result = spawnSync(
          process.execPath,
          [
            join(root, "scripts", "install-interaction-hook.mjs"),
            `--client=${client}`,
            `--home=${home}`,
          ],
          { encoding: "utf8", cwd: root },
        );
        if (result.status !== 0) {
          throw new Error(`${client} installer exit ${result.status}: ${result.stderr.trim()}`);
        }
        if (!result.stdout.includes("dry run: no file written")) {
          throw new Error(`${client} installer is not dry-run by default`);
        }
        generated[client] = JSON.parse(result.stdout.split("\n#")[0]);
      }
      const claudeGroup = generated.claude.hooks.PermissionRequest?.[0];
      if (!claudeGroup?.hooks?.[0]?.command?.includes("interaction-hook.mjs")) {
        throw new Error("Claude config lacks a command handler");
      }
      const zcode = generated.zcode.hooks;
      if (zcode.enabled !== true || zcode.events?.PermissionRequest?.[0]?.hooks?.[0]?.type !== "process") {
        throw new Error("ZCode config lacks enabled/events process handler");
      }
      const codebuddy = generated.codebuddy.hooks.PreToolUse?.[0]?.hooks?.[0];
      if (
        codebuddy?.type !== "command" ||
        !codebuddy.command?.includes("--input-field=modifiedInput") ||
        generated.codebuddy.hooks.PermissionRequest
      ) {
        throw new Error(
          "CodeBuddy must register PreToolUse with a modifiedInput command",
        );
      }
      return "claude command / zcode events+enabled / codebuddy PreToolUse modifiedInput";
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  return checks;
}

/**
 * Where a host binary can live outside PATH. The ZCode and CodeBuddy entries
 * are desktop apps: their agents run only inside the GUI process, so finding
 * the app is not the same as being able to drive a session headlessly.
 */
export const KNOWN_HOST_PATHS = {
  claude: ["~/.local/bin/claude", "~/.claude/local/claude", "/usr/local/bin/claude", "/opt/homebrew/bin/claude"],
  zcode: ["/Applications/ZCode.app/Contents/MacOS/ZCode"],
  codebuddy: [
    "/Applications/WorkBuddy.app/Contents/MacOS/WorkBuddy",
    "/Applications/AgnesCode.app/Contents/MacOS/AgnesCode",
  ],
};

const HOST_CONFIG_DIRS = {
  claude: "~/.claude",
  zcode: "~/.zcode",
  codebuddy: "~/.codebuddy",
};

/**
 * Probe one host: an executable on PATH wins, then a known install path, then
 * a bare config directory. `kind` is "cli" (drivable), "app" (present but its
 * agent runs only inside the GUI process), "config-only" or "absent". A PATH
 * entry named after the client is always a CLI; the known paths are CLI
 * install locations for Claude and GUI app binaries for ZCode / CodeBuddy.
 * Filesystem and environment are injectable so the probe is testable.
 */
export function probeHostInstallations(client, options = {}) {
  const isFile = options.exists ?? ((path) => {
    try {
      return statSync(path).isFile();
    } catch {
      return false;
    }
  });
  // The config markers are directories (~/.claude, ~/.zcode, ~/.codebuddy),
  // so they need an any-type existence check, not isFile.
  const exists = options.dirExists ?? existsSync;
  const homeDir = options.home || homedir();
  const expand = (path) => path.replace(/^~(?=\/|$)/, homeDir);
  const dirs = (options.pathEnv ?? process.env.PATH ?? "")
    .split(":")
    .filter(Boolean)
    .map(expand);
  const knownKind = client === "claude" ? "cli" : "app";
  const configDir = exists(expand(HOST_CONFIG_DIRS[client])) || undefined;
  const onPath = dirs
    .map((dir) => join(dir, client))
    .find((path) => isFile(path));
  if (onPath) {
    return { kind: "cli", path: onPath, configDir };
  }
  const known = KNOWN_HOST_PATHS[client]
    .map(expand)
    .find((path) => isFile(path));
  if (known) {
    return { kind: knownKind, path: known, configDir };
  }
  if (configDir) {
    return { kind: "config-only", path: null };
  }
  return { kind: "absent", path: null };
}

const HOST_PROBE_NOTES = {
  claude: {
    cli: "standalone Claude Code CLI",
    app: "no Claude CLI on a known path; the app entry is present but not drivable headlessly",
  },
  zcode: {
    cli: "standalone ZCode CLI",
    app: "the agent runs only inside the GUI app process; no standalone CLI is shipped, so a real session must be driven by hand",
  },
  codebuddy: {
    cli: "standalone CodeBuddy CLI",
    app: "the agent runs only inside the GUI app process; a real session must be driven by hand",
  },
};

export function describeHostAvailability(probes) {
  const rows = Object.entries(probes).map(([client, probe]) => {
    const note = probe.kind === "cli"
      ? HOST_PROBE_NOTES[client].cli
      : probe.kind === "app"
        ? HOST_PROBE_NOTES[client].app
        : probe.kind === "config-only"
          ? "only the config directory exists (recorder hooks or settings); no binary"
          : "no binary and no config directory";
    const where = probe.path ? ` (${probe.path})` : "";
    return `| ${client} | ${probe.kind} | ${note}${where} |`;
  });
  return [
    "## Host availability probe",
    "",
    "Machine-generated on every run; this is the evidence behind the F3 blocker.",
    "",
    "| Host | Finding | Detail |",
    "| --- | --- | --- |",
    ...rows,
    "",
  ].join("\n");
}

const HOST_RUNBOOK = [
  "## Runbook for the host-equipped machine (F3)",
  "",
  "The equivalence checks above pass on any machine. The three remaining F3",
  "items need a real host session; execute them in order and record the",
  "outcome here, then tick F3 in `plans/pending/03-ask-user-question-",
  "implementation-breakdown.md` and archive the plan.",
  "",
  "1. Claude `/hooks` visibility and transcript wording",
  "   - `pnpm install:interaction -- --client=claude --apply` (backs up",
  "     `~/.claude/settings.json` first).",
  "   - Start Claude Code in any directory, run `/hooks`, and confirm the",
  "     `interaction-hook.mjs` handler is listed under PermissionRequest.",
  "   - Trigger an AskUserQuestion, answer from the ASTRO console, then check",
  "     the session transcript for `Allowed by PermissionRequest hook`.",
  "2. ZCode fresh-session log",
  "   - `pnpm install:interaction -- --client=zcode --apply` (sets",
  "     `hooks.enabled=true` in `~/.zcode/cli/config.json`).",
  "   - Open a **new** ZCode session (hooks are snapshotted at session start),",
  "     trigger an AskUserQuestion, answer or let the 4.5 s window expire.",
  "   - `grep hook.run.failed ~/.zcode/cli/log/zcode-$(date +%F).jsonl` must",
  "     report no match, and the session log must show the hook ran.",
  "3. Record: paste both evidences into this file under a dated section, tick",
  "   F3, `plan_flow.py --root plans move 03 planing`, complete the remaining",
  "   DoD boxes (`code`, `func_test_result`) and archive.",
  "",
].join("\n");

/**
 * Run the whole check and return the report as a string plus the raw check
 * rows. Pure with respect to the outside world apart from the injected
 * `spawn` (default `spawnHook`), `real` (default `realPayload`) and probes;
 * no stdout, no file writes.
 */
export function runHostIntegrationCheck(options = {}) {
  const spawn = options.spawn ?? ((script, input) => spawnHook(script, input));
  const real = options.real ?? realPayload;
  const probes = options.probes ?? {
    claude: probeHostInstallations("claude"),
    zcode: probeHostInstallations("zcode"),
    codebuddy: probeHostInstallations("codebuddy"),
  };
  const checks = buildChecks(options.payload ?? defaultFixture(), spawn, real);
  const failed = checks.filter((c) => c.status === "fail");
  const lines = [
    "# Host integration equivalence acceptance (plan F3)",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "This record covers protocol-level acceptance using captured payloads and real",
    "hook processes. It does **not** replace launching Claude Code or ZCode:",
    "`/hooks` visibility, transcript wording and `hook.run.failed` in a fresh session",
    "still need a host session. The probe below records what this machine can and",
    "cannot verify; the runbook lists the remaining steps.",
    "",
    "| Check | Result | Detail |",
    "| --- | --- | --- |",
    ...checks.map((c) => `| ${c.name} | ${c.status} | ${c.detail.replace(/\|/g, "\\|")} |`),
    "",
    `Summary: ${checks.length - failed.length}/${checks.length} passed.`,
    "",
    describeHostAvailability(probes),
    HOST_RUNBOOK,
  ];
  return { report: lines.join("\n") + "\n", checks, failed };
}

function defaultFixture() {
  return {
    hook_event_name: "PermissionRequest",
    tool_name: "AskUserQuestion",
    tool_use_id: "call_fixture",
    tool_input: {
      questions: [
        {
          question: "Which framework?",
          header: "Framework",
          options: [{ label: "React" }, { label: "Vue" }],
          multiSelect: false,
        },
      ],
    },
  };
}

function isMain() {
  const entry = process.argv[1];
  return Boolean(entry) && import.meta.url === pathToFileURL(entry).href;
}

if (isMain()) {
  const { report, failed } = runHostIntegrationCheck();
  const outIndex = process.argv.indexOf("--out");
  if (outIndex >= 0 && process.argv[outIndex + 1]) {
    writeFileSync(process.argv[outIndex + 1], report);
  }
  process.stdout.write(report);
  process.exitCode = failed.length ? 1 : 0;
}
