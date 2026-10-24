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
 * Loads the canceller, and returns what builds one.
 *
 * The library carries its WebAssembly inline, as a data URL in a global, but
 * its own loader only recognises another kind of data URL and otherwise
 * fetches - and an audio worklet has no `fetch`. So the bytes are decoded
 * and compiled here, the same way on every thread and under test.
 */
export async function loadAec3(): Promise<() => Aec3> {
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
  return () => new module.AEC3(AEC_RATE, 1, 1)
}

/**
 * The microphone with Studio's own voice taken out, one render quantum at a
 * time.
 *
 * AEC3 works in 10 ms frames and the audio graph in quanta of 128 samples,
 * so cleaned audio comes out in bursts and is queued here; the queue is
 * primed by the first frame, which is the 10 ms this costs.
 *
 * AEC3 only finds an echo that comes back within about half a second, and a
 * phone browser's way out to the speaker and back in from the microphone can
 * take longer - past that, AEC3 removed almost nothing. So the delay is
 * measured here (`EchoDelay`) and what was played is held back by most of
 * it before AEC3 sees it, leaving AEC3 the short remainder it handles.
 *
 * A new hold-back only takes effect once Studio has been silent for longer
 * than its echo takes to die away, and with a new AEC3: one that learned the
 * old alignment, or that starts while echo is still arriving, went on
 * letting echo through for many seconds, while one started in silence
 * settles in under one. The measured hold-back is also kept by the caller
 * and passed in to start the next conversation aligned.
 */
export class EchoCancellingFilter {
  readonly #make: () => Aec3
  #aec: Aec3
  readonly #options: { sampleRateIn: number; sampleRateOut: number }
  readonly #delay: EchoDelay
  /** What was played, kept so it can be handed to AEC3 late. */
  readonly #played: Float32Array
  #playedAt = 0
  #late = new Float32Array(1)
  /** The hold-back in effect, in samples. */
  #heldBack: number
  /** How long, in samples, Studio has played nothing. */
  #quiet = 0
  readonly #settle: number
  #processed = [new Float32Array(1)]
  readonly #queue: Float32Array
  #read = 0
  #size = 0

  /** `heldBack` starts where a previous conversation on this device left it. */
  constructor(make: () => Aec3, sampleRate: number, heldBack = 0) {
    this.#make = make
    this.#aec = make()
    this.#options = { sampleRateIn: sampleRate, sampleRateOut: sampleRate }
    // A second of audio: far more than one frame ever leaves queued.
    this.#queue = new Float32Array(sampleRate)
    this.#delay = new EchoDelay(sampleRate, heldBack)
    this.#played = new Float32Array(Math.ceil(sampleRate * (MAX_ECHO_DELAY_S + 0.1)))
    this.#heldBack = this.#delay.heldBack
    this.#settle = Math.round(sampleRate * ECHO_TAIL_S)
  }

  /** How late, in samples, what was played is handed to AEC3. */
  get heldBack(): number {
    return this.#heldBack
  }

  /**
   * `played` is what Studio sent to the speaker in this quantum, `heard` what
   * the microphone picked up; `out` receives `heard` without the echo of
   * what was played. Missing inputs are silence.
   */
  process(heard: Float32Array, played: Float32Array, out: Float32Array): void {
    this.#delay.observe(heard, played)
    this.#quiet = played.some((sample) => Math.abs(sample) > SILENT) ? 0 : this.#quiet + played.length
    if (this.#delay.heldBack !== this.#heldBack && this.#quiet >= this.#delay.measured + this.#settle) {
      this.#heldBack = this.#delay.heldBack
      this.#aec.free()
      this.#aec = this.#make()
    }
    this.#aec.analyze([this.#holdBack(played)], this.#options)
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

  /** `played`, as it was `heldBack` samples ago. */
  #holdBack(played: Float32Array): Float32Array {
    const capacity = this.#played.length
    if (this.#late.length !== played.length) this.#late = new Float32Array(played.length)
    const back = this.#heldBack
    for (let index = 0; index < played.length; index++) {
      this.#played[this.#playedAt] = played[index] ?? 0
      this.#late[index] = this.#played[(this.#playedAt - back + capacity) % capacity] ?? 0
      this.#playedAt = (this.#playedAt + 1) % capacity
    }
    return this.#late
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

/** Below this, a played sample is silence. */
const SILENT = 1e-4
/** How long an echo goes on sounding in a room after the sound that made it. */
const ECHO_TAIL_S = 0.3
/** The longest echo delay looked for: a phone browser and a Bluetooth speaker together. */
const MAX_ECHO_DELAY_S = 1.5
/** The envelope is compared in steps of this many seconds. */
const STEP_S = 0.01
/** How much of the past the comparison looks at. */
const WINDOW_STEPS = 150
/** How often it is made. */
const EVERY_STEPS = 25
/** How far below the measured delay what was played is handed over: inside the range AEC3 finds alone. */
const LEAVE_STEPS = 15
/** The remainder AEC3 is trusted with; outside it, the hold-back moves. */
const LEAVE_RANGE_STEPS: readonly [number, number] = [3, 35]
/** How alike the two envelopes must be, at the delay, to believe it. */
const MIN_LIKENESS = 0.4

/**
 * How long Studio's voice takes to come back into the microphone.
 *
 * The loudness of what was played and of what was heard, in 10 ms steps, is
 * compared at every delay up to `MAX_ECHO_DELAY_S`; the echo is the delay at
 * which the two rise and fall together. Loudness rather than the waveform,
 * because a loudspeaker and a room change the waveform past recognition and
 * leave its loudness alone. Only a delay found twice running is believed,
 * and while someone talks over Studio the two do not move together at any
 * delay, so nothing is found and nothing moves.
 */
export class EchoDelay {
  readonly #step: number
  readonly #played = new Float32Array(WINDOW_STEPS + Math.ceil(MAX_ECHO_DELAY_S / STEP_S))
  readonly #heard = new Float32Array(this.#played.length)
  #steps = 0
  #at = 0
  #playedSum = 0
  #heardSum = 0
  #candidate = -1
  #measuredSteps = 0
  #heldBackSteps = 0

  constructor(sampleRate: number, heldBack = 0) {
    this.#step = Math.round(sampleRate * STEP_S)
    this.#heldBackSteps = Math.min(Math.max(0, Math.round(heldBack / this.#step)), Math.round(MAX_ECHO_DELAY_S / STEP_S))
  }

  /** Samples to hold what was played back by. */
  get heldBack(): number {
    return this.#heldBackSteps * this.#step
  }

  /** The echo's delay, in samples, as last measured. */
  get measured(): number {
    return Math.max(this.#measuredSteps * this.#step, this.heldBack)
  }

  observe(heard: Float32Array, played: Float32Array): void {
    for (let index = 0; index < heard.length; index++) {
      this.#heardSum += Math.abs(heard[index] ?? 0)
      this.#playedSum += Math.abs(played[index] ?? 0)
      if (++this.#at < this.#step) continue
      const slot = this.#steps % this.#played.length
      // Logarithmic, so a loud syllable does not outweigh the rest of the window.
      this.#played[slot] = Math.log(1e-5 + this.#playedSum / this.#step)
      this.#heard[slot] = Math.log(1e-5 + this.#heardSum / this.#step)
      this.#at = 0
      this.#playedSum = 0
      this.#heardSum = 0
      this.#steps++
      if (this.#steps >= this.#played.length && this.#steps % EVERY_STEPS === 0) this.#measure()
    }
  }

  #measure(): void {
    const length = this.#played.length
    const newest = this.#steps - 1
    const value = (array: Float32Array, step: number) => array[((step % length) + length) % length] ?? 0
    // Studio has to have been talking for the comparison to say anything.
    let talking = 0
    for (let step = newest - WINDOW_STEPS + 1; step <= newest; step++) if (value(this.#played, step) > -7) talking++
    if (talking < WINDOW_STEPS / 4) return
    const mean = (array: Float32Array, last: number) => {
      let sum = 0
      for (let step = last - WINDOW_STEPS + 1; step <= last; step++) sum += value(array, step)
      return sum / WINDOW_STEPS
    }
    const heardMean = mean(this.#heard, newest)
    let best = -1
    let likeness = 0
    for (let lag = 0; lag <= length - WINDOW_STEPS; lag++) {
      const playedMean = mean(this.#played, newest - lag)
      let cross = 0
      let heardPower = 0
      let playedPower = 0
      for (let step = newest - WINDOW_STEPS + 1; step <= newest; step++) {
        const h = value(this.#heard, step) - heardMean
        const p = value(this.#played, step - lag) - playedMean
        cross += h * p
        heardPower += h * h
        playedPower += p * p
      }
      const score = cross / Math.sqrt(heardPower * playedPower + 1e-12)
      if (score > likeness) { likeness = score; best = lag }
    }
    if (likeness < MIN_LIKENESS) { this.#candidate = -1; return }
    // Twice running, give or take three steps, before anything moves.
    const agreed = this.#candidate >= 0 && Math.abs(best - this.#candidate) <= 3
    this.#candidate = best
    if (!agreed) return
    this.#measuredSteps = best
    const left = best - this.#heldBackSteps
    if (left < LEAVE_RANGE_STEPS[0] || left > LEAVE_RANGE_STEPS[1]) this.#heldBackSteps = Math.max(0, best - LEAVE_STEPS)
  }
}
