import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildServiceEnv,
  parseServiceArgs,
  probeHealth,
  resolveServiceFile,
  runServiceCli,
} from "../scripts/service-cli.mjs";

function fetchStub(responses) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) {
      throw new Error(`unexpected request: ${url}`);
    }
    return {
      ok: next.ok !== false,
      status: next.status ?? 200,
      json: async () => next.body ?? {},
    };
  };
  return { calls, fetchImpl };
}

test("CLI defaults to up on the console's default port", () => {
  assert.deepEqual(parseServiceArgs([]), {
    command: "up",
    port: 5678,
    home: "",
    foreground: false,
    open: false,
    timeoutMs: 15_000,
  });
  assert.equal(parseServiceArgs(["restart", "--port=4401"]).port, 4401);
  assert.equal(parseServiceArgs(["status", "--port", "5679"]).port, 5679);
  assert.equal(parseServiceArgs(["up", "--port=0"]).port, 5678);
});

test("service env carries the resolved home and port", () => {
  assert.equal(
    buildServiceEnv(
      { ASTRO_PORT: "1", PATH: "/bin" },
      { home: "/tmp/astro", port: 4401, open: false },
    ).ASTRO_PORT,
    "4401",
  );
  assert.equal(
    buildServiceEnv({}, { home: "/tmp/astro", port: 4401, open: false }).ASTRO_OPEN_BROWSER,
    "0",
  );
});

test("a checkout without an installed runtime uses its own server", () => {
  const home = mkdtempSync(join(tmpdir(), "astro-service-cli-"));
  try {
    const file = resolveServiceFile(home, {});
    assert.match(file, /server\/server\.mjs$/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("health probe fails open on a refused or slow service", async () => {
  const { fetchImpl } = fetchStub([{ ok: false, status: 500 }]);
  assert.equal(await probeHealth("http://127.0.0.1:1", fetchImpl), null);
  assert.equal(
    await probeHealth("http://127.0.0.1:1", async () => {
      throw new Error("ECONNREFUSED");
    }),
    null,
  );
});

test("up restarts a running service through the HTTP route", async () => {
  const health = { pid: 4242, port: 4401 };
  const { calls, fetchImpl } = fetchStub([
    { body: health },
    { body: {} },
    { body: { ...health, pid: 4243 } },
  ]);
  const launched = [];
  const result = await runServiceCli(["up", "--port=4401"], {
    env: { ASTRO_HOME: "/tmp/astro-cli-up" },
    fetchImpl,
    launchImpl: (...args) => launched.push(args),
  });
  assert.equal(result.health.pid, 4243);
  assert.equal(
    calls[1].url,
    "http://127.0.0.1:4401/api/restart",
  );
  assert.equal(launched.length, 0, "a live service is restarted, not spawned twice");
});

test("up starts a downed service and waits for health", async () => {
  const { calls, fetchImpl } = fetchStub([
    { ok: false, status: 500 },
    { body: { pid: 99 } },
  ]);
  const launched = [];
  await runServiceCli(["up", "--port=4402"], {
    env: { ASTRO_HOME: "/tmp/astro-cli-down" },
    fetchImpl,
    launchImpl: (...args) => launched.push(args),
  });
  assert.equal(launched.length, 1);
  assert.match(String(calls[1].url), /api\/health$/);
});
