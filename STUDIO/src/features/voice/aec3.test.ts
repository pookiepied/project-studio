import { describe, expect, it } from 'vitest'
import { createAec3, EchoCancellingFilter } from './aec3'

const RATE = 48_000
const QUANTUM = 128


/** A voice-like test signal: a few drifting tones with a syllable-rate envelope. */
function voice(seconds: number, seed: number): Float32Array {
  const samples = new Float32Array(seconds * RATE)
  let random = seed
  const noise = () => { random = (random * 1_103_515_245 + 12_345) % 2_147_483_648; return random / 2_147_483_648 - 0.5 }
  for (let index = 0; index < samples.length; index++) {
    const t = index / RATE
    const pitch = 140 + 40 * Math.sin(2 * Math.PI * 0.7 * t + seed)
    const envelope = 0.5 + 0.5 * Math.sin(2 * Math.PI * 4 * t + seed)
    let sample = 0
    for (let harmonic = 1; harmonic <= 6; harmonic++) sample += Math.sin(2 * Math.PI * pitch * harmonic * t) / harmonic
    samples[index] = 0.15 * envelope * sample + 0.01 * noise()
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

async function run(heard: Float32Array, played: Float32Array): Promise<Float32Array> {
  const filter = new EchoCancellingFilter(await createAec3(), RATE)
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

  it('passes the microphone through when nothing is playing', async () => {
    const person = voice(3, 7)
    const cleaned = await run(person, new Float32Array(person.length))
    expect(energy(cleaned, RATE) / energy(person, RATE)).toBeGreaterThan(0.5)
  })
})
