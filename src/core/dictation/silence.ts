// When to stop listening: once the person has spoken and then stopped.
//
// ⚠️ « et le mode silence — il détecte la fin quand l'utilisateur arrête de parler ». The microphone
// had to be pressed a second time to end a dictation. This decides it from the loudness the extension
// already reads off the recording as it grows (`dictationLevel`): the room's own noise is learned
// first, a voice is anything well above it, and once a voice has been heard a stretch of quiet that
// lasts long enough ends the recording.
//
// Nothing ends before a voice has been heard: someone who presses the microphone and then thinks for
// five seconds must not lose the recording. And the floor follows the room — a fan, a laptop, an open
// window — rather than a fixed threshold that a quiet office and a noisy one would both get wrong.

/** How loud one reading is: the RMS of the samples read since the last one, from 0 to 1. */
export type Loudness = number;

export interface SilenceOptions {
  /** Quiet after speech that ends the recording, in milliseconds. */
  silenceMs: number;
  /** How far above the room's noise a voice is, as a ratio of RMS. */
  voiceRatio?: number;
  /** A voice is never quieter than this, whatever the room: an absolute RMS floor. */
  minVoice?: number;
}

/** Readings that teach the room's noise before anything is decided — about half a second at 120 ms. */
const LEARN_READINGS = 4;

export class SilenceDetector {
  private floor = Infinity;
  private readings = 0;
  private heard = false;
  private quietSince: number | undefined;
  private readonly ratio: number;
  private readonly minVoice: number;

  constructor(private readonly opts: SilenceOptions) {
    this.ratio = opts.voiceRatio ?? 3;
    this.minVoice = opts.minVoice ?? 0.012;
  }

  /** Whether a voice has been heard yet. */
  get spoke(): boolean {
    return this.heard;
  }

  /**
   * Whether the recording held no voice at all, as far as can be told: enough readings came in to
   * know the room, and none of them was a voice. False when too little was read to say — a recorder
   * that only writes its file at the end sends nothing, and its recording must still be transcribed.
   *
   * ⚠️ Noise with no voice in it is where the recogniser invents: measured with whisper.cpp in French,
   * `*musique*`, `[bruits de la salle]`, and with no language hint `1/2 %, 1/2 %` or a sentence in Korean.
   * A recording known to hold no voice is not sent to it at all.
   */
  get heardNothing(): boolean {
    return this.readings > LEARN_READINGS + 2 && !this.heard;
  }

  /**
   * One reading, taken at `at` (milliseconds). True when the recording should stop now: a voice was
   * heard, and it has been quiet for `silenceMs` since.
   */
  push(rms: Loudness, at: number): boolean {
    this.readings++;
    const voice = Math.max(this.minVoice, this.floor * this.ratio);
    const loud = this.readings > LEARN_READINGS && rms >= voice;
    // The room's noise, from the quiet readings only, so a voice never raises it: down at once to a
    // quieter reading, up slowly — a fan that starts is learned, a breath is not.
    if (!loud) this.floor = !Number.isFinite(this.floor) || rms < this.floor ? rms : this.floor + (rms - this.floor) * 0.05;
    if (loud) {
      this.heard = true;
      this.quietSince = undefined;
      return false;
    }
    if (!this.heard) return false;
    this.quietSince ??= at;
    return at - this.quietSince >= this.opts.silenceMs;
  }
}
