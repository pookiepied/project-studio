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
 * Both seams are injected — the invoke and the channel constructor — so
 * nothing here touches Tauri or a harness. What is asserted is the wire
 * behaviour the app depends on: where requests go, what a receipt must look
 * like, that a cold start is history FIRST and updates AFTER it, and above
 * all that the tracked offset survives an interruption and seeds the next
 * attach. A test that fails without the offset tracking is the one this file
 * exists to keep.
 *
 * The request shapes here were confirmed against a live harness: history
 * refuses `offset`/`live` outright, and a conversation with no stream yet
 * answers 404 — both are pinned below so neither can quietly regress.
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

/** One snapshot body the way the harness writes it, at a given tail offset. */
function snapshotBody(offset: string): string {
  return JSON.stringify({
    v: 1,
    conversationId: 'conv_1',
    offset,
    messages: [],
    settlements: [],
  })
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
const UPDATES_PATH = `/agents/studio/${CONVERSATION}?view=updates`

describe('submitting a turn', () => {
  it('posts to the agent route with the caller-chosen conversation id and parses the receipt', async () => {
    const { invoke, calls } = scriptedInvoke({
      service_fetch: () => serviceResponse(200, admission('sub_1', '7_2')),
    })
    const client = createConversationClient({ conversationId: CONVERSATION, invoke })

    const result = await client.submitTurn('hello', {
      modelId: 'google/gemini-3.5-flash',
      reasoningLevel: 'high',
    })

    expect(result).toEqual({ ok: true, value: { submissionId: 'sub_1', offset: '7_2' } })
    expect(calls).toHaveLength(1)
    expect(calls[0].command).toBe('service_fetch')
    expect(calls[0].args['service']).toBe('harness')
    expect(calls[0].args['path']).toBe(`/agents/studio/${CONVERSATION}`)
    const init = calls[0].args['init'] as { method: string; body: string }
    expect(init.method).toBe('POST')
    // The words ride the 2.0 delivered-message envelope; the settings sit at
    // the top level beside it, spelled exactly as the harness contract names
    // them, where the turn-settings middleware reads them.
    expect(JSON.parse(init.body)).toEqual({
      kind: 'user',
      body: 'hello',
      modelId: 'google/gemini-3.5-flash',
      reasoningLevel: 'high',
    })
  })

  it('omits the model key when the turn rides the default, and never sends a null', async () => {
    const { invoke, calls } = scriptedInvoke({
      service_fetch: () => serviceResponse(200, admission('sub_1', '7_2')),
    })
    const client = createConversationClient({ conversationId: CONVERSATION, invoke })

    await client.submitTurn('hello', { modelId: null, reasoningLevel: 'default' })

    const init = calls[0]?.args['init'] as { body: string }
    expect(JSON.parse(init.body)).toEqual({ kind: 'user', body: 'hello', reasoningLevel: 'default' })
  })

  it('carries the permission mode in the harness vocabulary, and omits it when the stored mode stands', async () => {
    const { invoke, calls } = scriptedInvoke({
      service_fetch: () => serviceResponse(200, admission('sub_1', '7_2')),
    })
    const client = createConversationClient({ conversationId: CONVERSATION, invoke })

    await client.submitTurn('hello', {
      modelId: null,
      reasoningLevel: 'default',
      permissionMode: 'full-auto',
    })

    const init = calls[0]?.args['init'] as { body: string }
    // The wire value is the one the admission boundary validates; the
    // picker's `auto` never reaches the body.
    expect(JSON.parse(init.body)).toEqual({
      kind: 'user',
      body: 'hello',
      reasoningLevel: 'default',
      permissionMode: 'full-auto',
    })

    await client.submitTurn('hello', { modelId: null, reasoningLevel: 'default' })

    const later = calls[1]?.args['init'] as { body: string }
    expect(JSON.parse(later.body)).not.toHaveProperty('permissionMode')
  })

  it('carries images under attachments in the Flue delivered-attachment shape', async () => {
    const { invoke, calls } = scriptedInvoke({
      service_fetch: () => serviceResponse(200, admission('sub_1', '7_2')),
    })
    const client = createConversationClient({ conversationId: CONVERSATION, invoke })

    await client.submitTurn(
      'look at this',
      { modelId: 'openai/gpt-4o', reasoningLevel: 'default' },
      [
        { type: 'image', data: 'aGk=', mimeType: 'image/png', filename: 'shot.png' },
        { type: 'image', data: 'aGk=', mimeType: 'image/jpeg' },
      ],
    )

    const init = calls[0]?.args['init'] as { body: string }
    // 2.0 renamed the payload field: 1.0's `images` key is stripped at
    // validation, so the images must travel under `attachments`.
    expect(JSON.parse(init.body)).toEqual({
      kind: 'user',
      body: 'look at this',
      modelId: 'openai/gpt-4o',
      reasoningLevel: 'default',
      attachments: [
        { type: 'image', data: 'aGk=', mimeType: 'image/png', filename: 'shot.png' },
        { type: 'image', data: 'aGk=', mimeType: 'image/jpeg' },
      ],
    })
  })

  it('sends a text-only turn with no attachments key at all', async () => {
    const { invoke, calls } = scriptedInvoke({
      service_fetch: () => serviceResponse(200, admission('sub_1', '7_2')),
    })
    const client = createConversationClient({ conversationId: CONVERSATION, invoke })

    await client.submitTurn('hello', { modelId: null, reasoningLevel: 'default' }, [])

    const init = calls[0]?.args['init'] as { body: string }
    expect(init.body).not.toContain('attachments')
    expect(JSON.parse(init.body)).toEqual({ kind: 'user', body: 'hello', reasoningLevel: 'default' })
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

  it('reads Flue own nested refusal envelope as the sentence a person can act on', async () => {
    const { invoke } = scriptedInvoke({
      // The 2.0 shape, verbatim from a live harness: the flat `error` string
      // our own refusals send is replaced by a nested object whose `details`
      // carries the reason and whose `message` is only the class sentence.
      service_fetch: () =>
        serviceResponse(
          400,
          JSON.stringify({
            error: {
              type: 'invalid_request',
              message: 'Request is malformed.',
              details:
                'Delivered messages must be { kind: "user", body: string, attachments?: attachment[] }.',
            },
          }),
        ),
    })
    const client = createConversationClient({ conversationId: CONVERSATION, invoke })

    const result = await client.submitTurn('hello')

    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'refused',
        status: 400,
        message:
          'Delivered messages must be { kind: "user", body: string, attachments?: attachment[] }.',
      },
    })
  })

  it('falls back to the envelope class sentence when no details rode along', async () => {
    const { invoke } = scriptedInvoke({
      service_fetch: () =>
        serviceResponse(
          400,
          JSON.stringify({ error: { type: 'invalid_request', message: 'Request is malformed.' } }),
        ),
    })
    const client = createConversationClient({ conversationId: CONVERSATION, invoke })

    const result = await client.submitTurn('hello')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.kind).toBe('refused')
      expect(result.error.message).toBe('Request is malformed.')
    }
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
  it('cold starts with history first, then opens updates strictly after the snapshot offset', async () => {
    // THE sequence the protocol prescribes when local state is unavailable:
    // an updates connection resumed without its projection state would
    // render deltas whose messages never began. The live harness refuses a
    // bare path too — Rust appends offset/live, which history rejects —
    // so the old bare-path request was refused on EVERY attach.
    let streamOpened = false
    const { invoke, calls } = scriptedInvoke({
      service_fetch: (args) => {
        // History must be asked for before any stream exists, by path, with
        // no offset or live parameter — those are exactly what it refuses.
        if (streamOpened) throw new Error('history read after the stream opened')
        const init = args['init'] as { method: string }
        expect(init.method).toBe('GET')
        return serviceResponse(200, snapshotBody('0000000000000000_0000000000000007'))
      },
      service_stream: (args) => {
        streamOpened = true
        expect(args['offset']).toBe('0000000000000000_0000000000000007')
        return new Promise<void>(() => {})
      },
    })
    const { factory, feeds } = recordingChannels()
    const client = createConversationClient({ conversationId: CONVERSATION, invoke, createChannel: factory })

    const deliveries: ConversationDelivery[] = []
    client.attach({ onEvent: (delivery) => deliveries.push(delivery) })
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    const fetches = calls.filter((call) => call.command === 'service_fetch')
    expect(fetches).toHaveLength(1)
    expect(fetches[0].args['path']).toBe(`/agents/studio/${CONVERSATION}?view=history`)
    expect(calls.filter((call) => call.command === 'service_stream')).toHaveLength(1)
    expect(calls.find((call) => call.command === 'service_stream')?.args['path']).toBe(UPDATES_PATH)

    expect(deliveries.map((delivery) => delivery.kind)).toEqual(['snapshot'])
    const snapshot = deliveries[0]
    if (snapshot.kind !== 'snapshot') throw new Error('expected the snapshot first')
    expect(snapshot.offset).toBe('0000000000000000_0000000000000007')
    expect(client.lastOffset()).toBe('0000000000000000_0000000000000007')

    // And what arrives on the updates connection is still classified as before.
    feeds[0]({ kind: 'up-to-date', offset: '0000000000000000_0000000000000008' })
    expect(deliveries.map((delivery) => delivery.kind)).toEqual(['snapshot', 'up-to-date'])
  })

  it('reports a fresh conversation as absent instead of dressing a 404 up as a break', async () => {
    // The harness creates the stream when the agent instance receives its
    // first prompt. A conversation nobody has spoken into has none, the
    // history view says 404, and there is nothing to attach to — a normal
    // state a first submission leaves, never a broken read.
    const { invoke, calls } = scriptedInvoke({
      service_fetch: () =>
        serviceResponse(
          404,
          JSON.stringify({
            error: { type: 'stream_not_found', message: 'was not found' },
          }),
        ),
    })
    const { factory } = recordingChannels()
    const client = createConversationClient({ conversationId: CONVERSATION, invoke, createChannel: factory })

    const deliveries: ConversationDelivery[] = []
    const handle = client.attach({ onEvent: (delivery) => deliveries.push(delivery) })
    await handle.settled

    expect(deliveries).toEqual([{ kind: 'absent', offset: '-1' }])
    await expect(handle.settled).resolves.toEqual({ outcome: 'absent' })
    expect(calls.some((call) => call.command === 'service_stream')).toBe(false)
  })

  it('carries a history refusal into the settlement with its status', async () => {
    const { invoke } = scriptedInvoke({
      service_fetch: () => serviceResponse(403, JSON.stringify({ error: 'admission denied' })),
    })
    const { factory } = recordingChannels()
    const client = createConversationClient({ conversationId: CONVERSATION, invoke, createChannel: factory })

    const handle = client.attach({ onEvent: () => {} })
    await expect(handle.settled).resolves.toEqual({
      outcome: 'refused',
      failure: { kind: 'refused', status: 403, message: 'admission denied' },
    })
  })

  it('settles broken when the history answer breaks the mirror', async () => {
    for (const body of ['not json', JSON.stringify({ v: 'one' })]) {
      const { invoke } = scriptedInvoke({
        service_fetch: () => serviceResponse(200, body),
      })
      const { factory } = recordingChannels()
      const client = createConversationClient({ conversationId: CONVERSATION, invoke, createChannel: factory })
      const handle = client.attach({ onEvent: () => {} })
      const settlement = await handle.settled
      expect(settlement.outcome).toBe('broken')
      if (settlement.outcome !== 'broken') continue
      expect(settlement.failure.kind).toBe('malformed')
    }
  })

  it('resumes from the last delivered offset on the next attach, over the updates view', async () => {
    // THE test of this task: events advance the tracked offset; a fresh
    // attach after the interruption reads FROM there.
    const { invoke, calls } = cancellableStreams()
    const { factory, feeds } = recordingChannels()
    const client = createConversationClient({ conversationId: CONVERSATION, invoke, createChannel: factory })

    const first = client.attach({ onEvent: () => {} }, { from: '-1' })
    feeds[0]({ kind: 'frame', offset: '4_0', event: 'data', data: '[{"type":"log"}]' })
    feeds[0]({ kind: 'up-to-date', offset: '5_1' })
    expect(client.lastOffset()).toBe('5_1')

    await first.cancel()
    client.attach({ onEvent: () => {} })
    const reads = calls.filter((call) => call.command === 'service_stream')
    expect(reads).toHaveLength(2)
    expect(reads[1].args['offset']).toBe('5_1')
    expect(reads[1].args['path']).toBe(UPDATES_PATH)
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
    client.attach({ onEvent: (delivery) => deliveries.push(delivery) }, { from: '-1' })

    feeds[0]({
      kind: 'frame',
      offset: '6_0',
      event: 'data',
      data: JSON.stringify([
        { type: 'message-started', messageId: 'm1', submissionId: 'sub_9', timestamp: '2026-08-24T00:00:00Z', position: { batch: 6, index: 0 } },
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
        position: { batch: 6, index: 0 },
        messageId: 'm1',
        submissionId: 'sub_9',
        outcome: null,
        snapshot: null,
        message: null,
        model: null,
        timestamp: '2026-08-24T00:00:00Z',
        deltaKind: null,
        delta: null,
        toolCallId: null,
        toolName: null,
        input: null,
        output: null,
        errorText: null,
        errorName: null,
        errorType: null,
        errorMessage: null,
        usage: null,
        attempt: null,
        maxRetries: null,
        delayMs: null,
      },
      // An unrecognised type survives as a fact carrying only its position,
      // because dropping it would desync position dedupe.
      {
        type: 'submission-settled',
        position: null,
        messageId: null,
        submissionId: 'sub_9',
        outcome: 'failed',
        snapshot: null,
        message: null,
        model: null,
        timestamp: null,
        deltaKind: null,
        delta: null,
        toolCallId: null,
        toolName: null,
        input: null,
        output: null,
        errorText: null,
        errorName: null,
        errorType: null,
        errorMessage: null,
        usage: null,
        attempt: null,
        maxRetries: null,
        delayMs: null,
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
    client.attach({ onEvent: (delivery) => deliveries.push(delivery) }, { from: '-1' })

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

    const handle = client.attach({ onEvent: () => {} }, { from: '-1' })
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

    const handle = client.attach({ onEvent: () => {} }, { from: '-1' })
    feeds[0]({ kind: 'up-to-date', offset: '8_8' })

    await expect(handle.settled).resolves.toEqual({
      outcome: 'broken',
      failure: { kind: 'broken', message: 'no bytes for 45s' },
    })
    // The whole point of retaining it: the next attach knows where to go.
    expect(client.lastOffset()).toBe('8_8')
  })

  it('delivers nothing from a superseded cold start whose history landed late', async () => {
    // Held in a property, not a bare `let`: the assignment happens inside a
    // callback, and control-flow narrowing would call it `never` here.
    const release: { history: ((value: unknown) => void) | null } = { history: null }
    const { invoke } = scriptedInvoke({
      service_fetch: () =>
        new Promise((resolve) => {
          release.history = resolve
        }),
    })
    const streams = cancellableStreams()
    const invokeBoth: ServiceInvoke = async (command, args) =>
      command === 'service_fetch' ? invoke(command, args) : streams.invoke(command, args)
    const { factory } = recordingChannels()
    const client = createConversationClient({ conversationId: CONVERSATION, invoke: invokeBoth, createChannel: factory })

    const deliveries: ConversationDelivery[] = []
    const first = client.attach({ onEvent: (delivery) => deliveries.push(delivery) })
    await first.cancel()
    client.attach({ onEvent: () => {} }, { from: '-1' })

    release.history?.(serviceResponse(200, snapshotBody('9_9')))
    for (let index = 0; index < 5; index += 1) await Promise.resolve()

    expect(deliveries).toEqual([])
    expect(streams.calls.filter((call) => call.command === 'service_stream')).toHaveLength(1)
  })

  it('cancels its read through the registry without touching the run', async () => {
    const { invoke, calls } = scriptedInvoke({ service_stream: () => new Promise(() => {}) })
    const { factory } = recordingChannels()
    const client = createConversationClient({ conversationId: CONVERSATION, invoke, createChannel: factory })

    const handle = client.attach({ onEvent: () => {} }, { from: '-1' })
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
    await expect(other.attach({ onEvent: () => {} }, { from: '-1' }).cancel()).resolves.toBeUndefined()
  })

  it('supersedes the previous read instead of stacking a second one', async () => {
    const { invoke, calls } = cancellableStreams()
    const { factory } = recordingChannels()
    const client = createConversationClient({ conversationId: CONVERSATION, invoke, createChannel: factory })

    const first = client.attach({ onEvent: () => {} }, { from: '-1' })
    client.attach({ onEvent: () => {} }, { from: '-1' })

    const cancelIds = calls
      .filter((call) => call.command === 'service_stream_cancel')
      .map((call) => call.args['streamId'])
    expect(cancelIds).toHaveLength(1)
    expect(cancelIds[0]).toBe(calls[0].args['streamId'])
    // The superseded read settles cancelled — the fake resolves it when its
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

/**
 * What a cancelled read must stop doing.
 *
 * `cancel()` is asynchronous by nature: the registry stops the reader in
 * Rust, but frames already in the channel's queue still arrive afterwards.
 * A superseded read that keeps delivering is not merely untidy — it writes
 * the client's tracked offset, and an older read's late frame can drag that
 * offset BACKWARDS past what the newer read has already seen.
 */
describe('a read that has been cancelled', () => {
  it('delivers nothing once cancelled, and never moves the tracked offset backwards', async () => {
    const { invoke } = cancellableStreams()
    const channels = recordingChannels()
    const client = createConversationClient({
      conversationId: CONVERSATION,
      invoke,
      createChannel: channels.factory,
    })

    const deliveries: ConversationDelivery[] = []
    const handle = client.attach(
      { onEvent: (delivery) => deliveries.push(delivery) },
      { from: '4_0' },
    )
    const feed = channels.feeds[0]
    if (feed === undefined) throw new Error('no channel')

    feed({ kind: 'keep-alive', offset: '9_9' })
    expect(client.lastOffset()).toBe('9_9')
    const delivered = deliveries.length

    await handle.cancel()

    // A frame that was already in flight when the cancel landed.
    feed({ kind: 'keep-alive', offset: '2_0' })

    expect(deliveries).toHaveLength(delivered)
    expect(client.lastOffset()).toBe('9_9')
  })

  it('settles a cold start cancelled while its history read is still in flight', async () => {
    let releaseHistory!: (answer: unknown) => void
    const { invoke } = scriptedInvoke({
      service_fetch: () => new Promise((resolve) => { releaseHistory = resolve }),
      service_stream: () => new Promise<void>(() => {}),
      service_stream_cancel: async () => undefined,
    })
    const channels = recordingChannels()
    const client = createConversationClient({
      conversationId: CONVERSATION,
      invoke,
      createChannel: channels.factory,
    })

    // No retained offset: this is the history-first cold start.
    const handle = client.attach({ onEvent: () => {} })
    await handle.cancel()
    releaseHistory(serviceResponse(200, snapshotBody('3_0')))

    // Nothing else will ever settle this read; if cancel does not, the
    // promise hangs for the lifetime of the page.
    const settlement = await Promise.race([
      handle.settled,
      new Promise((resolve) => setTimeout(() => resolve('hung'), 50)),
    ])
    expect(settlement).toEqual({ outcome: 'cancelled' })
    expect(client.attached()).toBe(false)
  })
})

/**
 * The parse guard must guard the PARSE.
 *
 * A frame that is not a chunk batch is delivered raw, and deciding that
 * requires a try. But the decision is about the DATA, not about what the
 * consumer then does with it: a reducer that throws must not be told the
 * same bytes twice in a second shape, and its failure must not be swallowed
 * into a fallback that looks like a protocol judgement.
 */
describe('a consumer that throws on a chunk batch', () => {
  it('is not handed the same frame again as raw data', () => {
    const { invoke } = cancellableStreams()
    const channels = recordingChannels()
    const client = createConversationClient({
      conversationId: CONVERSATION,
      invoke,
      createChannel: channels.factory,
    })

    const kinds: string[] = []
    client.attach(
      {
        onEvent: (delivery) => {
          kinds.push(delivery.kind)
          if (delivery.kind === 'chunks') throw new Error('reducer blew up')
        },
      },
      { from: '-1' },
    )
    const feed = channels.feeds[0]
    if (feed === undefined) throw new Error('no channel')

    const batch = JSON.stringify([{ type: 'message-delta', position: { batch: 1, index: 0 } }])
    expect(() => feed({ kind: 'frame', offset: '1_0', event: 'data', data: batch })).toThrow(
      'reducer blew up',
    )

    expect(kinds).toEqual(['chunks'])
  })
})
