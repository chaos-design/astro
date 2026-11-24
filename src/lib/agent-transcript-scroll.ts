/**
 * Scroll bookkeeping for the Agent view's single scroll container.
 *
 * Keeping the bottom test here (instead of inline in the component) makes the
 * threshold a named, testable rule: a reader who is a few pixels short of the
 * last step is still "at the bottom", so a streamed batch may keep following
 * without yanking them. Whether the newest step is in the reader's viewport
 * drives the centered affordance: it stays hidden while the newest message is
 * visible and appears — as a loading pill while the run executes, as a plain
 * quick-scroll button after it ends — only once that step has scrolled out of
 * view. A manual upward gesture is one way the step leaves the viewport, not a
 * gate of its own: programmatic locating of an older step scrolls it away too.
 */
export const AGENT_SCROLL_BOTTOM_EPSILON = 24;

/**
 * How far above the bottom a reader must sit before the centered jump pill
 * offers itself. A few pixels short of the last step is still "the bottom"
 * (live follow keeps pinning, the pill stays out of the way); a deliberate
 * scroll up past this line is a request to read history, and the pill shows.
 * It is a position rule, not a gesture one — the reader can arrive up there
 * scrolling up *or* settle there scrolling down; what matters is the
 * distance from the bottom, so the pill never flickers with the last wheel
 * direction.
 */
export const AGENT_SCROLL_JUMP_THRESHOLD = 64;

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
 * Whether the newest step is in the reader's viewport. Being within a few
 * pixels of the bottom is only an approximation: a tall last reply can still
 * be on screen while the scroll position is well above the bottom. The jump
 * pill must stay hidden whenever the newest message is visible — the reader
 * is already looking at it — and only appear once it has scrolled out of view.
 */
export function isLatestStepVisible(
  viewport: { readonly top: number; readonly bottom: number },
  step: { readonly top: number; readonly bottom: number },
): boolean {
  return step.bottom > viewport.top && step.top < viewport.bottom;
}
