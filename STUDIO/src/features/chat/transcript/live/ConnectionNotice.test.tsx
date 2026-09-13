/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ConversationPhase } from '@/features/chat/connection/useConversation'

const startHarness = vi.fn<() => Promise<boolean>>()
const harnessFailureReason = vi.fn<() => Promise<string | null>>()

vi.mock('@/platform/harness', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/platform/harness')>()
  return {
    ...actual,
    startHarness: () => startHarness(),
    harnessFailureReason: () => harnessFailureReason(),
  }
})

const { ConnectionNotice } = await import('./ConnectionNotice')

/**
 * What the app offers when there is no harness.
 *
 * For a long time: a sentence telling people to start it "from the status
 * bar". There is no status bar, and `restart_harness` — a Tauri command since
 * the supervisor landed — had never been called from the webview. A harness
 * that failed to come up therefore left the app permanently unable to send,
 * with the only instructions on screen impossible to follow.
 */

const NO_HARNESS: ConversationPhase = { status: 'no-harness' }

afterEach(() => {
  cleanup()
  startHarness.mockReset()
  harnessFailureReason.mockReset()
})

describe('a conversation with no harness behind it', () => {
  it('offers to start one instead of naming a control that does not exist', () => {
    render(<ConnectionNotice phase={NO_HARNESS} onResume={() => {}} refused={null} />)

    expect(screen.getByRole('button', { name: 'Start the harness' })).toBeTruthy()
    expect(screen.queryByText(/status bar/)).toBeNull()
  })

  it('attaches once the harness is actually up', async () => {
    startHarness.mockResolvedValue(true)
    const resumed = vi.fn()
    render(<ConnectionNotice phase={NO_HARNESS} onResume={resumed} refused={null} />)

    fireEvent.click(screen.getByRole('button', { name: 'Start the harness' }))

    await waitFor(() => expect(resumed).toHaveBeenCalledTimes(1))
    expect(startHarness).toHaveBeenCalledTimes(1)
  })

  it('does not attach when the start failed', async () => {
    // Reattaching to a harness that never came up replaces the supervisor's
    // own reason with a generic reaching-out message, which is the one thing
    // a person needs NOT to happen when a start fails.
    startHarness.mockResolvedValue(false)
    harnessFailureReason.mockResolvedValue(null)
    const resumed = vi.fn()
    render(<ConnectionNotice phase={NO_HARNESS} onResume={resumed} refused={null} />)

    fireEvent.click(screen.getByRole('button', { name: 'Start the harness' }))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Start the harness' })).toBeTruthy(),
    )
    expect(resumed).not.toHaveBeenCalled()
  })

  it('prints the reason the supervisor kept when the start failed', async () => {
    // A refused press used to leave the notice exactly as it was, which made
    // "it refused" and "nobody pressed" the same screen. The supervisor held
    // the sentence the whole time; the notice asks for it now.
    startHarness.mockResolvedValue(false)
    harnessFailureReason.mockResolvedValue(
      'Harness exited before readiness (status=exit code 1). stderr=StorageError: this build supports 17.',
    )
    render(<ConnectionNotice phase={NO_HARNESS} onResume={() => {}} refused={null} />)

    fireEvent.click(screen.getByRole('button', { name: 'Start the harness' }))

    await waitFor(() => expect(screen.getByText(/this build supports 17/)).toBeTruthy())
    expect(screen.getByRole('button', { name: 'Start the harness' })).toBeTruthy()
  })

  it('cannot be pressed twice while a start is in flight', async () => {
    let settle = (_up: boolean) => {}
    startHarness.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          settle = resolve
        }),
    )
    render(<ConnectionNotice phase={NO_HARNESS} onResume={() => {}} refused={null} />)

    fireEvent.click(screen.getByRole('button', { name: 'Start the harness' }))
    const button = await screen.findByRole('button', { name: 'Starting the harness…' })
    fireEvent.click(button)

    expect(startHarness).toHaveBeenCalledTimes(1)
    settle(true)
  })
})

describe('a send the harness would not take', () => {
  it('points at the control beside it, not at a status bar', () => {
    render(
      <ConnectionNotice
        phase={{ status: 'live' }}
        onResume={() => {}}
        refused={{ kind: 'no-harness', message: 'nothing to send this to' }}
      />,
    )

    expect(screen.queryByText(/status bar/)).toBeNull()
    expect(screen.getByText(/Start it below/)).toBeTruthy()
  })
})
