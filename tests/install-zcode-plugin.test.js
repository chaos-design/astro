import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  getAgentsSkillsDir,
  installSkills,
  installZcodePlugin,
  resolveZcodeCommand,
} from "../scripts/install-zcode-plugin.mjs";

const projectDir = resolve(import.meta.dirname, "..");

test("resolves the user-level agents skill directory", () => {
  assert.equal(
    getAgentsSkillsDir("/home/tester"),
    join("/home/tester", ".agents", "skills"),
  );
});

test("installs the shared ASTRO skills by copying them into .agents/skills", () => {
  const targetDir = mkdtempSync(join(tmpdir(), "astro-zcode-skills-"));
  try {
    const result = installSkills({ targetDir });

    assert.deepEqual(result.installed, ["astro-trace"]);
    assert.equal(
      existsSync(join(result.targetDir, "astro-trace", "SKILL.md")),
      true,
    );
  } finally {
    rmSync(targetDir, { recursive: true, force: true });
  }
});

test("reinstalling skills replaces the previous copy", () => {
  const targetDir = mkdtempSync(join(tmpdir(), "astro-zcode-skills-"));
  try {
    const staleSkill = join(targetDir, "astro-trace");
    rmSync(staleSkill, { recursive: true, force: true });
    cpSync(join(projectDir, ".agents", "skills", "astro-trace"), staleSkill, {
      recursive: true,
    });

    const result = installSkills({ targetDir });

    assert.deepEqual(result.installed, ["astro-trace"]);
    // The skill content matches the repository source of truth.
    assert.equal(
      existsSync(join(staleSkill, "SKILL.md")),
      true,
    );
  } finally {
    rmSync(targetDir, { recursive: true, force: true });
  }
});

test("the bundled ZCode CLI is used when zcode is not on PATH", () => {
  const found = resolveZcodeCommand({
    pathEnvironment: "/usr/bin:/bin",
    platform: "darwin",
  });
  // The darwin fallback uses the local ZCode.app bundle through Node.
  assert.ok(found);
  assert.equal(found.command, process.execPath);
  assert.equal(found.prefixArgs.length, 1);
  assert.match(String(found.prefixArgs[0]), /ZCode\.app/);
});

test("a missing CLI on unsupported platforms reports the manual handoff", () => {
  const found = resolveZcodeCommand({
    pathEnvironment: "/usr/bin:/bin",
    platform: "linux",
  });

  assert.equal(found, null);
});

test("plugin installation fails fast without a marketplace catalog", () => {
  const emptyDir = mkdtempSync(join(tmpdir(), "astro-zcode-plugin-"));
  try {
    assert.throws(() => installZcodePlugin({ pluginSourceDir: emptyDir }), /marketplace/);
  } finally {
    rmSync(emptyDir, { recursive: true, force: true });
  }
});
