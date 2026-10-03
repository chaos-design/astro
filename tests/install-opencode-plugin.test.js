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
  getOpenCodeConfigDir,
  installOpenCodePlugin,
} from "../scripts/install-opencode-plugin.mjs";

function createConfigDir() {
  return mkdtempSync(join(tmpdir(), "astro-opencode-"));
}

test("installs a self-contained plugin into the global plugin directory", () => {
  const configDir = createConfigDir();
  try {
    const result = installOpenCodePlugin({ configDir });

    assert.equal(result.installDir, join(configDir, "plugins", "astro-capture"));
    for (const file of ["index.ts", "mapping.ts", "package.json"]) {
      assert.equal(existsSync(join(result.installDir, file)), true, file);
    }
    assert.equal(existsSync(result.recorderFile), true);
    assert.equal(
      existsSync(join(result.installDir, "plugin", "storage-paths.cjs")),
      true,
    );
    assert.equal(
      existsSync(join(result.installDir, "plugin", "vendor", "dotenv")),
      true,
    );
    assert.equal(
      existsSync(join(result.installDir, "plugin", "vendor", "yaml")),
      true,
    );
  } finally {
    rmSync(configDir, { recursive: true, force: true });
  }
});

test("reinstalling replaces the previous plugin copy", () => {
  const configDir = createConfigDir();
  try {
    const first = installOpenCodePlugin({ configDir });
    const stale = join(first.installDir, "stale.txt");
    writeFileSync(stale, "stale", "utf8");

    const second = installOpenCodePlugin({ configDir });

    assert.equal(existsSync(stale), false);
    assert.equal(existsSync(second.recorderFile), true);
  } finally {
    rmSync(configDir, { recursive: true, force: true });
  }
});

test("removes the absolute-path entry that discovery now replaces", () => {
  const configDir = createConfigDir();
  try {
    mkdirSync(configDir, { recursive: true });
    const configFile = join(configDir, "opencode.json");
    writeFileSync(
      configFile,
      `${JSON.stringify(
        {
          $schema: "https://opencode.ai/config.json",
          plugins: ["/repo/astro/opencode-plugin", "other-plugin"],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    installOpenCodePlugin({ configDir });

    const config = JSON.parse(readFileSync(configFile, "utf8"));
    assert.deepEqual(config.plugins, ["other-plugin"]);
  } finally {
    rmSync(configDir, { recursive: true, force: true });
  }
});

test("keeps unrelated plugin entries untouched", () => {
  const configDir = createConfigDir();
  try {
    mkdirSync(configDir, { recursive: true });
    const configFile = join(configDir, "opencode.json");
    const original = {
      $schema: "https://opencode.ai/config.json",
      plugins: ["other-plugin", { package: "./local", options: { a: 1 } }],
    };
    writeFileSync(configFile, `${JSON.stringify(original, null, 2)}\n`, "utf8");

    installOpenCodePlugin({ configDir });

    const config = JSON.parse(readFileSync(configFile, "utf8"));
    assert.deepEqual(config.plugins, original.plugins);
  } finally {
    rmSync(configDir, { recursive: true, force: true });
  }
});

test("resolves the global config directory", () => {
  assert.equal(
    getOpenCodeConfigDir("/home/tester").endsWith("/home/tester/.config/opencode"),
    true,
  );
});