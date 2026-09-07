import { describe, expect, it } from 'vitest'

import { contextUsageFromTokens, reportedContextTokens } from '@/domain/session/context'

/** One assistant item's worth of reported usage, with the rest left null. */
function usage(fields: {
  input?: number
  output?: number
  cacheRead?: number
  cacheWrite?: number
}) {
  return {
    kind: 'assistant',
    usage: {
      input: fields.input ?? null,
      output: fields.output ?? null,
      cacheRead: fields.cacheRead ?? null,
      cacheWrite: fields.cacheWrite ?? null,
      reasoning: null,
    },
  }
}

describe('the reported context figure', () => {
  it('counts the cached parts of the prompt, not just the fresh ones', () => {
    // The whole point. pi reports cacheRead apart from input, so a long
    // conversation being served from cache would otherwise read as nearly
    // empty however far it had gone.
    expect(reportedContextTokens([usage({ input: 500, cacheRead: 40_000, output: 900 })])).toBe(
      41_400,
    )
  })

  it('takes the last turn rather than summing the conversation', () => {
    // Every request after the first re-sends the whole history, so usage is
    // not additive: summing counts the same tokens once per turn and reads
    // far over the truth. 30_000 is the second turn alone, not 42_000.
    expect(
      reportedContextTokens([
        usage({ input: 12_000, output: 400 }),
        usage({ input: 29_000, output: 1_000 }),
      ]),
    ).toBe(30_000)
  })

  it('reaches past items that carry no usage', () => {
    const items = [usage({ input: 8_000, output: 200 }), { kind: 'user' }, { kind: 'assistant' }]
    expect(reportedContextTokens(items)).toBe(8_200)
  })

  it('answers null when nothing has reported, rather than zero', () => {
    // A conversation whose first reply is still arriving has no measurement.
    // Zero would be a claim; null lets the meter fall back to its estimate.
    expect(reportedContextTokens([{ kind: 'user' }])).toBe(null)
    expect(reportedContextTokens([])).toBe(null)
    expect(reportedContextTokens([usage({})])).toBe(null)
  })
})

describe('the figure as a fraction of the window', () => {
  it('divides by the model own window', () => {
    expect(contextUsageFromTokens(50_000, 200_000)).toBeCloseTo(0.25)
  })

  it('falls back to a standard window when the model declares none', () => {
    expect(contextUsageFromTokens(50_000, 'unknown')).toBeCloseTo(0.25)
    expect(contextUsageFromTokens(50_000, null)).toBeCloseTo(0.25)
  })

  it('clamps at full rather than reporting over one', () => {
    expect(contextUsageFromTokens(500_000, 200_000)).toBe(1)
  })
})
