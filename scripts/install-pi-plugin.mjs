#!/usr/bin/env node

/**
 * Installs the ASTRO Pi capture extension into the global Pi extension
 * directory so every project records Pi sessions without extra config.
 *
 * Pi discovers ~/.pi/agent/extensions/<name>/index.ts automatically and loads
 * it with jiti, so the TypeScript extension works without a build step. The
 * installed copy is self-contained: the recorder and its vendored runtime
 * dependencies travel with the extension, which keeps the installation
 * independent of the ASTRO repository location.
 */

import { copyFileSync, cpSync, existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pluginSourceDir = join(packageDir, "pi-plugin");
const runtimeDependencies = ["dotenv", "yaml"];
const pluginFiles = ["index.ts", "mapping.ts", "claim.ts", "package.json", "README.md"];

export function getPiExtensionsDir(piHome = homedir()) {
  return join(resolve(piHome), ".pi", "agent", "extensions");
}

function copyRuntimeDependencies(destination) {
  const vendorDir = join(destination, "vendor");
  rmSync(vendorDir, { recursive: true, force: true });
  mkdirSync(vendorDir, { recursive: true });
  for (const dependency of runtimeDependencies) {
    const source = dirname(require.resolve(`${dependency}/package.json`));
    cpSync(source, join(vendorDir, dependency), {
      filter: (candidate) => {
        const name = relative(source, candidate);
        if (!name) {
          return true;
        }
        if (statSync(candidate).isDirectory()) {
          return dependency === "yaml"
            ? name === "dist" || name.startsWith(`dist${sep}`)
            : name === "lib";
        }
        if (name === "package.json" || name === "LICENSE") {
          return true;
        }
        return dependency === "yaml"
          ? name.startsWith(`dist${sep}`) && name.endsWith(".js")
          : name === join("lib", "main.js");
      },
      recursive: true,
    });
  }
}

export function installPiPlugin({
  extensionsDir = getPiExtensionsDir(),
  sourceDir = pluginSourceDir,
} = {}) {
  if (!existsSync(sourceDir)) {
    throw new Error(`ASTRO Pi plugin source was not found at ${sourceDir}.`);
  }

  const installDir = join(extensionsDir, "astro-trace");
  const runtimeDir = join(installDir, "plugin");
  rmSync(installDir, { recursive: true, force: true });
  mkdirSync(installDir, { recursive: true });

  for (const file of pluginFiles) {
    copyFileSync(join(sourceDir, file), join(installDir, file));
  }
  mkdirSync(runtimeDir, { recursive: true });
  for (const file of [
    "trace-recorder.cjs",
    "runtime-config.cjs",
    "storage-paths.cjs",
  ]) {
    const source = join(packageDir, "plugin", file);
    if (existsSync(source)) {
      copyFileSync(source, join(runtimeDir, file));
    }
  }
  copyRuntimeDependencies(runtimeDir);

  return {
    extensionsDir,
    installDir,
    recorderFile: join(runtimeDir, "trace-recorder.cjs"),
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
  const piHomeOption = getOption("pi-home");
  const result = installPiPlugin({
    extensionsDir: piHomeOption
      ? getPiExtensionsDir(piHomeOption)
      : undefined,
  });
  console.log(`Installed ASTRO Pi extension in ${result.installDir}`);
  console.log("Pi discovers global extensions automatically.");
  console.log("Restart Pi or start a new session to activate it.");
}
