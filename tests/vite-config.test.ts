import assert from "node:assert/strict";
import test from "node:test";
import { resolveAstroProxyTarget } from "../vite.config.ts";

test("proxies development API requests to the default ASTRO server", () => {
  assert.equal(resolveAstroProxyTarget({}), "http://127.0.0.1:4318");
});

test("uses configured ASTRO host and port for the development proxy", () => {
  assert.equal(
    resolveAstroProxyTarget({
      ASTRO_HOST: "localhost",
      ASTRO_PORT: "4400",
    }),
    "http://localhost:4400",
  );
});

test("falls back to the default port when ASTRO_PORT is invalid", () => {
  assert.equal(
    resolveAstroProxyTarget({
      ASTRO_PORT: "not-a-port",
    }),
    "http://127.0.0.1:4318",
  );
});
