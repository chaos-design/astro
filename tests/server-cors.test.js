import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const PAGE_ORIGIN = "https://astro-preview.vercel.app";
const OTHER_ORIGIN = "https://evil.example.com";

async function startServer(t, environment) {
  const root = mkdtempSync(join(tmpdir(), "astro-cors-"));
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const port = probe.address().port;
  await new Promise((done) => probe.close(done));
  const child = spawn(process.execPath, ["server/server.mjs"], {
    cwd: projectDir,
    env: {
      ...process.env,
      ASTRO_HOME: root,
      ASTRO_PORT: String(port),
      ASTRO_HOST: "127.0.0.1",
      ASTRO_OPEN_BROWSER: "0",
      ...environment,
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
    rmSync(root, { recursive: true, force: true });
  });
  let output = "";
  for await (const chunk of child.stdout) {
    output += chunk;
    if (output.includes("ASTRO:")) break;
  }
  assert.match(output, /ASTRO:/, stderr);
  return `http://127.0.0.1:${port}`;
}

test("default install: no cross-origin access, same as before", async (t) => {
  const url = await startServer(t, {});
  const response = await fetch(`${url}/api/health`, {
    headers: { Origin: PAGE_ORIGIN },
  });
  assert.equal(response.status, 200);
  // The allowlist is the data boundary: without it a random web page must not
  // be able to read local traces, exactly like every earlier release.
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  assert.equal(response.headers.get("access-control-allow-private-network"), null);
});

test("allowlisted origin can read and preflight, others cannot", async (t) => {
  const url = await startServer(t, {
    ASTRO_CORS_ORIGINS: `${PAGE_ORIGIN},https://chaos-design.github.io`,
  });

  const allowed = await fetch(`${url}/api/health`, {
    headers: { Origin: PAGE_ORIGIN },
  });
  assert.equal(allowed.headers.get("access-control-allow-origin"), PAGE_ORIGIN);
  // Chrome sends this preflight header for public→local requests; without the
  // answer the deployed console cannot reach the service at all.
  assert.equal(
    allowed.headers.get("access-control-allow-private-network"),
    "true",
  );

  const denied = await fetch(`${url}/api/health`, {
    headers: { Origin: OTHER_ORIGIN },
  });
  assert.equal(denied.headers.get("access-control-allow-origin"), null);
  assert.equal(denied.headers.get("access-control-allow-private-network"), null);
});

test("preflight answers for the stream and echoes requested headers", async (t) => {
  const url = await startServer(t, { ASTRO_CORS_ORIGINS: PAGE_ORIGIN });
  const preflight = await fetch(`${url}/api/stream`, {
    method: "OPTIONS",
    headers: {
      Origin: PAGE_ORIGIN,
      "Access-Control-Request-Method": "GET",
      "Access-Control-Request-Headers": "content-type",
      "Access-Control-Request-Private-Network": "true",
    },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), PAGE_ORIGIN);
  assert.equal(
    preflight.headers.get("access-control-allow-private-network"),
    "true",
  );
  assert.match(preflight.headers.get("access-control-allow-methods"), /GET/);
  assert.match(preflight.headers.get("access-control-allow-methods"), /DELETE/);
  assert.match(
    preflight.headers.get("access-control-allow-headers"),
    /content-type/i,
  );

  // The SSE stream itself carries the origin echo: EventSource cannot send
  // custom headers, so the response headers are all the browser sees.
  const stream = await fetch(`${url}/api/stream`, {
    headers: { Origin: PAGE_ORIGIN, Accept: "text/event-stream" },
  });
  assert.equal(stream.status, 200);
  assert.equal(stream.headers.get("access-control-allow-origin"), PAGE_ORIGIN);
  await stream.body.cancel();
});

test("an explicit wildcard opts every origin in", async (t) => {
  const url = await startServer(t, { ASTRO_CORS_ORIGINS: "*" });
  const response = await fetch(`${url}/api/health`, {
    headers: { Origin: OTHER_ORIGIN },
  });
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
});

test("health reports the configured allowlist for debugging", async (t) => {
  const url = await startServer(t, { ASTRO_CORS_ORIGINS: PAGE_ORIGIN });
  const health = await (await fetch(`${url}/api/health`)).json();
  assert.deepEqual(health.corsOrigins, [PAGE_ORIGIN]);
});
