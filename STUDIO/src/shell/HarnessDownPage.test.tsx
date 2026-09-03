/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { HarnessDownPage } from './HarnessDownPage'

/**
 * The page that is the whole window while the harness is down.
 *
 * These tests hold the states a person can be in on it: absent with no
 * failure behind it, absent because an eager start failed before the window
 * existed, a press the supervisor refused, and the two ways off the page that
 * are not the harness. It renders in place of the whole shell, so what must
 * never appear here is any of that shell — no sidebar controls, no composer,
 * no promise about rooms that are not there.
 */

const harnessFailureReason = vi.fn<() => Promise<string | null>>()
const quitApp = vi.fn<() => Promise<void>>()

vi.mock('@/platform/harness', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/platform/harness')>()
  return { ...actual, harnessFailureReason: () => harnessFailureReason() }
})

vi.mock('@/platform/tauri', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/platform/tauri')>()
  return { ...actual, quitApp: () => quitApp() }
})

const ensureStore = vi.fn<() => Promise<boolean>>()

vi.mock('@/stores/workspace', () => ({
  useWorkspace: () => ({
    ensureStore: () => ensureStore(),
  }),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('HarnessDownPage', () => {
  it('states the absence in the voice of the app, with the actions that still exist', () => {
    harnessFailureReason.mockResolvedValue(null)
    render(<HarnessDownPage />)

    expect(screen.getByText('The harness is not running.')).toBeTruthy()
    expect(screen.getByText(/nothing to read and nowhere to send/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Restart the harness' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Quit Studio' })).toBeTruthy()
    expect(harnessFailureReason).toHaveBeenCalledTimes(1)
    // No shell is behind this page, and nothing in it may pretend otherwise:
    // a composer here would be a field whose only answer is a refusal.
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('navigation')).toBeNull()
  })

  it('carries the sentence an eager start left with the supervisor, before anyone presses', async () => {
    // The eager start fails before any window exists, which is the common way
    // a person arrives here; the page's first look must bring the cause.
    harnessFailureReason.mockResolvedValue(
      'Harness server not found. Run `pnpm build` in `STUDIO HARNESS/` and ensure dist/server.mjs exists.',
    )
    render(<HarnessDownPage />)

    await waitFor(() => expect(screen.getByText(/dist\/server\.mjs/)).toBeTruthy())
  })

  it('prints the words the supervisor kept when a press is refused, and stays on the page', async () => {
    harnessFailureReason.mockResolvedValue(null)
    ensureStore.mockResolvedValue(false)
    render(<HarnessDownPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Restart the harness' }))
    expect(ensureStore).toHaveBeenCalledTimes(1)

    harnessFailureReason.mockResolvedValue(
      'Harness did not publish loopback readiness within 30000ms. observed=(nothing)',
    )
    await waitFor(() =>
      expect(screen.getByText(/did not publish loopback readiness/)).toBeTruthy(),
    )
    expect(screen.getByRole('button', { name: 'Restart the harness' })).toBeTruthy()
  })

  it('fetches no second sentence when the start lands', async () => {
    harnessFailureReason.mockResolvedValue(null)
    ensureStore.mockResolvedValue(true)
    render(<HarnessDownPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Restart the harness' }))
    await waitFor(() => expect(ensureStore).toHaveBeenCalledTimes(1))
    // Up means the harness answered and the page unmounts under the shell
    // coming back; nothing it fetched may name a failure that is over.
    expect(screen.queryByText(/readiness/)).toBeNull()
  })

  it('quits through the platform seam rather than closing the window', async () => {
    harnessFailureReason.mockResolvedValue(null)
    render(<HarnessDownPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Quit Studio' }))
    await waitFor(() => expect(quitApp).toHaveBeenCalledTimes(1))
  })
})
