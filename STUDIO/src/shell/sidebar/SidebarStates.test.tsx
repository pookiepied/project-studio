/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SidebarSkeleton, SidebarUnavailable } from './SidebarStates'
import type { StorePhase } from '@/stores/workspace'

/**
 * The column's answers to a store that is not a list yet, or not a list at
 * all.
 *
 * These two components exist because nothing used to read `StorePhase`: a
 * loading index and a failed read both rendered as the same blank column. The
 * tests hold the two halves of that fix -- that loading announces itself as a
 * region of bones rather than as emptiness, and that an unreadable store names
 * what happened and offers the remedy, once per press.
 */
afterEach(cleanup)

describe('SidebarSkeleton', () => {
  it('announces itself as loading, not as an empty column', () => {
    render(<SidebarSkeleton organize="list" />)
    expect(screen.getByRole('status', { name: 'Loading conversations' })).not.toBeNull()
    // The one thing it must never be mistaken for is the truth: no row here
    // claims a title, and no "no conversations" sentence appears either.
    expect(screen.queryByText(/conversation/i)).toBeNull()
  })

  it('holds the shape of the grouping it will be replaced by', () => {
    const grouped = render(<SidebarSkeleton organize="project" />)
    // Two groups: header rows at the left edge, conversation rows indented
    // under them -- the shape `ProjectSection` renders when the real data
    // arrives.
    const indented = grouped.container.querySelectorAll('.ml-3 span[aria-hidden]')
    expect(indented.length).toBe(5)
    grouped.unmount()

    const flat = render(<SidebarSkeleton organize="list" />)
    expect(flat.container.querySelectorAll('span[aria-hidden]').length).toBe(8)
  })
})

describe('SidebarUnavailable', () => {
  it('says the harness is absent and offers the control that starts it', async () => {
    const onEnsure = vi.fn(async () => true)
    const phase: StorePhase = { status: 'no-harness', error: null }
    render(<SidebarUnavailable phase={phase} onEnsure={onEnsure} />)

    expect(screen.getByText('The harness is not running.')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Start the harness' }))
    await waitFor(() => expect(onEnsure).toHaveBeenCalledTimes(1))
  })

  it("says the read failed and repeats the harness's own words", async () => {
    const onEnsure = vi.fn(async () => true)
    const phase: StorePhase = {
      status: 'failed',
      error: { kind: 'harness-error', status: 500, message: 'the index is corrupt' },
    }
    render(<SidebarUnavailable phase={phase} onEnsure={onEnsure} />)

    expect(screen.getByText('Could not read the conversations.')).not.toBeNull()
    expect(screen.getByText('the index is corrupt')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(onEnsure).toHaveBeenCalledTimes(1))
  })
})
