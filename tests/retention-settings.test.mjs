import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const dialog = readFileSync(
  fileURLToPath(new URL("../src/components/settings-dialog.tsx", import.meta.url)),
  "utf8",
);

/**
 * The retention switch is a two-step action: the first click fetches a preview
 * and the confirm block must stay on screen until the reader acts on it. The
 * regression here is a state machine that once rendered that block on the
 * in-flight flag alone: the flag ended the moment the preview arrived, so the
 * block vanished with it and the switch could never be turned on.
 */
test("the confirm block stays until the reader confirms, cancels or closes the switch", () => {
  // `awaiting` spans the whole two-step enable — it is set on the switch
  // click, and only the confirm, the cancel or the switch itself ends it.
  assert.match(dialog, /const \[awaiting, setAwaiting\] = useState\(false\);/);
  assert.match(dialog, /setAwaiting\(true\);/);
  assert.match(
    dialog,
    /\{!retention\.enabled && awaiting \? \(/,
    "the confirm block renders on `awaiting`, not on the in-flight flag",
  );
  // The preview arriving must NOT end the enable flow.
  assert.doesNotMatch(
    dialog,
    /setPreview\(next\);\s*\n\s*setAwaiting\(false\);\s*\n\s*\}\s*\n\s*\}\)\s*\n\s*\.catch/,
    "a fetched preview must not close the confirm block",
  );
  // Every explicit exit: cancel, confirm, a failed preview, or the switch.
  assert.match(dialog, /onClick=\{\(\) => \{\s*\n\s*setAwaiting\(false\);\s*\n\s*setPreview\(null\);/);
  assert.match(dialog, /onChange\(\{ \.\.\.retention, enabled: true \}\);\s*\n\s*setAwaiting\(false\);/);
  assert.match(dialog, /\.catch\(\(reason: unknown\) => \{\s*\n\s*setAwaiting\(false\);/);
  assert.match(
    dialog,
    /onChange\(\{ \.\.\.retention, enabled: false \}\);\s*\n\s*setAwaiting\(false\);/,
  );
});

test("an empty preview enables in one step, a failed one never enables silently", () => {
  // `next` must exist and be genuinely empty: a request that resolved to
  // nothing (or a payload the client rejected) is an error path, and silently
  // flipping the switch on an error hides the failure from the reader.
  assert.match(
    dialog,
    /if \(next && next\.eventFiles === 0\) \{/,
    "auto-enable requires a real preview with zero candidates",
  );
  assert.doesNotMatch(dialog, /if \(!next \|\| next\.eventFiles === 0\)/);
});

test("the preview follows the window while the enable flow is active", () => {
  // Changing 15 → 30 days while the confirm block is open must refresh the
  // count, so the effect has to run while `awaiting` too — not only while
  // enabled or mid-fetch.
  assert.match(
    dialog,
    /\}, \[awaiting, onPreview, retention\.days, retention\.enabled\]\);/,
  );
  assert.match(dialog, /if \(!retention\.enabled && !awaiting\) \{\s*\n\s*return;/);
});

test("the error line names the request, not just the preview", () => {
  // A failed prune reported "preview failed", which sent the reader looking
  // at the wrong step.
  assert.match(dialog, /清理请求失败：\{error\}/);
  assert.doesNotMatch(dialog, /清理预览失败：\{error\}/);
});
