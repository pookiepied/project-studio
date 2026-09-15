/**
 * @vitest-environment jsdom
 */
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { present } from '@/platform/harness/contracts/chunks'
import type { TranscriptItem } from '@/features/chat/transcript/projection'

import { useComputerIndicator } from './useComputerIndicator'

/**
 * The sign that Studio is at the keyboard (ADR 0055 §7).
 *
 * What is pinned: the pill goes up only for a running turn that has touched
 * the computer, comes down when that turn ends, and its Stop ends this
 * conversation's driver and run - and nobody else's.
 */

const show = vi.fn<(conversationId: string) => Promise<void>>().mockResolvedValue(undefined)
const hide = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
const stopComputer = vi.fn<(conversationId: string) => Promise<unknown>>().mockResolvedValue({})
let stopHandler: ((conversationId: string) => void) | null = null

vi.mock('@/platform/tauri', () => ({
  showComputerIndicator: (id: string) => show(id),
  hideComputerIndicator: () => hide(),
  onComputerStopRequested: (handler: (conversationId: string) => void) => {
    stopHandler = handler
    return Promise.resolve(() => {
      stopHandler = null
    })
  },
}))
vi.mock('@/stores/workspace', () => ({
  useWorkspace: () => ({ computer: { stop: stopComputer } }),
}))

function turnWith(toolName: string): TranscriptItem[] {
  return [
    {
      kind: 'assistant',
      id: 'msg_1',
      segments: [
        {
          kind: 'tools',
          groups: [
            {
              id: 'grp_1',
              calls: [
                {
                  toolCallId: 'call_1',
                  toolName,
                  input: present({}),
                  output: null,
                  errorText: null,
                },
              ],
            },
          ],
        },
      ],
    } as unknown as TranscriptItem,
  ]
}

afterEach(() => {
  cleanup()
  show.mockClear()
  hide.mockClear()
  stopComputer.mockClear()
  stopHandler = null
})

describe('useComputerIndicator', () => {
  it('shows the pill for a running turn that drives the computer, and hides it when the turn ends', () => {
    const stopTurn = vi.fn()
    const { rerender } = renderHook(
      ({ running }: { running: boolean }) =>
        useComputerIndicator('cnv_1', turnWith('mcp__15_studio-computer__3_studio_computer_open'), running, stopTurn),
      { initialProps: { running: true } },
    )
    expect(show).toHaveBeenCalledWith('cnv_1')
    expect(hide).not.toHaveBeenCalled()

    rerender({ running: false })
    expect(hide).toHaveBeenCalledTimes(1)
  })

  it('shows nothing for a turn that only browsed', () => {
    renderHook(() =>
      useComputerIndicator('cnv_1', turnWith('mcp__14_studio-browser__19_studio_browser_open'), true, () => undefined),
    )
    expect(show).not.toHaveBeenCalled()
    expect(hide).not.toHaveBeenCalled()
  })

  it("answers the pill's Stop for this conversation only", async () => {
    const stopTurn = vi.fn()
    renderHook(() =>
      useComputerIndicator('cnv_1', turnWith('mcp__15_studio-computer__3_studio_computer_type'), true, stopTurn),
    )
    await act(async () => {
      await Promise.resolve()
    })
    expect(stopHandler).not.toBeNull()

    act(() => stopHandler?.('cnv_other'))
    expect(stopComputer).not.toHaveBeenCalled()
    expect(stopTurn).not.toHaveBeenCalled()

    act(() => stopHandler?.('cnv_1'))
    expect(stopComputer).toHaveBeenCalledWith('cnv_1')
    expect(stopTurn).toHaveBeenCalledTimes(1)
  })
})
