import assert from "node:assert/strict";
import test from "node:test";
import { hookPhaseOf } from "../src/lib/trace-event-kind.ts";

test("PreToolUse and PostToolUse are the two tool-hook phases", () => {
  assert.equal(hookPhaseOf("PreToolUse"), "pre");
  assert.equal(hookPhaseOf("PostToolUse"), "post");
});

test("a failed tool call keeps its failure tone, not a hook phase", () => {
  assert.equal(hookPhaseOf("PostToolUseFailure"), null);
  assert.equal(hookPhaseOf("Notification"), null);
  assert.equal(hookPhaseOf(undefined), null);
});
