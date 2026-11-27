import assert from "node:assert/strict";
import test from "node:test";

import {
  AGENT_SCROLL_BOTTOM_EPSILON,
  AGENT_SCROLL_HIDDEN_STEP_THRESHOLD,
  isAgentTranscriptAtBottom,
  isLatestStepVisible,
  latestStepHiddenOutside,
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
    "one pixel past the threshold is no longer the bottom",
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

test("the newest step on screen hides the jump even above the bottom edge", () => {
  const view = { top: 100, bottom: 400 };
  // A tall last reply is visible in the viewport although the scroll
  // position is far from the end of the content.
  assert.equal(
    isLatestStepVisible(view, { top: 250, bottom: 900 }),
    true,
    "part of the newest step is on screen",
  );
  assert.equal(
    isLatestStepVisible(view, { top: 420, bottom: 900 }),
    false,
    "the newest step has scrolled below the viewport",
  );
  assert.equal(
    isLatestStepVisible(view, { top: -50, bottom: 90 }),
    false,
    "the newest step has scrolled above the viewport",
  );
});

test("the jump measures how far the newest step left the viewport, not wheel direction", () => {
  const view = { top: 100, bottom: 400 };
  assert.equal(
    latestStepHiddenOutside(view, { top: 250, bottom: 900 }),
    0,
    "a tall reply still being read never arms the pill",
  );
  assert.equal(
    latestStepHiddenOutside(view, { top: 400 + AGENT_SCROLL_HIDDEN_STEP_THRESHOLD, bottom: 900 }),
    AGENT_SCROLL_HIDDEN_STEP_THRESHOLD,
    "a step just at the threshold is still within tolerance",
  );
  assert.equal(
    latestStepHiddenOutside(view, { top: 400 + AGENT_SCROLL_HIDDEN_STEP_THRESHOLD + 1, bottom: 900 }),
    AGENT_SCROLL_HIDDEN_STEP_THRESHOLD + 1,
    "one pixel past the threshold arms it, whichever way the reader scrolled",
  );
  assert.equal(
    latestStepHiddenOutside(view, { top: -300, bottom: 100 - AGENT_SCROLL_HIDDEN_STEP_THRESHOLD - 1 }),
    AGENT_SCROLL_HIDDEN_STEP_THRESHOLD + 1,
    "the same rule applies above the viewport",
  );
  assert.ok(
    AGENT_SCROLL_HIDDEN_STEP_THRESHOLD > AGENT_SCROLL_BOTTOM_EPSILON,
    "the jump threshold sits well clear of the follow epsilon",
  );
});
