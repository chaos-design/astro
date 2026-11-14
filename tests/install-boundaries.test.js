import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { installClients } from "../scripts/install-plugins.mjs";

test("persists a custom data root in the installed DeepSeek bundle", (t) => {
  const root = mkdtempSync(join(tmpdir(), "astro-install-boundary-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const astroHome = join(root, "custom root");
  const dshHome = join(root, "dsh");
  installClients({
    targetDir: root, astroHome, dshHome,
    clients: ["deepseek"],
    deepseekRun(command, arguments_, options) {
      const profileDir = join(options.env.DSH_HOME, "profiles", "web");
      mkdirSync(profileDir, { recursive: true });
      writeFileSync(
        join(profileDir, "package.json"),
        `${JSON.stringify({
          dependencies: { "dsh-astro-plugin": "file:/tmp/dsh-astro-plugin" },
          dsh: { profile: { bundles: ["dsh-astro-plugin"] } },
        }, null, 2)}\n`,
      );
      return { status: 0 };
    },
  });
  const patch = readFileSync(
    join(astroHome, "plugins/astro/deepseek-plugin/cordis.patch.yml"), "utf8",
  );
  assert.ok(patch.includes(`astroHome: ${JSON.stringify(astroHome)}`));
});
