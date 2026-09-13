import { describe, expect, it } from 'vitest'

import { PAUSE_MS, SEGMENT_CEILING_MS, SEGMENT_MIN_MS, SegmentCutter } from './segments'

/**
 * The cutter, against a scripted level: frames of 16.7 ms at a level, the
 * way the microphone's loop feeds it. What is pinned is where the cuts
 * fall - at a pause after speech, at the ceiling without one - and where
 * they do not: in silence, and inside the first second.
 */

const FRAME_MS = 16.7
const SPEAKING = 0.4
const QUIET = 0.01

/** Feeds `ms` of one level; returns how many cuts it produced and at which elapsed times. */
function feed(cutter: SegmentCutter, level: number, ms: number, clock: { at: number }): number[] {
  const cuts: number[] = []
  for (let elapsed = 0; elapsed < ms; elapsed += FRAME_MS) {
    clock.at += FRAME_MS
    if (cutter.observe(level, FRAME_MS)) cuts.push(clock.at)
  }
  return cuts
}

describe('the segment cutter', () => {
  it('cuts at a pause after speech, and not before the pause is a pause', () => {
    const cutter = new SegmentCutter()
    const clock = { at: 0 }
    expect(feed(cutter, SPEAKING, 2_000, clock)).toEqual([])
    // Half a pause is a breath between words, not the end of a sentence.
    expect(feed(cutter, QUIET, PAUSE_MS / 2, clock)).toEqual([])
    const cuts = feed(cutter, QUIET, PAUSE_MS, clock)
    expect(cuts).toHaveLength(1)
    // The cut landed once the quiet had lasted PAUSE_MS, give or take a frame.
    expect(cuts[0]).toBeGreaterThanOrEqual(2_000 + PAUSE_MS - FRAME_MS)
    expect(cuts[0]).toBeLessThanOrEqual(2_000 + PAUSE_MS + 2 * FRAME_MS)
  })

  it('never cuts silence: a room with nobody speaking is one segment', () => {
    const cutter = new SegmentCutter()
    expect(feed(cutter, QUIET, 3 * SEGMENT_CEILING_MS, { at: 0 })).toEqual([])
    expect(cutter.spoke).toBe(false)
  })

  it('cuts at the ceiling when the person does not pause', () => {
    const cutter = new SegmentCutter()
    const cuts = feed(cutter, SPEAKING, 2.5 * SEGMENT_CEILING_MS, { at: 0 })
    expect(cuts).toHaveLength(2)
    expect(cuts[0]).toBeGreaterThanOrEqual(SEGMENT_CEILING_MS)
    expect(cuts[0]).toBeLessThan(SEGMENT_CEILING_MS + 2 * FRAME_MS)
    expect((cuts[1] ?? 0) - (cuts[0] ?? 0)).toBeGreaterThanOrEqual(SEGMENT_CEILING_MS - FRAME_MS)
  })

  it('does not cut inside the first second, even at a pause', () => {
    const cutter = new SegmentCutter()
    const clock = { at: 0 }
    // A short "yes" then quiet: the pause is real, but the segment is not
    // yet long enough to be a file worth sending.
    expect(feed(cutter, SPEAKING, 100, clock)).toEqual([])
    const cuts = feed(cutter, QUIET, SEGMENT_MIN_MS, clock)
    expect(cuts).toHaveLength(1)
    expect(cuts[0]).toBeGreaterThanOrEqual(SEGMENT_MIN_MS)
  })

  it('starts the next segment fresh after a cut', () => {
    const cutter = new SegmentCutter()
    const clock = { at: 0 }
    feed(cutter, SPEAKING, 2_000, clock)
    expect(feed(cutter, QUIET, PAUSE_MS + FRAME_MS, clock)).toHaveLength(1)
    // Quiet continuing after the cut is silence in a new segment, not a
    // second pause in the old one.
    expect(feed(cutter, QUIET, 5_000, clock)).toEqual([])
    expect(cutter.spoke).toBe(false)
  })
})
