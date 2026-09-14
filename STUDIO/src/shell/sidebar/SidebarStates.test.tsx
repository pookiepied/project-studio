/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SidebarLoading, SidebarUnavailable } from './SidebarStates'
import type { StorePhase } from '@/stores/workspace'

/**
 * The column's answers to a store that is not a list yet, or not a list at
 * all.
 *
 * These two components exist because nothing used to read `StorePhase`: a
 * loading index and a failed read both rendered as the same blank column. The
 * tests hold the two halves of that fix -- that loading announces itself as a
 * wait rather than as emptiness, and that an unreadable store names what
 * happened and offers the remedy, once per press.
 */
afterEach(cleanup)

describe('SidebarLoading', () => {
  it('announces itself as loading, not as an empty column', () => {
    render(<SidebarLoading />)
    expect(screen.getByRole('status', { name: 'Loading conversations' })).not.toBeNull()
    // The one thing it must never be mistaken for is the truth: no row here
    // claims a title, and no "no conversations" sentence appears either.
    expect(screen.queryByText(/conversation/i)).toBeNull()
  })
})

describe('SidebarUnavailable', () => {
  it('leaves the absent harness to the home surface and renders nothing here', () => {
    const onEnsure = vi.fn(async () => true)
    const phase: StorePhase = { status: 'no-harness', error: null }
    render(<SidebarUnavailable phase={phase} onEnsure={onEnsure} />)

    // The sentence and the control moved to the status pill on home, which
    // carries what this block never had: the supervisor's reason. The column
    // keeps its local rows and says nothing it cannot be the first to know.
    expect(screen.queryByText('The harness is not running.')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Start the harness' })).toBeNull()
    expect(onEnsure).not.toHaveBeenCalled()
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
