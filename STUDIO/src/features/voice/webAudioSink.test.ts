import { describe, expect, it, vi } from 'vitest'
import { openWebAudioSink } from './webAudioSink'

interface FakeSource {
  /** When `start` was called with, and from how far in. */
  scheduled: [number, number] | null
  stopped: boolean
  onended: (() => void) | null
}

/** Just enough of an audio graph to see what was scheduled, and when. */
function fakeGraph() {
  const sources: FakeSource[] = []
  const context = {
    currentTime: 0,
    destination: {},
    createGain: () => ({ gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() }),
    createBufferSource: () => {
      const source: FakeSource & Record<string, unknown> = {
        scheduled: null,
        stopped: false,
        onended: null,
        buffer: null,
        connect: vi.fn(),
        start(at: number, offset = 0) { source.scheduled = [at, offset] },
        stop() { source.stopped = true; source.onended?.() },
      }
      sources.push(source)
      return source
    },
    decodeAudioData: vi.fn(async () => ({ duration: 2 })),
    close: vi.fn(),
  }
  const destination = { context } as unknown as AudioNode
  return { context, destination, sources }
}

const clip = { audio: 'AAAA', mimeType: 'audio/mpeg' }

describe('openWebAudioSink in a graph it does not own', () => {
  it('pauses by stopping the clips and resumes each from where it got to', async () => {
    const { context, destination, sources } = fakeGraph()
    const onEnded = vi.fn()
    const sink = openWebAudioSink(onEnded, destination)
    const first = vi.fn()
    const second = vi.fn()
    await sink.enqueue(clip, first)
    await sink.enqueue(clip, second)
    expect(sources.map((source) => source.scheduled)).toEqual([[0, 0], [2, 0]])

    context.currentTime = 0.5
    sink.pause()
    expect(sources.every((source) => source.stopped)).toBe(true)
    // Stopped for the pause is not played to the end.
    expect(first).not.toHaveBeenCalled()

    context.currentTime = 10
    sink.resume()
    expect(sources.slice(2).map((source) => source.scheduled)).toEqual([[10, 0.5], [11.5, 0]])

    sources[2]?.onended?.()
    expect(first).toHaveBeenCalledTimes(1)
    sink.finish()
    expect(onEnded).not.toHaveBeenCalled()
    sources[3]?.onended?.()
    expect(second).toHaveBeenCalledTimes(1)
    expect(onEnded).toHaveBeenCalledTimes(1)
  })

  it('queues a clip that arrives during a pause after the paused ones', async () => {
    const { context, destination, sources } = fakeGraph()
    const sink = openWebAudioSink(() => {}, destination)
    await sink.enqueue(clip)
    context.currentTime = 1
    sink.pause()
    await sink.enqueue(clip)
    expect(sources).toHaveLength(1)
    context.currentTime = 4
    sink.resume()
    expect(sources.slice(1).map((source) => source.scheduled)).toEqual([[4, 1], [5, 0]])
  })

  it('closing stops the sound but leaves the shared graph running', async () => {
    const { context, destination, sources } = fakeGraph()
    const sink = openWebAudioSink(() => {}, destination)
    await sink.enqueue(clip)
    sink.close()
    expect(sources[0]?.stopped).toBe(true)
    expect(context.close).not.toHaveBeenCalled()
  })
})
