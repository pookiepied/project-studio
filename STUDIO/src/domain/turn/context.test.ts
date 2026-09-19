import { describe, expect, it } from 'vitest'

import { contextBreakdown, contextReport, formatTokens, measuredTotal } from '@/domain/turn/context'
import type { ContextReport } from '@/domain/turn/context'

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

/** What the harness reports, which is what the provider actually measured. */
function measured(fields: {
  input?: number
  cacheRead?: number
  cacheWrite?: number
  output?: number
}) {
  return {
    input: fields.input ?? 0,
    cacheRead: fields.cacheRead ?? 0,
    cacheWrite: fields.cacheWrite ?? 0,
    output: fields.output ?? 0,
    observedAt: 1_000,
    estimated: false,
  }
}

describe('the measured half', () => {
  it('counts the cached parts of the prompt, not just the fresh ones', () => {
    // The whole point. The provider reports cacheRead and cacheWrite apart
    // from input, and all three are prompt occupying the window - so a long
    // conversation being served from cache would otherwise read as nearly
    // empty however far it had gone.
    const report = contextReport(
      [],
      measured({ input: 500, cacheRead: 39_000, cacheWrite: 1_000, output: 900 }),
    )
    expect(report.measured).toEqual({ fresh: 500, cached: 40_000, reply: 900, estimated: false })
    expect(total(report)).toBe(41_400)
  })

  it('takes the figure the harness measured rather than the transcript on screen', () => {
    // The transcript is not the request. The system prompt, the tool
    // definitions, every tool input and result and every image are in the
    // prompt and not on screen, and on an agentic turn they are most of it.
    // Reading the rendered text gave about half the provider's own number,
    // which is the entire reason the measurement is fetched.
    const transcript = [said('hi'), { kind: 'assistant', segments: [{ kind: 'text', text: 'ok' }] }]

    expect(total(contextReport(transcript, measured({ input: 114_748 })))).toBe(114_748)
  })

  it('measures nothing at all before a turn has reported', () => {
    // A conversation whose first reply is still arriving has no measurement.
    // Zero would be a claim; null lets the panel say the figure is estimated.
    expect(contextReport([], null).measured).toBe(null)
    expect(contextReport([said('hello')], undefined).measured).toBe(null)
    expect(contextReport([said('hello')], measured({})).measured).toBe(null)
  })

  it('ignores the usage field the transcript carries, which is never filled', () => {
    // Flue 2.0 stamps no usage into message metadata and `message-completed`
    // carries none either, so this field is always null on the wire. Reading
    // it was what left the figure estimated; a transcript that somehow had one
    // must still not be preferred over the harness's measurement.
    expect(contextReport([usage({ input: 8_000, output: 200 })], null).measured).toBe(null)
  })
})

describe('the estimated half', () => {
  it('adds no estimate to a settled conversation', () => {
    // The measurement is re-read the moment a turn ends, so at rest it already
    // accounts for the whole transcript. Estimating it again on top would
    // double-count the conversation against itself, which is the mistake this
    // split exists to prevent.
    const report = contextReport(
      [said('a'.repeat(4_000)), { kind: 'assistant', segments: [{ kind: 'text', text: 'r' }] }],
      measured({ input: 9_000, output: 500 }),
    )

    expect(total(report)).toBe(9_500)
    expect(report.pending).toBe(0)
  })

  it('estimates the whole transcript while nothing has reported', () => {
    expect(contextReport([said('c'.repeat(800))], null).pending).toBe(200)
  })

  it('counts a streaming reply, so the figure moves before the turn settles', () => {
    // Between sending and the turn reporting, text is all there is. The
    // measurement is of the previous request, so what has arrived since is
    // the tail.
    const streaming = {
      kind: 'assistant',
      segments: [
        { kind: 'thinking', text: 'd'.repeat(200) },
        { kind: 'text', text: 'e'.repeat(200) },
        // A tool group carries no text of its own; its output is not the
        // transcript's to count and the wire never showed it here.
        { kind: 'tools' },
      ],
    }
    const report = contextReport(
      [
        { kind: 'assistant', segments: [{ kind: 'text', text: 'o'.repeat(4_000) }] },
        said('n'.repeat(400)),
        streaming,
      ],
      measured({ input: 100, output: 4 }),
      true,
    )

    // The message just sent plus what has streamed back: 400 + 400 characters.
    // Not the settled reply above it, which the measurement already counted.
    expect(report.pending).toBe(200)
  })
})

describe('the breakdown against a window', () => {
  const REPORT = {
    measured: { fresh: 10_000, cached: 30_000, reply: 2_000, estimated: false },
    pending: 500,
  }

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
    const over = contextBreakdown(
      { measured: { fresh: 500_000, cached: 0, reply: 0, estimated: false }, pending: 0 },
      200_000,
    )
    expect(over.used).toBe(1)
    expect(over.free).toBe(0)
  })

  it('says where the harness compacts, by the same rule the harness uses', () => {
    // 15% held back on a 200k window: compaction at 170k. The floor of 20k
    // holds on a smaller window, and a model that cannot write the reserve
    // gets a reserve it can. No window, no line.
    expect(contextBreakdown(REPORT, 200_000, 64_000).compactsAt).toBe(170_000)
    expect(contextBreakdown(REPORT, 128_000).compactsAt).toBe(108_000)
    expect(contextBreakdown(REPORT, 200_000, 8_192).compactsAt).toBe(200_000 - 8_192)
    expect(contextBreakdown(REPORT, 'unknown').compactsAt).toBeNull()
  })

  it('carries the estimate mark through from the harness', () => {
    const provisional = contextReport([], measured({ input: 25_000 }))
    expect(provisional.measured?.estimated).toBe(false)
    const after = contextReport([], { ...measured({ input: 25_000 }), estimated: true })
    expect(after.measured?.estimated).toBe(true)
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
