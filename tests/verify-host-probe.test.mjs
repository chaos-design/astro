import assert from "node:assert/strict";
import { test } from "node:test";

import {
  describeHostAvailability,
  probeHostInstallations,
  runHostIntegrationCheck,
} from "../scripts/verify-host-integration.mjs";

/**
 * The probe is fully injectable: `exists` answers for binaries, `dirExists`
 * for the config-directory markers, `pathEnv` replaces PATH, `home` replaces
 * the user home used for `~` expansion.
 */
function probe(client, options) {
  return probeHostInstallations(client, {
    pathEnv: "/usr/bin:/bin",
    home: "/home/tester",
    exists: () => false,
    dirExists: () => false,
    ...options,
  });
}

test("an executable on PATH wins and is reported as a drivable cli", () => {
  const result = probe("claude", {
    exists: (path) => path === "/usr/bin/claude",
  });
  assert.equal(result.kind, "cli");
  assert.equal(result.path, "/usr/bin/claude");
});

test("a known home-relative install path is found with ~ expansion", () => {
  const result = probe("claude", {
    exists: (path) => path === "/home/tester/.local/bin/claude",
  });
  assert.equal(result.kind, "cli");
  assert.equal(result.path, "/home/tester/.local/bin/claude");
});

test("the ZCode desktop app is reported as app-only, not as a drivable cli", () => {
  const result = probe("zcode", {
    exists: (path) => path === "/Applications/ZCode.app/Contents/MacOS/ZCode",
  });
  assert.equal(result.kind, "app");
  assert.equal(result.path, "/Applications/ZCode.app/Contents/MacOS/ZCode");
});

test("a bare config directory degrades the finding to config-only", () => {
  const result = probe("zcode", {
    dirExists: (path) => path === "/home/tester/.zcode",
  });
  assert.equal(result.kind, "config-only");
  assert.equal(result.path, null);
});

test("no binary and no config directory is absent", () => {
  const result = probe("claude", {});
  assert.deepEqual(result, { kind: "absent", path: null });
});

test("the availability table renders one row per host with escaped pipes", () => {
  const table = describeHostAvailability({
    claude: { kind: "cli", path: "/usr/bin/claude", configDir: true },
    zcode: { kind: "app", path: "/Applications/ZCode.app/Contents/MacOS/ZCode" },
    codebuddy: { kind: "absent", path: null },
  });
  assert.match(table, /\| claude \| cli \|/);
  assert.match(table, /standalone Claude Code CLI/);
  assert.match(table, /\| zcode \| app \|/);
  assert.match(table, /no standalone CLI is shipped/);
  assert.match(table, /\| codebuddy \| absent \|/);
});

/**
 * `runHostInjectionCheck` is a pure function: with an injected `spawn` that
 * returns canned results and an injected `real` that returns null, it builds
 * the full report and the raw checks without touching the real home directory
 * or spawning any process. This is what makes the import side-effect free.
 */
test("runHostIntegrationCheck is injectable and produces a full report", () => {
  const fixture = {
    hook_event_name: "PermissionRequest",
    tool_name: "AskUserQuestion",
    tool_use_id: "call_fixture",
    tool_input: {
      questions: [
        { question: "Which framework?", options: [{ label: "React" }, { label: "Vue" }] },
      ],
    },
  };
  const fakeProbes = {
    claude: { kind: "absent", path: null },
    zcode: { kind: "absent", path: null },
    codebuddy: { kind: "absent", path: null },
  };
  let spawnCalls = 0;
  const { report, checks, failed } = runHostIntegrationCheck({
    payload: fixture,
    probes: fakeProbes,
    real: () => null,
    spawn: (script, input) => {
      spawnCalls += 1;
      if (script === "auto-approve-question-hook.mjs") {
        return {
          status: 0,
          stdout: JSON.stringify({
            hookSpecificOutput: {
              decision: {
                behavior: "allow",
                updatedInput: {
                  answers: { "Which framework?": "React" },
                },
              },
            },
          }),
          stderr: "",
        };
      }
      // interaction-hook: empty stdout, exit 0
      return { status: 0, stdout: "", stderr: "" };
    },
  });
  assert.equal(spawnCalls, 2);
  assert.equal(checks.length, 6);
  assert.equal(failed.length, 0);
  assert.match(report, /# Host integration equivalence acceptance/);
  assert.match(report, /Summary: 6\/6 passed/);
  assert.match(report, /## Host availability probe/);
  assert.match(report, /## Runbook for the host-equipped machine/);
  assert.match(report, /\| claude \| absent \|/);
});

