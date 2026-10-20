/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

import { LibraryPane } from './LibraryPane'

/**
 * The pane, from the env vars down to the request. Nothing here mocks a
 * module of ours: the address resolves through the same two Vite env vars
 * the production read uses, the harness's answers come from a stubbed
 * `fetch`, and everything between — the resolver, the client, the contract,
 * the hook and the pane's own states — is the code the window runs.
 *
 * What is pinned is the redesign's bargain: the pane is a wall of files and
 * one control row. The explanatory prose is gone (the pane no longer says
 * what it is for or where the files live), and the functions all still
 * answer — search narrows the ask, the kind filter narrows it on the wire,
 * a card opens the keep dialog for editing, a card's remove really removes,
 * and the states a library passes through (empty, no harness) are named.
 */

const BASE_URL = 'http://127.0.0.1:4319'

interface Call {
  readonly url: string
  readonly method: string
  readonly body: string | null
}

function item(overrides: Partial<Record<string, unknown>>): Record<string, unknown> {
  return {
    id: 'img_1',
    kind: 'image',
    fileName: 'bruno.png',
    mimeType: 'image/png',
    byteLength: 1024,
    title: 'Bruno',
    description: '',
    subject: 'Bruno',
    tags: ['dog'],
    sourceConversationId: null,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    path: 'C:/studio/data/library/img_1.png',
    ...overrides,
  }
}

const PHOTO = item({})
const NOTES = item({
  id: 'doc_1',
  kind: 'document',
  fileName: 'notes.pdf',
  mimeType: 'application/pdf',
  byteLength: 2048,
  title: 'Meeting notes',
  subject: '',
  tags: [],
  path: 'C:/studio/data/library/doc_1.pdf',
})

const LISTING = {
  items: [PHOTO, NOTES],
  subjects: ['Bruno'],
  directory: 'C:/Users/pooki/.studio/data/library',
  maxFileBytes: 52_428_800,
}

const EMPTY = { ...LISTING, items: [], subjects: [] }

function harnessConfigured() {
  vi.stubEnv('VITE_HARNESS_BASE_URL', BASE_URL)
  vi.stubEnv('VITE_HARNESS_TOKEN', 'a-test-credential')
}

function harnessAbsent() {
  vi.stubEnv('VITE_HARNESS_BASE_URL', undefined)
  vi.stubEnv('VITE_HARNESS_TOKEN', undefined)
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Answers the routes the pane asks — the listing, the thumbnail bytes, the
 * remove — and records every ask. The listing is served per test through
 * `next`, because the tests below change what the library holds.
 */
function serveLibrary(next: (url: string) => unknown): Call[] {
  const calls: Call[] = []
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = input instanceof URL ? input.toString() : typeof input === 'string' ? input : input.url
    calls.push({
      url,
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? init.body : null,
    })
    if (url.includes('/api/pairing/state')) return new Response(null, { status: 404 })
    if (/\/api\/library\/[^/]+\/bytes$/.test(url)) return new Response(null, { status: 404 })
    if (/\/api\/library\/[^/]+$/.test(url)) return new Response(null, { status: 200 })
    if (url.includes('/api/library')) return jsonResponse(next(url))
    return new Response(null, { status: 404 })
  }
  vi.stubGlobal('fetch', fetch)
  return calls
}

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('LibraryPane', () => {
  it('reads the listing into a wall of files, and no longer explains itself', async () => {
    harnessConfigured()
    serveLibrary(() => LISTING)
    render(<LibraryPane />)

    await screen.findByRole('button', { name: 'Edit Bruno' })
    expect(screen.getByRole('button', { name: 'Edit Meeting notes' })).toBeTruthy()

    // The redesign's whole point, pinned: the pane is the files and the
    // controls. Every sentence it used to say about itself is gone.
    expect(screen.queryByText(/Found by every conversation/)).toBeNull()
    expect(screen.queryByText(/Files you keep for every conversation/)).toBeNull()
    expect(screen.queryByText(/The files live in/)).toBeNull()
    expect(screen.queryByText(/search tool by the words here/)).toBeNull()
  })

  it('sends the typed words as the search, after the typing settles', async () => {
    harnessConfigured()
    const calls = serveLibrary(() => LISTING)
    render(<LibraryPane />)
    await screen.findByRole('button', { name: 'Edit Bruno' })

    // Search is collapsed until the magnifier asks for it: no permanent
    // field squatting on the row.
    expect(screen.queryByRole('textbox', { name: 'Search the library' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    const field = await screen.findByRole('textbox', { name: 'Search the library' })

    fireEvent.change(field, { target: { value: 'logo' } })
    // A word waits a beat before it is asked; the wait is shorter than the
    // test's patience, so this also pins that the ask eventually happens.
    await waitFor(() =>
      expect(calls.some((asked) => asked.url.includes('query=logo'))).toBe(true),
    )

    // Dismissing the search takes its words with it — a closed magnifier
    // keeping a stale filter would be a wall silently narrowed.
    fireEvent.keyDown(field, { key: 'Escape' })
    await waitFor(() =>
      expect(screen.queryByRole('textbox', { name: 'Search the library' })).toBeNull(),
    )
    await waitFor(() => {
      const last = calls.filter((asked) => asked.url.includes('/api/library?')).at(-1)
      expect(last?.url.includes('query=')).toBe(false)
    })
  })

  it('says when a search found nothing, and gives the wall back', async () => {
    harnessConfigured()
    serveLibrary((url) => (url.includes('query=') ? EMPTY : LISTING))
    render(<LibraryPane />)
    await screen.findByRole('button', { name: 'Edit Bruno' })

    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    fireEvent.change(await screen.findByRole('textbox', { name: 'Search the library' }), {
      target: { value: 'zzz' },
    })

    await screen.findByText('Nothing matches.')
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Edit Bruno' })).toBeNull(),
    )

    // And the words leaving give the wall back — the dismissal is a
    // round trip, not a state the pane keeps.
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Search the library' }), {
      key: 'Escape',
    })
    await screen.findByRole('button', { name: 'Edit Bruno' })
    expect(screen.queryByText('Nothing matches.')).toBeNull()
  })

  it('narrows by kind on the wire', async () => {
    harnessConfigured()
    const calls = serveLibrary(() => LISTING)
    render(<LibraryPane />)
    await screen.findByRole('button', { name: 'Edit Bruno' })

    fireEvent.click(screen.getByRole('radio', { name: 'Documents' }))
    await waitFor(() => expect(calls.some((asked) => asked.url.includes('kind=document'))).toBe(true))
  })

  it('removes a kept file, and reads the wall again', async () => {
    // The read AFTER the removal sees a library without the file, because
    // that is what the harness now answers: the stub counts its listing
    // reads — mount, then the re-read `remove` triggers — and the second one
    // is the emptied wall. (The re-read can land while the first wait is
    // still flushing, so the answer is decided in the stub rather than
    // raced from the test.)
    let reads = 0
    harnessConfigured()
    const calls = serveLibrary(() => {
      reads += 1
      return reads > 1 ? EMPTY : LISTING
    })
    render(<LibraryPane />)
    await screen.findByRole('button', { name: 'Edit Bruno' })

    fireEvent.click(screen.getByRole('button', { name: 'Remove Bruno' }))
    const remove = await waitFor(() => {
      const ask = calls.find(
        (asked) => asked.url.endsWith('/api/library/img_1') && asked.method === 'DELETE',
      )
      if (ask === undefined) throw new Error('the removal was never asked for')
      return ask
    })
    expect(remove).toBeTruthy()

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Edit Bruno' })).toBeNull())
    expect(screen.getByText('Nothing kept yet.')).toBeTruthy()
  })

  it('says what an empty library is, with a pictogram and one line', async () => {
    harnessConfigured()
    serveLibrary(() => EMPTY)
    render(<LibraryPane />)

    await screen.findByText('Nothing kept yet.')
    // The empty state is a pictogram and the quiet line — no second
    // sentence of instructions, no lecture. A role of status so it is
    // spoken, and the pictogram carries nothing a reader must see.
    expect(screen.getByRole('status', { name: undefined })).toBeTruthy()
    expect(screen.queryByText(/add a file here/)).toBeNull()
    expect(screen.queryByText(/bookmark/)).toBeNull()
  })

  it('selects several, deletes them as one, and puts the tray away', async () => {
    let reads = 0
    harnessConfigured()
    const calls = serveLibrary(() => {
      reads += 1
      return reads > 1 ? EMPTY : LISTING
    })
    render(<LibraryPane />)
    await screen.findByRole('button', { name: 'Edit Bruno' })

    // The mode rises with its tray, count honest at zero.
    fireEvent.click(screen.getByRole('button', { name: 'Select' }))
    expect(screen.getByText('0 selected')).toBeTruthy()

    // A click becomes a toggle, and the card says so.
    const card = screen.getByRole('button', { name: 'Select Bruno' })
    expect(card.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(card)
    expect(card.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('1 selected')).toBeTruthy()

    // Delete is one ask per kept file, and the wall empties.
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() =>
      expect(calls.some((asked) => asked.url.endsWith('/api/library/img_1') && asked.method === 'DELETE')).toBe(
        true,
      ),
    )
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /Select Bruno|Edit Bruno/ })).toBeNull(),
    )
    expect(screen.getByText('Nothing kept yet.')).toBeTruthy()

    // The tray leaves when its work is done — there is nothing selected
    // and no mode to be in.
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull())
  })

  it('says the truth when there is no harness to read', async () => {
    harnessAbsent()
    render(<LibraryPane />)

    await screen.findByText('The harness is not running.')
    // The controls keep their places and answer as disabled — the same
    // degradation the voice controls run — rather than vanishing.
    const add = screen.getByRole('button', { name: 'Add a file' })
    expect(add.hasAttribute('disabled')).toBe(true)
  })

  it('opens the keep dialog when a file is added here', async () => {
    harnessConfigured()
    serveLibrary(() => LISTING)
    const { container } = render(<LibraryPane />)
    await screen.findByRole('button', { name: 'Edit Bruno' })

    const picker = container.querySelector('input[type="file"]')
    if (!(picker instanceof HTMLInputElement)) throw new Error('no picker in the pane')
    Object.defineProperty(picker, 'files', {
      value: [new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'logo.png', { type: 'image/png' })],
      configurable: true,
    })
    fireEvent.change(picker)

    // The dialog is the pane's editor: adding and editing are one thing, so
    // the wall's add lands in the same dialog the composer keeps with.
    expect(await screen.findByText('Keep in the library')).toBeTruthy()
    expect(screen.getByText('logo.png')).toBeTruthy()
  })
})
