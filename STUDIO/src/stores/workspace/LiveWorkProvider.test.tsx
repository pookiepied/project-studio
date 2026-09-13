/**
 * @vitest-environment jsdom
 */
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * A streamed delta reaches the readers of the stream, and nobody else.
 *
 * The pending context estimate is a count of characters, so it changes with
 * nearly every delta. It used to be a field on the workspace value, which
 * meant every delta handed a new value to every reader of the index - the
 * sidebar, each row, the palette. This file holds that the two are apart:
 * reporting a new cost re-renders a reader of the live work, and leaves a
 * reader of the index exactly where it was.
 */

vi.mock('@/platform/harness', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@/platform/harness')
  return {
    ...actual,
    // No harness: the index settles on `no-harness` and then holds still,
    // which is the quiet the render counts need.
    resolveHarnessAddress: vi.fn(async () => null),
    startHarness: vi.fn(async () => false),
  }
})

const { WorkspaceProvider, useWorkspace, useLiveWork } = await import('@/stores/workspace')

const renders = { index: 0, live: 0 }
let report: ((pending: number) => void) | null = null

function IndexReader() {
  const { storePhase } = useWorkspace()
  renders.index += 1
  return <span data-testid="phase">{storePhase.status}</span>
}

function LiveReader() {
  const { contextReports, markContextReport } = useLiveWork()
  renders.live += 1
  report = (pending) => markContextReport('cnv_1', { measured: null, pending })
  return <span data-testid="pending">{contextReports.get('cnv_1')?.pending ?? 0}</span>
}

afterEach(() => {
  cleanup()
  renders.index = 0
  renders.live = 0
  report = null
})

describe('LiveWorkProvider', () => {
  it('re-renders the stream readers on a new cost, and not the index readers', async () => {
    render(
      <WorkspaceProvider>
        <IndexReader />
        <LiveReader />
      </WorkspaceProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('phase').textContent).toBe('no-harness'))
    const settledIndex = renders.index
    const settledLive = renders.live

    act(() => report?.(120))
    act(() => report?.(121))

    expect(screen.getByTestId('pending').textContent).toBe('121')
    expect(renders.live).toBeGreaterThan(settledLive)
    expect(renders.index).toBe(settledIndex)
  })

  it('drops a report that says the same thing as the one it holds', async () => {
    render(
      <WorkspaceProvider>
        <IndexReader />
        <LiveReader />
      </WorkspaceProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('phase').textContent).toBe('no-harness'))
    act(() => report?.(120))
    const afterFirst = renders.live

    act(() => report?.(120))

    expect(renders.live).toBe(afterFirst)
  })
})
