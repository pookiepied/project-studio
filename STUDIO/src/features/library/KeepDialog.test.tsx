/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { LibraryItem } from '@/platform/harness'

import { KeepDialog } from './KeepDialog'

/**
 * Keeping a picture, from the env vars down to the request. Nothing here
 * mocks a module of ours: the address resolves through the same two Vite
 * env vars the production read uses, the harness's answers come from a
 * stubbed `fetch`, and everything between — the resolver, the client, the
 * contract and the dialog's own states — is the code the window runs. What
 * is pinned: the model is asked for the words as the dialog opens and its
 * proposal fills only the fields the person left empty; the subject is the
 * person's alone and is never sent to the model or taken from it; Keep posts
 * the bytes with what was typed; a picture the model could not describe can
 * still be kept; Cancel posts nothing.
 */

const BASE_URL = 'http://127.0.0.1:4319'

interface Call {
  readonly url: string
  readonly method: string
  readonly body: string | null
}

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

/** The describe proposal the harness's model makes for the test's picture. */
const PROPOSAL = { title: 'Ridge', description: 'A hike.', tags: ['hiking', 'mountain'] }

/** Configures an address, exactly as a developer's `.env` would. */
function harnessConfigured() {
  vi.stubEnv('VITE_HARNESS_BASE_URL', BASE_URL)
  vi.stubEnv('VITE_HARNESS_TOKEN', 'a-test-credential')
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Answers the routes the dialog asks, and records every ask. The describe
 * ask is held until `answerDescribe` releases it, so the test can type while
 * the model is "thinking" — the timing the dialog promises to survive.
 */
function serveDialog(): { calls: Call[]; answerDescribe: (value: unknown, status?: number) => void } {
  const calls: Call[] = []
  let release: ((answer: Response) => void) | null = null
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = input instanceof URL ? input.toString() : typeof input === 'string' ? input : input.url
    calls.push({
      url,
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? init.body : null,
    })
    if (url.endsWith('/api/library/describe')) {
      return new Promise<Response>((resolve) => {
        release = resolve
      })
    }
    if (url.endsWith('/api/library')) return jsonResponse({ item: KEPT })
    return new Response(null, { status: 404 })
  }
  vi.stubGlobal('fetch', fetch)
  return {
    calls,
    answerDescribe: (value: unknown, status = 200) => release?.(jsonResponse(value, status)),
  }
}

function field(label: string): HTMLInputElement {
  return screen.getByLabelText<HTMLInputElement>(label)
}

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('KeepDialog', () => {
  it('asks the model for the words, keeps what the person typed, and never sends the subject', async () => {
    harnessConfigured()
    const { calls, answerDescribe } = serveDialog()
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
      expect(calls.some((asked) => asked.url === `${BASE_URL}/api/library/describe`)).toBe(true),
    )
    expect(JSON.parse(calls[0]?.body ?? 'null')).toEqual({
      data: 'AAAA',
      mimeType: 'image/png',
      hint: 'me.png',
    })

    // The person types while the model is still thinking.
    fireEvent.change(field('Who or what is this?'), { target: { value: 'me' } })
    fireEvent.change(field('Title'), { target: { value: 'My own title' } })
    answerDescribe({ description: PROPOSAL })

    await waitFor(() => expect(field('Tags').value).toBe('hiking, mountain'))
    expect(field('Title').value).toBe('My own title')
    expect(field('Description').value).toBe('A hike.')
    expect(field('Who or what is this?').value).toBe('me')

    fireEvent.click(screen.getByRole('button', { name: 'Keep' }))
    await waitFor(() => expect(kept).toHaveLength(1))
    const addition = calls.find((asked) => asked.method === 'POST' && asked.url === `${BASE_URL}/api/library`)
    expect(JSON.parse(addition?.body ?? 'null')).toEqual({
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
    harnessConfigured()
    const { calls, answerDescribe } = serveDialog()
    render(
      <KeepDialog
        open
        candidate={{ fileName: 'me.png', mimeType: 'image/png', data: 'AAAA', sourceConversationId: null }}
        editing={null}
        onClose={() => undefined}
      />,
    )
    await waitFor(() =>
      expect(calls.some((asked) => asked.url === `${BASE_URL}/api/library/describe`)).toBe(true),
    )
    answerDescribe({ error: 'The model could not be asked.', code: 'extend.internal' }, 500)
    await screen.findByText(/could not describe this picture/)
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }))
    await waitFor(() =>
      expect(calls.some((asked) => asked.method === 'POST' && asked.url === `${BASE_URL}/api/library`)).toBe(
        true,
      ),
    )
  })

  it('does not ask the model about a document, and Cancel posts nothing', () => {
    harnessConfigured()
    const { calls } = serveDialog()
    const closed = vi.fn()
    render(
      <KeepDialog
        open
        candidate={{ fileName: 'lease.pdf', mimeType: 'application/pdf', data: 'AAAA', sourceConversationId: null }}
        editing={null}
        onClose={closed}
      />,
    )
    expect(calls.some((asked) => asked.url.endsWith('/api/library/describe'))).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(closed).toHaveBeenCalled()
    expect(calls.some((asked) => asked.method === 'POST' && asked.url === `${BASE_URL}/api/library`)).toBe(
      false,
    )
  })
})
