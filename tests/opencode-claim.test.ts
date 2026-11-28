import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { claimDirectoryName, claimSession } from "../opencode-plugin/claim.ts";

function createHome() {
  return mkdtempSync(join(tmpdir(), "astro-claim-"));
}

test("the first caller owns the session and records its pid", () => {
  const home = createHome();
  try {
    assert.equal(claimSession("ses_a", { home, source: "opencode", pid: process.pid }), true);

    const claims = readdirSync(join(home, "opencode", claimDirectoryName));
    assert.deepEqual(claims, ["ses_a.claim"]);
    const record = JSON.parse(
      readFileSync(join(home, "opencode", claimDirectoryName, "ses_a.claim"), "utf8"),
    );
    assert.equal(record.pid, process.pid);
    assert.equal(typeof record.claimedAt, "string");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("a live foreign owner keeps the session", () => {
  const home = createHome();
  try {
    assert.equal(claimSession("ses_a", { home, source: "opencode", pid: process.pid }), true);
    assert.equal(
      claimSession("ses_a", { home, source: "opencode", pid: process.pid + 1000 }),
      false,
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("a reload in the same process takes over its own claim", () => {
  const home = createHome();
  try {
    assert.equal(claimSession("ses_a", { home, source: "opencode", pid: process.pid }), true);
    assert.equal(claimSession("ses_a", { home, source: "opencode", pid: process.pid }), true);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("a dead owner's claim is taken over after a service restart", async () => {
  const home = createHome();
  try {
    const deadPid = await new Promise<number>((resolveChild, rejectChild) => {
      const child = spawn("true", [], { stdio: "ignore" });
      child.on("exit", () => resolveChild(child.pid ?? 0));
      child.on("error", rejectChild);
    });
    assert.equal(deadPid > 0, true);
    assert.equal(claimSession("ses_a", { home, source: "opencode", pid: deadPid }), true);
    assert.equal(claimSession("ses_a", { home, source: "opencode", pid: process.pid }), true);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("different sessions and different sources never collide", () => {
  const home = createHome();
  try {
    assert.equal(claimSession("ses_a", { home, source: "opencode" }), true);
    assert.equal(claimSession("ses_b", { home, source: "opencode" }), true);
    assert.equal(claimSession("ses_a", { home, source: "claude" }), true);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("an unwritable home fails open so traces are not silently lost", () => {
  const home = createHome();
  try {
    const blocked = join(home, "not-a-directory");
    writeFileSync(blocked, "", "utf8");
    assert.equal(claimSession("ses_a", { home: blocked, source: "opencode" }), true);
    assert.equal(claimSession("ses_a", { home: blocked, source: "opencode" }), true);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("an empty session id is never claimed", () => {
  const home = createHome();
  try {
    assert.equal(claimSession("", { home, source: "opencode" }), false);
    assert.equal(readdirSync(home).length, 0);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("the claim directory is created on demand", () => {
  const home = createHome();
  try {
    const nested = join(home, "deep", "nested");
    mkdirSync(nested, { recursive: true });
    assert.equal(claimSession("ses_a", { home: nested, source: "opencode" }), true);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});