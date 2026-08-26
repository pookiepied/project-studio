/**
 * @vitest-environment jsdom
 */
import { act, renderHook, waitFor } from '@testing-library/react'
import type { RenderHookResult } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type {
  ContactHarness,
  LifecycleListen,
  LifecycleSignal,
} from './useConversation'
import { useConversation } from './useConversation'
import {
  createConversationClient,
  type ConversationClient,
  type ServiceInvoke,
  type StreamChannel,
  type WireStreamEvent,
} from '@/platform/harness'

/**
 * The conversation state machine, end to end at the data layer.
 *
 * The hook runs against a REAL conversation client whose seams are scripted
 * — the same substitution pattern the settings pane tests use — so what is
 * exercised is everything below the component: lifecycle events, attach,
 * offset tracking, chunk reduction, and the prompt cancellation of a read
 * when the conversation changes or the hook goes away.
 */

interface RecordedCall {
  readonly command: string
  readonly args: Record<string, unknown>
}

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

/**
 * Streams whose command resolves when cancelled, exactly as Rust does:
 * `service_stream` answers Ok once the registry stops the read.
 *
 * The same script answers a cold start's history read, because every attach
 * without a retained offset is history FIRST and updates after it. Tests
 * that need a different history answer script `service_fetch` themselves.
 */
function cancellableStreams(): { invoke: ServiceInvoke; calls: RecordedCall[] } {
  const resolvers = new Map<string, () => void>()
  return scriptedInvoke({
    service_fetch: (args) => {
      const path = String(args['path'])
      if (!path.endsWith('?view=history')) {
        throw new Error(`unexpected fetch in this script: ${path}`)
      }
      return {
        status: 200,
        headers: [],
        body: JSON.stringify({
          v: 1,
          conversationId: 'conv_1',
          offset: '-1',
          messages: [],
          settlements: [],
        }),
      }
    },
    service_stream: (args) =>
      new Promise<void>((resolve) => {
        resolvers.set(String(args['streamId']), () => resolve())
      }),
    service_stream_cancel: (args) => {
      const resolve = resolvers.get(String(args['streamId']))
      if (resolve !== undefined) {
        resolve()
        resolvers.delete(String(args['streamId']))
      }
      return undefined
    },
  })
}

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

function manualLifecycle(): {
  listen: LifecycleListen
  emit: (signal: LifecycleSignal) => void
} {
  let handler: ((signal: LifecycleSignal) => void) | null = null
  return {
    listen: async (registered) => {
      handler = registered
      return () => {
        handler = null
      }
    },
    emit: (signal) => handler?.(signal),
  }
}

function contactFor(
  makeClient: () => ConversationClient,
): { contact: ContactHarness; swapClient: (client: ConversationClient) => void } {
  let client = makeClient()
  return {
    contact: async () => ({ kind: 'ready', client }),
    swapClient: (next) => {
      client = next
    },
  }
}

const ABSENT: ContactHarness = async () => ({ kind: 'absent' })
const STARTING: ContactHarness = async () => ({ kind: 'starting' })

function dataFrame(offset: string, chunks: unknown[]): WireStreamEvent {
  return { kind: 'frame', offset, event: 'data', data: JSON.stringify(chunks) }
}

/** Mounts against an always-ready scripted harness and waits for the attach. */
async function mountReady(
  invoke: ServiceInvoke,
  calls: RecordedCall[],
  factory: (onMessage: (message: WireStreamEvent) => void) => StreamChannel,
  listen: LifecycleListen,
): Promise<RenderHookResult<ReturnType<typeof useConversation>, string>> {
  const { contact } = contactFor(() =>
    createConversationClient({ conversationId: 'cnv_1', invoke, createChannel: factory }),
  )
  const rendered = renderHook((id: string) => useConversation(id, { contact, listen }), {
    initialProps: 'cnv_1',
  })
  await waitFor(() => expect(streamCount({ calls })).toBeGreaterThan(0))
  return rendered
}

function streamCount(callLog: { calls: RecordedCall[] }): number {
  return callLog.calls.filter((call) => call.command === 'service_stream').length
}

describe('the phases the harness itself puts a conversation in', () => {
  it('says so when there is no harness, and never attaches', async () => {
    const streams = cancellableStreams()
    // Hoisted: an inline listen would be a fresh dependency every render,
    // and the mount effect would chase its own tail forever.
    const lifecycle = manualLifecycle()
    const rendered = renderHook(
      (id: string) => useConversation(id, { contact: ABSENT, listen: lifecycle.listen }),
      { initialProps: 'cnv_1' },
    )

    await waitFor(() => expect(rendered.result.current.phase).toEqual({ status: 'no-harness' }))
    expect(streams.calls).toHaveLength(0)
  })

  it('uses the Task 23 starting state while the supervisor is coming up', async () => {
    const lifecycle = manualLifecycle()
    const rendered = renderHook(
      (id: string) => useConversation(id, { contact: STARTING, listen: lifecycle.listen }),
      { initialProps: 'cnv_1' },
    )

    await waitFor(() =>
      expect(rendered.result.current.phase).toEqual({ status: 'harness-starting' }),
    )
  })

  it('shows a crash mid-run as interrupted, then reattaches once, from the offset', async () => {
    const streams = cancellableStreams()
    const channels = recordingChannels()
    const lifecycle = manualLifecycle()
    const rendered = await mountReady(streams.invoke, streams.calls, channels.factory, lifecycle.listen)

    // A turn starts, then the harness process dies.
    act(() => {
      channels.feeds[0](
        dataFrame('3_0', [
          { type: 'message-started', submissionId: 'sub_1', position: { batch: 3, index: 0 } },
        ]),
      )
    })
    await waitFor(() => expect(rendered.result.current.phase.status).toBe('streaming'))
    act(() => {
      lifecycle.emit({ name: 'harness-failed', payload: 'the harness exited unexpectedly' })
    })
    expect(rendered.result.current.phase).toEqual({
      status: 'interrupted',
      reason: 'the harness exited unexpectedly',
    })

    // The supervisor restarts once, visibly; this hook is the visible part.
    // The reattach resumes from the last offset, without anyone asking twice.
    act(() => {
      lifecycle.emit({ name: 'harness-started' })
    })
    await waitFor(() => {
      const reads = streams.calls.filter((call) => call.command === 'service_stream')
      expect(reads).toHaveLength(2)
      expect(reads[1].args['offset']).toBe('3_0')
    })
    expect(rendered.result.current.phase).toEqual({ status: 'attaching' })
  })

  it('reports a deliberate stop as an interruption too', async () => {
    const streams = cancellableStreams()
    const channels = recordingChannels()
    const lifecycle = manualLifecycle()
    const rendered = await mountReady(streams.invoke, streams.calls, channels.factory, lifecycle.listen)

    act(() => {
      lifecycle.emit({ name: 'harness-stopped' })
    })
    expect(rendered.result.current.phase).toEqual({
      status: 'interrupted',
      reason: 'The harness stopped.',
    })
  })
})

describe('the phases the run itself puts a conversation in', () => {
  it('walks attaching, live, streaming, idle across a replayed-then-live turn', async () => {
    const streams = cancellableStreams()
    const channels = recordingChannels()
    const lifecycle = manualLifecycle()
    const rendered = await mountReady(streams.invoke, streams.calls, channels.factory, lifecycle.listen)

    // History replays: a past, finished message arrives before up-to-date,
    // marked as replay — and none of it is mistaken for a live turn.
    act(() => {
      channels.feeds[0](
        dataFrame('1_0', [{ type: 'message-appended', position: { batch: 1, index: 0 } }]),
      )
      channels.feeds[0]({ kind: 'up-to-date', offset: '2_0' })
    })
    await waitFor(() => expect(rendered.result.current.phase).toEqual({ status: 'live' }))
    expect(rendered.result.current.offset).toBe('2_0')

    // A live turn starts and produces deltas; a keep-alive slips in between
    // and must disturb nothing but the resume point.
    act(() => {
      channels.feeds[0](
        dataFrame('3_0', [
          {
            type: 'message-started',
            messageId: 'm2',
            submissionId: 'sub_live',
            position: { batch: 3, index: 0 },
          },
        ]),
      )
      channels.feeds[0]({ kind: 'keep-alive', offset: '3_0' })
      channels.feeds[0](
        dataFrame('4_0', [{ type: 'message-delta', position: { batch: 4, index: 0 } }]),
      )
    })
    await waitFor(() =>
      expect(rendered.result.current.phase).toEqual({
        status: 'streaming',
        submissionId: 'sub_live',
        retrying: null,
      }),
    )
    expect(rendered.result.current.offset).toBe('4_0')

    // Settlement closes the turn: connected, quiet, idle.
    act(() => {
      channels.feeds[0](
        dataFrame('5_0', [
          { type: 'submission-settled', outcome: 'completed', position: { batch: 5, index: 0 } },
        ]),
      )
    })
    await waitFor(() => expect(rendered.result.current.phase).toEqual({ status: 'idle' }))
  })

  it('distinguishes a failed run from an aborted one', async () => {
    for (const outcome of ['failed', 'aborted'] as const) {
      const streams = cancellableStreams()
      const channels = recordingChannels()
      const lifecycle = manualLifecycle()
      const rendered = await mountReady(streams.invoke, streams.calls, channels.factory, lifecycle.listen)

      act(() => {
        channels.feeds[0](
          dataFrame('3_0', [
            { type: 'submission-settled', outcome, position: { batch: 3, index: 0 } },
          ]),
        )
      })
      await waitFor(() => expect(rendered.result.current.phase.status).toBe('run-failed'))
      if (rendered.result.current.phase.status !== 'run-failed') throw new Error('unreachable')
      expect(rendered.result.current.phase.outcome).toBe(outcome)
    }
  })

  it('ignores a redelivered settlement instead of letting it lie about the present', async () => {
    const streams = cancellableStreams()
    const channels = recordingChannels()
    const lifecycle = manualLifecycle()
    const rendered = await mountReady(streams.invoke, streams.calls, channels.factory, lifecycle.listen)

    act(() => {
      channels.feeds[0]({ kind: 'up-to-date', offset: '8_0' })
      channels.feeds[0](
        dataFrame('9_0', [
          { type: 'submission-settled', outcome: 'completed', position: { batch: 9, index: 0 } },
        ]),
      )
    })
    await waitFor(() => expect(rendered.result.current.phase).toEqual({ status: 'idle' }))

    // The same batch again, the way a reconnect delivers it — except the
    // story underneath changed, which is exactly what dedupe must refuse.
    act(() => {
      channels.feeds[0](
        dataFrame('9_0', [
          { type: 'submission-settled', outcome: 'failed', position: { batch: 9, index: 0 } },
        ]),
      )
    })
    expect(rendered.result.current.phase).toEqual({ status: 'idle' })
  })
})

describe('the retry a turn announces while it is running', () => {
  const retryChunk = (attempt: number, position: { batch: number; index: number }) => ({
    type: 'submission-retrying',
    submissionId: 'sub_live',
    attempt,
    maxRetries: 3,
    delayMs: 1500 * attempt,
    error: '429 rate limit exceeded: temporarily rate-limited upstream',
    position,
  })

  it('carries the harness retry signal while it waits, and drops it when generation resumes', async () => {
    const streams = cancellableStreams()
    const channels = recordingChannels()
    const lifecycle = manualLifecycle()
    const rendered = await mountReady(streams.invoke, streams.calls, channels.factory, lifecycle.listen)

    act(() => {
      channels.feeds[0](
        dataFrame('3_0', [
          { type: 'message-started', messageId: 'm2', submissionId: 'sub_live', position: { batch: 3, index: 0 } },
        ]),
      )
      channels.feeds[0](dataFrame('4_0', [retryChunk(1, { batch: 4, index: 0 })]))
      channels.feeds[0](dataFrame('5_0', [retryChunk(2, { batch: 5, index: 0 })]))
    })
    await waitFor(() =>
      expect(rendered.result.current.phase).toEqual({
        status: 'streaming',
        submissionId: 'sub_live',
        retrying: {
          attempt: 2,
          maxRetries: 3,
          delayMs: 3000,
          detail: '429 rate limit exceeded: temporarily rate-limited upstream',
        },
      }),
    )

    // The next attempt starts producing again: whatever was being waited on
    // is over, and nothing stale may survive into the resumed turn.
    act(() => {
      channels.feeds[0](
        dataFrame('6_0', [
          { type: 'message-started', messageId: 'm3', submissionId: 'sub_live', position: { batch: 6, index: 0 } },
        ]),
      )
    })
    await waitFor(() =>
      expect(rendered.result.current.phase).toEqual({
        status: 'streaming',
        submissionId: 'sub_live',
        retrying: null,
      }),
    )
  })

  it('never carries a stale retry past its settlement', async () => {
    for (const outcome of ['completed', 'failed'] as const) {
      const streams = cancellableStreams()
      const channels = recordingChannels()
      const lifecycle = manualLifecycle()
      const rendered = await mountReady(streams.invoke, streams.calls, channels.factory, lifecycle.listen)

      act(() => {
        channels.feeds[0](
          dataFrame('3_0', [
            { type: 'message-started', messageId: 'm2', submissionId: 'sub_9', position: { batch: 3, index: 0 } },
          ]),
        )
        channels.feeds[0](
          dataFrame('4_0', [
            { ...retryChunk(1, { batch: 4, index: 0 }), submissionId: 'sub_9' },
          ]),
        )
        channels.feeds[0](
          dataFrame('5_0', [
            { type: 'submission-settled', submissionId: 'sub_9', outcome, error: { message: 'the end' }, position: { batch: 5, index: 0 } },
          ]),
        )
      })
      await waitFor(() =>
        expect(
          outcome === 'completed'
            ? rendered.result.current.phase.status === 'idle'
            : rendered.result.current.phase.status === 'run-failed',
        ).toBe(true),
      )
      // Neither idle nor run-failed has anywhere to put a retry — the shape
      // itself is the guarantee that one cannot leak past its settlement.
      expect(rendered.result.current.phase.status).not.toBe('streaming')
    }
  })

  it('ignores a redelivered retry batch instead of rewinding the wait', async () => {
    const streams = cancellableStreams()
    const channels = recordingChannels()
    const lifecycle = manualLifecycle()
    const rendered = await mountReady(streams.invoke, streams.calls, channels.factory, lifecycle.listen)

    act(() => {
      channels.feeds[0](
        dataFrame('3_0', [
          { type: 'message-started', messageId: 'm2', submissionId: 'sub_live', position: { batch: 3, index: 0 } },
        ]),
      )
      channels.feeds[0](dataFrame('4_0', [retryChunk(1, { batch: 4, index: 0 })]))
      channels.feeds[0](dataFrame('5_0', [retryChunk(2, { batch: 5, index: 0 })]))
    })
    await waitFor(() => expect(rendered.result.current.phase.status).toBe('streaming'))
    if (rendered.result.current.phase.status !== 'streaming') throw new Error('unreachable')
    expect(rendered.result.current.phase.retrying?.attempt).toBe(2)

    // The reconnect replays the batch that was in flight (and an older one
    // besides); dedupe by position must leave the newest wait standing.
    act(() => {
      channels.feeds[0](dataFrame('4_0', [retryChunk(1, { batch: 4, index: 0 })]))
      channels.feeds[0](dataFrame('5_0', [retryChunk(2, { batch: 5, index: 0 })]))
    })
    if (rendered.result.current.phase.status !== 'streaming') throw new Error('unreachable')
    expect(rendered.result.current.phase.retrying?.attempt).toBe(2)
  })

  it('refuses to wait on a retry signal that arrived half-read', async () => {
    const streams = cancellableStreams()
    const channels = recordingChannels()
    const lifecycle = manualLifecycle()
    const rendered = await mountReady(streams.invoke, streams.calls, channels.factory, lifecycle.listen)

    act(() => {
      channels.feeds[0](
        dataFrame('3_0', [
          { type: 'message-started', messageId: 'm2', submissionId: 'sub_live', position: { batch: 3, index: 0 } },
        ]),
      )
      channels.feeds[0](
        dataFrame('4_0', [
          // No delay on the wire: a wait nobody can name is not a state.
          { type: 'submission-retrying', submissionId: 'sub_live', attempt: 1, maxRetries: 3, position: { batch: 4, index: 0 } },
        ]),
      )
    })
    await waitFor(() =>
      expect(rendered.result.current.phase).toEqual({
        status: 'streaming',
        submissionId: 'sub_live',
        retrying: null,
      }),
    )
  })
})

describe('interruption and its answer', () => {
  it('keeps the offset through a broken read, and resumes from it on demand', async () => {
    // Held in a property, not a bare `let`: the assignment happens inside a
    // callback, and control-flow narrowing would call it `never` here.
    const breaker: { reject: ((error: unknown) => void) | null } = { reject: null }
    let reads = 0
    const calls: RecordedCall[] = []
    const resolvers = new Map<string, () => void>()
    const invoke: ServiceInvoke = async (command, args) => {
      calls.push({ command, args: args ?? {} })
      if (command === 'service_stream_cancel') {
        resolvers.get(String(args?.['streamId']))?.()
        return undefined
      }
      reads += 1
      if (reads === 1) {
        // Held open until the test has fed frames through it, then broken.
        return new Promise((_resolve, reject) => {
          breaker.reject = reject
        })
      }
      return new Promise<void>((resolve) => {
        resolvers.set(String(args?.['streamId']), () => resolve())
      })
    }
    const channels = recordingChannels()
    const lifecycle = manualLifecycle()
    const { contact } = contactFor(() =>
      createConversationClient({ conversationId: 'cnv_1', invoke, createChannel: channels.factory }),
    )
    const rendered = renderHook((id: string) => useConversation(id, { contact, listen: lifecycle.listen }), {
      initialProps: 'cnv_1',
    })
    await waitFor(() => expect(channels.feeds.length).toBeGreaterThan(0))

    act(() => {
      channels.feeds[0](dataFrame('6_1', [{ type: 'message-appended', position: { batch: 6, index: 1 } }]))
    })
    expect(rendered.result.current.offset).toBe('6_1')

    act(() => {
      breaker.reject?.({ kind: 'stream-broken', message: 'no bytes for 45s' })
    })
    await waitFor(() =>
      expect(rendered.result.current.phase).toEqual({
        status: 'interrupted',
        reason: 'no bytes for 45s',
      }),
    )
    // Retained, not lost: this is what makes interruption resumable.
    expect(rendered.result.current.offset).toBe('6_1')

    const readsBefore = streamCount({ calls })
    act(() => {
      rendered.result.current.resume()
    })
    await waitFor(() => {
      expect(streamCount({ calls })).toBe(readsBefore + 1)
      expect(calls.filter((call) => call.command === 'service_stream').at(-1)?.args['offset']).toBe('6_1')
    })
    expect(rendered.result.current.phase).toEqual({ status: 'attaching' })
  })
})

describe('what a conversation switch and a closed pane must do', () => {  it('cancels the old read promptly on a switch, and never aborts the run', async () => {
    const streams = cancellableStreams()
    const channels = recordingChannels()
    const lifecycle = manualLifecycle()
    const clients = new Map<string, ConversationClient>()
    let currentId = 'cnv_1'
    const contact: ContactHarness = async () => {
      const existing = clients.get(currentId)
      const client =
        existing ??
        createConversationClient({
          conversationId: currentId,
          invoke: streams.invoke,
          createChannel: channels.factory,
        })
      clients.set(currentId, client)
      return { kind: 'ready', client }
    }

    const rendered = renderHook(
      (id: string) => useConversation(id, { contact, listen: lifecycle.listen }),
      { initialProps: currentId },
    )
    await waitFor(() => expect(streamCount(streams)).toBe(1))

    currentId = 'cnv_2'
    rendered.rerender(currentId)

    await waitFor(() => expect(streamCount(streams)).toBe(2))
    const cancels = streams.calls.filter((call) => call.command === 'service_stream_cancel')
    expect(cancels).toHaveLength(1)
    expect(cancels[0].args['streamId']).toBe(
      streams.calls.find((call) => call.command === 'service_stream')?.args['streamId'],
    )
    // Not once anywhere was a run told to stop. Reading stopped; the run did
    // not — ADR 0045 section 5, held where it is easiest to break.
    expect(streams.calls.some((call) => String(call.args['path']).endsWith('/abort'))).toBe(false)
    const secondRead = streams.calls.filter((call) => call.command === 'service_stream')[1]
    expect(secondRead.args['path']).toBe('/agents/studio/cnv_2?view=updates')
    expect(secondRead.args['offset']).toBe('-1')
  })

  it('cancels its read when it goes away', async () => {
    const streams = cancellableStreams()
    const channels = recordingChannels()
    const lifecycle = manualLifecycle()
    const { contact } = contactFor(() =>
      createConversationClient({ conversationId: 'cnv_1', invoke: streams.invoke, createChannel: channels.factory }),
    )
    const rendered = renderHook((id: string) => useConversation(id, { contact, listen: lifecycle.listen }), {
      initialProps: 'cnv_1',
    })
    await waitFor(() => expect(streamCount(streams)).toBe(1))

    rendered.unmount()

    await waitFor(() =>
      expect(streams.calls.some((call) => call.command === 'service_stream_cancel')).toBe(true),
    )
  })
})

/**
 * Task 26, Part C: a refused submission must change something on screen.
 * The refusal lands beside the phases (not as one) because a send can be
 * refused while an earlier turn is still streaming — and the state machine
 * has no status that means both at once.
 */
describe('a refused submission has somewhere to land', () => {
  const REFUSAL = { kind: 'stream-refused', status: 403, message: 'admission denied for this session' }

  /** Streams held open; submissions answered per `mode`. */
  function submitScripting(mode: { reject: boolean }): { invoke: ServiceInvoke; calls: RecordedCall[] } {
    const resolvers = new Map<string, () => void>()
    return scriptedInvoke({
      service_fetch: (args) => {
        const path = String(args['path'])
        if (path.endsWith('?view=history')) {
          return {
            status: 200,
            headers: [],
            body: JSON.stringify({ v: 1, conversationId: 'conv_1', offset: '-1', messages: [], settlements: [] }),
          }
        }
        if (!path.includes('?view=')) {
          if (mode.reject) throw REFUSAL
          return { status: 202, headers: [], body: JSON.stringify({ submissionId: 'sub_new', offset: '0_0' }) }
        }
        throw new Error(`unexpected fetch in this script: ${path}`)
      },
      service_stream: (args) =>
        new Promise<void>((resolve) => {
          resolvers.set(String(args['streamId']), () => resolve())
        }),
      service_stream_cancel: (args) => {
        const resolve = resolvers.get(String(args['streamId']))
        if (resolve !== undefined) {
          resolve()
          resolvers.delete(String(args['streamId']))
        }
        return undefined
      },
    })
  }

  it('lands a refused POST in refused, with its status and its own sentence', async () => {
    const streams = submitScripting({ reject: true })
    const channels = recordingChannels()
    const lifecycle = manualLifecycle()
    const rendered = await mountReady(streams.invoke, streams.calls, channels.factory, lifecycle.listen)

    const receipt = await rendered.result.current.submit('please answer')
    expect(receipt.ok).toBe(false)
    if (receipt.ok) throw new Error('unreachable')
    expect(receipt.error).toEqual({
      kind: 'refused',
      status: 403,
      message: 'admission denied for this session',
    })
    await waitFor(() =>
      expect(rendered.result.current.refused).toEqual({
        kind: 'refused',
        status: 403,
        message: 'admission denied for this session',
      }),
    )

    act(() => rendered.result.current.dismissRefusal())
    expect(rendered.result.current.refused).toBeNull()
  })

  it('refuses a send while an earlier turn is still streaming, and keeps streaming', async () => {
    // The adversarial case: the state machine must not be hijacked by the
    // refusal — the earlier run is still producing, and the caret must not
    // blink out because a second POST bounced.
    const streams = submitScripting({ reject: true })
    const channels = recordingChannels()
    const lifecycle = manualLifecycle()
    const rendered = await mountReady(streams.invoke, streams.calls, channels.factory, lifecycle.listen)

    act(() => {
      channels.feeds[0](
        dataFrame('3_0', [
          { type: 'message-started', messageId: 'm2', submissionId: 'sub_live', position: { batch: 3, index: 0 } },
        ]),
      )
    })
    await waitFor(() =>
      expect(rendered.result.current.phase).toEqual({
        status: 'streaming',
        submissionId: 'sub_live',
        retrying: null,
      }),
    )

    await rendered.result.current.submit('a second message')
    expect(rendered.result.current.phase.status).toBe('streaming')
    await waitFor(() => expect(rendered.result.current.refused?.kind).toBe('refused'))
  })

  it('retires the refusal once a later send gets through', async () => {
    // The script reads this each call, so the same harness can refuse the
    // first send and accept the second — which is the point: the refusal
    // must survive until something actually got through.
    const mode = { reject: true }
    const streams = submitScripting(mode)
    const channels = recordingChannels()
    const lifecycle = manualLifecycle()
    const { contact } = contactFor(() =>
      createConversationClient({ conversationId: 'cnv_1', invoke: streams.invoke, createChannel: channels.factory }),
    )
    const rendered = renderHook((id: string) => useConversation(id, { contact, listen: lifecycle.listen }), {
      initialProps: 'cnv_1',
    })
    await waitFor(() => expect(streamCount(streams)).toBeGreaterThan(0))

    await rendered.result.current.submit('first try')
    await waitFor(() => expect(rendered.result.current.refused?.kind).toBe('refused'))

    mode.reject = false
    await rendered.result.current.submit('second try')
    await waitFor(() => expect(rendered.result.current.refused).toBeNull())
  })

  it('never stacks a refusal under the permanent no-harness notice', async () => {
    // The pre-contact path already explains itself on screen forever;
    // landing the same diagnosis twice teaches people to ignore notices.
    const lifecycle = manualLifecycle()
    const rendered = renderHook(
      (id: string) => useConversation(id, { contact: ABSENT, listen: lifecycle.listen }),
      { initialProps: 'cnv_1' },
    )
    await waitFor(() => expect(rendered.result.current.phase).toEqual({ status: 'no-harness' }))

    const receipt = await rendered.result.current.submit('anyone there?')
    expect(receipt.ok).toBe(false)
    // Whatever sentence the seam produced, the phase already owns this
    // diagnosis permanently — so nothing may land beside it.
    await waitFor(() => expect(rendered.result.current.refused).toBeNull())
  })

  it('carries the provider sentence into the run-failed phase as its detail', async () => {
    const streams = cancellableStreams()
    const channels = recordingChannels()
    const lifecycle = manualLifecycle()
    const rendered = await mountReady(streams.invoke, streams.calls, channels.factory, lifecycle.listen)

    act(() => {
      channels.feeds[0](
        dataFrame('5_0', [
          {
            type: 'submission-settled',
            submissionId: 'sub_9',
            outcome: 'failed',
            error: {
              name: 'FlueError',
              type: 'operation_failed',
              message: 'direct(sub_9) failed: 429 rate limit exceeded: temporarily rate-limited upstream',
            },
            position: { batch: 5, index: 0 },
          },
        ]),
      )
    })
    await waitFor(() =>
      expect(rendered.result.current.phase).toEqual({
        status: 'run-failed',
        outcome: 'failed',
        message: 'The turn failed while it was running.',
        detail: 'direct(sub_9) failed: 429 rate limit exceeded: temporarily rate-limited upstream',
      }),
    )
  })

  it('says nothing invented when the settlement carried no error object', async () => {
    const streams = cancellableStreams()
    const channels = recordingChannels()
    const lifecycle = manualLifecycle()
    const rendered = await mountReady(streams.invoke, streams.calls, channels.factory, lifecycle.listen)

    act(() => {
      channels.feeds[0](
        dataFrame('5_0', [
          { type: 'submission-settled', submissionId: 'sub_9', outcome: 'aborted', position: { batch: 5, index: 0 } },
        ]),
      )
    })
    await waitFor(() =>
      expect(rendered.result.current.phase).toEqual({
        status: 'run-failed',
        outcome: 'aborted',
        message: 'The turn was aborted before it finished.',
        detail: null,
      }),
    )
  })
})

/**
 * Mounts against a scripted harness whose contact is built ONCE. A contact
 * recreated inside the render prop would re-run the mount effect on every
 * render, because the effect correctly treats an unstable contact as a
 * changed dependency - and attaching is a render.
 */
async function mountScripted(options: {
  invoke: ServiceInvoke
  factory: (onMessage: (message: WireStreamEvent) => void) => StreamChannel
  listen: LifecycleListen
  livenessBudgetMs?: number
}): Promise<RenderHookResult<ReturnType<typeof useConversation>, string>> {
  const { contact } = contactFor(() =>
    createConversationClient({
      conversationId: 'cnv_1',
      invoke: options.invoke,
      createChannel: options.factory,
    }),
  )
  return renderHook(
    (id: string) =>
      useConversation(id, {
        contact,
        listen: options.listen,
        ...(options.livenessBudgetMs === undefined
          ? {}
          : { livenessBudgetMs: options.livenessBudgetMs }),
      }),
    { initialProps: 'cnv_1' },
  )
}

describe('the delivery a submission owes its turn', () => {
  /** History refused for a conversation the harness has no stream for yet. */
  const NO_STREAM = { status: 404, headers: [], body: '' }

  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
  }

  interface TurnScript {
    readonly invoke: ServiceInvoke
    readonly calls: RecordedCall[]
    readonly historyReads: () => number
    readonly streamOffsets: () => string[]
    readonly streamIds: () => string[]
    readonly cancelledStreams: () => string[]
  }

  /**
   * A conversation whose submission POST admits with the receipt's own
   * offset, and whose history view answers per `historyAtMount`: `absent`
   * is the every-fresh-conversation state (the stream does not exist until
   * the first admission creates it), `live` is a conversation the harness
   * already knows. Any history read AFTER the first answers 404 - with the
   * fix, the submission never makes one, so a regression to the cold-start
   * shape lands in `absent` and opens no stream, which the offsets record
   * makes unmissable.
   */
  function turnScript(admittedOffset: string, historyAtMount: 'absent' | 'live'): TurnScript {
    const resolvers = new Map<string, () => void>()
    let historyReads = 0
    const streamOffsets: string[] = []
    const streamIds: string[] = []
    const cancelled: string[] = []
    const { invoke, calls } = scriptedInvoke({
      service_fetch: (args) => {
        const path = String(args['path'])
        const init = args['init']
        const method = isRecord(init) ? init['method'] : undefined
        if (path.endsWith('?view=history')) {
          historyReads += 1
          if (historyReads === 1 && historyAtMount === 'live') {
            return {
              status: 200,
              headers: [],
              body: JSON.stringify({
                v: 1,
                conversationId: 'conv_1',
                offset: '4_2',
                messages: [],
                settlements: [],
              }),
            }
          }
          return NO_STREAM
        }
        if (method === 'POST' && !path.includes('?view=') && !path.endsWith('/abort')) {
          return {
            status: 200,
            headers: [],
            body: JSON.stringify({ submissionId: 'sub_turn', offset: admittedOffset }),
          }
        }
        throw new Error(`unexpected fetch in this script: ${String(method)} ${path}`)
      },
      service_stream: (args) => {
        streamOffsets.push(String(args['offset']))
        streamIds.push(String(args['streamId']))
        return new Promise<void>((resolve) => {
          resolvers.set(String(args['streamId']), () => resolve())
        })
      },
      service_stream_cancel: (args) => {
        cancelled.push(String(args['streamId']))
        const resolve = resolvers.get(String(args['streamId']))
        if (resolve !== undefined) {
          resolve()
          resolvers.delete(String(args['streamId']))
        }
        return undefined
      },
    })
    return {
      invoke,
      calls,
      historyReads: () => historyReads,
      streamOffsets: () => streamOffsets,
      streamIds: () => streamIds,
      cancelledStreams: () => cancelled,
    }
  }

  it('starts the turn read at the admission receipt offset, never by re-reading history', async () => {
    // A fresh conversation's mount attach settled `absent` - the stream did
    // not exist until this admission created it. The old shape attached with
    // a second cold start: a history read whose answer the submission had
    // just made stale, and - in the race where the 404 won - no read at all,
    // with the whole turn running unwitnessed. The receipt names where the
    // turn begins; the read must open THERE.
    const script = turnScript('9_4', 'absent')
    const channels = recordingChannels()
    const lifecycle = manualLifecycle()
    const rendered = await mountScripted({
      invoke: script.invoke,
      factory: channels.factory,
      listen: lifecycle.listen,
    })
    // The mount attach finds no stream: connected, quiet, ready.
    await waitFor(() => expect(rendered.result.current.phase).toEqual({ status: 'idle' }))

    const receipt = await rendered.result.current.submit('watch this one')
    expect(receipt.ok).toBe(true)

    await waitFor(() => expect(script.streamOffsets()).toEqual(['9_4']))
    expect(script.historyReads()).toBe(1)
  })

  it('replaces a read that is already attached with one starting at the receipt offset', async () => {
    // The other half of the same defect: an attached read that went deaf
    // without Rust noticing is still `attached()`, and a submission that
    // trusted it streamed the whole turn into a void. Every submission now
    // opens its own read at its own admission offset; the superseded one is
    // cancelled, and the position discipline makes any overlap harmless.
    const script = turnScript('9_4', 'live')
    const channels = recordingChannels()
    const lifecycle = manualLifecycle()
    const rendered = await mountScripted({
      invoke: script.invoke,
      factory: channels.factory,
      listen: lifecycle.listen,
    })
    // The mount attach reads history and opens the updates stream.
    await waitFor(() => expect(script.streamOffsets()).toEqual(['4_2']))
    act(() => {
      channels.feeds[0]({ kind: 'up-to-date', offset: '4_2' })
    })
    await waitFor(() => expect(rendered.result.current.phase.status).toBe('live'))

    const receipt = await rendered.result.current.submit('watch this one')
    expect(receipt.ok).toBe(true)
    await waitFor(() => expect(script.streamOffsets()).toEqual(['4_2', '9_4']))

    // The turn's first replay lands on the transcript through the new read.
    act(() => {
      channels.feeds[1](
        dataFrame('9_4', [
          {
            type: 'message-started',
            messageId: 'entry_turn',
            submissionId: 'sub_turn',
            position: { batch: 9, index: 0 },
          },
        ]),
      )
    })
    await waitFor(() => expect(rendered.result.current.phase.status).toBe('streaming'))
    // The mount read was stopped - once by the hook's supersede and once by
    // the client's own, which is why the same id can appear twice.
    const mountStream = script.streamIds()[0]
    if (mountStream === undefined) {
      throw new Error('the mount stream was asserted opened above')
    }
    expect(script.cancelledStreams()).toContain(mountStream)
  })
})

describe('the silence a read may not outlast', () => {
  /**
   * Drains the contact-attach-invoke chain without `waitFor`: the budget
   * runs on the fake clock from before the mount, so no real-timer wait can
   * race the very watchdog under test.
   */
  async function flushAttach(): Promise<void> {
    for (let round = 0; round < 8; round += 1) {
      await Promise.resolve()
    }
  }

  it('stops trusting a read that delivers nothing for a whole budget', async () => {
    // Rust cannot see this failure: a channel whose webview side vanished
    // keeps accepting sends, so the harness streams into a void while the
    // UI sits attached and deaf. The webview is the only place the silence
    // can be named, and the phase must say interrupted rather than leave a
    // dead read wearing a live one's state.
    const streams = cancellableStreams()
    const channels = recordingChannels()
    const lifecycle = manualLifecycle()
    vi.useFakeTimers()
    try {
      const rendered = await mountScripted({
        invoke: streams.invoke,
        factory: channels.factory,
        listen: lifecycle.listen,
        livenessBudgetMs: 50,
      }).then(async (hook) => {
        await act(async () => {
          await flushAttach()
        })
        return hook
      })
      expect(streamCount({ calls: streams.calls })).toBe(1)
      act(() => {
        channels.feeds[0]({ kind: 'up-to-date', offset: '-1' })
      })
      expect(rendered.result.current.phase.status).toBe('live')

      // The budget elapses with nothing further from the read.
      act(() => {
        vi.advanceTimersByTime(60)
      })
      expect(rendered.result.current.phase.status).toBe('interrupted')
      // The dead read was stopped by name, not left running in Rust.
      expect(
        streams.calls.filter((call) => call.command === 'service_stream_cancel'),
      ).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps trusting a read that keeps speaking, however quiet the turn itself is', async () => {
    // The false-positive guard: a healthy read is heard from at least twice
    // inside the budget (Rust forwards a keep-alive every 15s), so a long
    // provider silence before the first token must never read as a break.
    const streams = cancellableStreams()
    const channels = recordingChannels()
    const lifecycle = manualLifecycle()
    vi.useFakeTimers()
    try {
      const rendered = await mountScripted({
        invoke: streams.invoke,
        factory: channels.factory,
        listen: lifecycle.listen,
        livenessBudgetMs: 50,
      }).then(async (hook) => {
        await act(async () => {
          await flushAttach()
        })
        return hook
      })
      expect(streamCount({ calls: streams.calls })).toBe(1)
      act(() => {
        channels.feeds[0]({ kind: 'up-to-date', offset: '-1' })
      })
      expect(rendered.result.current.phase.status).toBe('live')

      for (let round = 0; round < 5; round += 1) {
        act(() => {
          vi.advanceTimersByTime(30)
          channels.feeds[0]({ kind: 'keep-alive', offset: '3_0' })
        })
      }
      expect(rendered.result.current.phase.status).toBe('live')
    } finally {
      vi.useRealTimers()
    }
  })
})
