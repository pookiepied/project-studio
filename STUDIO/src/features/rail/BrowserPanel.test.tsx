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
const stopComputer = vi.fn<(conversationId: string) => Promise<{ ok: true; value: 'cleanup_confirmed' | 'cleanup_unconfirmed' | 'not_running' }>>()
const openBrowser = vi.fn<(id: string) => Promise<void>>().mockResolvedValue(undefined)
vi.mock('@/platform/tauri', async (original) => ({ ...await original<object>(), openBrowserWindow: (id: string) => openBrowser(id) }))

vi.mock('@/stores/workspace', () => ({
  useWorkspace: () => ({ browser: { stop }, computer: { stop: stopComputer } }),
}))
vi.mock('@/features/chat/useAttachmentFrame', () => ({
  useAttachmentFrame: () => null,
}))

function entry(family: 'browser' | 'computer' = 'browser') {
  return {
    kind: 'browser' as const,
    family,
    id: `${family}:cnv_1`,
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
  stopComputer.mockReset()
  openBrowser.mockClear()
  vi.useRealTimers()
})

describe('BrowserPanel', () => {
  it('opens the live conversation browser and keeps recorded and computer previews read-only', async () => {
    const view = render(<BrowserPanel entry={entry()} />)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Open browser in new window' })))
    expect(openBrowser).toHaveBeenCalledWith('cnv_1')
    view.rerender(<BrowserPanel entry={{ ...entry(), recorded: true }} />)
    expect(screen.queryByRole('button', { name: 'Open browser in new window' })).toBeNull()
    view.rerender(<BrowserPanel entry={entry('computer')} />)
    expect(screen.queryByRole('button', { name: 'Open browser in new window' })).toBeNull()
  })
  it('keeps a recorded website preview separate from live browser controls', () => {
    render(<BrowserPanel entry={{ ...entry(), recorded: true }} />)
    expect(screen.queryByRole('button', { name: 'Stop browser' })).toBeNull()
    expect(screen.getByText('No screenshot was recorded for this website.')).toBeTruthy()
  })
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

  it("stops the computer, not the browser, when the entry is the computer's report", async () => {
    stopComputer.mockResolvedValue({ ok: true, value: 'cleanup_confirmed' })
    render(<BrowserPanel entry={entry('computer')} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Stop computer' }))
    })
    expect(stopComputer).toHaveBeenCalledWith('cnv_1')
    expect(stop).not.toHaveBeenCalled()
    expect(screen.getByRole('status').textContent).toBe('Stopped')
  })

  it('does not say Stopped, or Not running, for a stop whose cleanup was not confirmed', async () => {
    stopComputer.mockResolvedValue({ ok: true, value: 'cleanup_unconfirmed' })
    render(<BrowserPanel entry={entry('computer')} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Stop computer' }))
    })
    expect(screen.getByRole('status').textContent).toBe('Stop sent, not confirmed')
  })
})
