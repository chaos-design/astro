/**
 * Scroll bookkeeping for the Agent view's single scroll container.
 *
 * Keeping the bottom test here (instead of inline in the component) makes the
 * threshold a named, testable rule: a reader who is a few pixels short of the
 * last step is still "at the bottom", so a streamed batch may keep following
 * without yanking them, while a reader who scrolled up keeps their position
 * and gets the jump-to-latest affordance.
 */
export const AGENT_SCROLL_BOTTOM_EPSILON = 24;

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
 * Only a scroll that moves the reader *up* reveals the jump pill. Programmatic
 * positioning records its destination as the previous top, so locating a step
 * or pinning a live batch can never be mistaken for a manual scroll back.
 */
export function isManualUpScroll(
  currentTop: number,
  previousTop: number,
): boolean {
  return currentTop < previousTop - 1;
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
