import { describe, expect, it } from 'vitest'

import { contextBreakdown, contextReport, formatTokens, measuredTotal } from '@/domain/session/context'
import type { ContextReport } from '@/domain/session/context'

/** The measured total, refusing rather than asserting when nothing measured. */
function total(report: ContextReport): number {
  const measured = report.measured
  if (measured === null) throw new Error('this report measured nothing')
  return measuredTotal(measured)
}

/** One assistant item's worth of reported usage, with the rest left null. */
function usage(fields: {
  input?: number
  output?: number
  cacheRead?: number
  cacheWrite?: number
}) {
  return {
    kind: 'assistant',
    segments: [],
    usage: {
      input: fields.input ?? null,
      output: fields.output ?? null,
      cacheRead: fields.cacheRead ?? null,
      cacheWrite: fields.cacheWrite ?? null,
      reasoning: null,
      // Reported by some providers and deliberately unused: the figure is
      // built from the parts, because a provider that sends a total without
      // the cached parts would otherwise read as a nearly empty context.
      totalTokens: null,
    },
  }
}

/** A user message of a known length, for the estimated half. */
function said(text: string) {
  return { kind: 'user', text }
}

describe('the measured half', () => {
  it('counts the cached parts of the prompt, not just the fresh ones', () => {
    // The whole point. The wire reports cacheRead apart from input, so a long
    // conversation being served from cache would otherwise read as nearly
    // empty however far it had gone.
    const report = contextReport([usage({ input: 500, cacheRead: 40_000, output: 900 })])
    expect(report.measured).toEqual({ fresh: 500, cached: 40_000, reply: 900 })
    expect(total(report)).toBe(41_400)
  })

  it('takes the last turn rather than summing the conversation', () => {
    // Every request after the first re-sends the whole history, so usage is
    // not additive: summing counts the same tokens once per turn and reads
    // far over the truth. 30_000 is the second turn alone, not 42_000.
    const report = contextReport([
      usage({ input: 12_000, output: 400 }),
      usage({ input: 29_000, output: 1_000 }),
    ])
    expect(total(report)).toBe(30_000)
  })

  it('reaches past items that carry no usage', () => {
    const report = contextReport([usage({ input: 8_000, output: 200 }), { kind: 'user', text: '' }])
    expect(total(report)).toBe(8_200)
  })

  it('measures nothing at all before a turn has reported', () => {
    // A conversation whose first reply is still arriving has no measurement.
    // Zero would be a claim; null lets the panel say the figure is estimated.
    expect(contextReport([]).measured).toBe(null)
    expect(contextReport([said('hello')]).measured).toBe(null)
    expect(contextReport([usage({})]).measured).toBe(null)
  })
})

describe('the estimated half', () => {
  it('estimates only what came after the last turn that reported', () => {
    // The measured turn already accounts for everything up to itself. Adding
    // an estimate of that same history on top would double-count the whole
    // conversation, which is the mistake this split exists to prevent.
    const report = contextReport([
      said('a'.repeat(4_000)),
      usage({ input: 9_000, output: 500 }),
      said('b'.repeat(400)),
    ])
    expect(total(report)).toBe(9_500)
    expect(report.pending).toBe(100)
  })

  it('estimates the whole transcript while nothing has reported', () => {
    expect(contextReport([said('c'.repeat(800))]).pending).toBe(200)
  })

  it('counts what a reply has said so far, so the ring moves as it streams', () => {
    const streaming = {
      kind: 'assistant',
      segments: [
        { kind: 'thinking', text: 'd'.repeat(200) },
        { kind: 'text', text: 'e'.repeat(200) },
        // A tool group carries no text of its own; its output is not the
        // transcript's to count and the wire never showed it here.
        { kind: 'tools' },
      ],
      usage: null,
    }
    expect(contextReport([usage({ input: 100, output: 4 }), streaming]).pending).toBe(100)
  })
})

describe('the breakdown against a window', () => {
  const REPORT = { measured: { fresh: 10_000, cached: 30_000, reply: 2_000 }, pending: 500 }

  it('adds both halves and divides by the model own window', () => {
    const breakdown = contextBreakdown(REPORT, 200_000)
    expect(breakdown.total).toBe(42_500)
    expect(breakdown.free).toBe(157_500)
    expect(breakdown.used).toBeCloseTo(0.2125)
    expect(breakdown.windowDeclared).toBe(true)
  })

  it('stands a window in when the model declares none, and says which it did', () => {
    for (const declared of ['unknown', null] as const) {
      const breakdown = contextBreakdown(REPORT, declared)
      expect(breakdown.window).toBe(200_000)
      expect(breakdown.windowDeclared).toBe(false)
    }
  })

  it('clamps at full and never reports negative free space', () => {
    // A catalog window can understate what the provider actually allowed, and
    // a ring drawn past its own circumference is worse than one sitting full.
    const over = contextBreakdown({ measured: { fresh: 500_000, cached: 0, reply: 0 }, pending: 0 }, 200_000)
    expect(over.used).toBe(1)
    expect(over.free).toBe(0)
  })
})

describe('a token count as a person reads it', () => {
  it('leaves a count under a thousand exactly as it is', () => {
    // Shorter than any abbreviation of it, and exact costs nothing here.
    expect(formatTokens(0)).toBe('0')
    expect(formatTokens(840)).toBe('840')
    expect(formatTokens(999)).toBe('999')
  })

  it('keeps one decimal where the decimal is the whole story', () => {
    expect(formatTokens(1_000)).toBe('1k')
    expect(formatTokens(1_150)).toBe('1.2k')
    expect(formatTokens(9_400)).toBe('9.4k')
  })

  it('drops the decimal once it is noise', () => {
    expect(formatTokens(11_600)).toBe('12k')
    expect(formatTokens(264_000)).toBe('264k')
  })

  it('reads a window in the units the window is quoted in', () => {
    // A model advertises a 1M window, never a 1,000k one.
    expect(formatTokens(1_000_000)).toBe('1M')
    expect(formatTokens(1_500_000)).toBe('1.5M')
    expect(formatTokens(2_000_000)).toBe('2M')
    expect(formatTokens(999_600)).toBe('1M')
  })
})
