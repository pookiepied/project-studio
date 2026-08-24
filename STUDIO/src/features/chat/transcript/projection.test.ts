import { describe, expect, it } from 'vitest'

import {
  readChunkFacts,
  type ChunkFacts,
  type ConversationSnapshotFacts,
} from '@/platform/harness'
import {
  applyChunks,
  emptyProjection,
  isMessageBeingWritten,
  seededFrom,
} from './projection'

/**
 * The transcript projection against hand-built chunks.
 *
 * Every case here was shaped by what a live harness actually put on the
 * wire -- including the awkward parts: answers that arrive after the
 * message that issued the call has already completed, batches redelivered
 * after a reattach, streams that stop mid-turn, and chunk types this
 * client has never heard of.
 */

/** Reads raw wire objects into facts, so tests exercise the real parser path. */
function chunksOf(...raw: unknown[]): ChunkFacts[] {
  return raw.map((value) => {
    const chunk = readChunkFacts(value)
    if (chunk === null) throw new Error('test built an unparseable chunk')
    return chunk
  })
}

function at(batch: number, index = 0): { batch: number; index: number } {
  return { batch, index }
}

const CONVERSATION = 'conv_1'
const SUBMISSION = 'sub_1'

function resetChunk(): unknown {
  return {
    type: 'conversation-reset',
    conversationId: CONVERSATION,
    snapshot: { v: 1, conversationId: CONVERSATION, offset: '0_0', messages: [], settlements: [] },
    position: at(0),
  }
}

describe('seeding from history', () => {
  it('turns a whole snapshot into items, buckets included', () => {
    const items = seededFrom({
      version: 1,
      conversationId: CONVERSATION,
      offset: '12_3',
      messages: [
        {
          id: 'u1',
          role: 'user',
          submissionId: SUBMISSION,
          timestamp: '2026-08-24T00:00:00Z',
          model: null,
          usage: null,
          parts: [{ kind: 'text', text: 'read the config', state: 'done' }],
        },
        {
          id: 'a1',
          role: 'assistant',
          submissionId: null,
          timestamp: null,
          model: null,
          usage: null,
          parts: [
            { kind: 'reasoning', text: 'I should look.', state: 'done' },
            { kind: 'text', text: 'On it.', state: 'done' },
            {
              kind: 'tool',
              toolCallId: 't1',
              toolName: 'read',
              state: 'output-available',
              input: { present: true, value: { path: 'a.ts' } },
              output: { present: true, value: '...' },
              errorText: null,
            },
            {
              kind: 'tool',
              toolCallId: 't2',
              toolName: 'read',
              state: 'output-available',
              input: { present: true, value: { path: 'b.ts' } },
              output: { present: true, value: '...' },
              errorText: null,
            },
          ],
        },
      ],
      settlements: [],
    })

    expect(items.map((item) => item.kind)).toEqual(['user', 'assistant'])
    const user = items[0]
    if (user.kind !== 'user') throw new Error('expected a user item')
    expect(user.text).toBe('read the config')
    const reply = items[1]
    if (reply.kind !== 'assistant') throw new Error('expected an assistant item')
    expect(reply.segments.map((segment) => segment.kind)).toEqual([
      'thinking',
      'text',
      'tools',
    ])
    // One bucket per tool kind: the two reads are together.
    const tools = reply.segments[2]
    if (tools.kind !== 'tools') throw new Error('expected a tools segment')
    expect(tools.groups.map((group) => `${group.toolName}x${group.calls.length}`)).toEqual([
      'readx2',
    ])
    expect(reply.end).toEqual({ state: 'complete' })
  })

  it('keeps a message the snapshot says was still being written visibly unfinished', () => {
    const items = seededFrom({
      version: 1,
      conversationId: CONVERSATION,
      offset: '9_9',
      messages: [
        {
          id: 'a1',
          role: 'assistant',
          submissionId: null,
          timestamp: null,
          model: null,
          usage: null,
          parts: [{ kind: 'text', text: 'half a senten', state: 'streaming' }],
        },
      ],
      settlements: [],
    })
    const reply = items[0]
    if (reply.kind !== 'assistant') throw new Error('expected an assistant item')
    expect(reply.end).toEqual({ state: 'stopped' })
  })

  it('leaves a call whose answer never arrived pending, not failed', () => {
    const items = seededFrom({
      version: 1,
      conversationId: CONVERSATION,
      offset: '9_9',
      messages: [
        {
          id: 'a1',
          role: 'assistant',
          submissionId: null,
          timestamp: null,
          model: null,
          usage: null,
          parts: [
            {
              kind: 'tool',
              toolCallId: 't1',
              toolName: 'bash',
              state: 'input-available',
              input: { present: true, value: { command: 'sleep 100' } },
              output: { present: false, value: undefined },
              errorText: null,
            },
          ],
        },
      ],
      settlements: [],
    })
    const reply = items[0]
    if (reply.kind !== 'assistant') throw new Error('expected an assistant item')
    const tools = reply.segments[0]
    if (tools.kind !== 'tools') throw new Error('expected a tools segment')
    expect(tools.groups[0].calls[0].output).toMatchObject({ present: false })
    expect(tools.groups[0].calls[0].errorText).toBeNull()
  })
})

describe('assembling a live turn from deltas', () => {
  it('grows one thinking segment and one text segment out of many deltas', () => {
    let projection = emptyProjection()
    projection = applyChunks(
      projection,
      chunksOf(resetChunk(), {
        type: 'message-started',
        messageId: 'm1',
        submissionId: SUBMISSION,
        position: at(1),
      }),
    )
    projection = applyChunks(
      projection,
      chunksOf(
        { type: 'message-delta', messageId: 'm1', kind: 'reasoning', delta: 'Th', position: at(2) },
        { type: 'message-delta', messageId: 'm1', kind: 'reasoning', delta: 'in', position: at(3) },
      ),
    )
    projection = applyChunks(
      projection,
      chunksOf(
        { type: 'message-delta', messageId: 'm1', kind: 'text', delta: 'He', position: at(4) },
        { type: 'message-delta', messageId: 'm1', kind: 'text', delta: 'y', position: at(5) },
        { type: 'message-completed', messageId: 'm1', position: at(6) },
        {
          type: 'submission-settled',
          submissionId: SUBMISSION,
          outcome: 'completed',
          position: at(7),
        },
      ),
    )

    const reply = projection.items[0]
    if (reply.kind !== 'assistant') throw new Error('expected an assistant item')
    expect(reply.segments.map((segment) => segment.kind)).toEqual(['thinking', 'text'])
    const first = reply.segments[0]
    if (first.kind !== 'thinking') throw new Error('expected a thinking segment')
    expect(first.text).toBe('Thin')
    const second = reply.segments[1]
    if (second.kind !== 'text') throw new Error('expected a text segment')
    expect(second.text).toBe('Hey')
    expect(reply.end).toEqual({ state: 'complete' })
  })

  it('preserves interleaving: writing after thinking starts a second block', () => {
    let projection = emptyProjection()
    projection = applyChunks(
      projection,
      chunksOf(
        resetChunk(),
        { type: 'message-started', messageId: 'm1', submissionId: null, position: at(1) },
        { type: 'message-delta', messageId: 'm1', kind: 'reasoning', delta: 'plan', position: at(2) },
        { type: 'message-delta', messageId: 'm1', kind: 'text', delta: 'Doing', position: at(3) },
        { type: 'message-delta', messageId: 'm1', kind: 'reasoning', delta: ' more', position: at(4) },
      ),
    )
    const reply = projection.items[0]
    if (reply.kind !== 'assistant') throw new Error('expected an assistant item')
    expect(reply.segments.map((segment) => segment.kind)).toEqual([
      'thinking',
      'text',
      'thinking',
    ])
    // Segment ids are stable across replays: message plus ordinal.
    expect(reply.segments[2]).toMatchObject({ id: 'm1#think-1', text: ' more' })
  })
})

describe('structural grouping of tool calls', () => {
  function liveTurnWithTools() {
    let projection = emptyProjection()
    projection = applyChunks(
      projection,
      chunksOf(
        resetChunk(),
        { type: 'message-started', messageId: 'm1', submissionId: SUBMISSION, position: at(1) },
        { type: 'tool-input', messageId: 'm1', toolCallId: 'r1', toolName: 'read', input: { path: 'a' }, position: at(2) },
        { type: 'tool-input', messageId: 'm1', toolCallId: 'b1', toolName: 'bash', input: { cmd: 'ls' }, position: at(3) },
        { type: 'tool-input', messageId: 'm1', toolCallId: 'r2', toolName: 'read', input: { path: 'b' }, position: at(4) },
        { type: 'message-completed', messageId: 'm1', position: at(5) },
        { type: 'tool-output', toolCallId: 'r1', output: 'aaa', position: at(6) },
        { type: 'tool-output-error', toolCallId: 'b1', errorText: 'no such file', position: at(7) },
        { type: 'tool-output', toolCallId: 'r2', output: 'bbb', position: at(8) },
        {
          type: 'submission-settled',
          submissionId: SUBMISSION,
          outcome: 'completed',
          position: at(9),
        },
      ),
    )
    return projection
  }

  it('buckets one message calls by tool kind, in first-appearance order', () => {
    const projection = liveTurnWithTools()
    const reply = projection.items[0]
    if (reply.kind !== 'assistant') throw new Error('expected an assistant item')
    const tools = reply.segments[0]
    if (tools.kind !== 'tools') throw new Error('expected one tools segment')
    expect(tools.groups.map((group) => group.toolName)).toEqual(['read', 'bash'])
    expect(tools.groups[0].calls.map((call) => call.toolCallId)).toEqual(['r1', 'r2'])
  })

  it('delivers each answer to its own call even after the message completed', () => {
    // The wire really does this: outputs arrive in batches after the
    // assistant message has been marked complete. Correlation is by call
    // id alone, never by adjacency.
    const projection = liveTurnWithTools()
    const reply = projection.items[0]
    if (reply.kind !== 'assistant') throw new Error('expected an assistant item')
    const tools = reply.segments[0]
    if (tools.kind !== 'tools') throw new Error('expected one tools segment')
    expect(tools.groups[0].calls.map((call) => call.output)).toMatchObject([
      { present: true, value: 'aaa' },
      { present: true, value: 'bbb' },
    ])
    expect(tools.groups[1].calls[0].errorText).toBe('no such file')
    expect(reply.end).toEqual({ state: 'complete' })
  })
})

describe('replay and redelivery', () => {
  it('applies a redelivered batch exactly once', () => {
    const batch = chunksOf(
      resetChunk(),
      { type: 'message-started', messageId: 'm1', submissionId: null, position: at(1) },
      { type: 'message-delta', messageId: 'm1', kind: 'text', delta: 'once', position: at(2) },
    )
    let projection = applyChunks(emptyProjection(), batch)
    const once = projection
    projection = applyChunks(projection, batch)
    expect(projection).toBe(once)
  })

  it('keeps dedupe honest across an unknown chunk type', () => {
    // An unknown type must survive AS A FACT precisely so this works: it
    // advances the applied marker like any other chunk, and dropping it
    // would let a replayed neighbour apply twice.
    let projection = applyChunks(
      emptyProjection(),
      chunksOf(
        resetChunk(),
        { type: 'phase-marker-v9', position: at(1) },
        { type: 'message-started', messageId: 'm1', submissionId: null, position: at(2) },
        { type: 'message-delta', messageId: 'm1', kind: 'text', delta: 'x', position: at(3) },
      ),
    )
    projection = applyChunks(
      projection,
      chunksOf(
        { type: 'phase-marker-v9', position: at(1) },
        { type: 'message-started', messageId: 'm1', submissionId: null, position: at(2) },
        { type: 'message-delta', messageId: 'm1', kind: 'text', delta: 'x', position: at(3) },
      ),
    )
    const reply = projection.items[0]
    if (reply.kind !== 'assistant') throw new Error('expected an assistant item')
    expect(reply.segments).toHaveLength(1)
  })

  it('replaces everything on a reset, whatever came before it', () => {
    let projection = applyChunks(
      emptyProjection(),
      chunksOf(
        resetChunk(),
        { type: 'message-started', messageId: 'old', submissionId: null, position: at(1) },
        { type: 'message-delta', messageId: 'old', kind: 'text', delta: 'stale', position: at(2) },
      ),
    )
    projection = applyChunks(
      projection,
      chunksOf({
        type: 'conversation-reset',
        conversationId: CONVERSATION,
        snapshot: {
          v: 1,
          conversationId: CONVERSATION,
          offset: '40_0',
          messages: [
            {
              id: 'fresh-user',
              role: 'user',
              submissionId: null,
              timestamp: null,
              parts: [{ type: 'text', text: 'compacted away the old turns', state: 'done' }],
            },
          ],
          settlements: [],
        },
        position: at(3),
      }),
    )
    expect(projection.items.map((item) => item.id)).toEqual(['fresh-user'])
  })
})

describe('an interrupted turn is never a finished one', () => {
  function startTurn() {
    return applyChunks(
      emptyProjection(),
      chunksOf(
        resetChunk(),
        { type: 'message-started', messageId: 'm1', submissionId: SUBMISSION, position: at(1) },
        { type: 'message-delta', messageId: 'm1', kind: 'text', delta: 'Half a', position: at(2) },
      ),
    )
  }

  it('leaves a stream that stops mid-turn visibly unfinished', () => {
    // Bytes stopping proves nothing. No completion, no settlement -- so the
    // message stays `stopped`, whatever the connection does next.
    const reply = startTurn().items[0]
    if (reply.kind !== 'assistant') throw new Error('expected an assistant item')
    expect(reply.end).toEqual({ state: 'stopped' })
  })

  it('marks a failed or aborted submission without touching finished messages', () => {
    let projection = startTurn()
    // An earlier message of the SAME submission finished before the failure.
    projection = applyChunks(
      projection,
      chunksOf(
        {
          type: 'message-completed',
          messageId: 'm1',
          position: at(3),
        },
      ),
    )
    projection = applyChunks(
      projection,
      chunksOf(
        { type: 'message-started', messageId: 'm2', submissionId: SUBMISSION, position: at(4) },
        { type: 'message-delta', messageId: 'm2', kind: 'text', delta: 'still going', position: at(5) },
        {
          type: 'submission-settled',
          submissionId: SUBMISSION,
          outcome: 'aborted',
          position: at(6),
        },
      ),
    )
    const finished = projection.items[0]
    const interrupted = projection.items[1]
    if (finished.kind !== 'assistant' || interrupted.kind !== 'assistant') {
      throw new Error('expected two assistant items')
    }
    expect(finished.end).toEqual({ state: 'complete' })
    expect(interrupted.end).toEqual({ state: 'aborted', reason: null })
  })

  it('lets a resumed stream finish what interruption interrupted', () => {
    let projection = startTurn()
    projection = applyChunks(
      projection,
      chunksOf(
        { type: 'message-delta', messageId: 'm1', kind: 'text', delta: ' sentence.', position: at(3) },
        { type: 'message-completed', messageId: 'm1', position: at(4) },
      ),
    )
    const reply = projection.items[0]
    if (reply.kind !== 'assistant') throw new Error('expected an assistant item')
    const text = reply.segments[0]
    if (text.kind !== 'text') throw new Error('expected a text segment')
    expect(text.text).toBe('Half a sentence.')
    expect(reply.end).toEqual({ state: 'complete' })
  })

  it('ignores content whose message never began here, instead of inventing one', () => {
    // A suffix read can deliver a delta whose message-start scrolled past
    // the resume point. There is nothing to attach it to; inventing a
    // message would be worse than dropping it.
    const projection = applyChunks(
      emptyProjection(),
      chunksOf(resetChunk(), {
        type: 'message-delta',
        messageId: 'ghost',
        kind: 'text',
        delta: 'orphan',
        position: at(1),
      }),
    )
    expect(projection.items).toEqual([])
  })
})

describe('a reset rebuilds the indexes content lands through', () => {
  it('routes deltas to messages that arrived inside the reset', () => {
    // Compaction replaces the item list wholesale; a delta for a message
    // introduced BY the replacement must find it, not fall through a stale
    // id index left over from the replaced items.
    let projection = applyChunks(
      emptyProjection(),
      chunksOf(
        resetChunk(),
        { type: 'message-started', messageId: 'old', submissionId: null, position: at(1) },
      ),
    )
    projection = applyChunks(
      projection,
      chunksOf(
        {
          type: 'conversation-reset',
          conversationId: CONVERSATION,
          snapshot: {
            v: 1,
            conversationId: CONVERSATION,
            offset: '40_0',
            messages: [
              {
                id: 'fresh',
                role: 'assistant',
                submissionId: null,
                timestamp: null,
                parts: [{ type: 'text', text: 'kept', state: 'done' }],
              },
            ],
            settlements: [],
          },
          position: at(2),
        },
        {
          type: 'message-delta',
          messageId: 'fresh',
          kind: 'text',
          delta: ' and grown',
          position: at(3, 0),
        },
      ),
    )
    const reply = projection.items[0]
    if (reply.kind !== 'assistant') throw new Error('expected an assistant item')
    expect(reply.segments).toHaveLength(1)
    const text = reply.segments[0]
    if (text.kind !== 'text') throw new Error('expected a text segment')
    expect(text.text).toBe('kept and grown')
  })
})

describe('seeded turns honour what their submission settled as', () => {
  it('marks the unfinished tail of a failed submission failed, not merely stopped', () => {
    // History is what a cold start knows. A message still being written when
    // its submission settled failed must not read as an ordinary pause --
    // interrupted means something, at the transcript layer too.
    const items = seededFrom({
      version: 1,
      conversationId: CONVERSATION,
      offset: '9_9',
      messages: [
        {
          id: 'a1',
          role: 'assistant',
          submissionId: SUBMISSION,
          timestamp: null,
          model: null,
          usage: null,
          parts: [{ kind: 'text', text: 'half a senten', state: 'streaming' }],
        },
      ],
      settlements: [
        { submissionId: SUBMISSION, outcome: 'failed', result: { present: false, value: undefined }, error: { present: false, name: null, type: null, message: null } },
      ],
    })
    const reply = items[0]
    if (reply.kind !== 'assistant') throw new Error('expected an assistant item')
    expect(reply.end).toEqual({ state: 'failed', reason: null })
  })

  it('leaves genuinely finished messages of a failed submission finished', () => {
    const items = seededFrom({
      version: 1,
      conversationId: CONVERSATION,
      offset: '9_9',
      messages: [
        {
          id: 'a1',
          role: 'assistant',
          submissionId: SUBMISSION,
          timestamp: null,
          model: null,
          usage: null,
          parts: [{ kind: 'text', text: 'done writing', state: 'done' }],
        },
      ],
      settlements: [
        { submissionId: SUBMISSION, outcome: 'aborted', result: { present: false, value: undefined }, error: { present: false, name: null, type: null, message: null } },
      ],
    })
    const reply = items[0]
    if (reply.kind !== 'assistant') throw new Error('expected an assistant item')
    expect(reply.end).toEqual({ state: 'complete' })
  })
})

describe('which message is being written right now', () => {
  // Minimal assistant items: the predicate reads only kind, end, and the
  // caller's position facts.
  const stoppedItem = {
    kind: 'assistant',
    id: 'm1',
    submissionId: null,
    model: null,
    segments: [],
    end: { state: 'stopped' },
    usage: null,
  } as const

  function withEnd(state: 'complete' | 'failed' | 'aborted') {
    return {
      ...stoppedItem,
      end:
        state === 'complete'
          ? { state }
          : { state, reason: state === 'failed' ? 'boom' : null },
    }
  }

  it('is only true while the turn runs, for the newest, unfinished message', () => {
    expect(isMessageBeingWritten(stoppedItem, { newest: true, turnRunning: true })).toBe(true)
    expect(isMessageBeingWritten(stoppedItem, { newest: false, turnRunning: true })).toBe(false)
    expect(isMessageBeingWritten(stoppedItem, { newest: true, turnRunning: false })).toBe(false)
  })

  it('never shows the caret on a finished or failed message', () => {
    expect(
      isMessageBeingWritten(withEnd('complete'), { newest: true, turnRunning: true }),
    ).toBe(false)
    expect(
      isMessageBeingWritten(withEnd('failed'), { newest: true, turnRunning: true }),
    ).toBe(false)
  })

  it('says nothing is being written for user items', () => {
    expect(
      isMessageBeingWritten(
        {
          kind: 'user',
          id: 'u1',
          submissionId: null,
          text: 'hi',
          attachments: [],
          timestamp: null,
        },
        { newest: true, turnRunning: true },
      ),
    ).toBe(false)
  })
})

/**
 * Task 26's adversarial cases, live side. The rule under test: a message
 * that closed without ever producing content is a retry attempt that never
 * spoke and is withdrawn into one visible failure; open messages take the
 * outcome; closed-with-content messages are never falsified by a later
 * failure. Content means a delta or tool input arrived -- nothing else.
 */
describe('a failed submission must not look like a completed one', () => {
  const SENTENCE = 'direct(sub_1) failed: 429 rate limit exceeded'

  function rateLimitedTurn() {
    // Four retry attempts, each closing cleanly with nothing in them --
    // the shape the real captured wire has (wire-contract.test.ts pins it).
    let projection = applyChunks(
      emptyProjection(),
      chunksOf(resetChunk(), {
        type: 'message-appended',
        message: {
          id: 'u1',
          role: 'user',
          submissionId: SUBMISSION,
          metadata: { timestamp: '2026-08-24T00:00:00Z' },
          parts: [{ type: 'text', text: '[fail] please answer.', state: 'done' }],
        },
        position: at(1),
      }),
    )
    for (let attempt = 0; attempt < 4; attempt += 1) {
      projection = applyChunks(
        projection,
        chunksOf(
          { type: 'message-started', messageId: `m${attempt}`, submissionId: SUBMISSION, position: at(2 + attempt * 2) },
          { type: 'message-completed', messageId: `m${attempt}`, position: at(3 + attempt * 2) },
        ),
      )
    }
    return projection
  }

  it('withdraws four silent attempts into one failure carrying the sentence', () => {
    const settled = applyChunks(
      rateLimitedTurn(),
      chunksOf({
        type: 'submission-settled',
        submissionId: SUBMISSION,
        outcome: 'failed',
        error: { name: 'FlueError', type: 'operation_failed', message: SENTENCE },
        position: at(10),
      }),
    )
    expect(settled.items).toHaveLength(2)
    const [, failure] = settled.items
    expect(failure).toMatchObject({
      kind: 'submission-failed',
      id: `${SUBMISSION}#settled`,
      submissionId: SUBMISSION,
      outcome: 'failed',
      reason: SENTENCE,
    })
    expect(settled.items.some((item) => item.kind === 'assistant')).toBe(false)
  })

  it('keeps content that streamed before the failure and marks its record failed', () => {
    let projection = applyChunks(
      emptyProjection(),
      chunksOf(
        resetChunk(),
        { type: 'message-started', messageId: 'm1', submissionId: SUBMISSION, position: at(1) },
        { type: 'message-delta', messageId: 'm1', kind: 'text', delta: 'half an answer', position: at(2) },
      ),
    )
    projection = applyChunks(
      projection,
      chunksOf({
        type: 'submission-settled',
        submissionId: SUBMISSION,
        outcome: 'failed',
        error: { message: SENTENCE },
        position: at(3),
      }),
    )
    // Content survives, now honestly labelled with the reason beside it.
    expect(projection.items).toHaveLength(1)
    const reply = projection.items[0]
    if (reply.kind !== 'assistant') throw new Error('expected an assistant item')
    expect(reply.end).toEqual({ state: 'failed', reason: SENTENCE })
    // A survivor stands, so there is nothing to replace with a card.
    expect(projection.items.some((item) => item.kind === 'submission-failed')).toBe(false)
  })

  it('never falsifies work a submission genuinely completed before failing late', () => {
    let projection = applyChunks(
      emptyProjection(),
      chunksOf(
        resetChunk(),
        { type: 'message-started', messageId: 'worker', submissionId: SUBMISSION, position: at(1) },
        { type: 'tool-input', messageId: 'worker', toolCallId: 't1', toolName: 'read', input: { p: 1 }, position: at(2) },
        { type: 'tool-output', toolCallId: 't1', output: 'contents', position: at(3) },
        { type: 'message-completed', messageId: 'worker', position: at(4) },
      ),
    )
    // Two more attempts of the same submission fail silently, then the turn.
    projection = applyChunks(
      projection,
      chunksOf(
        { type: 'message-started', messageId: 'retry', submissionId: SUBMISSION, position: at(5) },
        { type: 'message-completed', messageId: 'retry', position: at(6) },
        {
          type: 'submission-settled',
          submissionId: SUBMISSION,
          outcome: 'failed',
          error: { message: SENTENCE },
          position: at(7),
        },
      ),
    )
    expect(projection.items).toHaveLength(1)
    const worker = projection.items[0]
    if (worker?.kind !== 'assistant') throw new Error('the working message vanished')
    // Real work keeps its real completion. A tool input is content too:
    // "content" was never a test over text.
    expect(worker.end).toEqual({ state: 'complete' })
    expect(worker.segments).toHaveLength(1)
  })

  it('renders a failure with no error object as a failure with an unknown reason', () => {
    const settled = applyChunks(
      rateLimitedTurn(),
      chunksOf({
        type: 'submission-settled',
        submissionId: SUBMISSION,
        outcome: 'failed',
        position: at(10),
      }),
    )
    expect(settled.items).toHaveLength(2)
    const [, failure] = settled.items
    if (failure?.kind !== 'submission-failed') throw new Error('no failure item')
    // The outcome is stated; no cause is invented.
    expect(failure.outcome).toBe('failed')
    expect(failure.reason).toBeNull()
  })

  it('applies a redelivered batch containing the failed settlement exactly once', () => {
    const settled = applyChunks(
      rateLimitedTurn(),
      chunksOf({
        type: 'submission-settled',
        submissionId: SUBMISSION,
        outcome: 'failed',
        error: { message: SENTENCE },
        position: at(10),
      }),
    )
    expect(applyChunks(settled, chunksOf({
      type: 'submission-settled',
      submissionId: SUBMISSION,
      outcome: 'failed',
      error: { message: SENTENCE },
      position: at(10),
    }))).toBe(settled)
  })

  it('leaves a legitimately silent model alone when the turn actually completed', () => {
    // The emptiness rule must never trip on the honest case: a model that
    // answers with nothing, successfully. Under a COMPLETED settlement
    // nothing is withdrawn and nothing is marked.
    let projection = applyChunks(
      emptyProjection(),
      chunksOf(
        resetChunk(),
        { type: 'message-started', messageId: 'quiet', submissionId: SUBMISSION, position: at(1) },
        { type: 'message-completed', messageId: 'quiet', position: at(2) },
        {
          type: 'submission-settled',
          submissionId: SUBMISSION,
          outcome: 'completed',
          position: at(3),
        },
      ),
    )
    expect(projection.items).toHaveLength(1)
    const quiet = projection.items[0]
    if (quiet?.kind !== 'assistant') throw new Error('expected an assistant item')
    expect(quiet.end).toEqual({ state: 'complete' })
  })
})

describe('a cold start applies the same failure rule to history-shaped snapshots', () => {
  const SENTENCE = 'direct(sub_1) failed: 429 rate limit exceeded'

  function failedHistory(): ConversationSnapshotFacts {
    return {
      version: 1,
      conversationId: CONVERSATION,
      offset: '9_9',
      messages: [
        {
          id: 'u1',
          role: 'user',
          submissionId: SUBMISSION,
          timestamp: null,
          model: null,
          usage: null,
          parts: [{ kind: 'text', text: '[fail] please answer.', state: 'done' }],
        },
        // History's own shape for the attempts: assistant messages with NO
        // submissionId and empty parts, exactly as a real harness returns
        // them (pinned verbatim in wire-contract.test.ts).
        ...[0, 1, 2].map((attempt) => ({
          id: `a${attempt}`,
          role: 'assistant' as const,
          submissionId: null,
          timestamp: null,
          model: null,
          usage: null,
          parts: [],
        })),
      ],
      settlements: [
        {
          submissionId: SUBMISSION,
          outcome: 'failed' as const,
          result: { present: false, value: undefined },
          error: { present: true, name: 'FlueError', type: 'operation_failed', message: SENTENCE },
        },
      ],
    }
  }

  it('associates unmarked attempts by position and collapses them into the failure', () => {
    const items = seededFrom(failedHistory())
    expect(items).toHaveLength(2)
    const [, failure] = items
    expect(failure).toMatchObject({
      kind: 'submission-failed',
      submissionId: SUBMISSION,
      reason: SENTENCE,
    })
    expect(items.some((item) => item.kind === 'assistant')).toBe(false)
  })

  it('still honours an explicit submissionId when a snapshot carries one', () => {
    const snapshot = failedHistory()
    const items = seededFrom({
      ...snapshot,
      messages: [
        ...snapshot.messages.slice(0, 1),
        ...snapshot.messages.slice(1).map((message) => ({ ...message, submissionId: SUBMISSION })),
      ],
    })
    expect(items).toHaveLength(2)
    expect(items[1]).toMatchObject({ kind: 'submission-failed', reason: SENTENCE })
  })

  it('leaves another turn between the two user messages entirely alone', () => {
    const base = failedHistory()
    const snapshot: ConversationSnapshotFacts = {
      ...base,
      messages: [
        ...base.messages,
        {
          id: 'u2',
          role: 'user' as const,
          submissionId: null,
          timestamp: null,
          model: null,
          usage: null,
          parts: [{ kind: 'text' as const, text: 'next question', state: 'done' as const }],
        },
        {
          id: 'later',
          role: 'assistant' as const,
          submissionId: null,
          timestamp: null,
          model: null,
          usage: null,
          parts: [{ kind: 'text' as const, text: 'a good answer', state: 'done' as const }],
        },
      ],
    }
    const items = seededFrom(snapshot)
    // The failed turn collapsed; the LATER answer, which sits beyond the
    // next user message, is nobody's retry attempt and stays complete.
    expect(items.map((item) => item.kind)).toEqual([
      'user',
      'submission-failed',
      'user',
      'assistant',
    ])
    const last = items.at(-1)
    if (last?.kind !== 'assistant') throw new Error('expected the later answer')
    expect(last.end).toEqual({ state: 'complete' })
  })
})
