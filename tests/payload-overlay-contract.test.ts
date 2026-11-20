import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const overlay = readFileSync(
  new URL("../src/components/payload-overlay.tsx", import.meta.url),
  "utf8",
);
const app = readFileSync(new URL("../src/app.tsx", import.meta.url), "utf8");

/**
 * The global layer follows the atom's type: a user.question Input tab shows
 * the question / option / answer list the reader saw, while every other tab
 * reads as Markdown. Both must keep using one preview definition each.
 */
test("the overlay switches preview by atom type", () => {
  assert.match(overlay, /variant === "question"/);
  assert.match(overlay, /<QuestionPreview payload=\{payload as TracePayload\} \/>/);
  assert.match(overlay, /USER QUESTION/);
  assert.match(overlay, /dangerouslySetInnerHTML=\{\{ __html: preview\.html \}\}/);
  assert.match(overlay, /<JsonViewer value=\{payload\} \/>/);
});

test("the inspector passes the raw question payload for question atoms", () => {
  const binding = app.slice(
    app.indexOf("<PayloadOverlay"),
    app.indexOf("</section>", app.indexOf("<PayloadOverlay")),
  );
  assert.match(
    binding,
    /activeTab === "input" && questionEvent\s*\? questionEvent\.payload/,
  );
  assert.match(
    binding,
    /variant=\{activeTab === "input" && questionEvent \? "question" : "default"\}/,
  );
});

test("the inspector passes the raw prompt payload so the overlay previews its content", () => {
  const binding = app.slice(
    app.indexOf("<PayloadOverlay"),
    app.indexOf("</section>", app.indexOf("<PayloadOverlay")),
  );
  assert.match(
    binding,
    /activeTab === "input" && promptEvent\s*\? promptEvent\.payload/,
  );
});

test("opening the overlay always shows the rendered preview, not a stale Code mode", () => {
  assert.match(overlay, /if \(open\) \{\s*setViewMode\("preview"\);\s*\}/);
});
