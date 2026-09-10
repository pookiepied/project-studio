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
const openDiagnosticWindow = vi.fn<() => Promise<void>>()

vi.mock('@/platform/harness', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/platform/harness')>()
  return { ...actual, harnessFailureReason: () => harnessFailureReason() }
})

vi.mock('@/platform/tauri', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/platform/tauri')>()
  return {
    ...actual,
    quitApp: () => quitApp(),
    openDiagnosticWindow: () => openDiagnosticWindow(),
  }
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
  Reflect.deleteProperty(window, '__TAURI_INTERNALS__')
})

/** Stands the test in the webview's shoes, where the desktop-only actions exist. */
function onDesktop(): void {
  Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true })
}

describe('HarnessDownPage', () => {
  it('states the absence in the voice of the app, with the actions that still exist', async () => {
    onDesktop()
    harnessFailureReason.mockResolvedValue(null)
    render(<HarnessDownPage />)

    expect(screen.getByText('The harness is not running.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Start the harness' })).toBeTruthy()
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
    await waitFor(() => expect(screen.getByText('The harness was not found.')).toBeTruthy())
    expect(screen.getByText(/path that was searched/)).toBeTruthy()

    // And the developer sentence is nowhere on it. `pnpm build` is an
    // instruction for whoever holds the repository; a person who installed
    // Studio cannot act on it and should never be shown it as the answer.
    expect(document.body.textContent).not.toContain('pnpm build')
    expect(document.body.textContent).not.toContain('dist/server.mjs')
  })

  it('shows the code, which is the one part worth writing down', async () => {
    harnessFailureReason.mockResolvedValue(RAW)
    render(<HarnessDownPage />)

    // Stable across rewordings of the prose, which is exactly what makes it
    // the thing to quote in a report.
    await waitFor(() => expect(screen.getByText('HARNESS_NOT_FOUND')).toBeTruthy())
  })

  it('hands the raw text to a window rather than growing the page', async () => {
    harnessFailureReason.mockResolvedValue(RAW)
    render(<HarnessDownPage />)

    await waitFor(() => expect(screen.getByRole('button', { name: 'See details' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'See details' }))

    await waitFor(() => expect(openDiagnosticWindow).toHaveBeenCalledTimes(1))
    // And the page stays exactly the size it was. The supervisor keeps up to
    // fifty observed lines plus the whole of stdout and stderr, so anything
    // that rendered it here would move these controls under the reader.
    expect(document.body.textContent).not.toContain('pnpm build')
  })

  it('carries the sentence an eager start left with the supervisor, before anyone presses', async () => {
    // The eager start fails before any window exists, which is the common way
    // a person arrives here; the page's first look must bring the cause.
    harnessFailureReason.mockResolvedValue(
      'Harness did not publish loopback readiness within 30000ms. observed=(nothing)',
    )
    render(<HarnessDownPage />)

    await waitFor(() => expect(screen.getByText('The harness did not become ready.')).toBeTruthy())
  })

  it('classifies again when a press is refused, and stays on the page', async () => {
    harnessFailureReason.mockResolvedValue(null)
    ensureStore.mockResolvedValue(false)
    render(<HarnessDownPage />)

    harnessFailureReason.mockResolvedValue(
      'Harness exited before readiness (status=exit code: 1). stderr=StorageError: this build supports 17.',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Start the harness' }))
    expect(ensureStore).toHaveBeenCalledTimes(1)

    await waitFor(() => expect(screen.getByText('The harness exited during startup.')).toBeTruthy())
    expect(screen.getByRole('button', { name: 'Start the harness' })).toBeTruthy()
  })

  it('fetches no second sentence when the start lands', async () => {
    harnessFailureReason.mockResolvedValue(null)
    ensureStore.mockResolvedValue(true)
    render(<HarnessDownPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Start the harness' }))
    await waitFor(() => expect(ensureStore).toHaveBeenCalledTimes(1))
    // Up means the harness answered and the page unmounts under the shell
    // coming back; nothing it fetched may name a failure that is over.
    expect(screen.queryByText(/readiness/)).toBeNull()
  })

  it('quits through the platform seam rather than closing the window', async () => {
    onDesktop()
    harnessFailureReason.mockResolvedValue(null)
    render(<HarnessDownPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Quit Studio' }))
    await waitFor(() => expect(quitApp).toHaveBeenCalledTimes(1))
  })

  it('offers no quit to a browser tab, which is not the app’s life', async () => {
    // The button no-ops outside Tauri, and a control that does nothing is
    // worse than no control: a paired device is a window onto the PC's
    // Studio, not the app itself.
    harnessFailureReason.mockResolvedValue(null)
    render(<HarnessDownPage />)

    expect(screen.queryByRole('button', { name: 'Quit Studio' })).toBeNull()
    // The remedy it does have is unaffected.
    expect(screen.getByRole('button', { name: 'Start the harness' })).toBeTruthy()
  })
})
