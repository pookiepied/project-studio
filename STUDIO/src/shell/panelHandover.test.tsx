/**
 * @vitest-environment jsdom
 */
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { usePanelHandover, whoYields } from './panelHandover'

/**
 * The handover between the sidebar and the rail.
 *
 * Two things are held here. The rule: whichever column was asked for last
 * wins, and the other yields - which is what makes opening something into
 * the rail work while the sidebar is up, instead of being undone in the
 * same commit. And the order: the yielding column leaves first, and the
 * arriving one is not drawn until that exit has settled, so the two moves
 * are a sequence rather than a collision.
 *
 * The columns are stubbed. What is under test is what the shell would draw
 * and when, not how either column animates.
 */

describe('who yields', () => {
  it('nobody, while only one column is asked for', () => {
    expect(whoYields({ sidebar: false, rail: false }, { sidebar: true, rail: false })).toBeNull()
    expect(whoYields({ sidebar: false, rail: false }, { sidebar: false, rail: true })).toBeNull()
    expect(whoYields({ sidebar: true, rail: false }, { sidebar: false, rail: false })).toBeNull()
  })

  it('the rail, when the sidebar is opened onto it', () => {
    expect(whoYields({ sidebar: false, rail: true }, { sidebar: true, rail: true })).toBe('rail')
  })

  it('the sidebar, when the rail is opened onto it', () => {
    expect(whoYields({ sidebar: true, rail: false }, { sidebar: true, rail: true })).toBe('sidebar')
  })

  it('the rail, when both arrive at once: the sidebar toggle is the deliberate gesture', () => {
    expect(whoYields({ sidebar: false, rail: false }, { sidebar: true, rail: true })).toBe('rail')
  })
})

/** The stores, as the shell would hold them, with the hook reading both. */
type Shown = ReturnType<typeof usePanelHandover>
let latest: Shown | null = null

function Probe({
  sidebarOpen,
  railOpen,
  closeSidebar,
  collapseRail,
}: {
  sidebarOpen: boolean
  railOpen: boolean
  closeSidebar: () => void
  collapseRail: () => void
}) {
  latest = usePanelHandover({ sidebarOpen, railOpen, closeSidebar, collapseRail })
  return null
}

function shown(): Shown {
  if (latest === null) throw new Error('the probe never rendered')
  return latest
}

afterEach(() => {
  cleanup()
  latest = null
})

describe('the sidebar opened onto an open rail', () => {
  it('folds the rail, holds the sidebar until the rail has left, then shows it', () => {
    const closeSidebar = vi.fn()
    const collapseRail = vi.fn()
    const view = render(
      <Probe sidebarOpen={false} railOpen closeSidebar={closeSidebar} collapseRail={collapseRail} />,
    )
    expect(shown().railShown).toBe(true)
    expect(shown().sidebarShown).toBe(false)

    // The toggle: the store says the sidebar is open.
    view.rerender(<Probe sidebarOpen railOpen closeSidebar={closeSidebar} collapseRail={collapseRail} />)
    // The rail is asked to fold, and the sidebar is not drawn yet.
    expect(collapseRail).toHaveBeenCalledTimes(1)
    expect(closeSidebar).not.toHaveBeenCalled()
    expect(shown().sidebarShown).toBe(false)

    // The rail store folds it; it is leaving, and the sidebar still waits.
    view.rerender(
      <Probe sidebarOpen railOpen={false} closeSidebar={closeSidebar} collapseRail={collapseRail} />,
    )
    expect(shown().railShown).toBe(false)
    expect(shown().sidebarShown).toBe(false)

    // The rail reports its exit complete: now the sidebar is drawn.
    act(() => shown().railSettled())
    expect(shown().sidebarShown).toBe(true)
  })
})

describe('the rail opened onto an open sidebar', () => {
  it('closes the sidebar, holds the rail until the sidebar has left, then shows it', () => {
    const closeSidebar = vi.fn()
    const collapseRail = vi.fn()
    const view = render(
      <Probe sidebarOpen railOpen={false} closeSidebar={closeSidebar} collapseRail={collapseRail} />,
    )
    expect(shown().sidebarShown).toBe(true)

    // Something is opened into the rail: the store says open.
    view.rerender(<Probe sidebarOpen railOpen closeSidebar={closeSidebar} collapseRail={collapseRail} />)
    // The sidebar is asked to close, the rail is not folded back, and the
    // rail is not drawn yet. The old rule folded it here, and the open was
    // undone before it was seen.
    expect(closeSidebar).toHaveBeenCalledTimes(1)
    expect(collapseRail).not.toHaveBeenCalled()
    expect(shown().railShown).toBe(false)
    expect(shown().sidebarShown).toBe(true)

    // The navigation store closes it; it is leaving, and the rail waits.
    view.rerender(
      <Probe sidebarOpen={false} railOpen closeSidebar={closeSidebar} collapseRail={collapseRail} />,
    )
    expect(shown().sidebarShown).toBe(false)
    expect(shown().railShown).toBe(false)

    // The sidebar's spring lands: now the rail is drawn.
    act(() => shown().sidebarSettled())
    expect(shown().railShown).toBe(true)
  })

  it('ignores a settle reported while the yielding column is still open', () => {
    const closeSidebar = vi.fn()
    const collapseRail = vi.fn()
    const view = render(
      <Probe sidebarOpen railOpen={false} closeSidebar={closeSidebar} collapseRail={collapseRail} />,
    )
    view.rerender(<Probe sidebarOpen railOpen closeSidebar={closeSidebar} collapseRail={collapseRail} />)

    // A settle from an earlier move, arriving before the store has closed
    // the sidebar, must not open the gate: the rail keeps waiting.
    act(() => shown().sidebarSettled())
    expect(shown().railShown).toBe(false)
  })
})

describe('with only one column asked for', () => {
  it('draws exactly what the stores say, and asks nothing of them', () => {
    const closeSidebar = vi.fn()
    const collapseRail = vi.fn()
    const view = render(
      <Probe sidebarOpen={false} railOpen={false} closeSidebar={closeSidebar} collapseRail={collapseRail} />,
    )
    view.rerender(
      <Probe sidebarOpen railOpen={false} closeSidebar={closeSidebar} collapseRail={collapseRail} />,
    )
    expect(shown().sidebarShown).toBe(true)
    view.rerender(
      <Probe sidebarOpen={false} railOpen={false} closeSidebar={closeSidebar} collapseRail={collapseRail} />,
    )
    view.rerender(
      <Probe sidebarOpen={false} railOpen closeSidebar={closeSidebar} collapseRail={collapseRail} />,
    )
    expect(shown().railShown).toBe(true)
    expect(closeSidebar).not.toHaveBeenCalled()
    expect(collapseRail).not.toHaveBeenCalled()
  })
})
