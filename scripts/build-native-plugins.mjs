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
import { dirname, join, relative, resolve, sep } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectDir = resolve(scriptDir, "..");
const require = createRequire(import.meta.url);
const packageMetadata = JSON.parse(
  readFileSync(join(projectDir, "package.json"), "utf8"),
);

const pluginDefinitions = [
  {
    directory: "codex-plugin",
    manifest: join(".codex-plugin", "plugin.json"),
  },
  {
    directory: "claude-plugin",
    manifest: join(".claude-plugin", "plugin.json"),
  },
  {
    directory: "workbuddy-plugin",
    manifest: join(".codebuddy-plugin", "plugin.json"),
  },
  {
    directory: "zcode-plugin",
    manifest: join(".zcode-plugin", "plugin.json"),
    extraRuntimeFiles: ["zcode-adapter.cjs"],
  },
  {
    directory: "deepseek-plugin",
    manifest: "package.json",
  },
];

const runtimeFiles = [
  "runtime-config.cjs",
  "storage-paths.cjs",
  "trace-recorder.cjs",
];
const templateFiles = ["config.example.yaml", ".env.example"];
const runtimeDependencies = ["dotenv", "yaml"];

function includeRuntimeDependencyFile(dependency, sourceRoot, source) {
  const name = relative(sourceRoot, source);
  if (!name) {
    return true;
  }
  if (statSync(source).isDirectory()) {
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
}

function copyRuntimeDependencies(runtimeDir) {
  const vendorDir = join(runtimeDir, "vendor");
  rmSync(vendorDir, { recursive: true, force: true });
  mkdirSync(vendorDir, { recursive: true });
  for (const dependency of runtimeDependencies) {
    const source = dirname(require.resolve(`${dependency}/package.json`));
    cpSync(source, join(vendorDir, dependency), {
      filter: (candidate) =>
        includeRuntimeDependencyFile(dependency, source, candidate),
      recursive: true,
    });
  }
}

for (const definition of pluginDefinitions) {
  const pluginRoot = join(projectDir, definition.directory);
  const runtimeDir = join(pluginRoot, "plugin");
  const manifestFile = join(pluginRoot, definition.manifest);
  const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));

  mkdirSync(runtimeDir, { recursive: true });
  for (const file of [...runtimeFiles, ...(definition.extraRuntimeFiles ?? [])]) {
    copyFileSync(join(projectDir, "plugin", file), join(runtimeDir, file));
  }
  copyRuntimeDependencies(runtimeDir);
  for (const file of templateFiles) {
    copyFileSync(join(projectDir, file), join(pluginRoot, file));
  }
  for (const directory of ["dist", "server"]) {
    const source = join(projectDir, directory);
    if (!existsSync(source)) {
      throw new Error(`Missing ${directory}; run pnpm build first.`);
    }
    const destination = join(pluginRoot, directory);
    rmSync(destination, { recursive: true, force: true });
    cpSync(source, destination, { recursive: true });
  }

  manifest.version = packageMetadata.version;
  writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`Built ${definition.directory}`);
}
