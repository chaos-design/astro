#!/usr/bin/env node

/**
 * Installs the ASTRO ZCode capture plugin and the shared ASTRO skills.
 *
 * The plugin is installed through the `zcode` CLI from the self-contained
 * `zcode-plugin/` marketplace directory. The skills travel separately: they
 * are copied into `~/.agents/skills`, the cross-agent skill directory that
 * ZCode imports by reference, so they stay usable by every client and are
 * never buried inside the ZCode plugin cache.
 */

import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pluginSourceDir = join(packageDir, "zcode-plugin");
const skillsSourceDir = join(packageDir, ".agents", "skills");
const marketplaceName = "astro-zcode-local";
const pluginName = "astro";

export function getAgentsSkillsDir(home = homedir()) {
  return join(home, ".agents", "skills");
}

export function resolveZcodeCommand({
  zcodeCommand = process.env.ZCODE_COMMAND,
  pathEnvironment = process.env.PATH,
  platform = process.platform,
  zcodeHome = homedir(),
} = {}) {
  if (zcodeCommand) {
    return { command: zcodeCommand, prefixArgs: [] };
  }
  const pathDirs = String(pathEnvironment || "").split(":").filter(Boolean);
  for (const dir of pathDirs) {
    const candidate = join(dir, "zcode");
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return { command: candidate, prefixArgs: [] };
    }
  }
  const bundledCli = join(
    zcodeHome,
    "Applications",
    "ZCode.app",
    "Contents",
    "Resources",
    "glm",
    "zcode.cjs",
  );
  const bundledCandidates =
    platform === "darwin"
      ? [bundledCli, "/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs"]
      : [];
  for (const candidate of bundledCandidates) {
    if (existsSync(candidate)) {
      return { command: process.execPath, prefixArgs: [candidate] };
    }
  }
  return null;
}

export function installSkills({
  sourceDir = skillsSourceDir,
  targetDir = getAgentsSkillsDir(),
} = {}) {
  if (!existsSync(sourceDir)) {
    throw new Error(`ASTRO skills source was not found at ${sourceDir}.`);
  }
  mkdirSync(targetDir, { recursive: true });
  const installed = [];
  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) {
      continue;
    }
    const skillSource = join(sourceDir, entry.name);
    if (!existsSync(join(skillSource, "SKILL.md"))) {
      continue;
    }
    const skillTarget = join(targetDir, entry.name);
    rmSync(skillTarget, { recursive: true, force: true });
    cpSync(skillSource, skillTarget, { recursive: true });
    installed.push(entry.name);
  }
  return { targetDir, installed };
}

export function installZcodePlugin({ pluginSourceDir: sourceDir = pluginSourceDir } = {}) {
  if (!existsSync(join(sourceDir, "marketplace.json"))) {
    throw new Error(
      `ASTRO ZCode plugin marketplace was not found at ${sourceDir}.`,
    );
  }
  const resolved = resolveZcodeCommand();
  if (!resolved) {
    return {
      installed: false,
      reason: "zcode-cli-missing",
      marketplaceDir: sourceDir,
      pluginId: `${pluginName}@${marketplaceName}`,
    };
  }
  const run = (args) =>
    spawnSync(resolved.command, [...resolved.prefixArgs, ...args], {
      encoding: "utf8",
    });
  const marketplaceAdd = run([
    "plugins",
    "marketplace",
    "add",
    resolve(sourceDir),
  ]);
  if (marketplaceAdd.status !== 0) {
    return {
      installed: false,
      reason: "marketplace-add-failed",
      output: `${marketplaceAdd.stdout || ""}${marketplaceAdd.stderr || ""}`,
      marketplaceDir: sourceDir,
      pluginId: `${pluginName}@${marketplaceName}`,
    };
  }
  const install = run(["plugins", "install", `${pluginName}@${marketplaceName}`]);
  if (install.status !== 0) {
    return {
      installed: false,
      reason: "install-failed",
      output: `${install.stdout || ""}${install.stderr || ""}`,
      marketplaceDir: sourceDir,
      pluginId: `${pluginName}@${marketplaceName}`,
    };
  }
  return {
    installed: true,
    marketplaceDir: sourceDir,
    pluginId: `${pluginName}@${marketplaceName}`,
    output: install.stdout || "",
  };
}

function getOption(name) {
  const inline = process.argv.find((argument) =>
    argument.startsWith(`--${name}=`),
  );
  if (inline) {
    return inline.slice(name.length + 3);
  }
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : null;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const skills = installSkills({
    targetDir: getOption("agents-skills-dir") ?? undefined,
  });
  console.log(
    `Installed ASTRO skills (${skills.installed.join(", ")}) into ${skills.targetDir}.`,
  );
  console.log("ZCode imports these skills by reference from .agents/skills.");
  const result = installZcodePlugin();
  if (result.installed) {
    console.log(`Installed ${result.pluginId} from ${result.marketplaceDir}.`);
  } else if (result.reason === "zcode-cli-missing") {
    console.log(
      `The zcode CLI was not found. Add the marketplace directory ${result.marketplaceDir} under Plugin Marketplace → Add → Add Plugin Marketplace, then install ${result.pluginId}.`,
    );
  } else {
    console.error(`Plugin installation failed (${result.reason}).`);
    if (result.output) {
      console.error(result.output.trim());
    }
    process.exitCode = 1;
  }
  console.log("Restart ZCode or start a new session to activate the plugin.");
}
