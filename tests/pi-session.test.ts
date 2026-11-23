import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  readSubagentIdentity,
  resolvePiSessionId,
} from "../pi-plugin/session.ts";

test("session id resolves across CLI, Web and SDK context shapes", () => {
  const ctx = {
    sessionManager: { getSessionId: () => "from-manager" },
    sessionId: "from-ctx",
    session: { id: "from-ctx-session" },
  };
  assert.equal(resolvePiSessionId({}, ctx, {}), "from-manager");
  assert.equal(resolvePiSessionId({}, { sessionId: "from-ctx" }, {}), "from-ctx");
  assert.equal(
    resolvePiSessionId({}, { session: { id: "from-ctx-session" } }, {}),
    "from-ctx-session",
  );
  assert.equal(resolvePiSessionId({ sessionId: "from-event" }, {}, {}), "from-event");
  assert.equal(resolvePiSessionId({}, {}, { PI_SESSION_ID: "from-env" }), "from-env");
});

test("a host without any session id still produces a stable process session", () => {
  const first = resolvePiSessionId({}, { cwd: "/tmp/project" }, {});
  const second = resolvePiSessionId({}, { cwd: "/tmp/project" }, {});
  assert.match(first, /^pi-process-\d+-tmp-project$/);
  assert.equal(second, first);
  assert.notEqual(resolvePiSessionId({}, { cwd: "/tmp/other" }, {}), first);
});

test("a getter that throws cannot drop the main agent's events", () => {
  const ctx = {
    sessionManager: {
      getSessionId: () => {
        throw new Error("not ready");
      },
    },
    sessionId: "fallback",
  };
  assert.equal(resolvePiSessionId({}, ctx, {}), "fallback");
});

test("delegation launch payload attributes a named child to its parent", () => {
  const identity = readSubagentIdentity({
    sessionId: "subagent.abc",
    env: {
      PI_SUBAGENT_DEPTH: "1",
      PI_SUBAGENT_STACK: '["main","explore"]',
      PI_SUBAGENT_DELEGATION: JSON.stringify({
        version: 1,
        childSessionId: "subagent.abc",
        parentSessionId: "parent-uuid",
        agent: "explore",
        handle: "auth",
      }),
    },
  });
  assert.ok(identity);
  assert.equal(identity.parentSessionId, "parent-uuid");
  assert.equal(identity.agent, "explore");
  assert.equal(identity.handle, "auth");
  assert.deepEqual(identity.stack, ["main", "explore"]);
});

test("a continuation without the launch payload reads the persisted delegation entry", () => {
  const home = mkdtempSync(join(tmpdir(), "astro-pi-delegation-"));
  try {
    const sessions = join(home, ".pi", "agent", "sessions", "project");
    const file = join(sessions, "2026-11-22T00-00-00-000Z_subagent.cont.jsonl");
    const entry = {
      type: "custom",
      customType: "pi-subagent:delegation",
      data: {
        version: 1,
        childSessionId: "subagent.cont",
        parentSessionId: "parent-continued",
        agent: "review",
        handle: "diff",
      },
    };
    mkdirSync(sessions, { recursive: true });
    writeFileSync(file, `${JSON.stringify({ type: "session", id: "subagent.cont" })}\n${JSON.stringify(entry)}\n`);
    const identity = readSubagentIdentity({
      sessionId: "subagent.cont",
      env: { PI_SUBAGENT_DEPTH: "1", PI_SUBAGENT_STACK: '["main","review"]' },
      home,
    });
    assert.ok(identity);
    assert.equal(identity.parentSessionId, "parent-continued");
    assert.equal(identity.agent, "review");
    assert.equal(identity.handle, "diff");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("a copied delegation entry from a parent-seeded fork is ignored", () => {
  const home = mkdtempSync(join(tmpdir(), "astro-pi-fork-"));
  try {
    const sessions = join(home, ".pi", "agent", "sessions", "project");
    mkdirSync(sessions, { recursive: true });
    writeFileSync(
      join(sessions, "seed_subagent.fork.jsonl"),
      `${JSON.stringify({
        type: "custom",
        customType: "pi-subagent:delegation",
        data: {
          version: 1,
          childSessionId: "subagent.other",
          parentSessionId: "wrong-parent",
          agent: "explore",
          handle: "seed",
        },
      })}\n`,
    );
    const identity = readSubagentIdentity({
      sessionId: "subagent.fork",
      env: { PI_SUBAGENT_DEPTH: "1", PI_SUBAGENT_STACK: '["main","explore"]' },
      home,
    });
    assert.ok(identity);
    assert.equal(identity.parentSessionId, "");
    assert.equal(identity.agent, "explore");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("the main agent is not misclassified as a subagent", () => {
  assert.equal(
    readSubagentIdentity({
      sessionId: "main-session",
      env: { PI_SUBAGENT_DEPTH: "0" },
    }),
    null,
  );
});
