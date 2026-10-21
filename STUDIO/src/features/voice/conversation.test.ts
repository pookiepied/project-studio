import { describe, expect, it, vi } from 'vitest'
import { VoiceConversation } from './conversation'
import { StreamingSpeech } from './streamingSpeech'
import type { VoiceFreshChat } from './conversation'
import type { ConversationClient } from '@/platform/harness/conversation'
import { readChunkFacts, type ChunkFacts } from '@/platform/harness'

const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
function fixture(fresh?: VoiceFreshChat) {
  const client = {
    conversationId: 'conversation',
    lastOffset: () => null,
    attached: () => false,
    submitTurn: vi.fn(async () => ({ ok: true as const, value: { submissionId: 'submission', offset: '1' } })),
    abortRun: vi.fn(async () => ({ ok: true as const, value: true })),
    attach: vi.fn(() => ({ settled: new Promise<{ outcome: 'cancelled' }>(() => {}), cancel: vi.fn(async () => {}) })),
  } satisfies ConversationClient
  const speak = vi.fn(async () => ({ kind: 'ok' as const, audio: 'clip', mimeType: 'audio/mpeg' }))
  const close = vi.fn()
  const pause = vi.fn()
  const resume = vi.fn()
  const output = () => new StreamingSpeech({ speak, openSink: () => ({ enqueue: vi.fn(async (_clip, played) => played?.()), finish: vi.fn(), close, pause, resume }), onPlaying: vi.fn(), onDone: vi.fn(), onFailure: vi.fn() })
  const voice = new VoiceConversation({ client, output, onText: vi.fn(), onFailure: vi.fn(), ...(fresh === undefined ? {} : { fresh }) })
  const receive = (chunks: unknown[], replaying = false) => voice.receive({ kind: 'chunks', offset: '1', replaying, chunks: chunks.map(readChunkFacts).filter((chunk): chunk is ChunkFacts => chunk !== null) })
  const start = { type: 'message-started', messageId: 'reply', submissionId: 'submission' }
  const delta = { type: 'message-delta', messageId: 'reply', kind: 'text', delta: 'Hello.' }
  return { client, voice, receive, speak, close, pause, resume, start, delta }
}

describe('voice conversation delivery', () => {
  it('holds a reply for someone talking over it without cancelling anything, and lets it go on', async () => {
    const f = fixture()
    await f.voice.send('Tell me a story.')
    f.receive([f.start, f.delta])
    await flush()
    f.voice.hold()
    expect(f.voice.holding).toBe(true)
    expect(f.pause).toHaveBeenCalledOnce()
    f.voice.release()
    expect(f.resume).toHaveBeenCalledOnce()
    await flush()
    expect(f.client.abortRun).not.toHaveBeenCalled()
    expect(f.close).not.toHaveBeenCalled()
    f.voice.close()
  })

  it('starts a reply that arrives during a hold paused', async () => {
    const f = fixture()
    await f.voice.send('Tell me a story.')
    f.voice.hold()
    f.receive([f.start, f.delta])
    await flush()
    expect(f.pause).toHaveBeenCalledOnce()
    f.voice.close()
  })

  it('waits for old admission and cancellation before admitting the next turn', async () => {
    const f = fixture()
    let admit: ((value: { ok: true; value: { submissionId: string; offset: string } }) => void) | undefined
    let aborted: ((value: { ok: true; value: boolean }) => void) | undefined
    f.client.submitTurn.mockImplementationOnce(() => new Promise((resolve) => { admit = resolve }))
    f.client.abortRun.mockImplementationOnce(() => new Promise((resolve) => { aborted = resolve }))
    const first = f.voice.send('Draw a circle.')
    await flush()
    f.voice.interrupt()
    const second = f.voice.send('Actually, a square.')
    expect(f.client.abortRun).not.toHaveBeenCalled()
    admit?.({ ok: true, value: { submissionId: 'old', offset: '1' } })
    await first
    await flush()
    expect(f.client.abortRun).toHaveBeenCalledOnce()
    expect(f.client.submitTurn).toHaveBeenCalledOnce()
    aborted?.({ ok: true, value: true })
    await second
    expect(f.client.submitTurn).toHaveBeenCalledTimes(2)
    f.voice.close()
  })

  it('speaks a finished task reported after an interrupt without waiting for the next utterance', async () => {
    const f = fixture()
    await f.voice.send('Check the weather.')
    f.voice.interrupt()
    await flush()
    // The interrupted reply stays silent even when its chunks arrive late.
    f.receive([{ type: 'message-started', messageId: 'old', submissionId: 'submission' }, { type: 'message-delta', messageId: 'old', kind: 'text', delta: 'Stale.' }])
    await flush()
    expect(f.speak).not.toHaveBeenCalled()
    // The harness wakes the conversation with the task's result.
    f.receive([{ type: 'message-started', messageId: 'news', submissionId: 'ping' }, { type: 'message-delta', messageId: 'news', kind: 'text', delta: 'Twelve degrees and clear.' }, { type: 'submission-settled', submissionId: 'ping', outcome: 'completed' }])
    await flush()
    expect(f.speak).toHaveBeenCalledOnce()
    expect(f.client.submitTurn).toHaveBeenCalledOnce()
    f.voice.close()
  })

  it('never speaks replayed history or submits replay as work', async () => {
    const f = fixture()
    f.receive([f.start, f.delta], true)
    await flush()
    expect(f.speak).not.toHaveBeenCalled()
    expect(f.client.submitTurn).not.toHaveBeenCalled()
    f.voice.close()
  })

  it('interrupts draining audio after model settlement and does not cancel a worker', async () => {
    const f = fixture()
    f.receive([f.start, f.delta, { type: 'submission-settled', submissionId: 'submission', outcome: 'completed' }])
    await flush()
    expect(f.speak).toHaveBeenCalledOnce()
    f.voice.interrupt()
    expect(f.close).toHaveBeenCalledOnce()
    await flush()
    expect(f.client.abortRun).not.toHaveBeenCalled()
  })

  it('sends voice as a separate role without replacing the working-model selection', async () => {
    const f = fixture()
    await f.voice.send('Make it a square.')
    expect(f.client.submitTurn).toHaveBeenCalledWith('Make it a square.', { modelId: null, reasoningLevel: null, voice: true, deliveryMode: 'steer' })
    f.voice.close()
  })

  it('opens a chat that does not exist yet only when the first utterance is admitted', async () => {
    const onAdmitted = vi.fn()
    const f = fixture({ settings: { modelId: 'openrouter/working', reasoningLevel: null, projectId: 'project' }, onAdmitted })
    f.voice.start()
    expect(f.client.attach).not.toHaveBeenCalled()
    f.client.submitTurn.mockResolvedValueOnce({ ok: false, error: { kind: 'refused', message: 'No voice model.' } } as never)
    await f.voice.send('Draw a circle.')
    expect(onAdmitted).not.toHaveBeenCalled()
    expect(f.client.attach).not.toHaveBeenCalled()
    await f.voice.send('Draw a circle.')
    expect(f.client.submitTurn).toHaveBeenLastCalledWith('Draw a circle.', { modelId: 'openrouter/working', reasoningLevel: null, projectId: 'project', voice: true, deliveryMode: 'steer' })
    expect(f.client.attach).toHaveBeenCalledWith(expect.anything(), { from: '1' })
    expect(onAdmitted).toHaveBeenCalledWith('Draw a circle.', { submissionId: 'submission', offset: '1' })
    // The catch-up after our own receipt is this chat's live reply, so it speaks.
    f.receive([f.start, f.delta, { type: 'submission-settled', submissionId: 'submission', outcome: 'completed' }], true)
    await flush()
    expect(f.speak).toHaveBeenCalledOnce()
    await f.voice.send('Make it a square.')
    expect(f.client.submitTurn).toHaveBeenLastCalledWith('Make it a square.', { modelId: null, reasoningLevel: null, voice: true, deliveryMode: 'steer' })
    expect(onAdmitted).toHaveBeenCalledOnce()
    f.voice.close()
  })
})
