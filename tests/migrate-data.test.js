import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  migrateLegacyAotHome,
  migrateSessionPathLayout,
  migrateTraceData,
} from "../scripts/migrate-data.mjs";

test("renames legacy session directories to underscore-separated times", () => {
  const root = mkdtempSync(join(tmpdir(), "astro-layout-migrate-"));
  const legacyDirectory = join(
    root,
    "trae",
    "2026",
    "09-10",
    "07:08:09-session",
  );
  const targetDirectory = join(
    root,
    "trae",
    "2026",
    "09-10",
    "07_08_09-session",
  );
  mkdirSync(legacyDirectory, { recursive: true });
  writeFileSync(join(legacyDirectory, "events.jsonl"), '{"id":"event-1"}\n');

  const first = migrateSessionPathLayout(root);
  const second = migrateSessionPathLayout(root);

  assert.equal(first.migratedDirectories, 1);
  assert.equal(first.renamedDirectories, 1);
  assert.equal(first.mergedDirectories, 0);
  assert.deepEqual(first.outputs, [targetDirectory]);
  assert.equal(existsSync(legacyDirectory), false);
  assert.equal(existsSync(join(targetDirectory, "events.jsonl")), true);
  assert.equal(second.migratedDirectories, 0);
  rmSync(root, { recursive: true, force: true });
});

test("merges conflicting session directories without losing JSONL rows", () => {
  const root = mkdtempSync(join(tmpdir(), "astro-layout-conflict-"));
  const dateDirectory = join(root, "trae", "2026", "09-10");
  const legacyDirectory = join(dateDirectory, "07:08:09-session");
  const targetDirectory = join(dateDirectory, "07_08_09-session");
  mkdirSync(legacyDirectory, { recursive: true });
  mkdirSync(targetDirectory, { recursive: true });
  writeFileSync(
    join(targetDirectory, "events.jsonl"),
    '{"id":"shared","value":"target"}\ninvalid-shared\n',
  );
  writeFileSync(
    join(legacyDirectory, "events.jsonl"),
    [
      '{"id":"shared","value":"legacy"}',
      '{"id":"legacy-only"}',
      "invalid-shared",
      "invalid-legacy",
    ].join("\n"),
  );

  const result = migrateSessionPathLayout(root);
  const rows = readFileSync(join(targetDirectory, "events.jsonl"), "utf8")
    .trim()
    .split("\n");

  assert.equal(result.migratedDirectories, 1);
  assert.equal(result.mergedDirectories, 1);
  assert.equal(result.appendedRows, 2);
  assert.equal(result.skippedRows, 2);
  assert.equal(existsSync(legacyDirectory), false);
  assert.deepEqual(rows, [
    '{"id":"shared","value":"target"}',
    "invalid-shared",
    '{"id":"legacy-only"}',
    "invalid-legacy",
  ]);
  rmSync(root, { recursive: true, force: true });
});

test("treats a missing session layout root as a successful no-op", () => {
  const root = join(tmpdir(), `astro-layout-missing-${process.pid}-${Date.now()}`);
  const result = migrateSessionPathLayout(root);

  assert.equal(result.migratedDirectories, 0);
  assert.deepEqual(result.outputs, []);
});

test("migrates legacy trace data into source-specific ASTRO directories", () => {
  const root = mkdtempSync(join(tmpdir(), "astro-migrate-"));
  const legacyDir = join(root, ".agent-trace");
  const astroHome = join(root, "astrox");
  mkdirSync(legacyDir, { recursive: true });
  writeFileSync(
    join(legacyDir, "events.jsonl"),
    [
      {
        id: "trae-event",
        source: "trae",
        sessionId: "session-1",
        eventName: "SessionStart",
        capturedAt: "2026-09-08T08:00:00.000Z",
        payload: {},
      },
      {
        id: "codex-event",
        source: "codex",
        sessionId: "session-2",
        eventName: "AgentMessage",
        capturedAt: "2026-09-08T08:01:00.000Z",
        payload: { message: "Done" },
      },
    ]
      .map((event) => JSON.stringify(event))
      .join("\n"),
    "utf8",
  );

  const first = migrateTraceData(legacyDir, { ASTRO_HOME: astroHome });
  const second = migrateTraceData(legacyDir, { ASTRO_HOME: astroHome });

  assert.equal(first.migrated, 2);
  assert.equal(second.migrated, 0);
  assert.equal(second.skipped, 2);
  const traeOutput = first.outputs.find((file) =>
    file.startsWith(join(astroHome, "trae")),
  );
  const codexOutput = first.outputs.find((file) =>
    file.startsWith(join(astroHome, "codex")),
  );
  assert.equal(
    JSON.parse(readFileSync(traeOutput, "utf8")).id,
    "trae-event",
  );
  assert.equal(
    JSON.parse(readFileSync(codexOutput, "utf8")).id,
    "codex-event",
  );

  rmSync(root, { recursive: true, force: true });
});

test("migrates every source from a legacy .aot root", () => {
  const root = mkdtempSync(join(tmpdir(), "astro-aot-migrate-"));
  const legacyAotHome = join(root, ".aot");
  const astroHome = join(root, ".astrox");
  for (const source of ["claude", "codex"]) {
    const sourceDir = join(legacyAotHome, source);
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(
      join(sourceDir, "events.jsonl"),
      `${JSON.stringify({
        id: `${source}-legacy`,
        source,
        sessionId: `${source}-session`,
        eventName: "SessionStart",
        capturedAt: "2026-09-08T08:00:00.000Z",
        payload: {},
      })}\n`,
      "utf8",
    );
  }

  const first = migrateLegacyAotHome(legacyAotHome, {
    ASTRO_HOME: astroHome,
  });
  const second = migrateLegacyAotHome(legacyAotHome, {
    ASTRO_HOME: astroHome,
  });

  assert.equal(first.migrated, 2);
  assert.equal(second.migrated, 0);
  assert.equal(second.skipped, 2);
  assert.equal(first.sources.length, 2);
  const claudeOutput = first.outputs.find((file) =>
    file.startsWith(join(astroHome, "claude")),
  );
  assert.equal(
    JSON.parse(readFileSync(claudeOutput, "utf8")).id,
    "claude-legacy",
  );

  rmSync(root, { recursive: true, force: true });
});

test("migrates session-partitioned events from a project-local ASTRO root", () => {
  const root = mkdtempSync(join(tmpdir(), "astro-project-migrate-"));
  const projectAstroHome = join(root, "workspace", ".astrox");
  const sessionDir = join(
    projectAstroHome,
    "trae",
    "2026",
    "09-09",
    "12:00:00-project-session",
  );
  const astroHome = join(root, "user", ".astrox");
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(
    join(sessionDir, "events.jsonl"),
    `${JSON.stringify({
      id: "project-session-event",
      source: "trae",
      sessionId: "project-session",
      eventName: "SessionStart",
      capturedAt: "2026-09-09T12:00:00.000Z",
      payload: {},
    })}\n`,
    "utf8",
  );

  const first = migrateLegacyAotHome(projectAstroHome, {
    ASTRO_HOME: astroHome,
  });
  const second = migrateLegacyAotHome(projectAstroHome, {
    ASTRO_HOME: astroHome,
  });

  assert.equal(first.migrated, 1);
  assert.equal(second.migrated, 0);
  assert.equal(second.skipped, 1);
  assert.equal(first.sources.length, 1);
  assert.equal(
    JSON.parse(readFileSync(first.outputs[0], "utf8")).id,
    "project-session-event",
  );

  rmSync(root, { recursive: true, force: true });
});
