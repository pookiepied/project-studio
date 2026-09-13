/**
 * Waveform geometry and envelopes.
 *
 * Pure functions — nothing here touches React, the DOM or the microphone, so
 * the same numbers drive every rendering of the voice and none of them can
 * disagree about what a level looks like.
 */

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
