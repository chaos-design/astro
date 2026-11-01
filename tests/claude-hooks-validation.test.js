import assert from "node:assert/strict";
import test from "node:test";
import { validateClaudeHooks } from "../scripts/validate-claude-hooks.mjs";

test("executes every Claude plugin hook through the packaged recorder", () => {
  const result = validateClaudeHooks();

  // 17 hooks: the 16 lifecycle hooks plus the auto-mode PermissionDenied
  // rejection hook that reports the fourth exception scope.
  assert.equal(result.eventCount, 17);
});
