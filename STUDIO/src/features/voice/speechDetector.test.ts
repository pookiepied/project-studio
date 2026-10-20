import { describe, expect, it } from 'vitest'
import { isContinuer, saidNothing, SpeechGate, voicedFrame } from './speechDetector'

const RATE = 48_000
const SIZE = 2048

/** The analyser's view of a signal: a Hann-windowed spectrum in dB per bin. */
function spectrum(signal: (t: number) => number): Float32Array {
  const samples = Array.from({ length: SIZE }, (_, n) => signal(n / RATE) * (0.5 - 0.5 * Math.cos((2 * Math.PI * n) / (SIZE - 1))))
  const out = new Float32Array(SIZE / 2)
  for (let k = 0; k < SIZE / 2; k++) {
    let re = 0
    let im = 0
    for (let n = 0; n < SIZE; n++) {
      const angle = (2 * Math.PI * k * n) / SIZE
      const value = samples[n] ?? 0
      re += value * Math.cos(angle)
      im -= value * Math.sin(angle)
    }
    out[k] = 10 * Math.log10((re * re + im * im) / SIZE + 1e-20)
  }
  return out
}

let seed = 7
const noise = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 * 2 - 1 }

/** A vowel: a 140 Hz pitch with harmonics falling off, the energy in the voice band. */
const vowel = (t: number) => {
  let value = 0
  for (let h = 1; h * 140 < 4000; h++) value += Math.sin(2 * Math.PI * 140 * h * t) / h * (h * 140 > 300 && h * 140 < 1200 ? 3 : 1)
  return value
}

describe('the speech detector', () => {
  it('hears a vowel as a voice', () => {
    expect(voicedFrame(spectrum(vowel), RATE)).toBe(true)
  })

  it('hears broadband noise - a clap, a fan, typing - as not a voice', () => {
    expect(voicedFrame(spectrum(() => noise()), RATE)).toBe(false)
  })

  it('hears a low hum as not a voice', () => {
    expect(voicedFrame(spectrum((t) => Math.sin(2 * Math.PI * 60 * t)), RATE)).toBe(false)
  })

  it('needs speech to last: a clap-length burst never opens the gate', () => {
    const gate = new SpeechGate()
    let opened = false
    for (let ms = 0; ms < 80; ms += 16) opened = gate.observe(true, true, 16) || opened
    for (let ms = 0; ms < 400; ms += 16) opened = gate.observe(false, false, 16) || opened
    expect(opened).toBe(false)
    for (let ms = 0; ms < 160; ms += 16) gate.observe(true, true, 16)
    gate.observe(false, false, 100)
    let spoke = false
    for (let ms = 0; ms < 120; ms += 16) spoke = gate.observe(true, true, 16) || spoke
    expect(spoke).toBe(true)
  })
})

describe('what a take said', () => {
  it('lets "yeah, continue" keep Studio talking, and anything else take the turn', () => {
    expect(isContinuer('Yeah, yeah, continue.')).toBe(true)
    expect(isContinuer('Mm-hmm, go on')).toBe(true)
    expect(isContinuer('okay')).toBe(true)
    expect(isContinuer('No, stop.')).toBe(false)
    expect(isContinuer('Yeah but make it blue')).toBe(false)
    expect(isContinuer('')).toBe(false)
  })

  it('treats punctuation-only transcriptions as nothing said', () => {
    expect(saidNothing(' ... ')).toBe(true)
    expect(saidNothing('Hi')).toBe(false)
  })
})
