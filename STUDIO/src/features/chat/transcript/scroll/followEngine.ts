/**
 * Chasing the bottom of a growing document, smoothly.
 *
 * ---- Why writing `scrollTop = scrollHeight` is not enough ----------------
 *
 * It is the obvious implementation and it produces a visible stutter, for a
 * reason that has nothing to do with how fast the text arrives.
 *
 * Text reflows by whole lines. A paragraph being written does not get one pixel
 * taller per character — it stays exactly the same height for a dozen frames
 * and then, when a word wraps, grows by a full line box at once. So the
 * document height is a staircase, and an assignment that pins the viewport to
 * the bottom of it reproduces the staircase exactly: nothing, nothing, nothing,
 * twenty-four pixels. That is the "1-2-3 versus 2-4-6" of it. The reveal was
 * smooth; the *scroll* was quantised to the line box, and no amount of
 * smoothing upstream of layout can change that.
 *
 * So the viewport is not assigned to the target, it is driven toward it. Each
 * frame it closes a fixed *proportion* of the remaining distance, which turns a
 * 24px step into a short glide and leaves a continuous stream looking like
 * continuous motion. The staircase is still there in the layout. It is no
 * longer there in what the eye follows.
 *
 * ---- Why exponential and not linear ---------------------------------------
 *
 * `next += (target - next) * rate * dt` is the naive version and it is subtly
 * frame-rate dependent: at 144Hz it converges in a quarter the wall-clock time
 * it takes at 30Hz, so the scroll feels different on different machines and
 * changes character when the window is busy. `1 - exp(-k * dt)` is the same
 * curve sampled correctly — the fraction closed depends on elapsed *time*, not
 * on how many frames happened to fit in it.
 */

/**
 * How quickly the gap closes, per second.
 *
 * The half-life is ln(2)/k, so this is about 55ms to close half the distance
 * and around 180ms to arrive. Slower reads as the view lagging behind the text;
 * faster and a line-wrap is back to being a jump.
 */
const STIFFNESS = 12

/** Below this the animation is over; anything less is sub-pixel. */
const EPSILON = 0.5

/**
 * A jump this much larger than the viewport is not a stream, it is a
 * navigation — opening a long conversation, or a code block expanding. Gliding
 * through several screens of content is a long, disorienting flight to a place
 * the reader did not ask to travel to, so those are taken instantly.
 */
const TELEPORT_SCREENS = 3

export interface Follower {
  /** Drive one frame. Returns the position written, or null if nothing to do. */
  step(element: HTMLElement, deltaSeconds: number, options?: StepOptions): number | null
  /** Abandon the chase, so the next start does not inherit stale motion. */
  stop(): void
}

/**
 * Per-step options. Everything defaults to the streaming follow's own
 * behaviour; callers pass things only when a step means something else.
 */
interface StepOptions {
  /**
   * Take a navigation-sized distance instantly rather than gliding through
   * it. True by default -- a jump this large mid-stream is disorientation
   * the reader did not ask for. The one caller that passes false is the
   * open: arriving in a conversation is a journey the reader is meant to
   * watch, fast at the start, settling as it lands.
   */
  readonly teleport?: boolean
}

export function createFollower(): Follower {
  // Tracked as a float. Reading `scrollTop` back each frame would round to the
  // browser's device-pixel grid, and at small deltas that rounding is the whole
  // movement — the position would quantise and the glide would stutter for the
  // second time, having just been fixed once.
  let position: number | null = null

  return {
    stop() {
      position = null
    },

    step(element, deltaSeconds, options) {
      const target = element.scrollHeight - element.clientHeight
      if (target <= 0) return null

      // Resync to reality before moving. Something other than this engine may
      // have scrolled the element — a jump-to-latest, an anchor, the user —
      // and continuing from a remembered position would yank the view back.
      const current = element.scrollTop
      if (position === null || Math.abs(position - current) > 1) position = current

      const distance = target - position
      if (Math.abs(distance) < EPSILON) {
        position = target
        return null
      }

      if ((options?.teleport ?? true) && distance > element.clientHeight * TELEPORT_SCREENS) {
        position = target
        element.scrollTop = target
        return target
      }

      // Frame-rate independent exponential approach. The delta is clamped
      // because a backgrounded tab delivers one frame worth several seconds,
      // and `exp` of that is 1 — which would teleport on the way back.
      const fraction = 1 - Math.exp(-STIFFNESS * Math.min(deltaSeconds, 0.05))
      position += distance * fraction

      element.scrollTop = position
      return position
    },
  }
}
