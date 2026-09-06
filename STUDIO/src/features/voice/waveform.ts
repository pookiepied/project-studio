/**
 * Waveform geometry and envelopes.
 *
 * Pure functions and one small buffer — nothing here touches React, the DOM
 * or the microphone, so the same numbers drive both renderings of the voice
 * (the composer's bars and the stage's ridge) and the two cannot disagree
 * about what a level looks like.
 *
 * ---- The ridge, not the bar chart ------------------------------------------
 *
 * Both visualisations show the same thing — recent level over time — but the
 * stage draws it as one continuous mirrored line rather than a row of bars,
 * for the same reason the voice mark is a line (`drawn.tsx`): a bar chart of
 * amplitude is a picture of equipment, a shape that swells and settles is a
 * picture of someone speaking. The line is built from real samples with a
 * light horizontal blur and quadratic midpoint curves; it is smoothed, never
 * synthesised.
 */

/** A fixed-size ring of recent levels, oldest first. */
export class LevelHistory {
  readonly size: number
  private readonly buffer: Float64Array
  private head = 0

  constructor(size: number) {
    this.size = size
    this.buffer = new Float64Array(size)
  }

  push(level: number): void {
    this.buffer[this.head] = level
    this.head = (this.head + 1) % this.size
  }

  /** Index 0 is the oldest sample, `size - 1` the newest. */
  get(index: number): number {
    // `?? 0` rather than an assertion: the modulo keeps the index inside
    // the array, and a slot that somehow is not there reads as silence,
    // which is the right answer for a level history.
    return this.buffer[(this.head + index) % this.size] ?? 0
  }

  clear(): void {
    this.buffer.fill(0)
  }
}

/** Neighbouring samples averaged 1:2:1, which is enough to un-jag the curve. */
function smoothed(history: LevelHistory, index: number): number {
  const previous = history.get(Math.max(0, index - 1))
  const next = history.get(Math.min(history.size - 1, index + 1))
  return 0.25 * previous + 0.5 * history.get(index) + 0.25 * next
}

/**
 * The mirrored ridge as one closed SVG path.
 *
 * The top edge runs left to right through the samples; the bottom edge is the
 * top reflected around the midline and run back right to left, so the shape
 * closes around the centre and reads as a single object breathing rather than
 * two lines tracking each other. Silence is a hairline, not nothing — a flat
 * line is the honest rendering of a quiet room and still shows the feature is
 * alive.
 */
export function ridgePath(history: LevelHistory, width: number, height: number): string {
  const mid = height / 2
  const amplitude = height / 2 - 2
  const count = history.size

  const x = (index: number) => (index / (count - 1)) * width
  const y = (index: number) => mid - (0.02 + 0.98 * smoothed(history, index)) * amplitude

  // Quadratics through segment midpoints: the curve touches every sample
  // without cornering on one, which is the difference between a drawn line
  // and a dot-to-dot.
  const edge = (direction: 1 | -1) => {
    let d = ''
    for (let i = 1; i < count - 1; i++) {
      const index = direction === 1 ? i : count - 1 - i
      const previous = direction === 1 ? index - 1 : index + 1
      const xc = (x(previous) + x(index)) / 2
      const yc = (y(previous) + y(index)) / 2
      d += ` Q ${x(index).toFixed(2)} ${y(index).toFixed(2)} ${xc.toFixed(2)} ${yc.toFixed(2)}`
    }
    return d
  }

  const startTop = `M ${x(0).toFixed(2)} ${y(0).toFixed(2)}`
  const lastTop = ` L ${x(count - 1).toFixed(2)} ${y(count - 1).toFixed(2)}`
  return startTop + edge(1) + lastTop + edge(-1) + ' Z'
}

/**
 * The speaking envelope, for the stage's talking state.
 *
 * There is no real voice to measure yet — no TTS exists behind this app —
 * so the shape is synthesised from a few sine bands at speech-like rates
 * (syllables around 3Hz, words around 0.5Hz). It is the one knowingly fake
 * signal in this feature and it stays contained here, behind the same
 * interface the microphone will use when a real voice arrives: when TTS
 * lands, its own level history replaces this function and nothing downstream
 * changes.
 */
export function speakingEnvelope(timeSeconds: number, seed: number): number {
  const syllable = 0.55 + 0.45 * Math.sin(timeSeconds * Math.PI * 2 * 3.4 + seed)
  const word = Math.max(0, Math.sin(timeSeconds * Math.PI * 2 * 0.5 + seed * 2))
  const phrase = 0.75 + 0.25 * Math.sin(timeSeconds * Math.PI * 2 * 0.13 + seed)
  return Math.min(1, 0.06 + 0.9 * word * syllable * phrase)
}

/**
 * The thinking pulse: barely above the hairline, slow. It exists so the
 * collapse from speech to thought is continuous — the ridge settles rather
 * than snapping flat — and it is quiet because thinking is the one state
 * with nothing to measure. Quiet is the honest rendering of nothing.
 */
export function thinkingPulse(timeSeconds: number): number {
  return 0.05 + 0.035 * (0.5 + 0.5 * Math.sin(timeSeconds * Math.PI * 2 * 0.3))
}

/**
 * The resting breath: the orb while the stage is opening or idle.
 *
 * Slower than a pulse and shallower than any state that means something, so
 * "waiting" cannot be mistaken for "listening" at a glance. Not flat, though
 * — a perfectly still orb reads as a frozen app, and the one thing this
 * screen must never look like is stopped.
 */
export function idleBreath(timeSeconds: number): number {
  return 0.06 + 0.05 * (0.5 + 0.5 * Math.sin(timeSeconds * Math.PI * 2 * 0.18))
}

/** `m:ss`, the way every recorder in the room already reads. */
export function formatClock(elapsedMs: number): string {
  const seconds = Math.floor(elapsedMs / 1000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

/**
 * Reduced motion, read once per consumer.
 *
 * `<MotionConfig reducedMotion="user">` covers everything Framer animates; the
 * waveform writes to the DOM directly from a frame loop, so it checks here.
 * Live measurement keeps updating — it is data, and pausing it would say the
 * microphone had — but the decorative envelopes (breathing, speaking cadence)
 * settle to a constant, and the reveal animations collapse the usual way.
 */
export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
