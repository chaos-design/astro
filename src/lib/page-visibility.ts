/**
 * Page-visibility suspension for the console.
 *
 * A hidden tab is not an idle tab: the browser keeps firing (throttled) timers,
 * the SSE connection stays open, and every captured event still re-derives
 * sessions, runs, and flows for a page nobody is looking at. The console
 * therefore suspends itself once the tab has been hidden for a while and
 * replays a fresh snapshot when the reader comes back.
 *
 * The whole app shares one listener and one timer, and only the transition
 * itself does work — there is no polling, no interval, and no timer at all
 * while the tab is visible.
 */

/** Hidden for longer than this and the console stops its live work. */
export const PAGE_SUSPEND_AFTER_HIDDEN_MS = 30_000;

export type PageVisibilitySnapshot = {
  /** The document is not visible right now. */
  hidden: boolean;
  /** Live work is stopped; the next visible transition must refresh. */
  suspended: boolean;
  /** Bumped by every resume, so consumers can refresh exactly once. */
  resumeCount: number;
};

/**
 * The slice of `Document` this monitor needs. Kept structural so tests can
 * drive it with a plain event target instead of a DOM.
 */
export type PageVisibilitySource = {
  readonly visibilityState: string;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
};

export type PageVisibilityMonitor = {
  getSnapshot: () => PageVisibilitySnapshot;
  subscribe: (listener: () => void) => () => void;
};

const visibleSnapshot: PageVisibilitySnapshot = {
  hidden: false,
  suspended: false,
  resumeCount: 0,
};

export function createPageVisibilityMonitor(
  source: PageVisibilitySource | null = typeof document === "undefined"
    ? null
    : document,
  suspendAfterHiddenMs: number = PAGE_SUSPEND_AFTER_HIDDEN_MS,
): PageVisibilityMonitor {
  let snapshot: PageVisibilitySnapshot = source
    ? {
        hidden: source.visibilityState === "hidden",
        suspended: false,
        resumeCount: 0,
      }
    : visibleSnapshot;
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const emit = (next: PageVisibilitySnapshot) => {
    snapshot = next;
    for (const listener of listeners) {
      listener();
    }
  };

  const clearTimer = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  // The delay timer exists only while the tab is hidden: a quick tab switch
  // costs one timeout and nothing else.
  const armSuspension = () => {
    clearTimer();
    timer = setTimeout(() => {
      timer = null;
      if (snapshot.hidden && !snapshot.suspended) {
        emit({ ...snapshot, suspended: true });
      }
    }, Math.max(0, suspendAfterHiddenMs));
  };

  const handleVisibilityChange = () => {
    const hidden = source?.visibilityState === "hidden";
    if (hidden === snapshot.hidden) {
      return;
    }
    if (hidden) {
      emit({ ...snapshot, hidden: true });
      armSuspension();
      return;
    }
    clearTimer();
    if (!snapshot.suspended) {
      emit({ ...snapshot, hidden: false });
      return;
    }
    emit({
      hidden: false,
      suspended: false,
      resumeCount: snapshot.resumeCount + 1,
    });
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1 && source) {
        source.addEventListener("visibilitychange", handleVisibilityChange);
        // A console opened in a background tab never sees a transition.
        if (snapshot.hidden && !snapshot.suspended) {
          armSuspension();
        }
      }
      return () => {
        if (!listeners.delete(listener)) {
          return;
        }
        if (listeners.size === 0) {
          source?.removeEventListener(
            "visibilitychange",
            handleVisibilityChange,
          );
          clearTimer();
        }
      };
    },
  };
}

/**
 * Shared by every consumer (`useSyncExternalStore` requires stable
 * identities), so the app has exactly one listener for its whole lifetime.
 */
const pageVisibilityMonitor = createPageVisibilityMonitor();

export function subscribePageVisibility(listener: () => void): () => void {
  return pageVisibilityMonitor.subscribe(listener);
}

export function getPageVisibilitySnapshot(): PageVisibilitySnapshot {
  return pageVisibilityMonitor.getSnapshot();
}

/** Server/prerender snapshot: never suspend, so no work is gated away early. */
export function getServerPageVisibilitySnapshot(): PageVisibilitySnapshot {
  return visibleSnapshot;
}
