import workletUrl from './echoCanceller.worklet.ts?worker&url'

/**
 * One audio graph for a voice conversation, in which Studio's voice is taken
 * out of the microphone before anything listens to it.
 *
 *   microphone ──▶ canceller ──▶ output        (what the detector and
 *                      ▲                        recorder hear)
 *   playback ──────────┴──────▶ speakers
 *
 * Everything Studio says is played into `playback`, so the canceller's
 * reference is exactly the sound sent to the speakers, in the same quantum,
 * and the room's delay is all it has to find (`aec3.ts`). That is what makes
 * talking over Studio work on a loudspeaker: the person is what is left.
 *
 * The microphone is opened without the browser's own processing - two
 * cancellers in a row fight, and the browser's would not know Studio's voice
 * anyway. Anything that stops the graph forming (no audio worklet, the
 * library refused) is `null`, and the caller opens the microphone with the
 * browser's processing as before. So is a graph that forms and then passes
 * nothing on - a phone's browser can hand the worklet a silent microphone,
 * or none - which `flowing()` finds out before anything listens.
 *
 * How late the echo comes back is a property of this device's speaker and
 * microphone, so the delay the canceller measured is kept in this browser
 * and the next conversation starts with it: the first reply on a device
 * whose echo is slow is the only one the canceller has to find it in.
 */
export interface EchoCancelledAudio {
  readonly context: AudioContext
  /** Where Studio's voice is played; it reaches the speakers and the canceller. */
  readonly playback: AudioNode
  /** The microphone, once attached, with Studio's voice taken out. */
  readonly output: AudioNode
  /** Connects the microphone, and returns the cleaned stream to record. */
  attach(microphone: MediaStream): MediaStream
  /** After `attach`: whether the microphone reaches the canceller and comes out of it. */
  flowing(): Promise<boolean>
  close(): void
}

/** How long the canceller is given to build before voice goes on without it. */
const READY_MS = 3_000
/** How long an attached microphone is given to be heard through the canceller. */
const FLOWING_MS = 3_000
/** Where this browser keeps the echo delay the canceller last measured. */
const HELD_BACK_KEY = 'studio.voice.echoHeldBackSeconds'

function rememberedHeldBack(): number {
  try {
    const seconds = Number(localStorage.getItem(HELD_BACK_KEY))
    return Number.isFinite(seconds) && seconds > 0 && seconds < 2 ? seconds : 0
  } catch {
    return 0
  }
}

/** The worklet's messages, other than `ready` and `failed`, go to `onReport`. */
function ready(node: AudioWorkletNode, onReport: (data: Record<string, unknown>) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('echo canceller: timed out')), READY_MS)
    node.port.onmessage = (event: MessageEvent<unknown>) => {
      const data = event.data
      if (data === 'ready') { window.clearTimeout(timer); resolve(); return }
      if (data === 'failed') { window.clearTimeout(timer); reject(new Error('echo canceller: failed')); return }
      if (typeof data === 'object' && data !== null) onReport(data as Record<string, unknown>)
    }
  })
}

export async function openEchoCancelledAudio(): Promise<EchoCancelledAudio | null> {
  if (typeof AudioWorkletNode === 'undefined') return null
  // The device's own rate: AEC3 resamples to its own, and a context at a
  // rate the microphone does not run at is where a browser's capture breaks.
  const context = new AudioContext()
  let hasFlowed = false
  let flowed: (() => void) | null = null
  const onReport = (data: Record<string, unknown>) => {
    if (typeof data.heldBackSeconds === 'number') {
      try {
        localStorage.setItem(HELD_BACK_KEY, String(data.heldBackSeconds))
      } catch {
        // Not kept: the next conversation measures it again.
      }
    }
    // Any real microphone has a noise floor; exact silence in or out is a
    // capture or a canceller that is not working.
    if (typeof data.heardPeak === 'number' && typeof data.outPeak === 'number' && data.heardPeak > 0 && data.outPeak > 0) {
      hasFlowed = true
      flowed?.()
    }
  }
  try {
    if (context.state === 'suspended') await context.resume()
    await context.audioWorklet.addModule(workletUrl)
    const canceller = new AudioWorkletNode(context, 'studio-echo-canceller', {
      numberOfInputs: 2,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      channelCount: 1,
      channelCountMode: 'explicit',
      processorOptions: { heldBackSeconds: rememberedHeldBack() },
    })
    await ready(canceller, onReport)
    const playback = context.createGain()
    playback.connect(context.destination)
    playback.connect(canceller, 0, 1)
    const recorded = context.createMediaStreamDestination()
    canceller.connect(recorded)
    let source: MediaStreamAudioSourceNode | null = null
    return {
      context,
      playback,
      output: canceller,
      attach(microphone) {
        source?.disconnect()
        source = context.createMediaStreamSource(microphone)
        source.connect(canceller, 0, 0)
        return recorded.stream
      },
      flowing() {
        if (hasFlowed) return Promise.resolve(true)
        canceller.port.postMessage('check')
        return new Promise((resolve) => {
          const timer = window.setTimeout(() => { flowed = null; resolve(false) }, FLOWING_MS)
          flowed = () => {
            window.clearTimeout(timer)
            flowed = null
            resolve(true)
          }
        })
      },
      close() {
        canceller.port.postMessage('close')
        void context.close()
      },
    }
  } catch {
    void context.close()
    return null
  }
}
