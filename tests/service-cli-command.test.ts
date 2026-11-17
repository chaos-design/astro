import assert from "node:assert/strict";
import test from "node:test";
import {
  buildServiceCliCommand,
  servicePortFromApiBase,
} from "../src/lib/service-cli-command.ts";

test("uses the port of the configured API base", () => {
  assert.equal(
    buildServiceCliCommand("http://127.0.0.1:4401"),
    "pnpm service:up --port=4401",
  );
  assert.equal(
    buildServiceCliCommand("http://localhost:5678"),
    "pnpm service:up --port=5678",
  );
});

test("falls back to the default port for relative or invalid bases", () => {
  assert.equal(servicePortFromApiBase(""), 5678);
  assert.equal(servicePortFromApiBase("not a url"), 5678);
  assert.equal(servicePortFromApiBase("http://127.0.0.1"), 80);
});
