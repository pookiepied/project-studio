import { describe, expect, it, vi } from 'vitest'
import { StreamingSpeech } from './streamingSpeech'
import type { AudioSink } from './narration'
import type { SpeechOutcome } from './speak'

const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }

function fixture() {
  const answers: Array<(clip: SpeechOutcome) => void> = []
  const played: Array<() => void> = []
  const speak = vi.fn((_text: string) => new Promise<SpeechOutcome>((resolve) => answers.push(resolve)))
  const sink = {
    enqueue: vi.fn(async (_clip, onPlayed) => { if (onPlayed) played.push(onPlayed) }),
    finish: vi.fn(), close: vi.fn(), pause: vi.fn(), resume: vi.fn(),
  } satisfies AudioSink
  const done = vi.fn()
  const failed = vi.fn()
  const phrases: string[] = []
  const output = new StreamingSpeech({ speak, openSink: () => sink, onPlaying: vi.fn(), onPhrase: (text) => phrases.push(text), onDone: done, onFailure: failed })
  return { output, speak, sink, answers, played, done, failed, phrases }
}

describe('streaming voice speech', () => {
  it('pauses where it is, and reports a phrase that started meanwhile only on resume', async () => {
    const f = fixture()
    f.output.append('First sentence.')
    await flush()
    f.output.pause()
    expect(f.sink.pause).toHaveBeenCalledOnce()
    f.answers.shift()?.({ kind: 'ok', audio: 'one', mimeType: 'audio/mpeg' })
    await flush()
    expect(f.sink.enqueue).toHaveBeenCalledOnce()
    expect(f.phrases).toEqual([])
    f.output.resume()
    expect(f.sink.resume).toHaveBeenCalledOnce()
    expect(f.phrases).toEqual(['First sentence.'])
    f.output.stop()
  })

  it('reports each phrase when its sound starts, not when its text arrives', async () => {
    const f = fixture()
    f.output.append('First sentence. Second sentence.')
    await flush()
    expect(f.phrases).toEqual([])
    f.answers.shift()?.({ kind: 'ok', audio: 'one', mimeType: 'audio/mpeg' })
    await flush()
    expect(f.phrases).toEqual(['First sentence.'])
    f.answers.shift()?.({ kind: 'ok', audio: 'two', mimeType: 'audio/mpeg' })
    await flush()
    expect(f.phrases).toEqual(['First sentence.'])
    f.played.shift()?.()
    await flush()
    expect(f.phrases).toEqual(['First sentence.', 'Second sentence.'])
    f.output.stop()
  })

  it('never sends a phrase with nothing to say, and speaks no Markdown marks', async () => {
    const f = fixture()
    f.output.append('**Sure.**\n')
    f.output.append('\n')
    f.output.append('.\n- ')
    f.output.finish()
    await flush()
    expect(f.speak.mock.calls).toEqual([['Sure.']])
    f.output.stop()
  })

  it('starts a phrase before generation finishes and limits prefetch to one clip', async () => {
    const f = fixture()
    f.output.append('First sentence. Second sentence. Third sentence.')
    await flush()
    expect(f.speak.mock.calls).toEqual([['First sentence.']])
    f.answers.shift()?.({ kind: 'ok', audio: 'one', mimeType: 'audio/mpeg' })
    await flush()
    expect(f.sink.enqueue).toHaveBeenCalledTimes(1)
    expect(f.speak).toHaveBeenCalledTimes(2)
    f.answers.shift()?.({ kind: 'ok', audio: 'two', mimeType: 'audio/mpeg' })
    await flush()
    expect(f.sink.enqueue).toHaveBeenCalledTimes(1)
    f.played.shift()?.()
    await flush()
    expect(f.sink.enqueue).toHaveBeenCalledTimes(2)
    f.output.stop()
  })

  it('drops late synthesis after interruption and closes audible playback immediately', async () => {
    const f = fixture()
    f.output.append('A sentence.')
    await flush()
    f.output.stop()
    expect(f.sink.close).toHaveBeenCalledOnce()
    f.answers.shift()?.({ kind: 'ok', audio: 'late', mimeType: 'audio/mpeg' })
    await flush()
    expect(f.sink.enqueue).not.toHaveBeenCalled()
    expect(f.done).not.toHaveBeenCalled()
  })

  it('reports provider failure without turning it into spoken content', async () => {
    const f = fixture()
    f.output.append('Hello.')
    f.output.finish()
    await flush()
    f.answers.shift()?.({ kind: 'note', note: 'No speech model connected.' })
    await flush()
    expect(f.failed).toHaveBeenCalledWith('No speech model connected.')
    expect(f.sink.enqueue).not.toHaveBeenCalled()
  })
});
