/** PCM WAV is the common recording format accepted by Studio's STT adapters. */
const SAMPLE_RATE = 16_000

/** Decode the container, resample, and encode actual PCM; relabeling WebM fails. */
export async function recordingAudio(blob: Blob): Promise<Uint8Array> {
  const source = await blob.arrayBuffer()
  if (blob.type.split(';')[0]?.toLowerCase() === 'audio/wav') return new Uint8Array(source)
  const decoder = new OfflineAudioContext(1, 1, SAMPLE_RATE)
  const decoded = await decoder.decodeAudioData(source)
  return pcmWav(decoded)
}

export function pcmWav(audio: Pick<AudioBuffer, 'length' | 'sampleRate' | 'numberOfChannels' | 'getChannelData'>): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(44 + audio.length * 2)
  const view = new DataView(bytes.buffer)
  const text = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index++) view.setUint8(offset + index, value.charCodeAt(index))
  }
  text(0, 'RIFF')
  view.setUint32(4, bytes.length - 8, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, audio.sampleRate, true)
  view.setUint32(28, audio.sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  text(36, 'data')
  view.setUint32(40, audio.length * 2, true)
  const channels = Array.from({ length: audio.numberOfChannels }, (_, index) => audio.getChannelData(index))
  for (let index = 0; index < audio.length; index++) {
    const sample = channels.reduce((sum, channel) => sum + (channel[index] ?? 0), 0) / channels.length
    const bounded = Number.isFinite(sample) ? Math.max(-1, Math.min(1, sample)) : 0
    view.setInt16(44 + index * 2, Math.round(bounded * (bounded < 0 ? 32768 : 32767)), true)
  }
  return bytes
}
