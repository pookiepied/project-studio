/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ComputerIndicatorWindow } from './ComputerIndicatorWindow'

let changed: (() => void) | undefined
let status: ((mode: string) => void) | undefined
let result: ((requestId: string, failed: boolean) => void) | undefined
const stop = vi.fn<(id: string) => Promise<void>>().mockResolvedValue(undefined)
vi.mock('@/platform/tauri', () => ({
  requestComputerStop: (id: string) => stop(id),
  onComputerIndicatorChanged: async (callback: () => void) => { changed = callback; return () => { changed = undefined } },
  onComputerIndicatorStatus: async (callback: (mode: string) => void) => { status = callback; return () => { status = undefined } },
  onComputerStopResult: async (callback: (requestId: string, failed: boolean) => void) => { result = callback; return () => { result = undefined } },
}))
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('computer pill', () => {
  it('shows the lease mode and resets Stop when the reused window gets a new owner', async () => {
    render(<ComputerIndicatorWindow />)
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(stop).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Stopping' })).toBeTruthy()
    act(() => { changed?.() })
    expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy()
    act(() => { status?.('paused') })
    expect(screen.getByText('Computer work is paused')).toBeTruthy()
  })
  it('allows another attempt when the native stop could not be delivered', async () => {
    stop.mockRejectedValueOnce(new Error('Unavailable'))
    render(<ComputerIndicatorWindow />)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Stop' })))
    expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy()
  })
  it('accepts only the current stop request result and ignores late replies after ownership changes', async () => {
    render(<ComputerIndicatorWindow />)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Stop' })))
    const requestId = stop.mock.calls[0]?.[0]
    expect(requestId).toBeTypeOf('string')
    act(() => { result?.('unrelated', true) })
    expect(screen.getByRole('button', { name: 'Stopping' })).toBeTruthy()
    if (requestId === undefined) return
    act(() => { result?.(requestId, true) })
    expect(screen.getByText('Could not stop. Try again.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(stop).toHaveBeenCalledTimes(2)
    const second = stop.mock.calls[1]?.[0]
    expect(second).not.toBe(requestId)
    act(() => { changed?.() })
    if (second !== undefined) act(() => { result?.(second, true) })
    expect(screen.queryByText('Could not stop. Try again.')).toBeNull()
  })
})
