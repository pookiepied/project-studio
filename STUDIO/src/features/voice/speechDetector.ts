/**
 * Telling a voice from a noise, cheaply, one analyser frame at a time.
 *
 * Loudness alone cannot: a clap, a dropped cup and a keyboard are as loud as
 * a word. Two facts about speech separate them without a model. Its energy
 * sits in the voice band (roughly 250-3500 Hz) rather than spread across the
 * spectrum, and voiced sounds are harmonic - a comb of peaks over the pitch -
 * so the band's spectrum is far from flat, where noise and transients are
 * close to flat. And speech lasts: a word holds for hundreds of milliseconds
 * where a clap is gone in tens. `voicedFrame` answers the first two per
 * frame; `SpeechGate` adds the third over time.
 *
 * It is a filter in front of a check, not the last word: a sound it lets
 * through only pauses Studio, and the transcription decides whether anything
 * was said (see `useVoiceSession`'s soft interrupt).
 */

/** The share of the 80-8000 Hz energy that must sit in the voice band. */
const BAND_SHARE = 0.55
/** The voice band's spectral flatness above which a frame reads as noise. */
const MAX_FLATNESS = 0.3

/** Whether one frame of the analyser's spectrum (dB per bin) looks like a voice. */
export function voicedFrame(spectrumDb: Float32Array, sampleRate: number): boolean {
  const binHz = sampleRate / (2 * spectrumDb.length)
  let band = 0
  let total = 0
  let logSum = 0
  let count = 0
  for (let bin = 0; bin < spectrumDb.length; bin++) {
    const hz = bin * binHz
    if (hz < 80 || hz > 8000) continue
    const db = spectrumDb[bin] ?? -Infinity
    const power = Number.isFinite(db) ? 10 ** (db / 10) : 0
    total += power
    if (hz < 250 || hz > 3500) continue
    band += power
    logSum += Math.log(power + 1e-12)
    count++
  }
  if (total <= 0 || count === 0 || band / total < BAND_SHARE) return false
  const flatness = Math.exp(logSum / count) / (band / count)
  return flatness < MAX_FLATNESS
}

/** Voiced time it takes to count as someone speaking. */
export const SPEECH_ONSET_MS = 250
/** A gap this long in voiced frames resets the count; syllables have shorter ones. */
const SPEECH_GAP_MS = 180

/**
 * Voiced frames, held over time. `observe` answers true once speech has been
 * heard for `SPEECH_ONSET_MS`, counting through the short unvoiced gaps
 * inside words, and starting over after a longer silence.
 */
export class SpeechGate {
  #voicedMs = 0
  #gapMs = 0

  get voicedMs(): number {
    return this.#voicedMs
  }

  observe(loud: boolean, voiced: boolean, dtMs: number): boolean {
    if (loud && voiced) {
      this.#voicedMs += dtMs
      this.#gapMs = 0
    } else {
      this.#gapMs += dtMs
      if (this.#gapMs >= SPEECH_GAP_MS) this.#voicedMs = 0
    }
    return this.#voicedMs >= SPEECH_ONSET_MS
  }

  reset(): void {
    this.#voicedMs = 0
    this.#gapMs = 0
  }
}

/** Words that keep the listener's place rather than take a turn. */
const CONTINUERS = new Set([
  'yeah', 'yes', 'yep', 'yup', 'ya', 'ok', 'okay', 'alright', 'right', 'sure', 'cool', 'nice', 'good', 'great',
  'mhm', 'mm', 'mmm', 'hmm', 'uh', 'huh', 'uhhuh', 'ah', 'oh', 'aha', 'i', 'see', 'got', 'it',
  'go', 'on', 'ahead', 'continue', 'carry', 'keep', 'going', 'please', 'and', 'then', 'so',
])

/**
 * Whether a short take only acknowledged ("yeah, yeah, continue") rather
 * than said something to act on. Anything with a word outside the list, or
 * longer than a few words, is a turn: a false "continue" talks over the
 * person, which is worse than a needless stop.
 */
export function isContinuer(text: string): boolean {
  const words = text.toLowerCase().replace(/uh-huh|mm-hmm/g, 'uhhuh').split(/[^\p{L}\p{N}']+/u).filter((word) => word !== '')
  return words.length > 0 && words.length <= 6 && words.every((word) => CONTINUERS.has(word))
}

/** Whether a transcription holds anything said at all. */
export function saidNothing(text: string): boolean {
  return !/[\p{L}\p{N}]/u.test(text)
}
