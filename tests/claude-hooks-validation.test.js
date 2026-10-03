import assert from "node:assert/strict";
import test from "node:test";
import { validateClaudeHooks } from "../scripts/validate-claude-hooks.mjs";

test("executes every Claude plugin hook through the packaged recorder", () => {
  const result = validateClaudeHooks();

  assert.equal(result.eventCount, 16);
});
