#!/usr/bin/env node

/**
 * Installs the ASTRO OpenCode capture plugin into the global OpenCode plugin
 * directory so every project records OpenCode sessions without extra config.
 *
 * The installed copy is self-contained: the recorder and its vendored runtime
 * dependencies travel with the plugin, which keeps the installation independent
 * of the ASTRO repository location.
 */

import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pluginSourceDir = join(packageDir, "opencode-plugin");
const runtimeDependencies = ["dotenv", "yaml"];
const pluginFiles = ["index.ts", "mapping.ts", "claim.ts", "package.json", "README.md"];

export function getOpenCodeConfigDir(openCodeHome = homedir()) {
  const configured = process.env.XDG_CONFIG_HOME;
  const base = configured
    ? resolve(configured)
    : join(openCodeHome, ".config");
  return join(base, "opencode");
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

export function installOpenCodePlugin({
  configDir = getOpenCodeConfigDir(),
  sourceDir = pluginSourceDir,
} = {}) {
  if (!existsSync(sourceDir)) {
    throw new Error(
      `ASTRO OpenCode plugin source was not found at ${sourceDir}.`,
    );
  }

  const installDir = join(configDir, "plugins", "astro-capture");
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

  // Discovery of ~/.config/opencode/plugins is automatic, so an explicit entry
  // is only needed to keep a previous absolute-path install from loading twice.
  const configFile = join(configDir, "opencode.json");
  if (existsSync(configFile)) {
    const config = JSON.parse(readFileSync(configFile, "utf8"));
    const entries = Array.isArray(config.plugins) ? config.plugins : [];
    const stale = entries.filter(
      (entry) =>
        typeof entry === "string" &&
        (entry.endsWith("astro/opencode-plugin") ||
          entry.endsWith("astro/opencode-plugin/index.ts") ||
          entry.endsWith("plugins/astro-capture")),
    );
    if (stale.length) {
      config.plugins = entries.filter((entry) => !stale.includes(entry));
      writeFileSync(
        configFile,
        `${JSON.stringify(config, null, 2)}\n`,
        "utf8",
      );
    }
  }

  return {
    configDir,
    configFile,
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
  const result = installOpenCodePlugin({
    configDir: getOption("opencode-home")
      ? join(resolve(getOption("opencode-home")), "config", "opencode")
      : undefined,
  });
  console.log(`Installed ASTRO OpenCode plugin in ${result.installDir}`);
  console.log("OpenCode discovers global plugins automatically.");
  console.log(
    "Restart OpenCode or run `opencode service restart` to activate it in existing sessions.",
  );
}