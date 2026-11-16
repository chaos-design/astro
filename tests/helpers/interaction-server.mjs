import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer as createProbe } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

export async function freePort() {
  const probe = createProbe();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const port = probe.address().port;
  await new Promise((done) => probe.close(done));
  return port;
}

/** Start the real service on a free port with a throwaway ASTRO_HOME. */
export async function startServer(t) {
  const home = mkdtempSync(join(tmpdir(), "astro-interaction-service-"));
  const port = await freePort();
  const child = spawn(process.execPath, ["server/server.mjs"], {
    cwd: projectDir,
    env: {
      ...process.env,
      ASTRO_HOME: home,
      ASTRO_PORT: String(port),
      ASTRO_HOST: "127.0.0.1",
      ASTRO_OPEN_BROWSER: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exited = once(child, "exit");
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  t.after(async () => {
    child.kill("SIGTERM");
    await exited;
    rmSync(home, { recursive: true, force: true });
  });
  let output = "";
  for await (const chunk of child.stdout) {
    output += chunk;
    if (output.includes("ASTRO:")) {
      break;
    }
  }
  assert.match(output, /ASTRO:/, stderr);
  return { url: `http://127.0.0.1:${port}`, home };
}
