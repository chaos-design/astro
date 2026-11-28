/**
 * Scroll bookkeeping for the Agent view's single scroll container.
 *
 * Keeping the bottom test here (instead of inline in the component) makes the
 * threshold a named, testable rule: a reader who is a few pixels short of the
 * last step is still "at the bottom", so a streamed batch may keep following
 * without yanking them. Whether the newest step is in the reader's viewport
 * drives the centered affordance: it stays hidden while the newest message is
 * visible and appears — as a loading pill while the run executes, as a plain
 * quick-scroll button after it ends — only once that step has left the view by
 * more than the threshold. Scroll direction is never consulted: the control
 * answers "is the newest message still on screen", not "which way did the
 * reader last wheel".
 */
export const AGENT_SCROLL_BOTTOM_EPSILON = 24;

/**
 * How far the newest step must sit *outside* the viewport before the centered
 * jump pill offers itself. A few pixels of overlap still count as "the reader
 * is looking at the newest message" (live follow keeps pinning, the pill stays
 * out of the way); once the whole step is out of view by this much, the reader
 * is reading history and the jump reads as available. It is a position rule —
 * the reader can arrive up there scrolling up, scrolling down or through an
 * explicit locate — so the pill never flickers with the last wheel direction.
 */
export const AGENT_SCROLL_HIDDEN_STEP_THRESHOLD = 64;

export function isAgentTranscriptAtBottom(element: {
  readonly clientHeight: number;
  readonly scrollHeight: number;
  readonly scrollTop: number;
}): boolean {
  return (
    element.scrollHeight - element.scrollTop - element.clientHeight <=
    AGENT_SCROLL_BOTTOM_EPSILON
  );
}

/**
 * Whether the newest step is anywhere in the reader's viewport. Being within a
 * few pixels of the bottom is only an approximation: a tall last reply can
 * still be on screen while the scroll position is well above the bottom. Live
 * following uses this generous test so it keeps pinning while the reader is
 * reading that reply.
 */
export function isLatestStepVisible(
  viewport: { readonly top: number; readonly bottom: number },
  step: { readonly top: number; readonly bottom: number },
): boolean {
  return step.bottom > viewport.top && step.top < viewport.bottom;
}

/**
 * Whether a streamed batch may keep following the tail: the reader is within a
 * few pixels of the bottom, or the newest step is still anywhere in the
 * viewport (a tall last reply can be on screen well above the bottom edge).
 * This is the one generous rule behind live pinning — the append pin / selection
 * effects read it live from the DOM at the moment a batch lands, so a batch
 * arriving between a wheel gesture and its rAF cannot undo the reader with a
 * stale flag. The component pairs this live verdict with a snapshot taken at
 * the last *observed* scroll position so a newly appended card (which grows
 * `scrollHeight` and pushes the last step below the edge) is not mistaken for
 * a reader who scrolled away. An unmeasurable newest step keeps the optimistic
 * follow.
 */
export function isFollowingNewestStep(
  container: {
    readonly clientHeight: number;
    readonly scrollHeight: number;
    readonly scrollTop: number;
  },
  viewport: { readonly top: number; readonly bottom: number },
  lastStep: { readonly top: number; readonly bottom: number } | null,
): boolean {
  if (isAgentTranscriptAtBottom(container)) {
    return true;
  }
  if (!lastStep) {
    return true;
  }
  return isLatestStepVisible(viewport, lastStep);
}

/**
 * Tie-breaker for a batch that appended under a reader who never scrolled.
 *
 * `isFollowingNewestStep` reads the *post-append* DOM: a new card grows
 * `scrollHeight` and pushes the last step just below the viewport edge, so the
 * raw rule reports "detached" for a reader who is still pinned to the tail.
 * The component records the posture at the last *observed* scroll position;
 * if `scrollTop` has not moved since then and the reader was following, the
 * change is content growth, not a gesture — keep following. A real wheel
 * gesture changes `scrollTop`, so this tie-breaker can never override it.
 */
export function followAfterAppend(
  following: boolean,
  scrollTop: number,
  observed: { readonly scrollTop: number; readonly following: boolean },
): boolean {
  return following || (scrollTop === observed.scrollTop && observed.following);
}

/**
 * How many pixels of the newest step are completely outside the viewport.
 * Zero while any part of it is on screen, so a reader in the middle of a tall
 * live reply is never offered a jump away from the message they are reading.
 * Only when the step has left the view does the distance grow; that is the one
 * signal the centered pill uses, independent of how the reader got there.
 */
export function latestStepHiddenOutside(
  viewport: { readonly top: number; readonly bottom: number },
  step: { readonly top: number; readonly bottom: number },
): number {
  return Math.max(0, viewport.top - step.bottom, step.top - viewport.bottom);
}
