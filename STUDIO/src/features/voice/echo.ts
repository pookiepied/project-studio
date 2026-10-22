/**
 * Studio hearing itself.
 *
 * On a phone's loudspeaker the microphone hears the reply as loudly as it
 * hears the person. Without help, that sound passes the speech detector,
 * pauses Studio, is transcribed - and the transcript, being Studio's own
 * sentence, was taken as the person's turn: the reply cancelled and its own
 * words sent back to the model.
 *
 * Three layers stop it, each cheaper to be wrong about than the last:
 *
 * 1. The browser's echo canceller is given the reply as its reference
 *    (`echoReference.ts`), so most of the echo never reaches the meter.
 * 2. `EchoGuard` learns how loudly the reply comes back through the room,
 *    and while Studio speaks only a level clearly above that counts as the
 *    person - so the residue does not pause Studio or open a take.
 * 3. `isOwnEcho` is the last word, on text: a take heard while Studio spoke
 *    that mostly repeats what Studio was saying is dropped, and Studio
 *    carries on. Nothing new, and no short interruption, ever matches.
 */

/** Words that are always the person, however Studio's reply happened to use them. */
const INTERRUPTIONS = new Set(['stop', 'wait', 'no', 'nope', 'hold', 'pause', 'cancel', 'hey', 'studio', 'enough', 'quiet'])

/** How far back in what Studio said a take is compared against, in words. */
const SPOKEN_WINDOW = 160
/** A short take must match within this many of the latest words spoken. */
const SHORT_WINDOW = 12
/** Share of a longer take's words that must follow what Studio said, in order. */
const ECHO_SHARE = 0.75

function words(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .split(/[^\p{L}\p{N}']+/u)
    .map((word) => word.replace(/^'+|'+$/g, ''))
    .filter((word) => word !== '')
}

/** Length of the longest in-order run of `heard` found in `spoken` (a common subsequence). */
function inOrder(heard: readonly string[], spoken: readonly string[]): number {
  let previous = new Array<number>(spoken.length + 1).fill(0)
  for (const word of heard) {
    const current = new Array<number>(spoken.length + 1).fill(0)
    for (let j = 1; j <= spoken.length; j++) {
      current[j] = word === spoken[j - 1]
        ? (previous[j - 1] ?? 0) + 1
        : Math.max(previous[j] ?? 0, current[j - 1] ?? 0)
    }
    previous = current
  }
  return previous[spoken.length] ?? 0
}

/**
 * Whether `heard`, a take that overlapped Studio speaking, is Studio's own
 * reply coming back through the microphone.
 *
 * Errs toward the person. A take of one or two words is echo only when the
 * same words, in the same order, were among the last few Studio said, and
 * never when one of them is an interruption. A longer take is echo when at
 * least three quarters of its words follow Studio's recent words in order -
 * a transcriber's slips cost a few, a person's own sentence costs most.
 */
export function isOwnEcho(heard: string, spoken: string): boolean {
  const take = words(heard)
  if (take.length === 0) return false
  if (take.some((word) => INTERRUPTIONS.has(word))) return false
  const said = words(spoken).slice(-SPOKEN_WINDOW)
  if (said.length === 0) return false
  if (take.length <= 2) {
    const recent = said.slice(-SHORT_WINDOW)
    for (let start = 0; start + take.length <= recent.length; start++) {
      if (take.every((word, offset) => recent[start + offset] === word)) return true
    }
    return false
  }
  return inOrder(take, said) / take.length >= ECHO_SHARE
}

/** Frames of the reply sounding before the room's echo level is trusted. */
const LEARN_FRAMES = 30
/** How much louder than the expected echo the person must be while Studio speaks. */
const MARGIN = 1.8
/** Added to the margin, so a faint reply does not make a faint echo look like speech. */
const HEADROOM = 0.06
/** The reply's own level below which a frame teaches nothing. */
const SOUNDING = 0.05
/** Ceiling on one frame's echo ratio, so a person talking early cannot teach "everything is echo". */
const MAX_RATIO = 1.5

/**
 * The room's echo path, learned from the reply itself.
 *
 * While Studio speaks and nobody has been detected talking, the microphone's
 * level divided by the reply's own level is how strongly this room returns
 * the reply. With that known, a frame is the person only when the
 * microphone is clearly above what the reply alone would produce. Until it
 * has seen enough of the reply, the guard admits everything - the behaviour
 * before it existed - and where the browser cancels the echo well, the
 * learned ratio is small and the guard changes nothing.
 */
export class EchoGuard {
  #ratio = 0
  #frames = 0

  /** Teaches the guard from one frame in which only Studio was sounding. */
  observe(micLevel: number, replyLevel: number): void {
    if (replyLevel < SOUNDING) return
    const ratio = Math.min(MAX_RATIO, micLevel / replyLevel)
    this.#frames++
    // Fast at first, then slow: the first second sets the room, later
    // frames only follow a change in volume or distance.
    const rate = this.#frames < LEARN_FRAMES ? 1 / this.#frames : 0.03
    this.#ratio += (ratio - this.#ratio) * rate
  }

  /** Whether a frame's microphone level is more than the reply's echo could be. */
  isPerson(micLevel: number, replyLevel: number): boolean {
    if (this.#frames < LEARN_FRAMES || replyLevel < SOUNDING) return true
    return micLevel > replyLevel * this.#ratio * MARGIN + HEADROOM
  }

  reset(): void {
    this.#ratio = 0
    this.#frames = 0
  }
}
