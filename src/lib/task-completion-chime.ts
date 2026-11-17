import type { TraceRunStatus } from "../types/trace";
import { isLiveRunStatus } from "./run-history-state.ts";

/**
 * A short, local notification chime for runs that reach a terminal state.
 *
 * The sound is generated with the Web Audio API instead of shipping an audio
 * asset: the console is a static page that may be served under a project path
 * on a cloud origin, and a two-note beep needs no bundled file or `assetUrl()`.
 * Playback is gated by the Settings → 通知 preference (on by default); this
 * module only ever makes a sound when the caller has checked the stored value.
 */

type AudioContextCtor = new () => AudioContext;

let sharedContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") {
    return null;
  }
  const scopedWindow = window as Window & {
    webkitAudioContext?: AudioContextCtor;
  };
  const Ctor = window.AudioContext ?? scopedWindow.webkitAudioContext;
  if (!Ctor) {
    return null;
  }
  try {
    sharedContext ??= new Ctor();
    return sharedContext;
  } catch {
    return null;
  }
}

/**
 * Play a brief two-note chime. Best-effort by design: an unsupported browser,
 * a blocked autoplay policy, or a closed context must never throw into the
 * render path. A suspended context is resumed, so a reader who has already
 * interacted with the page hears the notification normally.
 */
export function playTaskCompletionChime(): void {
  const context = getAudioContext();
  if (!context) {
    return;
  }
  try {
    if (context.state === "suspended") {
      void context.resume();
    }
    const start = context.currentTime;
    const notes = [
      { frequency: 880, offset: 0, duration: 0.12 },
      { frequency: 1174.66, offset: 0.14, duration: 0.18 },
    ];
    for (const note of notes) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = note.frequency;
      const begin = start + note.offset;
      const end = begin + note.duration;
      // A short attack and an exponential decay avoid the click of a hard
      // start/stop while keeping the whole sound under a fifth of a second.
      gain.gain.setValueAtTime(0.0001, begin);
      gain.gain.exponentialRampToValueAtTime(0.12, begin + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, end);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(begin);
      oscillator.stop(end + 0.02);
    }
  } catch {
    // A notification is an enhancement, never a reason to break the console.
  }
}

type RunStatusSource = {
  key: string;
  status: TraceRunStatus;
};

export type TerminalTransitions = {
  /** Run keys that became terminal on this observation, in session order. */
  newlyTerminal: string[];
  /** Terminal keys to carry into the next observation. */
  nextKnown: Set<string>;
};

/**
 * Pure terminal-transition detection shared by the effect in `app.tsx`.
 *
 * A run is terminal when its recorded status is not live (complete / failed /
 * terminated). Live runs are removed from `knownTerminalKeys` so a session that
 * receives a new prompt can chime again when *that* message finishes — a
 * resumed run does not lose its notification because it was once complete.
 *
 * `seedBaseline` is true for the first observation after events load: runs that
 * were already terminal in the snapshot are recorded without a chime, because
 * the console did not witness them finishing.
 */
export function collectTerminalTransitions(
  runs: readonly RunStatusSource[],
  knownTerminalKeys: ReadonlySet<string>,
  seedBaseline: boolean,
): TerminalTransitions {
  const nextKnown = new Set(knownTerminalKeys);
  const newlyTerminal: string[] = [];
  for (const run of runs) {
    if (isLiveRunStatus(run.status)) {
      nextKnown.delete(run.key);
      continue;
    }
    if (nextKnown.has(run.key)) {
      continue;
    }
    nextKnown.add(run.key);
    if (!seedBaseline) {
      newlyTerminal.push(run.key);
    }
  }
  return { newlyTerminal, nextKnown };
}
