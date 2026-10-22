/**
 * The audio-thread half of `echoCanceller.ts`: input 0 is the microphone,
 * input 1 is what Studio is playing, and the one output is the microphone
 * with that taken out (`aec3.ts`).
 *
 * Built as its own bundle and loaded with `audioWorklet.addModule`. It says
 * `ready` once the canceller is built, or `failed`; until then it passes the
 * microphone through, so nothing is lost while it starts.
 */
import { createAec3, EchoCancellingFilter } from './aec3'

// The worklet scope's own globals, which the DOM library does not declare.
declare const sampleRate: number
declare class AudioWorkletProcessor {
  readonly port: MessagePort
}
declare function registerProcessor(
  name: string,
  processor: new () => AudioWorkletProcessor,
): void

class EchoCancellerProcessor extends AudioWorkletProcessor {
  #filter: EchoCancellingFilter | null = null
  #closed = false
  #silence = new Float32Array(128)

  constructor() {
    super()
    createAec3().then(
      (aec) => {
        if (this.#closed) { aec.free(); return }
        this.#filter = new EchoCancellingFilter(aec, sampleRate)
        this.port.postMessage('ready')
      },
      () => this.port.postMessage('failed'),
    )
    this.port.onmessage = (event) => {
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
    else this.#filter.process(heard, played, out)
    return !this.#closed
  }
}

registerProcessor('studio-echo-canceller', EchoCancellerProcessor)
