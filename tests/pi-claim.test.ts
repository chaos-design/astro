import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { claimDirectoryName, claimSession } from "../pi-plugin/claim.ts";

function createHome() {
  return mkdtempSync(join(tmpdir(), "astro-pi-claim-"));
}

test("the first caller owns the session and records its pid", () => {
  const home = createHome();
  try {
    assert.equal(claimSession("ses_a", { home, source: "pi" }), true);

    const claimFile = join(home, "pi", claimDirectoryName, "ses_a.claim");
    const record = JSON.parse(readFileSync(claimFile, "utf8"));
    assert.equal(Number.isInteger(record.pid), true);
    assert.equal(typeof record.claimedAt, "string");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("a live owner keeps the session", () => {
  const home = createHome();
  try {
    assert.equal(
      claimSession("ses_a", { home, source: "pi", pid: process.pid }),
      true,
    );
    // process.pid is alive, so a second instance must stay silent even with
    // a different pid.
    assert.equal(
      claimSession("ses_a", { home, source: "pi", pid: process.pid + 1000 }),
      false,
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("a dead owner's claim is taken over by the next instance", async () => {
  const home = createHome();
  try {
    // A finished child process is a guaranteed-dead owner: its pid no longer
    // responds to signals, so the claim must transfer.
    const deadPid = await new Promise<number>((resolveChild, rejectChild) => {
      const child = spawn("true", [], { stdio: "ignore" });
      child.on("exit", () => resolveChild(child.pid ?? 0));
      child.on("error", rejectChild);
    });
    assert.equal(deadPid > 0, true);

    assert.equal(
      claimSession("ses_a", { home, source: "pi", pid: deadPid }),
      true,
    );
    assert.equal(
      claimSession("ses_a", { home, source: "pi", pid: process.pid }),
      true,
    );

    const claimFile = join(home, "pi", claimDirectoryName, "ses_a.claim");
    const record = JSON.parse(readFileSync(claimFile, "utf8"));
    assert.equal(record.pid, process.pid);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("different sessions and sources never collide", () => {
  const home = createHome();
  try {
    assert.equal(claimSession("ses_a", { home, source: "pi" }), true);
    assert.equal(claimSession("ses_b", { home, source: "pi" }), true);
    assert.equal(claimSession("ses_a", { home, source: "opencode" }), true);

    const claims = readdirSync(join(home, "pi", claimDirectoryName));
    assert.deepEqual(claims.sort(), ["ses_a.claim", "ses_b.claim"]);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("a corrupted claim fails open so traces are not lost", () => {
  const home = createHome();
  try {
    const claimDir = join(home, "pi", claimDirectoryName);
    mkdirSync(claimDir, { recursive: true });
    writeFileSync(join(claimDir, "ses_a.claim"), "not-json", "utf8");
    assert.equal(claimSession("ses_a", { home, source: "pi" }), true);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("an empty session id is never claimed", () => {
  const home = createHome();
  try {
    assert.equal(claimSession("", { home, source: "pi" }), false);
    assert.equal(readdirSync(home).length, 0);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
