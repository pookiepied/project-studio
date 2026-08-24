/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import type { TranscriptItem } from '@/features/chat/transcript/projection'

import { SubmissionFailed } from './SubmissionFailed'

type FailedItem = Extract<TranscriptItem, { kind: 'submission-failed' }>

function failedItem(reason: string | null): FailedItem {
  return {
    kind: 'submission-failed',
    id: 'sub_1#settled',
    submissionId: 'sub_1',
    outcome: 'failed',
    reason,
  }
}

afterEach(() => {
  cleanup()
})

describe('the failure card remedy line', () => {
  it('points an exhausted account at the provider settings', () => {
    render(<SubmissionFailed item={failedItem('(insufficient_quota) please answer.')} />)
    expect(screen.getByText('This turn failed')).toBeTruthy()
    const remedy = screen.getByText(/quota or billing limit/)
    expect(remedy.textContent).toContain('will not lift it')
  })

  it("tells the throttled that a retry happened and another one is safe", () => {
    render(<SubmissionFailed item={failedItem('429 rate limit exceeded: upstream')} />)
    expect(screen.getByText(/retried automatically/)).toBeTruthy()
  })

  it('appends nothing when the sentence names no category it can vouch for', () => {
    render(<SubmissionFailed item={failedItem('Provider returned error')} />)
    expect(screen.getByText('Provider returned error')).toBeTruthy()
    expect(screen.queryByText(/retried automatically/)).toBeNull()
    expect(screen.queryByText(/will not lift it/)).toBeNull()
  })
})
