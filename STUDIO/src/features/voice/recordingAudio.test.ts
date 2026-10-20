import { afterEach, describe, expect, it, vi } from 'vitest'
import { pcmWav, recordingAudio } from './recordingAudio'

afterEach(() => vi.unstubAllGlobals())

describe('provider-neutral dictation audio', () => {
  it('writes a mono PCM WAV header and little-endian samples with clipping', () => {
    const data = pcmWav({ length: 5, sampleRate: 16_000, numberOfChannels: 1,
      getChannelData: () => new Float32Array([-2, -0.5, 0, 0.5, 2]) })
    const view = new DataView(data.buffer)
    expect(new TextDecoder().decode(data.slice(0, 4))).toBe('RIFF')
    expect(new TextDecoder().decode(data.slice(8, 12))).toBe('WAVE')
    expect(view.getUint32(4, true)).toBe(data.length - 8)
    expect(view.getUint16(20, true)).toBe(1)
    expect(view.getUint16(22, true)).toBe(1)
    expect(view.getUint32(24, true)).toBe(16_000)
    expect(view.getUint32(28, true)).toBe(32_000)
    expect(view.getUint16(34, true)).toBe(16)
    expect(view.getUint32(40, true)).toBe(10)
    expect(Array.from({ length: 5 }, (_, index) => view.getInt16(44 + index * 2, true)))
      .toEqual([-32768, -16384, 0, 16384, 32767])
  })

  it('mixes channels and writes silence for nonfinite input', () => {
    const data = pcmWav({ length: 2, sampleRate: 24_000, numberOfChannels: 2,
      getChannelData: (channel) => new Float32Array(channel === 0 ? [1, NaN] : [-1, 0]) })
    const view = new DataView(data.buffer)
    expect(view.getInt16(44, true)).toBe(0)
    expect(view.getInt16(46, true)).toBe(0)
    expect(view.getUint32(24, true)).toBe(24_000)
  })

  it('decodes compressed containers using a 16 kHz offline context', async () => {
    const decode = vi.fn(async () => ({ length: 1, sampleRate: 16_000, numberOfChannels: 1,
      getChannelData: () => new Float32Array([0.25]) }))
    const construct = vi.fn()
    vi.stubGlobal('OfflineAudioContext', class {
      constructor(channels: number, frames: number, rate: number) { construct(channels, frames, rate) }
      decodeAudioData = decode
    })
    const result = await recordingAudio(new Blob([new Uint8Array([0x1a, 0x45])], { type: 'audio/webm;codecs=opus' }))
    expect(construct).toHaveBeenCalledWith(1, 1, 16_000)
    expect(decode).toHaveBeenCalledTimes(1)
    expect(new DataView(result.buffer).getInt16(44, true)).toBe(8192)
  })

  it('preserves existing WAV bytes without opening a decoder', async () => {
    const construct = vi.fn()
    vi.stubGlobal('OfflineAudioContext', construct)
    const wav = pcmWav({ length: 1, sampleRate: 16_000, numberOfChannels: 1, getChannelData: () => new Float32Array([0]) })
    expect(await recordingAudio(new Blob([wav], { type: 'audio/wav' }))).toEqual(wav)
    expect(construct).not.toHaveBeenCalled()
  })
})
