import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { TraceRepository } from "../server/trace-repository.mjs";

const cliFile = fileURLToPath(new URL("../bin/astro.mjs", import.meta.url));

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "astro-cli-boundary-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const environment = {
    ...process.env, ASTRO_HOME: join(root, "home"), ASTRO_AUTO_OPEN: "0",
  };
  delete environment.ASTRO_TRACE_DIR;
  delete environment.AGENT_TRACE_DIR;
  delete environment.TRAE_TRACE_DIR;
  return { root, environment };
}

test("imports explicit Codex files and remains idempotent on reimport", async (t) => {
  const { root, environment } = fixture(t);
  const file = join(root, "rollout.jsonl");
  writeFileSync(file, `${JSON.stringify({
    type: "session_meta", timestamp: "2026-09-10T00:00:00Z",
    payload: { id: "session", cwd: root },
  })}\n`);
  const run = () => spawnSync(process.execPath, [
    "bin/astro.mjs", "import-codex", file,
  ], { encoding: "utf8", env: environment, timeout: 10_000 });
  const first = run();
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /Imported 1 new events/);
  assert.match(run().stdout, /Imported 0 new events/);
});

test("ingest preserves each canonical source unless an override is explicit", async (t) => {
  const { environment } = fixture(t);
  const input = ["codex", "claude"].map((source) => JSON.stringify({
    id: source, source, sessionId: "session", eventName: "SessionStart",
    capturedAt: "2026-09-10T00:00:00Z", payload: {},
  })).join("\n");
  const result = spawnSync(process.execPath, ["bin/astro.mjs", "ingest"], {
    encoding: "utf8", env: environment, input, timeout: 10_000,
  });
  assert.equal(result.status, 0, result.stderr);
  const repository = new TraceRepository(environment);
  await repository.initialize();
  t.after(() => repository.stop());
  assert.deepEqual(repository.getEvents().map((event) => event.source).sort(), ["claude", "codex"]);
});

test("migrate normalizes legacy session directory names", (t) => {
  const { root, environment } = fixture(t);
  const legacyDirectory = join(
    environment.ASTRO_HOME,
    "trae",
    "2026",
    "09-10",
    "07:08:09-session",
  );
  const targetDirectory = join(
    environment.ASTRO_HOME,
    "trae",
    "2026",
    "09-10",
    "07_08_09-session",
  );
  mkdirSync(legacyDirectory, { recursive: true });
  writeFileSync(
    join(legacyDirectory, "events.jsonl"),
    '{"id":"event","source":"trae","sessionId":"session"}\n',
  );

  const result = spawnSync(process.execPath, [cliFile, "migrate"], {
    cwd: root,
    encoding: "utf8",
    env: environment,
    timeout: 10_000,
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Migrated 1 session directories/);
  assert.equal(existsSync(legacyDirectory), false);
  assert.equal(existsSync(join(targetDirectory, "events.jsonl")), true);
});

test("doctor reports shared plugin configuration without exposing values", (t) => {
  const { root, environment } = fixture(t);
  const pluginDir = join(environment.ASTRO_HOME, "plugins", "astro");
  mkdirSync(pluginDir, { recursive: true });
  writeFileSync(
    join(pluginDir, "config.yaml"),
    [
      "version: 1",
      "integrations:",
      "  example:",
      "    apiKey: ${EXAMPLE_API_KEY}",
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(pluginDir, ".env"),
    "EXAMPLE_API_KEY=never-print-this-value\n",
  );

  const result = spawnSync(
    process.execPath,
    [cliFile, "doctor", "--target", root, "--scope", "project"],
    {
      cwd: root,
      encoding: "utf8",
      env: environment,
      timeout: 10_000,
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /OK  config\.yaml:/);
  assert.match(result.stdout, /OK  \.env:/);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /never-print/);
});
