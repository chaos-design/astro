import assert from "node:assert/strict";
import test from "node:test";

import {
  AGENT_SCROLL_BOTTOM_EPSILON,
  isAgentTranscriptAtBottom,
} from "../src/lib/agent-transcript-scroll.ts";

function viewport(scrollTop: number) {
  return { scrollTop, clientHeight: 300, scrollHeight: 1000 };
}

test("a reader at the end stays pinned and sees no jump affordance", () => {
  assert.equal(
    isAgentTranscriptAtBottom(viewport(700)),
    true,
    "exact bottom is the follow position",
  );
  assert.equal(
    isAgentTranscriptAtBottom(viewport(700 - AGENT_SCROLL_BOTTOM_EPSILON)),
    true,
    "a few pixels of rounding must not break live follow",
  );
});

test("scrolling back through the chain releases the follow position", () => {
  assert.equal(isAgentTranscriptAtBottom(viewport(0)), false);
  assert.equal(
    isAgentTranscriptAtBottom(viewport(700 - AGENT_SCROLL_BOTTOM_EPSILON - 1)),
    false,
    "one pixel past the threshold is a deliberate scroll up",
  );
});

test("content shorter than the viewport is always at the bottom", () => {
  assert.equal(
    isAgentTranscriptAtBottom({
      scrollTop: 0,
      clientHeight: 600,
      scrollHeight: 300,
    }),
    true,
  );
});
