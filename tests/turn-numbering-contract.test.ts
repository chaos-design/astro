import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../src/app.tsx", import.meta.url), "utf8");

/**
 * The LOG renders one Prompt run, and turn numbers are part of that run's
 * identity — but the separators must be keyed by position, never by the number.
 *
 * A value key collides as soon as two groups repeat a number, which a restarted
 * counter (or the oscillating numbering the old index produced) does routinely.
 * React then leaves the earlier node in the DOM as an orphan: after switching
 * from DeepSeek to another agent the pane showed a stack of `TURN 01` chips
 * with no rows under them, and the stale `TURN 05` of the previous agent above
 * the new rows. Both were that orphan, not real entries.
 */
test("turn separators are keyed by position, never by their number", () => {
  assert.match(app, /key=\{`turn-\$\{item\.entryIndex\}`\}/);
  assert.doesNotMatch(app, /key=\{`turn-\$\{item\.turn\}`\}/);
});

test("the LOG derives its separators from the run it renders", () => {
  // `platformId` only selects the atom TYPE lookup table; the turn index is
  // still built inside buildLogEntries from the very events the LOG renders.
  assert.match(app, /buildLogEntries\(events, platformId\)/);
  assert.doesNotMatch(
    app,
    /buildLogEntries\([^)]*turnByEventId/,
    "the separators must follow the rendered run, not a map from another scope",
  );
});
