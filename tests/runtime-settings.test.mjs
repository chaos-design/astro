import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { writeTraceDirectory } from "../server/runtime-settings.mjs";

function createFixture(t) {
  const root = mkdtempSync(join(tmpdir(), "astro-runtime-settings-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const envFile = join(root, "plugins", "astro", ".env");
  const dataRoot = join(root, "default-traces");
  const traces = join(root, "traces");
  mkdirSync(dataRoot, { recursive: true });
  mkdirSync(traces, { recursive: true });
  return { root, envFile, dataRoot, traces };
}

test("replaces the trace directory and keeps every other line", (t) => {
  const { envFile, dataRoot, traces } = createFixture(t);
  mkdirSync(join(envFile, ".."), { recursive: true });
  writeFileSync(
    envFile,
    [
      "# keep this comment",
      "ASTRO_PORT=5678",
      "ASTRO_TRACE_DIR=/old/traces",
      "OTHER=value",
      "",
    ].join("\n"),
  );

  const result = writeTraceDirectory({ envFile, defaultRoot: dataRoot, value: traces });

  assert.equal(result.ok, true);
  assert.equal(result.dataRoot, traces);
  const text = readFileSync(envFile, "utf8");
  assert.match(text, /# keep this comment/);
  assert.match(text, /ASTRO_PORT=5678/);
  assert.match(text, /OTHER=value/);
  assert.match(text, new RegExp(`ASTRO_TRACE_DIR=${traces}`));
  assert.doesNotMatch(text, /\/old\/traces/);
});

test("an empty value clears the override", (t) => {
  const { envFile, dataRoot, traces } = createFixture(t);
  mkdirSync(join(envFile, ".."), { recursive: true });
  writeFileSync(envFile, `ASTRO_TRACE_DIR=${traces}\nASTRO_PORT=5678\n`);

  const result = writeTraceDirectory({ envFile, defaultRoot: dataRoot, value: "  " });

  assert.equal(result.ok, true);
  assert.equal(result.dataRoot, dataRoot);
  const text = readFileSync(envFile, "utf8");
  assert.doesNotMatch(text, /ASTRO_TRACE_DIR/);
  assert.match(text, /ASTRO_PORT=5678/);
});

test("expands a home-relative directory", (t) => {
  const { root, envFile, dataRoot } = createFixture(t);
  const home = join(root, "home");
  mkdirSync(join(home, "traces"), { recursive: true });

  const result = writeTraceDirectory({
    envFile,
    defaultRoot: dataRoot,
    value: "~/traces",
    home,
  });

  assert.equal(result.ok, true);
  assert.equal(result.dataRoot, join(home, "traces"));
});

test("rejects a relative or missing directory without touching the file", (t) => {
  const { envFile, dataRoot } = createFixture(t);
  mkdirSync(join(envFile, ".."), { recursive: true });
  writeFileSync(envFile, "ASTRO_TRACE_DIR=/keep\n");

  const relative = writeTraceDirectory({
    envFile,
    defaultRoot: dataRoot,
    value: "traces",
  });
  assert.equal(relative.ok, false);
  assert.match(relative.error, /绝对路径/);

  const missing = writeTraceDirectory({
    envFile,
    defaultRoot: dataRoot,
    value: join(dataRoot, "missing"),
  });
  assert.equal(missing.ok, false);
  assert.match(missing.error, /不存在/);

  assert.equal(readFileSync(envFile, "utf8"), "ASTRO_TRACE_DIR=/keep\n");
});
