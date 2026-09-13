/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import type { RetryWaitFacts } from '@/features/chat/connection/useConversation'

import { RetryWait } from './RetryWait'

function retryFacts(overrides: Partial<RetryWaitFacts> = {}): RetryWaitFacts {
  return {
    attempt: 2,
    maxRetries: 3,
    delayMs: 4100,
    detail: '429 rate limit exceeded: temporarily rate-limited upstream',
    ...overrides,
  }
}

afterEach(() => {
  cleanup()
})

describe('the retry wait line', () => {
  it('names the failed attempt, the budget, and the wait', () => {
    render(<RetryWait retrying={retryFacts()} />)
    expect(screen.getByText(/Attempt 2 of 4 failed/)).toBeTruthy()
    expect(screen.getByText(/waiting 4s before trying again/)).toBeTruthy()
  })

  it('shows the provider sentence for the attempt that failed', () => {
    render(<RetryWait retrying={retryFacts()} />)
    expect(screen.getByText('429 rate limit exceeded: temporarily rate-limited upstream')).toBeTruthy()
  })

  it('says nothing it was not told when no sentence arrived', () => {
    render(<RetryWait retrying={retryFacts({ detail: null })} />)
    expect(screen.getByText(/Attempt 2 of 4 failed/)).toBeTruthy()
    expect(screen.queryByText(/rate limit/)).toBeNull()
  })

  it('reads as a wait in progress rather than a finished failure', () => {
    // The role is how a glance and a screen reader alike tell this apart
    // from the settled failure card: this one is live status, not an ending.
    render(<RetryWait retrying={retryFacts()} />)
    expect(screen.getByRole('status')).toBeTruthy()
  })
})
