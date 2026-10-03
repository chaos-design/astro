import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { installClients } from "../scripts/install-plugins.mjs";

test("persists a custom data root in the installed DeepSeek bundle", (t) => {
  const root = mkdtempSync(join(tmpdir(), "astro-install-boundary-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const astroHome = join(root, "custom root");
  installClients({
    targetDir: root, astroHome, dshHome: join(root, "dsh"),
    clients: ["deepseek"], deepseekRun: () => ({ status: 0 }),
  });
  const patch = readFileSync(
    join(astroHome, "plugins/astro/deepseek-plugin/cordis.patch.yml"), "utf8",
  );
  assert.ok(patch.includes(`astroHome: ${JSON.stringify(astroHome)}`));
});
