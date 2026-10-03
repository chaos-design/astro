import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { claimDirectoryName, claimSession } from "../opencode-plugin/claim.ts";

function createHome() {
  return mkdtempSync(join(tmpdir(), "astro-claim-"));
}

test("the first caller owns the session and later callers are refused", () => {
  const home = createHome();
  try {
    assert.equal(claimSession("ses_a", { home, source: "opencode" }), true);
    assert.equal(claimSession("ses_a", { home, source: "opencode" }), false);

    const claims = readdirSync(join(home, "opencode", claimDirectoryName));
    assert.deepEqual(claims, ["ses_a.claim"]);
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