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
 * With `destination`, the sink plays into a graph it does not own - voice
 * mode's, where the microphone runs too (`echoCanceller.ts`) - so pause
 * cannot stop the clock: the microphone has to keep listening. Pause stops
 * the clips instead and remembers how far each got; resume schedules them
 * again from there, back to back, and a clip queued during the pause lands
 * after them. Close stops every clip, and closes the context only when the
 * sink made it.
 */
export function openWebAudioSink(onEnded: () => void, destination?: AudioNode): AudioSink {
  const owned = destination === undefined ? new AudioContext() : null
  const context = owned ?? (destination?.context as BaseAudioContext)
  // A context made outside a user gesture starts suspended; this one is made
  // in the click, and asking anyway costs nothing where it already runs.
  if (owned !== null) void owned.resume()
  // Every clip plays through one gain, so deafening silences what is already
  // scheduled as well as what comes next, and the clock keeps running.
  const output = context.createGain()
  output.connect(destination ?? context.destination)

  interface Queued {
    readonly buffer: AudioBuffer
    readonly onPlayed: (() => void) | undefined
    /** Seconds into the clip already heard, across pauses. */
    offset: number
    /** The source sounding it now; null while paused. */
    source: AudioBufferSourceNode | null
    startedAt: number
  }
  // Clips not yet played to their end, in order.
  const queue: Queued[] = []
  let nextAt = 0
  let paused = false
  let finished = false
  let closed = false

  const drained = (): void => {
    if (finished && queue.length === 0 && !closed) onEnded()
  }

  /** Starts `clip` from where it got to, at `at`; returns when it will end. */
  const play = (clip: Queued, at: number): number => {
    const source = context.createBufferSource()
    source.buffer = clip.buffer
    source.connect(output)
    source.start(at, clip.offset)
    clip.source = source
    clip.startedAt = at
    source.onended = () => {
      // A source stopped by pause is not the clip ending.
      if (clip.source !== source) return
      queue.splice(queue.indexOf(clip), 1)
      clip.onPlayed?.()
      drained()
    }
    return at + clip.buffer.duration - clip.offset
  }

  const enqueue = async (clip: Clip, onPlayed?: () => void): Promise<void> => {
    // decodeAudioData detaches the buffer it is given; the decoder owns
    // these bytes and nothing else reads them after.
    const buffer = await context.decodeAudioData(bytesOfBase64(clip.audio).buffer)
    if (closed) return
    const queued: Queued = { buffer, onPlayed, offset: 0, source: null, startedAt: 0 }
    queue.push(queued)
    if (!paused) nextAt = play(queued, Math.max(context.currentTime, nextAt))
  }

  const silence = (): void => {
    const now = context.currentTime
    for (const clip of queue) {
      const source = clip.source
      if (source === null) continue
      clip.source = null
      if (now > clip.startedAt) clip.offset = Math.min(clip.buffer.duration, clip.offset + now - clip.startedAt)
      source.stop()
    }
  }

  return {
    enqueue,
    finish() {
      finished = true
      drained()
    },
    pause() {
      if (paused || closed) return
      paused = true
      silence()
    },
    resume() {
      if (!paused || closed) return
      paused = false
      let at = context.currentTime
      for (const clip of queue) at = play(clip, at)
      nextAt = at
    },
    setMuted(muted: boolean) {
      output.gain.value = muted ? 0 : 1
    },
    close() {
      closed = true
      silence()
      output.disconnect()
      void owned?.close()
    },
  }
}
