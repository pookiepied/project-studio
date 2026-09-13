/**
 * Where one dictation segment ends and the next begins.
 *
 * Live dictation is the recording cut into segments while the person is
 * still speaking, each posted to the transcriber as soon as it is cut, so
 * the words arrive with the lag of one segment rather than of the whole
 * take. The cut is decided here, from the same smoothed level the waveform
 * paints, and nowhere else: the microphone hook asks this once per frame and
 * rotates its recorder when the answer is yes.
 *
 * A cut happens at a pause - `PAUSE_MS` of level under `SPEECH_LEVEL` after
 * speech was heard - because a pause is where a sentence ends, and a segment
 * cut there transcribes as a sentence rather than as a word in two halves. A
 * segment that has run `SEGMENT_CEILING_MS` without a pause is cut anyway, so
 * a person who does not pause still sees text arrive. A segment shorter than
 * `SEGMENT_MIN_MS` is never cut, because a fifty-millisecond file is a
 * container header and nothing else. Silence alone never cuts: a room with
 * nobody speaking in it is one segment, however long, and its transcript is
 * empty.
 *
 * Pure on purpose. The audio graph is where this is used; a scripted level is
 * how it is tested.
 */

/** A smoothed level at or above this counts as speech. Ordinary speech sits well above. */
export const SPEECH_LEVEL = 0.06
/** How long a level under `SPEECH_LEVEL` must last, after speech, to be a pause. */
export const PAUSE_MS = 700
/** A segment that has not paused by this long is cut regardless. */
export const SEGMENT_CEILING_MS = 12_000
/** No segment shorter than this is cut: it would be a header and no audio. */
export const SEGMENT_MIN_MS = 1_000

export class SegmentCutter {
  #elapsedMs = 0
  #silenceMs = 0
  #spoke = false

  /**
   * One frame of level. Returns true when the current segment should end
   * here; the caller cuts, and this resets for the next one.
   */
  observe(level: number, dtMs: number): boolean {
    this.#elapsedMs += dtMs
    if (level >= SPEECH_LEVEL) {
      this.#spoke = true
      this.#silenceMs = 0
    } else {
      this.#silenceMs += dtMs
    }

    if (!this.#spoke || this.#elapsedMs < SEGMENT_MIN_MS) return false
    const paused = this.#silenceMs >= PAUSE_MS
    const overlong = this.#elapsedMs >= SEGMENT_CEILING_MS
    if (!paused && !overlong) return false
    this.reset()
    return true
  }

  /** Whether speech has been heard in the current segment. */
  get spoke(): boolean {
    return this.#spoke
  }

  reset(): void {
    this.#elapsedMs = 0
    this.#silenceMs = 0
    this.#spoke = false
  }
}
