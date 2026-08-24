import { describe, expect, it } from 'vitest'

import type { WireStreamEvent } from './contracts'
import {
  createConversationClient,
  type ConversationDelivery,
  type ServiceInvoke,
  type StreamChannel,
} from './conversation'

/**
 * The conversation client against scripted answers.
 *
 * Both seams are injected -- the invoke and the channel constructor -- so
 * nothing here touches Tauri or a harness. What is asserted is the wire
 * behaviour the app depends on: where requests go, what a receipt must look
 * like, and above all that the tracked offset survives an interruption and
 * seeds the next attach. A test that fails without the offset tracking is
 * the one this file exists to keep.
 */

interface RecordedCall {
  readonly command: string
  readonly args: Record<string, unknown>
}

/**
 * An invoke that records every call and answers from a per-command script.
 * Unscripted commands fail loudly rather than answering `undefined`, which
 * would read as a malformed response and muddle the failure under test.
 */
function scriptedInvoke(script: {
  [command: string]: (args: Record<string, unknown>) => unknown
}): { invoke: ServiceInvoke; calls: RecordedCall[] } {
  const calls: RecordedCall[] = []
  const invoke: ServiceInvoke = async (command, args) => {
    const recorded: RecordedCall = { command, args: args ?? {} }
    calls.push(recorded)
    const respond = script[command]
    if (respond === undefined) throw new Error(`no scripted answer for ${command}`)
    return respond(recorded.args)
  }
  return { invoke, calls }
}

/** The channels the client built, in order, each feedable by a test. */
function recordingChannels(): {
  factory: (onMessage: (message: WireStreamEvent) => void) => StreamChannel
  feeds: Array<(event: WireStreamEvent) => void>
} {
  const feeds: Array<(event: WireStreamEvent) => void> = []
  return {
    factory: (onMessage) => {
      feeds.push(onMessage)
      return { id: feeds.length }
    },
    feeds,
  }
}

/** One admission receipt the way Flue writes it. */
function admission(submissionId: string, offset: string): string {
  return JSON.stringify({ submissionId, streamUrl: '/agents/studio/c1', offset })
}

function serviceResponse(status: number, body: string): unknown {
  return { status, headers: [['content-type', 'application/json']], body }
}

/**
 * A stream script that behaves like the real seam on cancellation: Rust
 * resolves `service_stream` with Ok once the registry stops the read, so a
 * cancelled handle's settlement is observable without any frames.
 */
function cancellableStreams(): { invoke: ServiceInvoke; calls: RecordedCall[] } {
  const resolvers = new Map<string, () => void>()
  return scriptedInvoke({
    service_stream: (args) =>
      new Promise<void>((resolve) => {
        resolvers.set(String(args['streamId']), () => resolve())
      }),
    service_stream_cancel: async (args) => {
      const resolve = resolvers.get(String(args['streamId']))
      if (resolve === undefined) throw new Error('cancelled a stream that was never reading')
      resolve()
      resolvers.delete(String(args['streamId']))
      return undefined
    },
  })
}

const CONVERSATION = 'cnv_test_01'

describe('submitting a turn', () => {
  it('posts to the agent route with the caller-chosen conversation id and parses the receipt', async () => {
    const { invoke, calls } = scriptedInvoke({
      service_fetch: () => serviceResponse(200, admission('sub_1', '7_2')),
    })
    const client = createConversationClient({ conversationId: CONVERSATION, invoke })

    const result = await client.submitTurn('hello')

    expect(result).toEqual({ ok: true, value: { submissionId: 'sub_1', offset: '7_2' } })
    expect(calls).toHaveLength(1)
    expect(calls[0].command).toBe('service_fetch')
    expect(calls[0].args['service']).toBe('harness')
    expect(calls[0].args['path']).toBe(`/agents/studio/${CONVERSATION}`)
    const init = calls[0].args['init'] as { method: string; body: string }
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ message: 'hello' })
  })

  it('keeps the harness refusal together with its status and its own sentence', async () => {
    const { invoke } = scriptedInvoke({
      service_fetch: () => serviceResponse(403, JSON.stringify({ error: 'admission denied' })),
    })
    const client = createConversationClient({ conversationId: CONVERSATION, invoke })

    const result = await client.submitTurn('hello')

    expect(result).toEqual({
      ok: false,
      error: { kind: 'refused', status: 403, message: 'admission denied' },
    })
  })

  it('reports a success whose body breaks the contract as malformed, not as a turn', async () => {
    for (const body of ['not json at all', JSON.stringify({ submissionId: 'sub_1' })]) {
      const { invoke } = scriptedInvoke({
        service_fetch: () => serviceResponse(200, body),
      })
      const client = createConversationClient({ conversationId: CONVERSATION, invoke })
      const result = await client.submitTurn('hello')
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.kind).toBe('malformed')
    }
  })

  it('answers a not-running supervisor with no-harness', async () => {
    const { invoke } = scriptedInvoke({
      service_fetch: () => {
        throw { kind: 'not-running' }
      },
    })
    const client = createConversationClient({ conversationId: CONVERSATION, invoke })

    const result = await client.submitTurn('hello')

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.kind).toBe('no-harness')
  })
})

describe('attaching to a run', () => {
  it('reads from -1 when nothing has been seen yet, over the streaming seam', async () => {
    const { invoke, calls } = scriptedInvoke({ service_stream: () => undefined })
    const { factory } = recordingChannels()
    const client = createConversationClient({ conversationId: CONVERSATION, invoke, createChannel: factory })

    client.attach({ onEvent: () => {} })

    expect(client.attached()).toBe(true)
    expect(calls[0].command).toBe('service_stream')
    expect(calls[0].args['service']).toBe('harness')
    expect(calls[0].args['path']).toBe(`/agents/studio/${CONVERSATION}`)
    expect(calls[0].args['offset']).toBe('-1')
    expect(typeof calls[0].args['streamId']).toBe('string')
  })

  it('resumes from the last delivered offset on the next attach', async () => {
    // THE test of this task: events advance the tracked offset; a fresh
    // attach after the interruption reads FROM there.
    const { invoke, calls } = scriptedInvoke({ service_stream: () => undefined })
    const { factory, feeds } = recordingChannels()
    const client = createConversationClient({ conversationId: CONVERSATION, invoke, createChannel: factory })

    const first = client.attach({ onEvent: () => {} })
    feeds[0]({ kind: 'frame', offset: '4_0', event: 'data', data: '[{"type":"log"}]' })
    feeds[0]({ kind: 'up-to-date', offset: '5_1' })
    expect(client.lastOffset()).toBe('5_1')

    await first.cancel()
    client.attach({ onEvent: () => {} })
    expect(calls.filter((call) => call.command === 'service_stream')).toHaveLength(2)
    expect(calls.at(-1)?.args['offset']).toBe('5_1')
  })

  it('honours an explicit starting offset, including -1 for the beginning', async () => {
    const { invoke, calls } = cancellableStreams()
    const { factory, feeds } = recordingChannels()
    const client = createConversationClient({ conversationId: CONVERSATION, invoke, createChannel: factory })

    const first = client.attach({ onEvent: () => {} }, { from: '-1' })
    feeds[0]({ kind: 'keep-alive', offset: '2_0' })
    await first.cancel()

    client.attach({ onEvent: () => {} }, { from: '-1' })
    const reads = calls.filter((call) => call.command === 'service_stream')
    expect(reads).toHaveLength(2)
    expect(reads.every((call) => call.args['offset'] === '-1')).toBe(true)
  })

  it('classifies deliveries: chunk batches, foreign frames, liveness, and the end', async () => {
    const { invoke } = scriptedInvoke({ service_stream: () => new Promise(() => {}) })
    const { factory, feeds } = recordingChannels()
    const client = createConversationClient({ conversationId: CONVERSATION, invoke, createChannel: factory })

    const deliveries: ConversationDelivery[] = []
    client.attach({ onEvent: (delivery) => deliveries.push(delivery) })

    feeds[0]({
      kind: 'frame',
      offset: '6_0',
      event: 'data',
      data: JSON.stringify([
        { type: 'message-started', messageId: 'm1', submissionId: 'sub_9', position: { batch: 6, index: 0 } },
        { noTypeHere: true },
        { type: 'submission-settled', outcome: 'failed', submissionId: 'sub_9' },
      ]),
    })
    feeds[0]({ kind: 'frame', offset: '6_1', event: 'presence', data: '{"who":"me"}' })
    feeds[0]({ kind: 'keep-alive', offset: '6_1' })
    feeds[0]({ kind: 'ended', offset: '7_0' })

    const kinds = deliveries.map((delivery) => delivery.kind)
    expect(kinds).toEqual(['chunks', 'frame', 'keep-alive', 'ended'])
    const batch = deliveries[0]
    if (batch.kind !== 'chunks') throw new Error('expected chunks first')
    expect(batch.replaying).toBe(true)
    expect(batch.chunks).toEqual([
      {
        type: 'message-started',
        messageId: 'm1',
        submissionId: 'sub_9',
        position: { batch: 6, index: 0 },
        outcome: null,
      },
      {
        type: 'submission-settled',
        messageId: null,
        submissionId: 'sub_9',
        position: null,
        outcome: 'failed',
      },
    ])
    const foreign = deliveries[1]
    if (foreign.kind !== 'frame') throw new Error('expected the foreign frame passed through')
    expect(foreign.event).toBe('presence')
    expect(foreign.data).toBe('{"who":"me"}')
  })

  it('stops calling a replay live once up-to-date has arrived', async () => {
    const { invoke } = scriptedInvoke({ service_stream: () => new Promise(() => {}) })
    const { factory, feeds } = recordingChannels()
    const client = createConversationClient({ conversationId: CONVERSATION, invoke, createChannel: factory })

    const deliveries: ConversationDelivery[] = []
    client.attach({ onEvent: (delivery) => deliveries.push(delivery) })

    feeds[0]({
      kind: 'frame',
      offset: '1_0',
      event: 'data',
      data: '[{"type":"message-appended","position":{"batch":1,"index":0}}]',
    })
    feeds[0]({ kind: 'up-to-date', offset: '2_0' })
    feeds[0]({
      kind: 'frame',
      offset: '3_0',
      event: 'data',
      data: '[{"type":"message-delta","position":{"batch":3,"index":0}}]',
    })

    const batches = deliveries.filter(
      (delivery): delivery is Extract<ConversationDelivery, { kind: 'chunks' }> =>
        delivery.kind === 'chunks',
    )
    expect(batches.map((batch) => batch.replaying)).toEqual([true, false])
  })

  it('settles ended when the close arrives, and once only', async () => {
    // Held in a property, not a bare `let`: the assignment happens inside a
    // callback, and control-flow narrowing would call it `never` here.
    const settle: { resolve: ((value: unknown) => void) | null } = { resolve: null }
    const { invoke } = scriptedInvoke({
      service_stream: () =>
        new Promise((resolve) => {
          settle.resolve = resolve
        }),
    })
    const { factory, feeds } = recordingChannels()
    const client = createConversationClient({ conversationId: CONVERSATION, invoke, createChannel: factory })

    const handle = client.attach({ onEvent: () => {} })
    feeds[0]({ kind: 'ended', offset: '9_0' })
    await expect(handle.settled).resolves.toEqual({ outcome: 'ended' })

    // Rust also resolves the command afterwards; the settlement is done.
    settle.resolve?.(undefined)
    await expect(handle.settled).resolves.toEqual({ outcome: 'ended' })
    expect(client.attached()).toBe(false)
  })

  it('settles broken when the stream breaks mid-read, keeping the offset', async () => {
    const { invoke } = scriptedInvoke({
      service_stream: () => {
        throw { kind: 'stream-broken', message: 'no bytes for 45s' }
      },
    })
    const { factory, feeds } = recordingChannels()
    const client = createConversationClient({ conversationId: CONVERSATION, invoke, createChannel: factory })

    const handle = client.attach({ onEvent: () => {} })
    feeds[0]({ kind: 'up-to-date', offset: '8_8' })

    await expect(handle.settled).resolves.toEqual({
      outcome: 'broken',
      failure: { kind: 'broken', message: 'no bytes for 45s' },
    })
    // The whole point of retaining it: the next attach knows where to go.
    expect(client.lastOffset()).toBe('8_8')
  })

  it('cancels its read through the registry without touching the run', async () => {
    const { invoke, calls } = scriptedInvoke({ service_stream: () => new Promise(() => {}) })
    const { factory } = recordingChannels()
    const client = createConversationClient({ conversationId: CONVERSATION, invoke, createChannel: factory })

    const handle = client.attach({ onEvent: () => {} })
    await handle.cancel()
    await handle.cancel()

    const cancels = calls.filter((call) => call.command === 'service_stream_cancel')
    expect(cancels).toHaveLength(2)
    expect(cancels[0].args['streamId']).toBe(calls.find((call) => call.command === 'service_stream')?.args['streamId'])
    // No abort route was anywhere in play: closing a reader is not aborting.
    expect(calls.some((call) => String(call.args['path']).endsWith('/abort'))).toBe(false)

    // And cancelling stays quiet even if the command itself fails.
    const failing = scriptedInvoke({
      service_stream: () => new Promise(() => {}),
      service_stream_cancel: () => {
        throw new Error('the webview is going away right now')
      },
    })
    const otherFeeds = recordingChannels()
    const other = createConversationClient({
      conversationId: CONVERSATION,
      invoke: failing.invoke,
      createChannel: otherFeeds.factory,
    })
    await expect(other.attach({ onEvent: () => {} }).cancel()).resolves.toBeUndefined()
  })

  it('supersedes the previous read instead of stacking a second one', async () => {
    const { invoke, calls } = cancellableStreams()
    const { factory } = recordingChannels()
    const client = createConversationClient({ conversationId: CONVERSATION, invoke, createChannel: factory })

    const first = client.attach({ onEvent: () => {} })
    client.attach({ onEvent: () => {} })

    const cancelIds = calls
      .filter((call) => call.command === 'service_stream_cancel')
      .map((call) => call.args['streamId'])
    expect(cancelIds).toHaveLength(1)
    expect(cancelIds[0]).toBe(calls[0].args['streamId'])
    // The superseded read settles cancelled -- the fake resolves it when its
    // cancel lands, exactly as the registry does in Rust.
    await expect(first.settled).resolves.toEqual({ outcome: 'cancelled' })
    expect(client.attached()).toBe(true)
  })
})

describe('aborting a run', () => {
  it('calls the abort route and reports what the harness said', async () => {
    const { invoke, calls } = scriptedInvoke({
      service_fetch: () => serviceResponse(200, JSON.stringify({ aborted: true })),
    })
    const client = createConversationClient({ conversationId: CONVERSATION, invoke })

    await expect(client.abortRun()).resolves.toEqual({ ok: true, value: true })
    expect(calls[0].args['path']).toBe(`/agents/studio/${CONVERSATION}/abort`)
  })

  it('refuses to guess when the answer does not say whether anything was aborted', async () => {
    for (const body of [JSON.stringify({}), 'garbage']) {
      const { invoke } = scriptedInvoke({
        service_fetch: () => serviceResponse(200, body),
      })
      const client = createConversationClient({ conversationId: CONVERSATION, invoke })
      const result = await client.abortRun()
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.kind).toBe('malformed')
    }
  })

  it('carries a refusal status and sentence from the abort route', async () => {
    const { invoke } = scriptedInvoke({
      service_fetch: () => serviceResponse(404, JSON.stringify({ error: 'no such agent instance' })),
    })
    const client = createConversationClient({ conversationId: CONVERSATION, invoke })

    const result = await client.abortRun()
    expect(result).toEqual({
      ok: false,
      error: { kind: 'refused', status: 404, message: 'no such agent instance' },
    })
  })
})
