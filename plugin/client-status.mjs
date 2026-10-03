import { spawnSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { join } from "node:path";

export const deepseekPluginPackage = "dsh-astro-plugin";

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

export function hasInstalledHook(configFile, source) {
  const config = readJson(configFile);
  return Object.values(config?.hooks || {}).some(
    (groups) =>
      Array.isArray(groups) &&
      groups.some(
        (group) =>
          Array.isArray(group?.hooks) &&
          group.hooks.some(
            (hook) =>
              typeof hook?.command === "string" &&
              (hook.command.includes("trace-recorder.cjs") ||
                hook.command.includes("hook-recorder.cjs")) &&
              hook.command.includes(`--source=${source}`),
          ),
      ),
  );
}

export function inspectExecutable(
  command,
  { environment = process.env, run = spawnSync } = {},
) {
  const result = run(command, ["--version"], {
    encoding: "utf8",
    env: environment,
    timeout: 5_000,
  });
  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  const version =
    output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line && !line.startsWith("WARNING:")) || "";
  return {
    available: !result.error && result.status === 0,
    version,
  };
}

function containsAstroPlugin(value) {
  if (Array.isArray(value)) {
    return value.some(containsAstroPlugin);
  }
  if (!value || typeof value !== "object") {
    return false;
  }
  const pluginId = String(value.pluginId || value.id || "");
  const name = String(value.name || "");
  if (
    (pluginId === "astro" || pluginId.startsWith("astro@") || name === "astro") &&
    value.installed !== false &&
    value.enabled !== false
  ) {
    return true;
  }
  return Object.values(value).some(containsAstroPlugin);
}

export function inspectNativePlugin(
  command,
  { environment = process.env, run = spawnSync } = {},
) {
  for (const arguments_ of [
    ["plugin", "list", "--json"],
    ["plugin", "list"],
  ]) {
    const result = run(command, arguments_, {
      encoding: "utf8",
      env: environment,
      timeout: 10_000,
    });
    if (result.error || result.status !== 0) {
      continue;
    }
    const output = String(result.stdout || "");
    try {
      if (containsAstroPlugin(JSON.parse(output))) {
        return { installed: true, detail: "native plugin" };
      }
    } catch {
      if (/\bastro@astro-local\b/i.test(output)) {
        return { installed: true, detail: "native plugin" };
      }
    }
  }
  return { installed: false, detail: "" };
}

export function hasDeepseekPlugin(dshHome, profile = "web") {
  const profileFile = join(dshHome, "profiles", profile, "package.json");
  const manifest = readJson(profileFile);
  const dependencies = manifest?.dependencies || {};
  const bundles = manifest?.dsh?.profile?.bundles || [];
  return {
    installed:
      Object.hasOwn(dependencies, deepseekPluginPackage) &&
      Array.isArray(bundles) &&
      bundles.includes(deepseekPluginPackage),
    profileFile,
  };
}

export function getTraceStats(astroHome, source) {
  const root = join(astroHome, source);
  const files = [];
  const walk = (directory) => {
    if (!existsSync(directory)) {
      return;
    }
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(entryPath);
      } else if (entry.isFile() && entry.name === "events.jsonl") {
        files.push(entryPath);
      }
    }
  };
  walk(root);
  return {
    bytes: files.reduce((total, file) => total + statSync(file).size, 0),
    files,
    root,
  };
}
