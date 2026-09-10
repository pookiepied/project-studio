/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { FolderBrowserDialog } from './FolderBrowserDialog'
import type { FolderListing, HarnessResult } from '@/platform/harness'

/**
 * The picker a browser tab uses instead of the OS's.
 *
 * The claims that make it a picker and not a list:
 *
 * - It opens at the position the harness names (the person's home), so
 *   nothing on this side has to know where home is.
 * - A row opens the directory it names, Up goes back out through the parent,
 *   and `Use this folder` chooses the position - including an empty one,
 *   which a rows-only picker could never offer.
 * - A failed walk keeps the last good listing and names the refusal, so the
 *   person is annotated, not stranded.
 * - The newest navigation wins. Two walks opened in quick succession must
 *   land the person where they last asked; a slow first answer overtaking a
 *   fast second one would make the list lie about where they are.
 */

const browseFolders = vi.fn<(path?: string) => Promise<HarnessResult<FolderListing>>>()
const onClose = vi.fn()
const onPick = vi.fn<(path: string) => void>()

// The vi.fn itself, not a wrapper around it: the dialog rebuilds its load
// callback from this identity, so a fresh function per render would restart
// the walk on every render and consume the queued answers.
vi.mock('@/stores/workspace', () => ({
  useWorkspace: () => ({ browseFolders }),
}))

const HOME: FolderListing = {
  path: 'C:\\Users\\pooki',
  parent: 'C:\\Users',
  directories: [
    { name: 'alpha', path: 'C:\\Users\\pooki\\alpha' },
    { name: 'Beta', path: 'C:\\Users\\pooki\\Beta' },
  ],
}

const ALPHA: FolderListing = {
  path: 'C:\\Users\\pooki\\alpha',
  parent: 'C:\\Users\\pooki',
  directories: [],
}

function listingOf(value: FolderListing): HarnessResult<FolderListing> {
  return { ok: true, value }
}

function renderBrowser() {
  return render(<FolderBrowserDialog open onClose={onClose} onPick={onPick} />)
}

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

describe('FolderBrowserDialog', () => {
  it('opens the walk where the harness says it starts', async () => {
    const holder: { settle: ((result: HarnessResult<FolderListing>) => void) | null } = {
      settle: null,
    }
    browseFolders.mockImplementationOnce(
      () =>
        new Promise<HarnessResult<FolderListing>>((resolve) => {
          holder.settle = resolve
        }),
    )
    renderBrowser()

    // The first paint says what is happening, before the harness answers.
    expect(screen.getByText('Listing the folders on this PC…')).toBeTruthy()

    if (holder.settle === null) throw new Error('unreachable')
    holder.settle(listingOf(HOME))

    expect(await screen.findByText('C:\\Users\\pooki')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'alpha' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Beta' })).toBeTruthy()
    expect(browseFolders).toHaveBeenCalledWith(undefined)
  })

  it('walks into a row, and the row becomes the position', async () => {
    browseFolders
      .mockResolvedValueOnce(listingOf(HOME))
      .mockResolvedValueOnce(listingOf(ALPHA))
    renderBrowser()
    await screen.findByRole('button', { name: 'alpha' })

    fireEvent.click(screen.getByRole('button', { name: 'alpha' }))

    expect(await screen.findByText('C:\\Users\\pooki\\alpha')).toBeTruthy()
    expect(browseFolders).toHaveBeenLastCalledWith('C:\\Users\\pooki\\alpha')
    // An empty directory is a position, not an absence: it can be chosen.
    expect(screen.getByText('No folders inside.')).toBeTruthy()
    const choose = screen.getByRole('button', { name: 'Use this folder' })
    if (!(choose instanceof HTMLButtonElement)) throw new Error('no footer button')
    expect(choose.disabled).toBe(false)
  })

  it('goes back out through the parent', async () => {
    browseFolders
      .mockResolvedValueOnce(listingOf(ALPHA))
      .mockResolvedValueOnce(listingOf(HOME))
    renderBrowser()
    await screen.findByText('C:\\Users\\pooki\\alpha')

    fireEvent.click(screen.getByRole('button', { name: 'Up' }))

    await waitFor(() => expect(browseFolders).toHaveBeenLastCalledWith('C:\\Users\\pooki'))
    expect(await screen.findByRole('button', { name: 'alpha' })).toBeTruthy()
  })

  it('hands the position to the form and closes', async () => {
    browseFolders.mockResolvedValueOnce(listingOf(HOME))
    renderBrowser()
    await screen.findByRole('button', { name: 'alpha' })

    fireEvent.click(screen.getByRole('button', { name: 'Use this folder' }))

    expect(onPick).toHaveBeenCalledWith('C:\\Users\\pooki')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('keeps the last good listing and names the refusal when a walk fails', async () => {
    browseFolders
      .mockResolvedValueOnce(listingOf(HOME))
      .mockResolvedValueOnce({
        ok: false,
        error: {
          kind: 'harness-error',
          status: 400,
          message: 'That path does not exist (C:\\Users\\pooki\\gone).',
        },
      })
    renderBrowser()
    await screen.findByRole('button', { name: 'alpha' })

    fireEvent.click(screen.getByRole('button', { name: 'Up' }))

    // The sentence arrives with the position still under it: an answer that
    // replaced the list with the error would strand the person one row away
    // from where they were.
    expect(
      await screen.findByText('That path does not exist (C:\\Users\\pooki\\gone).'),
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: 'alpha' })).toBeTruthy()
  })

  it('lands the person where they last asked, not where a slow answer said', async () => {
    const holder: { settle: ((result: HarnessResult<FolderListing>) => void) | null } = {
      settle: null,
    }
    browseFolders
      .mockResolvedValueOnce(listingOf(HOME))
      // The second ask - Up - never settles on its own; it is resolved late,
      // on purpose, after the third has already landed.
      .mockImplementationOnce(
        () =>
          new Promise<HarnessResult<FolderListing>>((resolve) => {
            holder.settle = resolve
          }),
      )
      .mockResolvedValueOnce(listingOf(ALPHA))
    renderBrowser()
    await screen.findByRole('button', { name: 'alpha' })

    fireEvent.click(screen.getByRole('button', { name: 'Up' }))
    await waitFor(() => expect(browseFolders).toHaveBeenCalledTimes(2))
    fireEvent.click(screen.getByRole('button', { name: 'alpha' }))
    expect(await screen.findByText('C:\\Users\\pooki\\alpha')).toBeTruthy()

    // The stale answer lands last, and loses: the position stays where the
    // person asked to be, not where the slower walk said.
    if (holder.settle === null) throw new Error('unreachable')
    holder.settle(listingOf(HOME))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(screen.getByText('C:\\Users\\pooki\\alpha')).toBeTruthy()
  })
})
