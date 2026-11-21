import type { TraceRunStatus } from "../types/trace";
import { defaultChimeStyle, type ChimeStyleId } from "../config/app-config.ts";
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
 * A style (Settings → 通知, persisted as `ASTROX_CHIME_STYLE`) picks the
 * timbre — waveform, loudness, attack and the note patterns themselves. What
 * a style may never change is the contour rule that makes the sound readable
 * without looking: within every style a completion ascends, a failure
 * descends in a lower register, and a termination is a neutral double tap.
 * When several runs finish between two observations the batch plays one
 * sound, chosen by `resolveChimeStatus`.
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

type ChimeStatusKey = "complete" | "failed" | "terminated";

/**
 * Render parameters shared by every tone of one style: the oscillator
 * timbre, the peak gain (the style's loudness) and the attack ramp (how
 * percussive the onset is — a short attack with an exponential decay avoids
 * the click of a hard start/stop).
 */
type ChimeStyleSpec = {
  wave: OscillatorType;
  gain: number;
  attack: number;
  tones: Record<ChimeStatusKey, ChimeToneSpec>;
};

/** 清脆 — the original bright sine chime. */
const BRIGHT_STYLE: ChimeStyleSpec = {
  wave: "sine",
  gain: 0.12,
  attack: 0.015,
  tones: {
    /** Success: the ascending two-note chime (A5 → D6). */
    complete: {
      notes: [
        { frequency: 880, offset: 0, duration: 0.12 },
        { frequency: 1174.66, offset: 0.14, duration: 0.18 },
      ],
    },
    /** Failure: a descending minor third in a lower register (C5 → G#4). */
    failed: {
      notes: [
        { frequency: 523.25, offset: 0, duration: 0.14 },
        { frequency: 415.3, offset: 0.16, duration: 0.2 },
      ],
    },
    /**
     * Termination: two identical taps. A run that merely stopped is neither a
     * success nor a failure, so the tone carries no rising or falling contour.
     */
    terminated: {
      notes: [
        { frequency: 659.33, offset: 0, duration: 0.09 },
        { frequency: 659.33, offset: 0.15, duration: 0.09 },
      ],
    },
  },
};

/** 柔和 — a warmer, quieter marimba-like tone with slower onsets and decays. */
const SOFT_STYLE: ChimeStyleSpec = {
  wave: "triangle",
  gain: 0.09,
  attack: 0.03,
  tones: {
    /** Success: E5 → A5, a gentle ascending fourth. */
    complete: {
      notes: [
        { frequency: 659.25, offset: 0, duration: 0.16 },
        { frequency: 880, offset: 0.18, duration: 0.26 },
      ],
    },
    /** Failure: B4 → G4, a descending third in the middle register. */
    failed: {
      notes: [
        { frequency: 493.88, offset: 0, duration: 0.18 },
        { frequency: 392, offset: 0.2, duration: 0.28 },
      ],
    },
    /** Termination: two identical soft taps on A4. */
    terminated: {
      notes: [
        { frequency: 440, offset: 0, duration: 0.12 },
        { frequency: 440, offset: 0.17, duration: 0.12 },
      ],
    },
  },
};

/** 脉冲 — short percussive square blips, closer to a ticker than a bell. */
const PULSE_STYLE: ChimeStyleSpec = {
  wave: "square",
  gain: 0.055,
  attack: 0.004,
  tones: {
    /** Success: C6 → G6, two fast ascending blips. */
    complete: {
      notes: [
        { frequency: 1046.5, offset: 0, duration: 0.07 },
        { frequency: 1568, offset: 0.09, duration: 0.11 },
      ],
    },
    /** Failure: E5 → B4, two fast descending blips. */
    failed: {
      notes: [
        { frequency: 659.25, offset: 0, duration: 0.08 },
        { frequency: 493.88, offset: 0.1, duration: 0.12 },
      ],
    },
    /** Termination: two identical short taps on A5. */
    terminated: {
      notes: [
        { frequency: 880, offset: 0, duration: 0.05 },
        { frequency: 880, offset: 0.12, duration: 0.05 },
      ],
    },
  },
};

/**
 * The one style table. Keyed by `ChimeStyleId` (whose option list lives in
 * `app-config.ts` beside the other preference options); tests pin the two
 * lists to each other so a new id cannot be added to one and forgotten in
 * the other.
 */
const CHIME_STYLE_SPECS: Record<ChimeStyleId, ChimeStyleSpec> = {
  bright: BRIGHT_STYLE,
  soft: SOFT_STYLE,
  pulse: PULSE_STYLE,
};

/**
 * The one tone lookup for a terminal status within a style. Live statuses
 * never reach the player, and an unforeseen recorded status gets the
 * style's neutral tone rather than being announced as a success. An unknown
 * style id (an older build reading a newer value) falls back to the default
 * style instead of staying silent.
 */
export function getChimeTone(
  status: TraceRunStatus,
  style: ChimeStyleId = defaultChimeStyle,
): ChimeToneSpec {
  const spec = CHIME_STYLE_SPECS[style] ?? CHIME_STYLE_SPECS[defaultChimeStyle];
  if (status === "complete" || status === "failed" || status === "terminated") {
    return spec.tones[status];
  }
  return spec.tones.terminated;
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
 * Play the chime for a terminal status (default: the success tone of the
 * default style). Best-effort by design: an unsupported browser, a blocked
 * autoplay policy, or a closed context must never throw into the render
 * path. A suspended context is resumed, so a reader who has already
 * interacted with the page hears the notification normally.
 */
export function playTaskCompletionChime(
  status: TraceRunStatus = "complete",
  style: ChimeStyleId = defaultChimeStyle,
): void {
  const context = getAudioContext();
  if (!context) {
    return;
  }
  const spec = CHIME_STYLE_SPECS[style] ?? CHIME_STYLE_SPECS[defaultChimeStyle];
  try {
    if (context.state === "suspended") {
      void context.resume();
    }
    const start = context.currentTime;
    for (const note of getChimeTone(status, style).notes) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = spec.wave;
      oscillator.frequency.value = note.frequency;
      const begin = start + note.offset;
      const end = begin + note.duration;
      // A short attack and an exponential decay avoid the click of a hard
      // start/stop while keeping the whole sound short.
      gain.gain.setValueAtTime(0.0001, begin);
      gain.gain.exponentialRampToValueAtTime(spec.gain, begin + spec.attack);
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
