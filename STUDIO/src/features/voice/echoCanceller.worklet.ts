/**
 * The audio-thread half of `echoCanceller.ts`: input 0 is the microphone,
 * input 1 is what Studio is playing, and the one output is the microphone
 * with that taken out (`aec3.ts`).
 *
 * Built as its own bundle and loaded with `audioWorklet.addModule`. It says
 * `ready` once the canceller is built, or `failed`; until then it passes the
 * microphone through, so nothing is lost while it starts. It starts with the
 * hold-back in `processorOptions.heldBackSeconds` and reports
 * `{ heldBackSeconds }` whenever it measures a new one. Sent `check`, it
 * reports `{ heardPeak, outPeak }` every quarter second for a few seconds, so
 * the page can tell a microphone that reaches it, and leaves it, from one
 * that does not.
 */
import { loadAec3, EchoCancellingFilter } from './aec3'

// The worklet scope's own globals, which the DOM library does not declare.
declare const sampleRate: number
declare class AudioWorkletProcessor {
  readonly port: MessagePort
}
declare function registerProcessor(
  name: string,
  processor: new (options: { processorOptions?: { heldBackSeconds?: number } }) => AudioWorkletProcessor,
): void

/** Quarter seconds of health reports after a `check`: longer than the page waits. */
const HEALTH_REPORTS = 16

class EchoCancellerProcessor extends AudioWorkletProcessor {
  #filter: EchoCancellingFilter | null = null
  #closed = false
  #silence = new Float32Array(128)
  #reported = 0
  #heardPeak = 0
  #outPeak = 0
  #counted = 0
  #reports = HEALTH_REPORTS

  constructor(options: { processorOptions?: { heldBackSeconds?: number } }) {
    super()
    loadAec3().then(
      (make) => {
        if (this.#closed) return
        this.#filter = new EchoCancellingFilter(make, sampleRate, (options.processorOptions?.heldBackSeconds ?? 0) * sampleRate)
        this.#reported = this.#filter.heldBack
        this.port.postMessage('ready')
      },
      () => this.port.postMessage('failed'),
    )
    this.port.onmessage = (event) => {
      if (event.data === 'check') {
        this.#reports = 0
        this.#heardPeak = 0
        this.#outPeak = 0
        this.#counted = 0
        return
      }
      if (event.data !== 'close') return
      this.#closed = true
      this.#filter?.free()
      this.#filter = null
    }
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0]?.[0]
    if (out === undefined) return !this.#closed
    if (this.#silence.length !== out.length) this.#silence = new Float32Array(out.length)
    const heard = inputs[0]?.[0] ?? this.#silence
    const played = inputs[1]?.[0] ?? this.#silence
    if (this.#filter === null) out.set(heard)
    else {
      this.#filter.process(heard, played, out)
      if (this.#filter.heldBack !== this.#reported) {
        this.#reported = this.#filter.heldBack
        this.port.postMessage({ heldBackSeconds: this.#reported / sampleRate })
      }
    }
    if (this.#reports < HEALTH_REPORTS) this.#health(heard, out)
    return !this.#closed
  }

  #health(heard: Float32Array, out: Float32Array): void {
    for (const sample of heard) this.#heardPeak = Math.max(this.#heardPeak, Math.abs(sample))
    for (const sample of out) this.#outPeak = Math.max(this.#outPeak, Math.abs(sample))
    this.#counted += out.length
    if (this.#counted < sampleRate / 4) return
    this.port.postMessage({ heardPeak: this.#heardPeak, outPeak: this.#outPeak })
    this.#reports++
    this.#heardPeak = 0
    this.#outPeak = 0
    this.#counted = 0
  }
}

registerProcessor('studio-echo-canceller', EchoCancellerProcessor)
