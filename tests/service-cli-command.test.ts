import assert from "node:assert/strict";
import test from "node:test";
import {
  buildServiceCliCommands,
  offlineRestartNotice,
  serviceCardHint,
  servicePortFromApiBase,
} from "../src/lib/service-cli-command.ts";

test("uses the port of the configured API base", () => {
  assert.equal(servicePortFromApiBase("http://127.0.0.1:4401"), 4401);
  assert.equal(
    buildServiceCliCommands("http://127.0.0.1:4401").repo,
    "pnpm service:up --port=4401",
  );
  assert.equal(
    buildServiceCliCommands("http://localhost:5678").installed,
    "ASTRO_PORT=5678 astro-trace serve",
  );
});

test("a same-origin page uses the page port, not the default", () => {
  assert.equal(
    buildServiceCliCommands("", "http://127.0.0.1:4401").repo,
    "pnpm service:up --port=4401",
  );
  assert.equal(
    servicePortFromApiBase("", "http://127.0.0.1"),
    80,
  );
});

test("falls back to the default port for invalid bases and no origin", () => {
  assert.equal(servicePortFromApiBase("not a url", "also invalid"), 5678);
  assert.equal(servicePortFromApiBase(""), 5678);
});

test("the offline notice tells the truth about clipboard failure", () => {
  const commands = buildServiceCliCommands("http://127.0.0.1:5678");
  assert.match(offlineRestartNotice(true, commands), /^已复制/);
  assert.match(offlineRestartNotice(false, commands), /^请手动复制/);
  assert.match(offlineRestartNotice(false, commands), /astro-trace serve/);
});

test("the service card hint matches the offline button's real behavior", () => {
  assert.match(serviceCardHint(false, true), /只复制启动命令/);
  assert.match(serviceCardHint(true, true), /只复制启动命令/);
  assert.match(serviceCardHint(true, false), /最长同步时长/);
  assert.match(serviceCardHint(false, false), /自动重连/);
});
