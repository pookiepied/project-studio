/**
 * @vitest-environment jsdom
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { BrowserPanel } from './BrowserPanel'

/**
 * The person's stop for a conversation's browser (ADR 0049 §4).
 *
 * What is pinned is the one thing a button cannot show on its own: that the
 * answer distinguishes a browser that was running from one that was not, so
 * "I pressed stop and nothing happened" is never what a person reads.
 */

const stop = vi.fn<(conversationId: string) => Promise<{ ok: true; value: boolean }>>()

vi.mock('@/stores/workspace', () => ({
  useWorkspace: () => ({ browser: { stop } }),
}))
vi.mock('@/features/chat/useAttachmentFrame', () => ({
  useAttachmentFrame: () => null,
}))

function entry() {
  return {
    kind: 'browser' as const,
    id: 'browser:cnv_1',
    conversationId: 'cnv_1',
    conversationTitle: 'A conversation',
    openedAt: 0,
    url: 'http://localhost:3000',
    title: 'Home',
    frame: null,
    steps: [],
  }
}

afterEach(() => {
  cleanup()
  stop.mockReset()
  vi.useRealTimers()
})

describe('BrowserPanel', () => {
  it('offers a Stop for the conversation, and says Stopped when one was running', async () => {
    stop.mockResolvedValue({ ok: true, value: true })
    render(<BrowserPanel entry={entry()} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Stop browser' }))
    })
    expect(stop).toHaveBeenCalledWith('cnv_1')
    expect(screen.getByRole('status').textContent).toBe('Stopped')
  })

  it('says Not running when there was nothing to stop, then offers the button again', async () => {
    vi.useFakeTimers()
    stop.mockResolvedValue({ ok: true, value: false })
    render(<BrowserPanel entry={entry()} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Stop browser' }))
    })
    expect(screen.getByRole('status').textContent).toBe('Not running')
    await act(async () => {
      vi.advanceTimersByTime(2000)
    })
    expect(screen.getByRole('button', { name: 'Stop browser' })).toBeTruthy()
  })
})
