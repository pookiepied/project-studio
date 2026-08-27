import { describe, expect, it } from 'vitest'

import {
  readChunkFacts,
  type ChunkFacts,
  type ConversationSnapshotFacts,
} from '@/platform/harness'
import {
  applyChunks,
  emptyProjection,
  pendingUserItem,
  reseeded,
  withPendingSubmission,
  type PendingSubmission,
} from './projection'

/**
 * Words that have been sent and not yet echoed.
 *
 * A user's own message reaches the transcript by round trip: the harness
 * records it and hands it back as `message-appended`. For the length of that
 * trip the page had nothing on it, and the working mark stood alone against an
 * empty column and then jumped when the echo landed above it. Holding the
 * words is what removes the jump — but held words are a claim that a message
 * was sent, so every case here is about the claim being retired exactly when
 * the log makes it true, and never on anything else.
 */

function chunksOf(...raw: unknown[]): ChunkFacts[] {
  return raw.map((value) => {
    const chunk = readChunkFacts(value)
    if (chunk === null) throw new Error('test built an unparseable chunk')
    return chunk
  })
}

const SUBMISSION = 'sub_1'
const WORDS = 'what did you make of it?'
/** When the receipt reached this window. Fixed, so durations are assertable. */
const ADMITTED = 1_700_000_000_000
const HELD: PendingSubmission = { submissionId: SUBMISSION, text: WORDS, at: ADMITTED }

function echoOf(submissionId: string, text: string, batch: number): unknown {
  return {
    type: 'message-appended',
    message: {
      id: `u_${submissionId}`,
      role: 'user',
      submissionId,
      metadata: { timestamp: '2026-08-26T00:00:00Z' },
      parts: [{ type: 'text', text, state: 'done' }],
    },
    position: { batch, index: 0 },
  }
}

function snapshotWith(messages: ConversationSnapshotFacts['messages']): ConversationSnapshotFacts {
  return {
    version: 1,
    conversationId: 'conv_1',
    offset: '4_0',
    messages,
    settlements: [],
  }
}

describe('words that have been sent and not yet echoed', () => {
  it('holds them against the submission the harness admitted', () => {
    const held = withPendingSubmission(emptyProjection(), HELD)
    expect(held.pending).toEqual(HELD)
    // Not an item. Items are what the harness reported, and a projection that
    // blurred the two would let a send that never landed sit in the log.
    expect(held.items).toEqual([])
  })

  it('lets them go the moment that submission comes back', () => {
    const held = withPendingSubmission(emptyProjection(), HELD)
    const applied = applyChunks(held, chunksOf(echoOf(SUBMISSION, WORDS, 1)))

    expect(applied.pending).toBeNull()
    expect(applied.items).toHaveLength(1)
    // Exactly once. The whole risk of drawing a message before the log has it
    // is drawing it twice at the seam.
    expect(applied.items.filter((item) => item.kind === 'user')).toHaveLength(1)
  })

  it('keeps holding them while another submission of somebody else arrives', () => {
    // The retirement rule is the submission id, not "a user message landed".
    // A second window sending into the same conversation would otherwise take
    // these words off the screen before their own turn was ever recorded.
    const held = withPendingSubmission(emptyProjection(), HELD)
    const applied = applyChunks(held, chunksOf(echoOf('sub_other', 'not yours', 1)))

    expect(applied.pending).toEqual(HELD)
  })

  it('keeps holding them through an assistant reply that starts first', () => {
    // Ordering on the wire is not guaranteed to put the echo first, and a
    // reply opening is not evidence about the message that prompted it.
    const held = withPendingSubmission(emptyProjection(), HELD)
    const applied = applyChunks(
      held,
      chunksOf({
        type: 'message-started',
        messageId: 'm1',
        submissionId: SUBMISSION,
        position: { batch: 1, index: 0 },
      }),
    )

    expect(applied.pending).toEqual(HELD)
  })

  it('survives a snapshot that does not carry them yet', () => {
    // A reattach mid-flight delivers the log as the harness knew it a moment
    // ago. Replacing the projection outright took the words off the screen and
    // put them back on the next delivery.
    const held = withPendingSubmission(emptyProjection(), HELD)
    const seeded = reseeded(held, snapshotWith([]))

    expect(seeded.pending).toEqual(HELD)
  })

  it('is dropped by a snapshot that does carry them', () => {
    const held = withPendingSubmission(emptyProjection(), HELD)
    const seeded = reseeded(
      held,
      snapshotWith([
        {
          id: 'u1',
          role: 'user',
          submissionId: SUBMISSION,
          timestamp: null,
          model: null,
          usage: null,
          parts: [{ kind: 'text', text: WORDS, state: 'done' }],
        },
      ]),
    )

    expect(seeded.pending).toBeNull()
    expect(seeded.items).toHaveLength(1)
  })

  it('refuses to hold a submission the log already has', () => {
    // A receipt can reach the holder after its own echo has already been
    // applied — a fast round trip, or a re-seed on mount. Holding it then
    // would draw the same message twice for as long as it took to notice.
    const applied = applyChunks(emptyProjection(), chunksOf(echoOf(SUBMISSION, WORDS, 1)))
    const held = withPendingSubmission(applied, HELD)

    expect(held.pending).toBeNull()
    expect(held.items).toHaveLength(1)
  })
})

describe('the shape held words are drawn in', () => {
  it('is a user message carrying the submission it was admitted under', () => {
    const item = pendingUserItem(HELD)

    expect(item.kind).toBe('user')
    expect(item.text).toBe(WORDS)
    expect(item.submissionId).toBe(SUBMISSION)
  })

  it('invents no timestamp, because the log has not stamped one', () => {
    const item = pendingUserItem(HELD)

    expect(item.timestamp).toBeNull()
  })
})
