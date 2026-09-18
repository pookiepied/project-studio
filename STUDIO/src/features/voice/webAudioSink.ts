import { bytesOfBase64 } from '@/lib/base64'
import type { AudioSink, Clip } from './narration'

/**
 * The passages of one narration, joined without a gap.
 *
 * An `<audio>` element per passage would do, chained on `ended`, and the
 * chain would breathe between every two: the element fires `ended`, the
 * next is told to play, the decoder warms up - tens of milliseconds of
 * silence at each join, at every sentence end, which is the one place a
 * listener hears it. Web Audio schedules instead. Every clip is decoded to
 * samples and told to start on the context's clock exactly where the clip
 * before it ends, so the join is sample-accurate whether the next clip was
 * decoded a second early or is decoded while the current one plays. When
 * the provider is slower than the sound - the next clip arrives after the
 * current one ended - the clip starts at once, and the gap is the wait it
 * really was.
 *
 * Pause is the context suspended, and its clock stops with it, so a clip
 * queued during a pause still lands right after the one before. Close is
 * the context closed, which stops every source at once and frees the
 * device.
 */
export function openWebAudioSink(onEnded: () => void): AudioSink {
  const context = new AudioContext()
  // A context made outside a user gesture starts suspended; this one is made
  // in the click, and asking anyway costs nothing where it already runs.
  void context.resume()
  const sounding = new Set<AudioBufferSourceNode>()
  let nextAt = 0
  let finished = false
  let closed = false

  const drained = (): void => {
    if (finished && sounding.size === 0 && !closed) onEnded()
  }

  const enqueue = async (clip: Clip): Promise<void> => {
    // decodeAudioData detaches the buffer it is given; the decoder owns
    // these bytes and nothing else reads them after.
    const buffer = await context.decodeAudioData(bytesOfBase64(clip.audio).buffer)
    if (closed) return
    const source = context.createBufferSource()
    source.buffer = buffer
    source.connect(context.destination)
    const at = Math.max(context.currentTime, nextAt)
    source.start(at)
    nextAt = at + buffer.duration
    sounding.add(source)
    source.onended = () => {
      sounding.delete(source)
      drained()
    }
  }

  return {
    enqueue,
    finish() {
      finished = true
      drained()
    },
    pause() {
      void context.suspend()
    },
    resume() {
      void context.resume()
    },
    close() {
      closed = true
      void context.close()
    },
  }
}
