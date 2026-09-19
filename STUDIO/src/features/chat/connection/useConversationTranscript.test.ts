import { describe, expect, it } from 'vitest'

import { arrivalTimeOf } from './useConversationTranscript'

/**
 * The one rule that separates a turn being lived through from one being
 * handed back.
 *
 * Anything that measures a duration by arrival has to know the difference, or
 * a reattach that redelivers a two-minute reasoning trace in fifty
 * milliseconds reports the reattach's speed as the model's thinking time.
 * `replaying` has been on every chunk delivery since Task 24 and nothing read
 * it until now.
 */

const SNAPSHOT = {
  version: 1,
  conversationId: 'cnv_1',
  offset: '4_2',
  messages: [],
  settlements: [],
  compactions: [],
}

const NOW = () => 1_700_000_000_000

describe('when a delivery counts as having arrived here', () => {
  it('stamps a live batch with the clock', () => {
    expect(arrivalTimeOf({ kind: 'chunks', replaying: false, chunks: [] }, NOW)).toBe(
      1_700_000_000_000,
    )
  })

  it('refuses to stamp a replayed batch', () => {
    expect(arrivalTimeOf({ kind: 'chunks', replaying: true, chunks: [] }, NOW)).toBeNull()
  })

  it('refuses to stamp a snapshot, which is history by definition', () => {
    expect(arrivalTimeOf({ kind: 'snapshot', snapshot: SNAPSHOT }, NOW)).toBeNull()
  })

  it('does not read the clock at all when it is not going to use it', () => {
    // Not a micro-optimisation: a clock read on a replay path is the shape
    // that ends up quietly used later. If it never happens it cannot leak.
    let reads = 0
    const counting = () => {
      reads += 1
      return 1
    }
    arrivalTimeOf({ kind: 'chunks', replaying: true, chunks: [] }, counting)
    arrivalTimeOf({ kind: 'snapshot', snapshot: SNAPSHOT }, counting)
    expect(reads).toBe(0)
  })
})
