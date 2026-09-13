import { describe, expect, it } from 'vitest'

import { classifyFailureKind, failureRemedy } from './failure-kind'

describe('classifyFailureKind', () => {
  it('calls the real OpenAI billing shape quota even though it also says 429', () => {
    // The adversarial input: matches both lists at once. Exhaustion wins —
    // "check your account" must not be drowned out by "try again later".
    const openai =
      'direct(x) failed: You exceeded your current quota, please check your plan and billing details (insufficient_quota). (HTTP 429)'
    expect(classifyFailureKind(openai)).toBe('quota')
  })

  it('recognizes the other exhaustion wordings the harness refuses to retry', () => {
    expect(classifyFailureKind('Out of budget')).toBe('quota')
    expect(classifyFailureKind('quota exceeded for this month')).toBe('quota')
    expect(classifyFailureKind('Billing hard limit reached')).toBe('quota')
    expect(classifyFailureKind('Monthly usage limit reached')).toBe('quota')
  })

  it('recognizes the throttle family, where waiting is the actual advice', () => {
    expect(
      classifyFailureKind('429 rate limit exceeded: temporarily rate-limited upstream'),
    ).toBe('rate-limited')
    expect(classifyFailureKind('Too Many Requests')).toBe('rate-limited')
  })

  it('leaves everything else unclassified, including OpenRouter wrapper text', () => {
    // The wrapper IS retried by the patched harness, but the display claim
    // "it was retried, wait and send again" is reserved for the throttle
    // family; anything else renders as the plain sentence instead.
    expect(classifyFailureKind('Provider returned error')).toBe('unclassified')
    expect(classifyFailureKind('The upstream planet is misaligned')).toBe('unclassified')
  })

  it('treats an empty or absent sentence as unclassified, never as a rate limit', () => {
    expect(classifyFailureKind(null)).toBe('unclassified')
    expect(classifyFailureKind('')).toBe('unclassified')
  })
})

describe('failureRemedy', () => {
  it('sends the exhausted account to the provider settings, not to another try', () => {
    const remedy = failureRemedy(classifyFailureKind('(insufficient_quota)'))
    expect(remedy).toContain('billing')
    expect(remedy).toContain('will not lift it')
  })

  it('tells the throttled that a retry already happened and another is safe', () => {
    const remedy = failureRemedy(classifyFailureKind('429 rate limit exceeded'))
    expect(remedy).toContain('retried automatically')
    expect(remedy).toContain('safe')
  })

  it('says nothing extra about an unrecognized sentence', () => {
    expect(failureRemedy(classifyFailureKind('Provider returned error'))).toBeNull()
    expect(failureRemedy(classifyFailureKind(null))).toBeNull()
  })
})
