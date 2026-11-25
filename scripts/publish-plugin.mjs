#!/usr/bin/env node

/**
 * Publish the packaged `astro-plugin` runtime to npm.
 *
 * The flow is the build pipeline's, with gates:
 *   1. `scripts/build-plugin.mjs` stages `artifacts/astro-plugin/` and packs
 *      the tarball (`pnpm pack`, requires `dist/` — run `pnpm build` first).
 *   2. This script validates the staging package (publishable license, every
 *      bin and declared file present, tarball for the current version).
 *   3. `npm publish <tarball> --tag <tag>` runs. **Dry-run by default**:
 *      without `--apply` the publish is `--dry-run` and nothing leaves the
 *      machine. Prerelease versions default to their prerelease dist-tag
 *      (`0.0.7-alpha.4` → `alpha`) so a prerelease never lands on `latest`;
 *      `--tag` overrides.
 *
 * Usage:
 *   node scripts/publish-plugin.mjs                  # build + validate + dry-run
 *   node scripts/publish-plugin.mjs --skip-build     # reuse existing artifacts
 *   node scripts/publish-plugin.mjs --tag alpha      # force a dist-tag
 *   node scripts/publish-plugin.mjs --apply          # real publish
 */

import { execFileSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectDir = resolve(scriptDir, "..");
const stagingDir = join(projectDir, "artifacts", "astro-plugin");
const artifactsDir = join(projectDir, "artifacts");

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function getOption(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : null;
}

function fail(message) {
  console.error(`publish:plugin: ${message}`);
  process.exitCode = 1;
}

function getVersionPrereleaseTag(version) {
  const match = /-([A-Za-z0-9]+)(?:\.\d+)?$/.exec(version);
  return match ? match[1].toLowerCase() : "latest";
}

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

if (!existsSync(join(projectDir, "dist", "index.html"))) {
  fail('dist/index.html is missing — run "pnpm build" first.');
  process.exit(process.exitCode || 1);
}

if (!hasFlag("skip-build")) {
  console.log("Building the astro-plugin package…");
  execFileSync(process.execPath, [join(scriptDir, "build-plugin.mjs")], {
    stdio: "inherit",
  });
}

if (!existsSync(stagingDir)) {
  fail(
    `Staging directory ${stagingDir} is missing — run without --skip-build.`,
  );
  process.exit(process.exitCode || 1);
}

const rootVersion = JSON.parse(
  readFileSync(join(projectDir, "package.json"), "utf8"),
).version;
const stagedManifest = JSON.parse(
  readFileSync(join(stagingDir, "package.json"), "utf8"),
);

const problems = [];
if (stagedManifest.name !== "astro-plugin") {
  problems.push(`package name is ${stagedManifest.name}, expected astro-plugin`);
}
if (stagedManifest.version !== rootVersion) {
  problems.push(
    `staged version ${stagedManifest.version} ≠ root version ${rootVersion} — rebuild without --skip-build`,
  );
}
if (!stagedManifest.license || stagedManifest.license === "UNLICENSED") {
  problems.push("license is unset or UNLICENSED — npm refuses to publish it");
}
if (stagedManifest.private) {
  problems.push("staged package is private");
}
for (const [bin, file] of Object.entries(stagedManifest.bin ?? {})) {
  if (!existsSync(join(stagingDir, file))) {
    problems.push(`bin ${bin} points at missing file ${file}`);
  }
}
for (const entry of stagedManifest.files ?? []) {
  if (!existsSync(join(stagingDir, entry))) {
    problems.push(`declared file/directory is missing in staging: ${entry}`);
  }
}
const tarballName = `astro-plugin-${stagedManifest.version}.tgz`;
const tarball = join(artifactsDir, tarballName);
if (!existsSync(tarball)) {
  problems.push(`tarball ${tarball} is missing — rebuild without --skip-build`);
}

if (problems.length) {
  for (const problem of problems) {
    fail(problem);
  }
  process.exit(1);
}

const distTag =
  getOption("tag") || getVersionPrereleaseTag(stagedManifest.version);
const apply = hasFlag("apply");
const tarballBytes = statSync(tarball).size;

console.log(
  `${stagedManifest.name}@${stagedManifest.version} → dist-tag ${distTag}`,
);
console.log(`  tarball  ${tarball} (${formatBytes(tarballBytes)})`);
console.log(`  staging  ${stagingDir} (${readdirSync(stagingDir).length} entries)`);
console.log(
  apply
    ? "Publishing to npm…"
    : "DRY RUN — nothing is published. Re-run with --apply to publish.",
);

const publishArgs = ["publish", tarball, "--tag", distTag];
if (!apply) {
  publishArgs.push("--dry-run");
}
try {
  execFileSync("npm", publishArgs, { stdio: "inherit" });
} catch {
  fail("npm publish failed — see the npm output above.");
  process.exit(1);
}

console.log(
  apply
    ? `Published ${stagedManifest.name}@${stagedManifest.version} (tag ${distTag}).`
    : `Dry run passed for ${stagedManifest.name}@${stagedManifest.version} (tag ${distTag}).`,
);
