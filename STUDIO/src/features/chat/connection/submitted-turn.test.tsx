/**
 * @vitest-environment jsdom
 */
import { act, renderHook, waitFor } from '@testing-library/react'
import type { RenderHookResult } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createConversationClient,
  type ServiceInvoke,
  type StreamChannel,
  type WireStreamEvent,
} from '@/platform/harness'
import {
  forgetFirstAdmission,
  rememberFirstAdmission,
} from '@/features/chat/connection/first-attach'
import type { ContactHarness, LifecycleListen } from './useConversation'
import { useConversation } from './useConversation'

/**
 * The turn between its admission and its first token.
 *
 * Measured on the real provider, that window was six seconds of a seven-second
 * turn, and for all six the page said nothing: no busy composer, no stop
 * control, no mark. The phase machine only left `live` on `message-started`
 * or `message-delta`, so every consumer that hangs off "a turn is running"
 * was asking a question whose answer arrived last.
 *
 * `submitted` is what the receipt licenses us to say. Everything below is
 * about which facts may end it — the harness's, all of them — and which may
 * not.
 */

interface RecordedCall {
  readonly command: string
  readonly args: Record<string, unknown>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

interface TurnScript {
  readonly invoke: ServiceInvoke
  readonly calls: RecordedCall[]
  readonly historyReads: () => number
  readonly streamOffsets: () => string[]
}

/**
 * A harness that answers history for a conversation it already knows, admits
 * every POST with a fixed receipt, and holds every read open until cancelled.
 */
function turnScript(): TurnScript {
  const calls: RecordedCall[] = []
  const resolvers = new Map<string, () => void>()
  const streamOffsets: string[] = []
  let historyReads = 0
  const invoke: ServiceInvoke = async (command, args) => {
    const recorded: RecordedCall = { command, args: args ?? {} }
    calls.push(recorded)
    if (command === 'service_fetch') {
      const path = String(recorded.args['path'])
      const init = recorded.args['init']
      const method = isRecord(init) ? init['method'] : undefined
      if (path.endsWith('?view=history')) {
        historyReads += 1
        return {
          status: 200,
          headers: [],
          body: JSON.stringify({
            v: 1,
            conversationId: 'cnv_1',
            offset: '4_2',
            messages: [],
            settlements: [],
          }),
        }
      }
      if (method === 'POST' && !path.endsWith('/abort')) {
        return {
          status: 200,
          headers: [],
          body: JSON.stringify({ submissionId: 'sub_turn', offset: '9_4' }),
        }
      }
      throw new Error(`unexpected fetch in this script: ${String(method)} ${path}`)
    }
    if (command === 'service_stream') {
      streamOffsets.push(String(recorded.args['offset']))
      return new Promise<void>((resolve) => {
        resolvers.set(String(recorded.args['streamId']), () => resolve())
      })
    }
    if (command === 'service_stream_cancel') {
      const resolve = resolvers.get(String(recorded.args['streamId']))
      if (resolve !== undefined) {
        resolve()
        resolvers.delete(String(recorded.args['streamId']))
      }
      return undefined
    }
    throw new Error(`no scripted answer for ${command}`)
  }
  return {
    invoke,
    calls,
    historyReads: () => historyReads,
    streamOffsets: () => streamOffsets,
  }
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

const SILENT_LIFECYCLE: LifecycleListen = async () => () => {}

/**
 * What a send carries beside its words. Every test here passes settings the
 * way the page does, and the first one asserts they reached the wire - the
 * whole point of the turn settings is what the harness receives.
 */
const SETTINGS = { modelId: 'google/gemini-3.5-flash', reasoningLevel: 'high' } as const

function dataFrame(offset: string, chunks: unknown[]): WireStreamEvent {
  return { kind: 'frame', offset, event: 'data', data: JSON.stringify(chunks) }
}

function mount(options: {
  script: TurnScript
  channels: ReturnType<typeof recordingChannels>
  livenessBudgetMs?: number
}): RenderHookResult<ReturnType<typeof useConversation>, string> {
  // Built once: a contact rebuilt per render is a changed effect dependency,
  // and attaching is a render.
  const client = createConversationClient({
    conversationId: 'cnv_1',
    invoke: options.script.invoke,
    createChannel: options.channels.factory,
  })
  const contact: ContactHarness = async () => ({ kind: 'ready', client })
  return renderHook(
    (id: string) =>
      useConversation(id, {
        contact,
        listen: SILENT_LIFECYCLE,
        ...(options.livenessBudgetMs === undefined
          ? {}
          : { livenessBudgetMs: options.livenessBudgetMs }),
      }),
    { initialProps: 'cnv_1' },
  )
}

beforeEach(() => {
  // The handoff registry is module state shared by every test in this file.
  forgetFirstAdmission('cnv_1')
})

describe('what the receipt licenses the page to say', () => {
  it('is already submitted by the time the send answers', async () => {
    // The composer drops its own in-flight lock the instant this promise
    // resolves. If the phase were set a tick later, the stop control would
    // blink out and back, which is worse than one that arrives late.
    const script = turnScript()
    const channels = recordingChannels()
    const rendered = mount({ script, channels })
    await waitFor(() => expect(script.streamOffsets()).toEqual(['4_2']))

    // One flush, no waiting: the phase is not something a later delivery
    // brings, it is set inside the call that answers the receipt. Nothing is
    // fed through the channel in this test, so if `submit` did not say it,
    // nothing else would.
    let receipt: { ok: boolean } = { ok: false }
    await act(async () => {
      receipt = await rendered.result.current.submit('watch this one', SETTINGS)
    })
    expect(receipt.ok).toBe(true)
    expect(rendered.result.current.phase).toEqual({
      status: 'submitted',
      submissionId: 'sub_turn',
    })
    // And the body the harness received carried what the picker chose - the
    // assertion Task 36's wire tests are shaped on, one layer up.
    const submission = script.calls.find(
      (call) =>
        call.command === 'service_fetch' &&
        String(call.args['path']).endsWith('/agents/studio/cnv_1'),
    )
    const init = submission?.args['init']
    const body = isRecord(init) && typeof init['body'] === 'string' ? init['body'] : ''
    expect(JSON.parse(body)).toEqual({
      kind: 'user',
      body: 'watch this one',
      modelId: SETTINGS.modelId,
      reasoningLevel: SETTINGS.reasoningLevel,
    })
  })

  it('stays submitted while the new read catches up', async () => {
    // `up-to-date` says where the READ is. It arrives on the very read the
    // submission just opened, and a turn already known to be under way
    // outranks it.
    const script = turnScript()
    const channels = recordingChannels()
    const rendered = mount({ script, channels })
    await waitFor(() => expect(script.streamOffsets()).toEqual(['4_2']))

    await rendered.result.current.submit('watch this one', SETTINGS)
    await waitFor(() => expect(channels.feeds.length).toBe(2))
    act(() => {
      channels.feeds[1]({ kind: 'up-to-date', offset: '9_4' })
      channels.feeds[1](
        dataFrame('9_5', [{ type: 'message-appended', position: { batch: 9, index: 5 } }]),
      )
    })
    expect(rendered.result.current.phase.status).toBe('submitted')
  })

  it('moves on to streaming at the first delta, keeping the receipt submission', async () => {
    // A delta with no start of its own (the start scrolled past the resume
    // point) used to leave the stream unnamed. The receipt named it before
    // any of this arrived.
    const script = turnScript()
    const channels = recordingChannels()
    const rendered = mount({ script, channels })
    await waitFor(() => expect(script.streamOffsets()).toEqual(['4_2']))

    await rendered.result.current.submit('watch this one', SETTINGS)
    await waitFor(() => expect(channels.feeds.length).toBe(2))
    act(() => {
      channels.feeds[1](
        dataFrame('9_6', [{ type: 'message-delta', position: { batch: 9, index: 6 } }]),
      )
    })
    await waitFor(() =>
      expect(rendered.result.current.phase).toEqual({
        status: 'streaming',
        submissionId: 'sub_turn',
        retrying: null,
      }),
    )
  })

  it('ends when the turn is aborted before it ever produced anything', async () => {
    // Stop pressed in the quiet window. Nothing was written, so nothing on
    // screen changes except that the turn is over — and the composer, which
    // reads this phase, must stop being busy.
    const script = turnScript()
    const channels = recordingChannels()
    const rendered = mount({ script, channels })
    await waitFor(() => expect(script.streamOffsets()).toEqual(['4_2']))

    await rendered.result.current.submit('never mind', SETTINGS)
    await waitFor(() => expect(channels.feeds.length).toBe(2))
    act(() => {
      channels.feeds[1](
        dataFrame('9_7', [
          { type: 'submission-settled', outcome: 'aborted', position: { batch: 9, index: 7 } },
        ]),
      )
    })
    await waitFor(() => expect(rendered.result.current.phase.status).toBe('run-failed'))
  })

  it('does not leave a submitted turn running forever when its read dies', async () => {
    // The negative one the brief asks for. Nothing here may end `submitted`
    // on a clock that means "long enough" — but a read that has delivered
    // NOTHING at all, keep-alives included, for a whole budget is a fact
    // about the read, and the composer must not stay busy behind it.
    const script = turnScript()
    const channels = recordingChannels()
    vi.useFakeTimers()
    try {
      const rendered = mount({ script, channels, livenessBudgetMs: 50 })
      await act(async () => {
        for (let round = 0; round < 8; round += 1) await Promise.resolve()
      })
      let receipt: { ok: boolean } = { ok: false }
      await act(async () => {
        receipt = await rendered.result.current.submit('watch this one', SETTINGS)
      })
      expect(receipt.ok).toBe(true)
      expect(rendered.result.current.phase.status).toBe('submitted')

      act(() => {
        vi.advanceTimersByTime(60)
      })
      expect(rendered.result.current.phase.status).toBe('interrupted')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('a first turn admitted before this view existed', () => {
  it('opens at the receipt offset, already saying a turn is running', async () => {
    // Home and a project page submit before anything navigates. The receipt
    // is the only thing that knows where the turn begins, and asking history
    // instead is the 404 race Task 32 removed from `submit()`.
    rememberFirstAdmission('cnv_1', {
      offset: '9_4',
      submissionId: 'sub_first',
      text: 'the first words',
    })
    const script = turnScript()
    const channels = recordingChannels()
    const rendered = mount({ script, channels })

    // On the FIRST render, before the supervisor has been asked anything. The
    // receipt was in hand before this view existed, so waiting on a status
    // invoke to repeat it leaves the composer idle for the length of that
    // invoke — measured at ~280ms on the desktop, which is a stop control
    // blinking out of one page and back into the next.
    expect(rendered.result.current.phase).toEqual({
      status: 'submitted',
      submissionId: 'sub_first',
    })

    await waitFor(() => expect(script.streamOffsets()).toEqual(['9_4']))
    expect(script.historyReads()).toBe(0)
    expect(rendered.result.current.phase.status).toBe('submitted')
  })

  it('still serves a second mount, and is retired once a read has caught up', async () => {
    // StrictMode mounts this view twice, so a handoff consumed on read would
    // hand the surviving mount a cold start. Handing it to both costs
    // nothing: there is no history before a first turn to miss.
    rememberFirstAdmission('cnv_1', {
      offset: '9_4',
      submissionId: 'sub_first',
      text: 'the first words',
    })
    const first = { script: turnScript(), channels: recordingChannels() }
    const one = mount(first)
    await waitFor(() => expect(first.script.streamOffsets()).toEqual(['9_4']))
    one.unmount()

    const second = { script: turnScript(), channels: recordingChannels() }
    const two = mount(second)
    await waitFor(() => expect(second.script.streamOffsets()).toEqual(['9_4']))

    // Caught up to the present: the receipt has done its whole job, and
    // every later visit is an ordinary cold start through history.
    act(() => {
      second.channels.feeds[0]({ kind: 'up-to-date', offset: '9_9' })
    })
    two.unmount()

    const third = { script: turnScript(), channels: recordingChannels() }
    mount(third)
    await waitFor(() => expect(third.script.historyReads()).toBe(1))
    expect(third.script.streamOffsets()).toEqual(['4_2'])
  })
})
