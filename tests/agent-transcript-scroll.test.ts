import assert from "node:assert/strict";
import test from "node:test";

import {
  AGENT_SCROLL_BOTTOM_EPSILON,
  AGENT_SCROLL_HIDDEN_STEP_THRESHOLD,
  followAfterAppend,
  isAgentTranscriptAtBottom,
  isFollowingNewestStep,
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

/**
 * The one generous rule the append pin and the selection effects read live
 * from the DOM when a batch lands: a stale cached flag must never let a
 * programmatic pin undo a reader's in-flight wheel.
 */
test("a batch may follow at the bottom or while the newest step is on screen", () => {
  const container = viewport(700);
  const view = { top: 0, bottom: 300 };
  assert.equal(
    isFollowingNewestStep(container, view, { top: 250, bottom: 900 }),
    true,
    "the exact bottom is the follow position whatever the step rect says",
  );
  assert.equal(
    isFollowingNewestStep(viewport(300), view, { top: 250, bottom: 900 }),
    true,
    "a tall last reply still being read keeps following above the bottom edge",
  );
  assert.equal(
    isFollowingNewestStep(viewport(300), view, { top: 420, bottom: 900 }),
    false,
    "the newest step off-screen means the reader detached and the batch only counts",
  );
  assert.equal(
    isFollowingNewestStep(viewport(300), view, { top: -400, bottom: -20 }),
    false,
    "the newest step above the viewport is detached too — no gesture, no scroll",
  );
  assert.equal(
    isFollowingNewestStep(viewport(300), view, null),
    true,
    "an unmeasurable newest step keeps the optimistic follow",
  );
});

/**
 * A newly appended card grows `scrollHeight` and puts the last step just below
 * the viewport, so the raw post-append rule says "detached" for a reader who
 * never scrolled. The observed snapshot distinguishes growth from a gesture.
 */
test("an append under a reader at the tail keeps following", () => {
  const observed = { scrollTop: 700, following: true };
  // Post-append geometry: same scrollTop, taller content, last step out of
  // view — `isFollowingNewestStep` alone would report false here.
  const grown = { scrollTop: 700, clientHeight: 300, scrollHeight: 1100 };
  assert.equal(isFollowingNewestStep(grown, { top: 700, bottom: 1000 }, {
    top: 1000,
    bottom: 1120,
  }), false);
  assert.equal(
    followAfterAppend(false, grown.scrollTop, observed),
    true,
    "content growth with no scroll move resumes the follow",
  );
});

test("a reader who scrolled away is never re-captured by an append", () => {
  const observed = { scrollTop: 700, following: true };
  // The wheel already moved scrollTop (its rAF has not run yet) or the reader
  // was detached at the last observation — neither may be overridden.
  assert.equal(followAfterAppend(false, 640, observed), false);
  assert.equal(
    followAfterAppend(false, 700, { scrollTop: 700, following: false }),
    false,
  );
  // A genuinely following reader is still followed when the live rule agrees.
  assert.equal(followAfterAppend(true, 640, observed), true);
});
