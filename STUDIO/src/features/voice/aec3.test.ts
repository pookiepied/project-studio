import { describe, expect, it } from 'vitest'
import { loadAec3, EchoCancellingFilter } from './aec3'

const RATE = 48_000
const QUANTUM = 128


/**
 * A voice-like test signal: syllables of drifting pitch, of uneven length and
 * loudness, with uneven pauses - uneven, as speech is, so the echo's delay
 * can only be found at one place.
 */
function voice(seconds: number, seed: number): Float32Array {
  const samples = new Float32Array(seconds * RATE)
  let state = seed * 7919 + 1
  const random = () => { state = (state * 1_103_515_245 + 12_345) % 2_147_483_648; return state / 2_147_483_648 }
  let at = 0
  let phase = 0
  let pitch = 150
  while (at < samples.length) {
    const syllable = Math.floor((0.08 + 0.22 * random()) * RATE)
    const pause = Math.floor((0.03 + (random() < 0.15 ? 0.5 : 0.12) * random()) * RATE)
    const loudness = 0.1 + 0.25 * random()
    for (let index = 0; index < syllable && at < samples.length; index++, at++) {
      pitch = Math.min(260, Math.max(90, pitch + (random() - 0.5) * 0.05))
      phase += (2 * Math.PI * pitch) / RATE
      let sample = 0
      for (let harmonic = 1; harmonic <= 8; harmonic++) sample += Math.sin(phase * harmonic) / harmonic
      samples[at] = loudness * Math.sin((Math.PI * index) / syllable) * sample + 0.003 * (random() - 0.5)
    }
    for (let index = 0; index < pause && at < samples.length; index++, at++) samples[at] = 0.003 * (random() - 0.5)
  }
  return samples
}

/** The room: the speaker's sound, quieter, later, with one reflection. */
function room(played: Float32Array, delaySamples: number): Float32Array {
  const heard = new Float32Array(played.length)
  for (let index = 0; index < played.length; index++) {
    heard[index] = 0.6 * (played[index - delaySamples] ?? 0) + 0.25 * (played[index - delaySamples - 700] ?? 0)
  }
  return heard
}

function energy(samples: Float32Array, from: number): number {
  let sum = 0
  for (let index = from; index < samples.length; index++) sum += (samples[index] ?? 0) ** 2
  return sum / (samples.length - from)
}

async function run(heard: Float32Array, played: Float32Array, heldBack = 0): Promise<Float32Array> {
  const filter = new EchoCancellingFilter(await loadAec3(), RATE, heldBack)
  const cleaned = new Float32Array(heard.length)
  for (let at = 0; at + QUANTUM <= heard.length; at += QUANTUM) {
    filter.process(heard.subarray(at, at + QUANTUM), played.subarray(at, at + QUANTUM), cleaned.subarray(at, at + QUANTUM))
  }
  filter.free()
  return cleaned
}

describe('EchoCancellingFilter', () => {
  // 100 ms is a phone's own speaker; 250 ms a Bluetooth one.
  it.each([4_800, 12_000])('takes Studio’s voice out of what the microphone hears, echo %i samples late', async (delay) => {
    const studio = voice(6, 1)
    const echo = room(studio, delay)
    const cleaned = await run(echo, studio)
    // Judged after the first two seconds, once the canceller has converged.
    expect(10 * Math.log10(energy(cleaned, 2 * RATE) / energy(echo, 2 * RATE))).toBeLessThan(-20)
  })

  it('leaves the person talking over Studio audible', async () => {
    const studio = voice(6, 1)
    const person = voice(6, 7)
    const echo = room(studio, 4_800)
    const heard = echo.map((sample, index) => sample + (index >= 3 * RATE ? (person[index] ?? 0) : 0))
    const cleaned = await run(heard, studio)
    // Echo alone just before, the person on top just after.
    const quiet = energy(cleaned.subarray(2 * RATE, 3 * RATE), 0)
    const talking = energy(cleaned.subarray(3 * RATE + RATE / 2, 5 * RATE), 0)
    expect(10 * Math.log10(talking / quiet)).toBeGreaterThan(15)
    // And most of the person survives.
    expect(talking / energy(person.subarray(3 * RATE + RATE / 2, 5 * RATE), 0)).toBeGreaterThan(0.25)
  })

  // A phone browser's way out and back in can take longer than AEC3 looks.
  it('finds an echo too late for AEC3 alone, and cancels it from the next reply on', async () => {
    const delay = 0.7 * RATE
    // A reply, the person answering, another reply.
    const studio = new Float32Array(21 * RATE)
    studio.set(voice(8, 1), RATE)
    studio.set(voice(8, 3), 12 * RATE)
    const person = voice(3, 9)
    const heard = room(studio, delay).map((sample, index) =>
      sample + (index >= 9.2 * RATE && index < 12 * RATE ? 0.5 * (person[index - 9.2 * RATE] ?? 0) : 0))
    const filter = new EchoCancellingFilter(await loadAec3(), RATE)
    const cleaned = new Float32Array(heard.length)
    for (let at = 0; at + QUANTUM <= heard.length; at += QUANTUM) {
      filter.process(heard.subarray(at, at + QUANTUM), studio.subarray(at, at + QUANTUM), cleaned.subarray(at, at + QUANTUM))
    }
    // Most of the delay held back, the rest inside what AEC3 finds alone.
    expect(delay - filter.heldBack).toBeGreaterThan(0)
    expect(delay - filter.heldBack).toBeLessThan(0.35 * RATE)
    filter.free()
    const second = (samples: Float32Array) => energy(samples.subarray(12 * RATE, 21 * RATE), 0)
    expect(10 * Math.log10(second(cleaned) / second(heard))).toBeLessThan(-20)
    // The person, between the replies, is still there.
    const answer = (samples: Float32Array) => energy(samples.subarray(9.5 * RATE, 11.5 * RATE), 0)
    expect(answer(cleaned) / answer(heard)).toBeGreaterThan(0.25)
  })

  it('starts on the delay a previous conversation measured, so the first reply is cancelled too', async () => {
    const studio = voice(6, 1)
    const echo = room(studio, 0.7 * RATE)
    const cleaned = await run(echo, studio, 0.55 * RATE)
    expect(10 * Math.log10(energy(cleaned, RATE) / energy(echo, RATE))).toBeLessThan(-20)
  })

  // The context runs at the device's rate, which is not always AEC3's own.
  it('cancels at 44.1 kHz too', async () => {
    const rate = 44_100
    const studio = voice(6, 1)
    const echo = room(studio, 0.1 * rate)
    const filter = new EchoCancellingFilter(await loadAec3(), rate)
    const cleaned = new Float32Array(echo.length)
    for (let at = 0; at + QUANTUM <= echo.length; at += QUANTUM) {
      filter.process(echo.subarray(at, at + QUANTUM), studio.subarray(at, at + QUANTUM), cleaned.subarray(at, at + QUANTUM))
    }
    filter.free()
    expect(10 * Math.log10(energy(cleaned, 2 * rate) / energy(echo, 2 * rate))).toBeLessThan(-20)
  })

  it('passes the microphone through when nothing is playing', async () => {
    const person = voice(3, 7)
    const cleaned = await run(person, new Float32Array(person.length))
    expect(energy(cleaned, RATE) / energy(person, RATE)).toBeGreaterThan(0.5)
  })
})
