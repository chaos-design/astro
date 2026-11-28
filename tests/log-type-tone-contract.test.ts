import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const styles = readFileSync(
  new URL("../src/styles.css", import.meta.url),
  "utf8",
);

/**
 * A LOG row's TYPE badge names the very atom the canvas highlights. They used
 * to disagree — the badge was a hardcoded violet while the canvas coloured the
 * same atom by its own tone — which made the two views hard to scan side by
 * side. The tone->colour table is shared; the badge just carries the atom's
 * `tone-*` class.
 */
test("the canvas and the LOG TYPE badge share one tone->colour table", () => {
  // One selector list assigns --type-tone to both the node class and the badge
  // class, so a tone cannot drift between the two surfaces again.
  assert.match(
    styles,
    /\.harness-node--tool,\s*\.atomic-log__type\.tone-tool \{\s*--type-tone: var\(--amber\);/,
  );
  assert.match(
    styles,
    /\.harness-node--signal,\s*\.atomic-log__type\.tone-signal \{\s*--type-tone: var\(--pink\);/,
  );
  // The canvas derives its node colour from that same custom property.
  assert.match(styles, /\.harness-node \{[\s\S]*?--node-tone: var\(--type-tone,/);
});

test("the TYPE badge paints from the shared tone, not a hardcoded colour", () => {
  const start = styles.indexOf(".atomic-log__row .atomic-log__type {");
  assert.notEqual(start, -1, "badge rule must exist");
  const badge = styles.slice(start, styles.indexOf("}", start) + 1);
  assert.match(badge, /color: var\(--type-tone\);/);
  assert.doesNotMatch(badge, /var\(--violet\)/);
  assert.doesNotMatch(badge, /var\(--violet-deep\)/);
});
