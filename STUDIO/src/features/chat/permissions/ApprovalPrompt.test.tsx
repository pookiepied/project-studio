/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApprovalPrompt } from './ApprovalPrompt'
import { questionFromRecord } from '@/domain/permissions/question'
import type { PendingApprovalRecord } from '@/platform/harness'

/**
 * The attribution half of S5.4: a delegate's ask names the delegate on the
 * card - the same agent the grant will be keyed to - and the conversation
 * agent's own ask stays unattributed, which is its honest label. The waiting
 * list groups by agent when the parked questions come from more than one.
 */

vi.mock('framer-motion', () => ({
  LayoutGroup: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: new Proxy({}, { get: () => (props: Record<string, unknown>) => <div {...props} /> }),
}))

function record(agentId: string, resource: string, maxDuration: PendingApprovalRecord['maxDuration'] = 'always'): PendingApprovalRecord {
  return {
    id: `approval-${agentId}-${resource}`,
    createdAt: 1_000,
    capabilityNamespace: 'native',
    capabilityName: 'write',
    capabilityTitle: 'Write file',
    resource,
    conversationId: 'cnv_1',
    agentId,
    scopes: [
      { id: 'this-file', label: 'Just this file', detail: resource, pattern: null },
      { id: 'this-folder', label: 'This folder', detail: resource, pattern: 'C:\\home\\workspace' },
    ],
    source: 'default',
    reason: 'native/write has not been approved yet.',
    maxDuration,
  }
}

const answer = vi.fn<(id: string, answer: { verdict: 'allow' | 'deny'; duration: 'once' | 'conversation' | 'always' }) => Promise<void>>()

afterEach(() => {
  cleanup()
  answer.mockReset()
})

describe('ApprovalPrompt attribution', () => {
  it('names the delegate on the card a delegate asks under', () => {
    const question = questionFromRecord(record('general', 'C:\\home\\workspace\\index.html'))
    render(
      <ApprovalPrompt
        questions={[question]}
        answeringId={null}
        onAnswer={answer}
      />,
    )
    expect(screen.getByText('Permission — General agent')).not.toBeNull()
    // The action sentence renders part by part (prose + mono code), so the
    // code part is what a matcher can pin.
    expect(screen.getByText('index.html')).not.toBeNull()
  })

  it('leaves the conversation agent ask unattributed', () => {
    const question = questionFromRecord(record('studio', 'C:\\home\\workspace\\index.html'))
    render(
      <ApprovalPrompt
        questions={[question]}
        answeringId={null}
        onAnswer={answer}
      />,
    )
    expect(screen.getByText('Permission')).not.toBeNull()
    expect(screen.queryByText(/Permission —/)).toBeNull()
  })

  it('groups the waiting list by agent when asks from two agents wait', () => {
    const own = questionFromRecord(record('studio', 'C:\\home\\workspace\\own.html'))
    const fromDelegate = questionFromRecord(record('general', 'C:\\home\\workspace\\general.html'))
    render(
      <ApprovalPrompt
        questions={[own, fromDelegate]}
        answeringId={null}
        onAnswer={answer}
      />,
    )
    // The active card is the conversation agent's; the waiting sentence
    // says which agent the other ask belongs to.
    expect(screen.getByText('Permission')).not.toBeNull()
    expect(screen.getByText(/the general agent asks to/i)).not.toBeNull()
    expect(screen.getByText('general.html')).not.toBeNull()
  })
})

/**
 * P1-4: the kernel refuses an answer longer than the request allows rather
 * than shortening it, so the card never offers one.
 */
describe('ApprovalPrompt duration limit', () => {
  it('offers only "Just once" when that is all the kernel takes', () => {
    render(<ApprovalPrompt questions={[questionFromRecord(record('studio', 'computer:password_field:app', 'once'))]} hasProject answeringId={null} onAnswer={answer} />)
    expect(screen.queryByText('This conversation')).toBeNull()
    expect(screen.queryByText('Always')).toBeNull()
    expect(screen.getByText('Just once')).not.toBeNull()
  })

  it('stops at "This conversation" when that is the limit', () => {
    render(<ApprovalPrompt questions={[questionFromRecord(record('studio', 'computer:terminal:wt', 'conversation'))]} hasProject answeringId={null} onAnswer={answer} />)
    expect(screen.getByText('This conversation')).not.toBeNull()
    expect(screen.queryByText('Always')).toBeNull()
  })

  it('offers every duration with no limit', () => {
    render(<ApprovalPrompt questions={[questionFromRecord(record('studio', 'C:/home/workspace/a.txt'))]} hasProject answeringId={null} onAnswer={answer} />)
    expect(screen.getByText('Always')).not.toBeNull()
  })
})
