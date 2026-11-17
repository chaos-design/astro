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
 *
 * The tone is keyed by the recorded terminal status: a completion ascends, a
 * failure descends in a lower register, and a termination is a neutral double
 * tap — the sound alone tells the reader whether the run succeeded, went
 * wrong, or merely stopped. When several runs finish between two observations
 * the batch plays one sound, chosen by `resolveChimeStatus`.
 */

type AudioContextCtor = new () => AudioContext;

type ChimeNote = {
  frequency: number;
  offset: number;
  duration: number;
};

export type ChimeToneSpec = {
  notes: readonly ChimeNote[];
};

/** Success: the original ascending two-note chime (A5 → D6). */
const COMPLETE_TONE: ChimeToneSpec = {
  notes: [
    { frequency: 880, offset: 0, duration: 0.12 },
    { frequency: 1174.66, offset: 0.14, duration: 0.18 },
  ],
};

/** Failure: a descending minor third in a lower register (C5 → G#4). */
const FAILED_TONE: ChimeToneSpec = {
  notes: [
    { frequency: 523.25, offset: 0, duration: 0.14 },
    { frequency: 415.3, offset: 0.16, duration: 0.2 },
  ],
};

/**
 * Termination: two identical taps. A run that merely stopped is neither a
 * success nor a failure, so the tone carries no rising or falling contour.
 */
const TERMINATED_TONE: ChimeToneSpec = {
  notes: [
    { frequency: 659.33, offset: 0, duration: 0.09 },
    { frequency: 659.33, offset: 0.15, duration: 0.09 },
  ],
};

const CHIME_TONES: Record<"complete" | "failed" | "terminated", ChimeToneSpec> =
  {
    complete: COMPLETE_TONE,
    failed: FAILED_TONE,
    terminated: TERMINATED_TONE,
  };

/**
 * The one tone lookup for a terminal status. Live statuses never reach the
 * player, and an unforeseen recorded status gets the neutral tone rather
 * than being announced as a success.
 */
export function getChimeTone(status: TraceRunStatus): ChimeToneSpec {
  if (status === "complete" || status === "failed" || status === "terminated") {
    return CHIME_TONES[status];
  }
  return TERMINATED_TONE;
}

// One sound per streamed batch: the tone announces the most important outcome.
// A failure is the one the reader must not miss, so it outranks a plain stop
// and a success.
const CHIME_STATUS_PRIORITY = new Map<TraceRunStatus, number>([
  ["failed", 0],
  ["terminated", 1],
  ["complete", 2],
]);

export function resolveChimeStatus(
  statuses: readonly TraceRunStatus[],
): TraceRunStatus {
  let winner: TraceRunStatus = "terminated";
  let rank = Number.POSITIVE_INFINITY;
  for (const status of statuses) {
    const candidate = CHIME_STATUS_PRIORITY.get(status) ?? 1;
    if (candidate < rank) {
      rank = candidate;
      winner = status;
    }
  }
  return winner;
}

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
 * Play the chime for a terminal status (default: the success tone).
 * Best-effort by design: an unsupported browser, a blocked autoplay policy,
 * or a closed context must never throw into the render path. A suspended
 * context is resumed, so a reader who has already interacted with the page
 * hears the notification normally.
 */
export function playTaskCompletionChime(status: TraceRunStatus = "complete"): void {
  const context = getAudioContext();
  if (!context) {
    return;
  }
  try {
    if (context.state === "suspended") {
      void context.resume();
    }
    const start = context.currentTime;
    for (const note of getChimeTone(status).notes) {
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

export type TerminalTransition = {
  key: string;
  /** The recorded terminal status the run reached. */
  status: TraceRunStatus;
};

export type TerminalTransitions = {
  /** Runs that became terminal on this observation, in session order. */
  newlyTerminal: TerminalTransition[];
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
  const newlyTerminal: TerminalTransition[] = [];
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
      newlyTerminal.push({ key: run.key, status: run.status });
    }
  }
  return { newlyTerminal, nextKnown };
}
