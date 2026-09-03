/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DiagnosticWindow } from './DiagnosticWindow'

/**
 * The failure at full size, in its own window.
 *
 * The load-bearing test here is `copies the text and leaves the numbers
 * behind`. Line numbers were the right idea and the wrong mechanism inside the
 * page, and the thing that makes them right in a window is the gutter being a
 * separate, unselectable column. If that ever regresses -- numbers woven into
 * the text, or the copy control reading the rendered rows instead of the
 * source -- every paste out of this window grows a number welded to the front
 * of each line, and nobody notices until someone pastes one into a report.
 */

const harnessFailureReason = vi.fn<() => Promise<string | null>>()

vi.mock('@/platform/harness', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/platform/harness')>()
  return { ...actual, harnessFailureReason: () => harnessFailureReason() }
})

/** Shaped like a real crash: a headline sentence and then the child's output. */
const CRASH = [
  'Harness exited before readiness (status=exit code: 1). stderr=',
  'node:internal/modules/cjs/loader:1143',
  '  throw err;',
  '  ^',
  '',
  "Error: Cannot find module 'better-sqlite3'",
  '    at Module._resolveFilename (node:internal/modules/cjs/loader:1140:15)',
].join('\n')

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('DiagnosticWindow', () => {
  it('reads the failure itself rather than being handed it', async () => {
    harnessFailureReason.mockResolvedValue(CRASH)
    render(<DiagnosticWindow />)

    // Nothing is plumbed between windows: no copy to go stale, and no payload
    // that could carry a token across.
    await waitFor(() => expect(harnessFailureReason).toHaveBeenCalledTimes(1))
    // Named like an open file, not titled like a page.
    expect(screen.getByText('HARNESS_EXITED')).toBeTruthy()
  })

  it('is the text and nothing else', async () => {
    harnessFailureReason.mockResolvedValue(CRASH)
    render(<DiagnosticWindow />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy())

    // The page behind this window already states the failure and offers the
    // remedy. Repeating either here made this a second, worse copy of that
    // page with a log stapled underneath.
    expect(screen.queryByText('The harness exited during startup.')).toBeNull()
    expect(screen.queryByText(/exit status and its output/)).toBeNull()

    // And no Close button in the content: the traffic lights in the corner
    // are the close button, and shipping both asks the same question twice.
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull()
  })

  it('numbers every line, including the blank ones', async () => {
    harnessFailureReason.mockResolvedValue(CRASH)
    render(<DiagnosticWindow />)

    // Leading whitespace kept: testing-library collapses it by default, and
    // the indentation of a stack trace is part of what it says.
    const verbatim = { normalizer: (text: string) => text }
    await waitFor(() => expect(screen.getByText('  throw err;', verbatim)).toBeTruthy())
    // Seven lines in, seven numbers out. A blank line that lost its row would
    // put every number below it out of step with the text beside it.
    for (const n of ['1', '2', '3', '4', '5', '6', '7']) {
      expect(screen.getByText(n)).toBeTruthy()
    }
    expect(screen.queryByText('8')).toBeNull()
  })

  it('copies the text and leaves the numbers behind', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    harnessFailureReason.mockResolvedValue(CRASH)
    render(<DiagnosticWindow />)

    await waitFor(() => expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))

    // The source text, exactly. Not the rendered rows, which carry the gutter.
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(CRASH))
    const written = writeText.mock.calls[0]?.[0] ?? ''
    expect(written).not.toMatch(/^1/)
    expect(written.split('\n')).toHaveLength(7)
    // Confirmed in place, and only because the write succeeded.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy())
  })

  it('keeps the gutter out of any selection a person makes', async () => {
    harnessFailureReason.mockResolvedValue(CRASH)
    render(<DiagnosticWindow />)

    // The mechanism, asserted rather than assumed: a drag-selection across the
    // pane is the browser's to make, and `select-none` on the number column is
    // the only thing that keeps it out of the result.
    const gutter = await screen.findByText('2')
    expect(gutter.className).toContain('select-none')
  })

  it('says so plainly when the failure is over', async () => {
    // The window outlives the failure it was opened for: someone pressed Try
    // again in the other window and it worked. Showing the old text would be
    // reporting a problem that no longer exists.
    harnessFailureReason.mockResolvedValue(null)
    render(<DiagnosticWindow />)

    await waitFor(() =>
      expect(screen.getByText(/not reporting a failure/)).toBeTruthy(),
    )
    expect(screen.queryByRole('button', { name: 'Copy' })).toBeNull()
  })

  it('offers nothing to copy when there is nothing to show', async () => {
    harnessFailureReason.mockResolvedValue(null)
    render(<DiagnosticWindow />)

    await waitFor(() => expect(screen.getByText(/not reporting a failure/)).toBeTruthy())
    expect(screen.queryByRole('button', { name: 'Copy' })).toBeNull()
  })
})
