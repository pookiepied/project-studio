/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { HarnessDownPage } from './HarnessDownPage'

/**
 * The page that is the whole window while the harness is down.
 *
 * These tests hold the states a person can be in on it: absent with no failure
 * behind it, absent because an eager start failed before the window existed, a
 * press the supervisor refused, and the two ways off the page that are not the
 * harness. It renders in place of the whole shell, so what must never appear
 * here is any of that shell -- no sidebar controls, no composer, no promise
 * about rooms that are not there.
 *
 * The load-bearing one is `keeps the supervisor's own words out of the first
 * screen`. Everything else here is behaviour; that one is the reason the page
 * was rewritten.
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

/** Verbatim from `supervisor.rs`, which is the only reason it is worth testing. */
const RAW =
  'Harness server not found. Run `pnpm build` in `STUDIO HARNESS/` and ensure dist/server.mjs exists.'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('HarnessDownPage', () => {
  it('states the absence in the voice of the app, with the actions that still exist', async () => {
    harnessFailureReason.mockResolvedValue(null)
    render(<HarnessDownPage />)

    expect(screen.getByText('The harness is not running.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Quit Studio' })).toBeTruthy()
    await waitFor(() => expect(harnessFailureReason).toHaveBeenCalledTimes(1))

    // No shell is behind this page, and nothing in it may pretend otherwise:
    // a composer here would be a field whose only answer is a refusal.
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('navigation')).toBeNull()

    // The sentence about conversations living in the harness is gone. It was
    // written for someone who lost the harness mid-work, and the person who
    // sees this page opened Studio and found it already down -- to them it
    // described a loss that never happened.
    expect(screen.queryByText(/nothing to read and nowhere to send/)).toBeNull()

    // Nothing to disclose when there is no sentence behind the absence.
    expect(screen.queryByRole('button', { name: 'See details' })).toBeNull()
  })

  it("keeps the supervisor's own words out of the first screen", async () => {
    harnessFailureReason.mockResolvedValue(RAW)
    render(<HarnessDownPage />)

    // Classified, in the app's voice.
    await waitFor(() => expect(screen.getByText('The harness is missing.')).toBeTruthy())
    expect(screen.getByText(/Reinstalling Studio puts it back/)).toBeTruthy()

    // And the developer sentence is nowhere on it. `pnpm build` is an
    // instruction for whoever holds the repository; a person who installed
    // Studio cannot act on it and should never be shown it as the answer.
    expect(document.body.textContent).not.toContain('pnpm build')
    expect(document.body.textContent).not.toContain('dist/server.mjs')
  })

  it('gives the raw sentence up verbatim, but only when it is asked for', async () => {
    harnessFailureReason.mockResolvedValue(RAW)
    render(<HarnessDownPage />)

    await waitFor(() => expect(screen.getByRole('button', { name: 'See details' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'See details' }))

    // Verbatim, never paraphrased: "what did it actually say" has to have a
    // real answer, and this is it.
    await waitFor(() => expect(screen.getByText(RAW)).toBeTruthy())
    expect(screen.getByRole('button', { name: 'Hide details' })).toBeTruthy()
  })

  it('copies the raw sentence, because copying is what it is for', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })
    harnessFailureReason.mockResolvedValue(RAW)
    render(<HarnessDownPage />)

    await waitFor(() => expect(screen.getByRole('button', { name: 'See details' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'See details' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(RAW))
    // Confirmed in place, and only because the write succeeded.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy())
  })

  it('carries the sentence an eager start left with the supervisor, before anyone presses', async () => {
    // The eager start fails before any window exists, which is the common way
    // a person arrives here; the page's first look must bring the cause.
    harnessFailureReason.mockResolvedValue(
      'Harness did not publish loopback readiness within 30000ms. observed=(nothing)',
    )
    render(<HarnessDownPage />)

    await waitFor(() => expect(screen.getByText('The harness did not finish starting.')).toBeTruthy())
  })

  it('classifies again when a press is refused, and stays on the page', async () => {
    harnessFailureReason.mockResolvedValue(null)
    ensureStore.mockResolvedValue(false)
    render(<HarnessDownPage />)

    harnessFailureReason.mockResolvedValue(
      'Harness exited before readiness (status=exit code: 1). stderr=StorageError: this build supports 17.',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(ensureStore).toHaveBeenCalledTimes(1)

    await waitFor(() => expect(screen.getByText('The harness stopped while starting.')).toBeTruthy())
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  })

  it('fetches no second sentence when the start lands', async () => {
    harnessFailureReason.mockResolvedValue(null)
    ensureStore.mockResolvedValue(true)
    render(<HarnessDownPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
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
