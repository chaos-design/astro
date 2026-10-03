import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  getTraceStats,
  hasDeepseekPlugin,
  hasInstalledHook,
  inspectNativePlugin,
} from "../plugin/client-status.mjs";

test("detects direct hooks without depending on unrelated hook groups", (t) => {
  const root = mkdtempSync(join(tmpdir(), "astro-status-hooks-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const configFile = join(root, "hooks.json");
  writeFileSync(
    configFile,
    JSON.stringify({
      hooks: {
        SessionStart: [
          { hooks: [{ command: "node unrelated.cjs" }] },
          {
            hooks: [
              {
                command:
                  "node ~/.astrox/plugins/astro/plugin/trace-recorder.cjs --source=codex",
              },
            ],
          },
        ],
      },
    }),
  );

  assert.equal(hasInstalledHook(configFile, "codex"), true);
  assert.equal(hasInstalledHook(configFile, "claude"), false);
});

test("detects enabled native ASTRO plugins from client JSON output", () => {
  const status = inspectNativePlugin("codex", {
    run: () => ({
      status: 0,
      stdout: JSON.stringify({
        installed: [
          {
            pluginId: "astro@astro-local",
            name: "astro",
            installed: true,
            enabled: true,
          },
        ],
      }),
      stderr: "",
    }),
  });

  assert.deepEqual(status, {
    installed: true,
    detail: "native plugin",
  });
});

test("detects DeepSeek bundles and session-partitioned trace data", (t) => {
  const root = mkdtempSync(join(tmpdir(), "astro-status-deepseek-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const profileFile = join(root, ".dsh", "profiles", "web", "package.json");
  mkdirSync(join(root, ".dsh", "profiles", "web"), { recursive: true });
  writeFileSync(
    profileFile,
    JSON.stringify({
      dependencies: {
        "dsh-astro-plugin": "file:/tmp/dsh-astro-plugin",
      },
      dsh: {
        profile: {
          bundles: ["@deepseek-ai/dsh-base", "dsh-astro-plugin"],
        },
      },
    }),
  );
  const traceFile = join(
    root,
    ".astrox",
    "deepseek",
    "2026",
    "09-09",
    "08:00:00-session",
    "events.jsonl",
  );
  mkdirSync(join(traceFile, ".."), { recursive: true });
  writeFileSync(traceFile, '{"id":"event"}\n');

  assert.deepEqual(hasDeepseekPlugin(join(root, ".dsh"), "web"), {
    installed: true,
    profileFile,
  });
  const stats = getTraceStats(join(root, ".astrox"), "deepseek");
  assert.deepEqual(stats.files, [traceFile]);
  assert.equal(stats.bytes, 15);
});
