/**
 * @vitest-environment jsdom
 */
import { act, renderHook, waitFor } from '@testing-library/react'
import type { RenderHookResult } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

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
 * -- the same substitution pattern the settings pane tests use -- so what is
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
    // marked as replay -- and none of it is mistaken for a live turn.
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

    // The same batch again, the way a reconnect delivers it -- except the
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

describe('what a conversation switch and a closed pane must do', () => {
  it('cancels the old read promptly on a switch, and never aborts the run', async () => {
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
    // not -- ADR 0045 section 5, held where it is easiest to break.
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
