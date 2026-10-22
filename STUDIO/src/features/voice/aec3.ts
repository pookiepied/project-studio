import './aec3Global'
import createAec3Module from '@ennuicastr/webrtcaec3.js'

/**
 * WebRTC's echo canceller (AEC3), the one Chrome runs in its own calls,
 * compiled to WebAssembly by `@ennuicastr/webrtcaec3.js`.
 *
 * Studio runs it itself rather than trusting the browser's: a browser
 * cancels only the sound it knows it is playing, and what it counts as
 * "playing" differs - on a phone's loudspeaker Studio's reply was not on
 * that list, and voice mode heard itself. Here the reference is exactly the
 * samples Studio plays (`echoCanceller.ts` wires them in), so the result is
 * the same in every browser.
 *
 * This file is the part with no audio thread in it, so the same code runs in
 * the worklet and under test.
 */

/** The rate AEC3 is built for; other input rates are resampled by the library. */
const AEC_RATE = 48_000

interface Aec3 {
  analyze(data: Float32Array[], options?: { sampleRateIn?: number }): void
  processSize(data: Float32Array[], options?: { sampleRateIn?: number; sampleRateOut?: number }): number
  process(out: Float32Array[], data: Float32Array[], options?: { sampleRateIn?: number; sampleRateOut?: number }): void
  free(): void
}

interface Aec3Module {
  AEC3: new (sampleRate: number, renderChannels: number, captureChannels: number) => Aec3
}

type ModuleFactory = (config: {
  instantiateWasm: (imports: WebAssembly.Imports, receive: (instance: WebAssembly.Instance) => void) => WebAssembly.Exports
}) => Promise<Aec3Module>

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Base64 to bytes without `atob`, which an audio worklet's scope does not have. */
function decodeBase64(text: string): Uint8Array<ArrayBuffer> {
  const values = new Uint8Array(128)
  for (let index = 0; index < BASE64.length; index++) values[BASE64.charCodeAt(index)] = index
  const digits = text.replace(/=+$/, '')
  const bytes = new Uint8Array(Math.floor((digits.length * 3) / 4))
  let bits = 0
  let held = 0
  let at = 0
  for (let index = 0; index < digits.length; index++) {
    bits = ((bits << 6) | (values[digits.charCodeAt(index)] ?? 0)) & 0xff_ffff
    held += 6
    if (held >= 8) {
      held -= 8
      bytes[at++] = (bits >> held) & 0xff
    }
  }
  return bytes
}

/**
 * Builds one canceller.
 *
 * The library carries its WebAssembly inline, as a data URL in a global, but
 * its own loader only recognises another kind of data URL and otherwise
 * fetches - and an audio worklet has no `fetch`. So the bytes are decoded
 * and compiled here, the same way on every thread and under test.
 */
export async function createAec3(): Promise<Aec3> {
  const embedded = (globalThis as { WebRtcAec3Wasm?: string }).WebRtcAec3Wasm ?? ''
  const comma = embedded.indexOf(',')
  if (!embedded.startsWith('data:') || comma < 0) throw new Error('echo canceller: the library carried no WebAssembly')
  const compiled = new WebAssembly.Module(decodeBase64(embedded.slice(comma + 1)))
  const module = await (createAec3Module as unknown as ModuleFactory)({
    instantiateWasm(imports, receive) {
      const instance = new WebAssembly.Instance(compiled, imports)
      receive(instance)
      return instance.exports
    },
  })
  return new module.AEC3(AEC_RATE, 1, 1)
}

/**
 * The microphone with Studio's own voice taken out, one render quantum at a
 * time.
 *
 * AEC3 works in 10 ms frames and the audio graph in quanta of 128 samples,
 * so cleaned audio comes out in bursts and is queued here; the queue is
 * primed by the first frame, which is the 10 ms this costs.
 */
export class EchoCancellingFilter {
  readonly #aec: Aec3
  readonly #options: { sampleRateIn: number; sampleRateOut: number }
  #processed = [new Float32Array(1)]
  readonly #queue: Float32Array
  #read = 0
  #size = 0

  constructor(aec: Aec3, sampleRate: number) {
    this.#aec = aec
    this.#options = { sampleRateIn: sampleRate, sampleRateOut: sampleRate }
    // A second of audio: far more than one frame ever leaves queued.
    this.#queue = new Float32Array(sampleRate)
  }

  /**
   * `played` is what Studio sent to the speaker in this quantum, `heard` what
   * the microphone picked up; `out` receives `heard` without the echo of
   * what was played. Missing inputs are silence.
   */
  process(heard: Float32Array, played: Float32Array, out: Float32Array): void {
    this.#aec.analyze([played], this.#options)
    // Every quantum goes in, even one that completes no frame: the library
    // collects it towards the next.
    const size = this.#aec.processSize([heard], this.#options)
    const first = this.#processed[0]
    if (first === undefined || first.length < size) this.#processed = [new Float32Array(size)]
    this.#aec.process(this.#processed, [heard], this.#options)
    if (size > 0) this.#push(this.#processed[0]?.subarray(0, size) ?? new Float32Array(0))
    this.#pull(out)
  }

  free(): void {
    this.#aec.free()
  }

  #push(samples: Float32Array): void {
    const capacity = this.#queue.length
    for (const sample of samples) {
      if (this.#size === capacity) {
        // Never expected; dropping the oldest keeps the delay bounded.
        this.#read = (this.#read + 1) % capacity
        this.#size--
      }
      this.#queue[(this.#read + this.#size) % capacity] = sample
      this.#size++
    }
  }

  #pull(out: Float32Array): void {
    const capacity = this.#queue.length
    // Until the first frame is out there is nothing yet to give: silence.
    const ready = Math.min(out.length, this.#size)
    for (let index = 0; index < ready; index++) {
      out[index] = this.#queue[(this.#read + index) % capacity] ?? 0
    }
    out.fill(0, ready)
    this.#read = (this.#read + ready) % capacity
    this.#size -= ready
  }
}
