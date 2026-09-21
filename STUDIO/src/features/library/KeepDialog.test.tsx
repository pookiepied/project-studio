/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { LibraryItem } from '@/platform/harness'

/**
 * Keeping a picture. What is pinned: the model is asked for the words as
 * the dialog opens and its proposal fills only the fields the person left
 * empty; the subject is the person's alone and is never sent to the model
 * or taken from it; Keep posts the bytes with what was typed; Cancel
 * posts nothing.
 */

const describeImage = vi.fn()
const addLibraryItem = vi.fn()

vi.mock('@/platform/harness', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/platform/harness')>()
  return {
    ...actual,
    resolveHarnessAddress: () => Promise.resolve({ baseUrl: 'http://harness.test', credential: 'c' }),
    createHarnessClient: () => ({ describeImage, addLibraryItem }),
  }
})

import { KeepDialog } from './KeepDialog'

const KEPT: LibraryItem = {
  id: 'lib_1',
  kind: 'image',
  fileName: 'me.png',
  mimeType: 'image/png',
  byteLength: 3,
  title: 'Ridge',
  description: 'A hike.',
  subject: 'me',
  tags: ['hiking'],
  sourceConversationId: 'cnv_1',
  createdAt: 1,
  updatedAt: 1,
  path: 'C:/lib/lib_1.png',
}

function field(label: string): HTMLInputElement {
  return screen.getByLabelText<HTMLInputElement>(label)
}

afterEach(() => {
  cleanup()
  describeImage.mockReset()
  addLibraryItem.mockReset()
})

describe('KeepDialog', () => {
  it('asks the model for the words, keeps what the person typed, and never sends the subject', async () => {
    let answer: (value: unknown) => void = () => undefined
    describeImage.mockReturnValue(new Promise((resolve) => (answer = resolve)))
    addLibraryItem.mockResolvedValue({ ok: true, value: KEPT })
    const kept: LibraryItem[] = []
    render(
      <KeepDialog
        open
        candidate={{ fileName: 'me.png', mimeType: 'image/png', data: 'AAAA', sourceConversationId: 'cnv_1' }}
        editing={null}
        onClose={() => undefined}
        onKept={(item) => kept.push(item)}
      />,
    )
    await waitFor(() =>
      expect(describeImage).toHaveBeenCalledWith({ data: 'AAAA', mimeType: 'image/png', hint: 'me.png' }),
    )

    fireEvent.change(field('Who or what is this?'), { target: { value: 'me' } })
    fireEvent.change(field('Title'), { target: { value: 'My own title' } })
    answer({ ok: true, value: { title: 'Ridge', description: 'A hike.', tags: ['hiking', 'mountain'] } })

    await waitFor(() => expect(field('Tags').value).toBe('hiking, mountain'))
    expect(field('Title').value).toBe('My own title')
    expect(field('Description').value).toBe('A hike.')
    expect(field('Who or what is this?').value).toBe('me')

    fireEvent.click(screen.getByRole('button', { name: 'Keep' }))
    await waitFor(() => expect(kept).toHaveLength(1))
    expect(addLibraryItem).toHaveBeenCalledWith({
      title: 'My own title',
      description: 'A hike.',
      subject: 'me',
      tags: ['hiking', 'mountain'],
      fileName: 'me.png',
      mimeType: 'image/png',
      data: 'AAAA',
      sourceConversationId: 'cnv_1',
    })
  })

  it('says so when the model could not describe the picture, and still keeps', async () => {
    describeImage.mockResolvedValue({ ok: false, error: { kind: 'refused', message: 'no', timedOut: false } })
    addLibraryItem.mockResolvedValue({ ok: true, value: KEPT })
    render(
      <KeepDialog
        open
        candidate={{ fileName: 'me.png', mimeType: 'image/png', data: 'AAAA', sourceConversationId: null }}
        editing={null}
        onClose={() => undefined}
      />,
    )
    await screen.findByText(/could not describe this picture/)
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }))
    await waitFor(() => expect(addLibraryItem).toHaveBeenCalledTimes(1))
  })

  it('does not ask the model about a document, and Cancel posts nothing', () => {
    const closed = vi.fn()
    render(
      <KeepDialog
        open
        candidate={{ fileName: 'lease.pdf', mimeType: 'application/pdf', data: 'AAAA', sourceConversationId: null }}
        editing={null}
        onClose={closed}
      />,
    )
    expect(describeImage).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(closed).toHaveBeenCalled()
    expect(addLibraryItem).not.toHaveBeenCalled()
  })
})
