import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectDir = resolve(scriptDir, "..");
const artifactsDir = join(projectDir, "artifacts");
const stagingDir = join(artifactsDir, "astro-plugin");
const packageMetadata = JSON.parse(
  readFileSync(join(projectDir, "package.json"), "utf8"),
);

rmSync(stagingDir, { recursive: true, force: true });
mkdirSync(stagingDir, { recursive: true });

for (const directory of ["deepseek-plugin", "dist", "plugin", "server"]) {
  const source = join(projectDir, directory);
  if (!existsSync(source)) {
    throw new Error(`Missing ${directory}; run pnpm build before packaging.`);
  }
  cpSync(source, join(stagingDir, directory), { recursive: true });
}

for (const file of [
  ".env.example",
  "bin/astro.mjs",
  "config.example.yaml",
  "scripts/install-plugins.mjs",
  "scripts/migrate-data.mjs",
]) {
  const destination = join(stagingDir, file);
  mkdirSync(dirname(destination), { recursive: true });
  cpSync(join(projectDir, file), destination);
}

cpSync(
  join(projectDir, "docs", "plugin-installation.md"),
  join(stagingDir, "README.md"),
);
writeFileSync(
  join(stagingDir, "package.json"),
  `${JSON.stringify(
    {
      name: "astro-plugin",
      version: packageMetadata.version,
      description:
        "ASTRO local-first trace integrations for Trae, Claude Code, Codex, DeepSeek Harness, and WorkBuddy.",
      license: "UNLICENSED",
      type: "module",
      bin: {
        "astro-trace": "bin/astro.mjs",
        "astro-plugin": "bin/astro.mjs",
      },
      files: [
        "bin",
        "config.example.yaml",
        "deepseek-plugin",
        "dist",
        ".env.example",
        "plugin",
        "scripts",
        "server",
        "README.md",
      ],
      dependencies: {
        dotenv: packageMetadata.dependencies.dotenv,
        yaml: packageMetadata.dependencies.yaml,
      },
      engines: {
        node: ">=20",
      },
    },
    null,
    2,
  )}\n`,
  "utf8",
);

const packOutput = execFileSync(
  "pnpm",
  ["pack", "--pack-destination", artifactsDir],
  {
    cwd: stagingDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  },
).trim();
const archiveName = packOutput.split(/\r?\n/).at(-1);

console.log(isAbsolute(archiveName) ? archiveName : join(artifactsDir, archiveName));
