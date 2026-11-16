import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  getPiExtensionsDir,
  installPiPlugin,
} from "../scripts/install-pi-plugin.mjs";

function createPiHome() {
  return mkdtempSync(join(tmpdir(), "astro-pi-"));
}

test("installs a self-contained extension into the global extension directory", () => {
  const piHome = createPiHome();
  try {
    const result = installPiPlugin({
      extensionsDir: getPiExtensionsDir(piHome),
    });

    assert.equal(
      result.installDir,
      join(piHome, ".pi", "agent", "extensions", "astro-trace"),
    );
    for (const file of [
      "index.ts",
      "mapping.ts",
      "claim.ts",
      "package.json",
      "README.md",
    ]) {
      assert.equal(existsSync(join(result.installDir, file)), true, file);
    }
    assert.equal(existsSync(result.recorderFile), true);
    assert.equal(
      existsSync(join(result.installDir, "plugin", "storage-paths.cjs")),
      true,
    );
    assert.equal(
      existsSync(join(result.installDir, "plugin", "runtime-config.cjs")),
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
    rmSync(piHome, { recursive: true, force: true });
  }
});

test("reinstalling replaces the previous extension copy", () => {
  const piHome = createPiHome();
  try {
    const first = installPiPlugin({
      extensionsDir: getPiExtensionsDir(piHome),
    });
    const stale = join(first.installDir, "stale.txt");
    writeFileSync(stale, "stale", "utf8");

    const second = installPiPlugin({
      extensionsDir: getPiExtensionsDir(piHome),
    });

    assert.equal(existsSync(stale), false);
    assert.equal(existsSync(second.recorderFile), true);
  } finally {
    rmSync(piHome, { recursive: true, force: true });
  }
});
