import type { RhubarbLetter } from "@asset-studio/formats";

export type MouthCue = {
  start: number;
  end: number;
  value: RhubarbLetter;
};

export const REST_LETTER: RhubarbLetter = "X";

/**
 * The mouth letter to show at `time` seconds of the audio: the latest cue
 * starting at or before `time`, held until that cue's `end`. `X` (REST)
 * before the first cue, after a cue's end, and once the audio has ended.
 * `cues` must be in order (asset contract rule 6).
 */
export function letterAt(
  cues: readonly MouthCue[],
  time: number,
  ended = false,
): RhubarbLetter {
  if (ended || !Number.isFinite(time)) return REST_LETTER;
  let lo = 0;
  let hi = cues.length - 1;
  let found: MouthCue | undefined;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const cue = cues[mid];
    if (cue === undefined) break;
    if (cue.start <= time) {
      found = cue;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (found === undefined || time >= found.end) return REST_LETTER;
  return found.value;
}

export type ClockAudio = {
  readonly currentTime: number;
  readonly paused: boolean;
  readonly ended: boolean;
};

export type FrameScheduler = {
  request(callback: () => void): number;
  cancel(id: number): void;
};

/**
 * Samples `audio.currentTime` once per frame while the audio plays and
 * reports the mouth letter whenever it changes. The audio element is the only
 * clock: pause, seek, buffering and rate changes all move `currentTime`.
 */
export function createMouthClock(options: {
  audio: ClockAudio;
  cues: () => readonly MouthCue[];
  onLetter: (letter: RhubarbLetter) => void;
  scheduler: FrameScheduler;
}) {
  const { audio, scheduler } = options;
  let frame: number | null = null;
  let last: RhubarbLetter | null = null;

  const sample = () => {
    const letter = letterAt(options.cues(), audio.currentTime, audio.ended);
    if (letter !== last) {
      last = letter;
      options.onLetter(letter);
    }
  };
  const tick = () => {
    frame = null;
    sample();
    if (!audio.paused && !audio.ended) frame = scheduler.request(tick);
  };
  const stop = () => {
    if (frame !== null) scheduler.cancel(frame);
    frame = null;
  };

  return {
    /** Starts the per-frame loop; it stops by itself once the audio pauses or ends. */
    start() {
      if (frame === null) tick();
    },
    /** One sample without starting the loop (after a pause or seek). */
    sample,
    stop,
  };
}
