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
