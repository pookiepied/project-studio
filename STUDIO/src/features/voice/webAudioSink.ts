import { bytesOfBase64 } from '@/lib/base64'
import { openEchoReference, type EchoReference } from './echoReference'
import type { AudioSink, Clip } from './narration'
import { meterLevel } from './useMicInput'

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
 *
 * With `echoReference`, used while the microphone is open in voice mode, the
 * output is played as call audio so the browser's echo canceller hears it
 * (`echoReference.ts`). The first clip waits for that route - it forms while
 * the first passage renders, so the wait is rarely felt - and plays directly
 * if the route cannot form.
 */
export function openWebAudioSink(onEnded: () => void, options?: { echoReference?: boolean }): AudioSink {
  const context = new AudioContext()
  // A context made outside a user gesture starts suspended; this one is made
  // in the click, and asking anyway costs nothing where it already runs.
  void context.resume()
  // Every clip plays through one gain, so deafening silences what is already
  // scheduled as well as what comes next, and the clock keeps running.
  const output = context.createGain()
  // Read for the echo guard: how loud Studio sounds in the room. After the
  // deafen gain, because a deafened reply never reaches the room to return.
  const meter = context.createAnalyser()
  meter.fftSize = 1024
  output.connect(meter)
  const samples = new Float32Array(meter.fftSize)
  let reference: EchoReference | null = null
  const routed: Promise<void> = options?.echoReference === true
    ? openEchoReference(context).then((opened) => {
        if (closed) { opened?.close(); return }
        reference = opened
        output.connect(opened?.input ?? context.destination)
      })
    : Promise.resolve(output.connect(context.destination)).then(() => undefined)
  const sounding = new Set<AudioBufferSourceNode>()
  let nextAt = 0
  let finished = false
  let closed = false

  const drained = (): void => {
    if (finished && sounding.size === 0 && !closed) onEnded()
  }

  const enqueue = async (clip: Clip, onPlayed?: () => void): Promise<void> => {
    // decodeAudioData detaches the buffer it is given; the decoder owns
    // these bytes and nothing else reads them after.
    const buffer = await context.decodeAudioData(bytesOfBase64(clip.audio).buffer)
    await routed
    if (closed) return
    const source = context.createBufferSource()
    source.buffer = buffer
    source.connect(output)
    const at = Math.max(context.currentTime, nextAt)
    source.start(at)
    nextAt = at + buffer.duration
    sounding.add(source)
    source.onended = () => {
      sounding.delete(source)
      onPlayed?.()
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
    setMuted(muted: boolean) {
      output.gain.value = muted ? 0 : 1
    },
    level() {
      if (closed || sounding.size === 0) return 0
      meter.getFloatTimeDomainData(samples)
      let sum = 0
      for (const sample of samples) sum += sample * sample
      return meterLevel(Math.sqrt(sum / samples.length))
    },
    close() {
      closed = true
      reference?.close()
      void context.close()
    },
  }
}
