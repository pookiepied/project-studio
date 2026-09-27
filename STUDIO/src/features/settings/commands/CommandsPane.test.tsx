/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

import { CommandsPane } from './CommandsPane'

/**
 * The pane, from the env vars down to the request. Nothing here mocks a
 * module of ours: the address resolves through the same two Vite env vars
 * the production read uses, the harness's answers come from a stubbed
 * `fetch`, and everything between — the resolver, the client, the contract
 * and the pane's own states — is the code the window runs. What is pinned:
 * the ways the list can land (ready, failed, no harness), the hint that is
 * legitimately the empty string, the files that were skipped, and an editor
 * that saves what it actually opened.
 */

const BASE_URL = 'http://127.0.0.1:4319'

interface Call {
  readonly url: string
  readonly method: string
  readonly body: string | null
}

const COMPACT = {
  id: 'compact',
  description: 'Compact the conversation: fold the earlier turns into a summary',
  argumentHint: '',
  provenance: 'builtin',
  kind: 'action',
  path: null,
}

const EXPLAIN = {
  id: 'explain',
  description: 'Explain a file, a function or a concept in plain words',
  argumentHint: '<what to explain>',
  provenance: 'system',
  kind: 'prompt',
  path: 'C:/studio/commands/explain.md',
}

const NOTES = {
  id: 'notes',
  description: 'File a note away',
  argumentHint: '',
  provenance: 'user',
  kind: 'prompt',
  path: 'C:/studio/commands/notes.md',
}

const LISTING = {
  commands: [COMPACT, EXPLAIN, NOTES],
  problems: [
    { path: 'C:/studio/commands/WIP.md', reason: 'The file has no prompt under its frontmatter.' },
  ],
  userDirectory: 'C:/studio/commands',
}

/** The detail the harness holds for `notes`: the hint and the description, both, as they are. */
const NOTES_DETAIL = {
  command: NOTES,
  source: { frontmatter: { description: 'File a note away', argumentHint: '' }, body: 'File $1 away.' },
}

/** Configures an address, exactly as a developer's `.env` would. */
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

/** Answers the routes the pane asks, and records every ask. */
function servePane(): Call[] {
  const calls: Call[] = []
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = input instanceof URL ? input.toString() : typeof input === 'string' ? input : input.url
    calls.push({
      url,
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? init.body : null,
    })
    if (url.includes('/api/pairing/state')) return new Response(null, { status: 404 })
    if (url.endsWith('/api/commands/notes')) return jsonResponse(NOTES_DETAIL)
    if (url.endsWith('/api/commands')) return jsonResponse(LISTING)
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

describe('CommandsPane', () => {
  it('reads the list into its rows, and says which files were skipped', async () => {
    harnessConfigured()
    const calls = servePane()
    render(<CommandsPane />)

    await screen.findByText('/notes')
    expect(screen.getByText('/compact')).toBeTruthy()
    // The hint, where there is one; the built-in's row, where there is not.
    expect(screen.getByText('<what to explain>')).toBeTruthy()
    expect(screen.getByText('Built into Studio')).toBeTruthy()
    expect(screen.getByText('Ships with Studio')).toBeTruthy()
    expect(screen.getByText('C:/studio/commands/explain.md')).toBeTruthy()
    // The person's own command is the only one the pane can act on.
    expect(screen.getByRole('button', { name: 'Edit /notes' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Edit /explain' })).toBeNull()
    // Where the files live, as the listing named it — not the guessed path.
    expect(screen.getByText(/Yours live in/)).toBeTruthy()
    expect(screen.getByText('C:/studio/commands')).toBeTruthy()
    expect(screen.queryByText('~/.studio/commands/')).toBeNull()

    // A skipped file is named with its reason, and never pretended listed:
    // its full path and reason render under Skipped, but no command row
    // ever appears for it.
    expect(screen.getByText('Skipped')).toBeTruthy()
    const skipped = screen.getByText('C:/studio/commands/WIP.md').closest('li')
    expect(skipped?.textContent).toContain('WIP.md — The file has no prompt under its frontmatter.')
    expect(screen.queryByText('/WIP')).toBeNull()
    expect(calls[0]?.url).toBe(`${BASE_URL}/api/commands`)
  })

  it('opens the editor on what the harness holds, and saves exactly that', async () => {
    harnessConfigured()
    const calls = servePane()
    render(<CommandsPane />)
    await screen.findByText('/notes')

    fireEvent.click(screen.getByRole('button', { name: 'Edit /notes' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit /notes' })

    // Seeded from the detail, the empties included: the hint's "" is the
    // harness's truth, arrived in the field the person would otherwise
    // have to refill from nothing.
    await within(dialog).findByText('Description')
    expect(within(dialog).getByLabelText<HTMLInputElement>('Argument hint').value).toBe('')
    expect(within(dialog).getByLabelText<HTMLInputElement>('Description').value).toBe('File a note away')
    // The Prompt label's text runs on — the textarea's own words and the
    // rule under it are inside the label too — so the query matches from
    // the front rather than the whole.
    expect(within(dialog).getByLabelText<HTMLTextAreaElement>(/^Prompt/).value).toBe('File $1 away.')

    fireEvent.change(within(dialog).getByLabelText('Description'), {
      target: { value: 'File a note, renamed' },
    })
    fireEvent.click(within(dialog).getByText('Save'))

    await waitFor(() =>
      expect(
        calls.some((asked) => asked.method === 'PUT' && asked.url === `${BASE_URL}/api/commands/notes`),
      ).toBe(true),
    )
    const put = calls.find((asked) => asked.method === 'PUT')
    if (put === undefined) throw new Error('the save never went out')
    expect(JSON.parse(put.body ?? 'null')).toEqual({
      description: 'File a note, renamed',
      argumentHint: '',
      body: 'File $1 away.',
    })

    // And the pane re-reads rather than trusting its hope: the second
    // listing is what the harness now says, not what was sent.
    await waitFor(() =>
      expect(calls.filter((asked) => asked.url === `${BASE_URL}/api/commands`)).toHaveLength(2),
    )
  })

  it('says what failed, when the harness answers but cannot be read', async () => {
    harnessConfigured()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ error: 'The listing broke.', code: 'extend.internal' }, 500)),
    )
    render(<CommandsPane />)

    await screen.findByText('The list could not be read.')
    expect(screen.getByText('The listing broke.')).toBeTruthy()
    // Nothing acts on a list nobody has: the mutations wait.
    expect(screen.getByRole('button', { name: 'New command' }).hasAttribute('disabled')).toBe(true)
  })

  it('waits for a harness, and says plainly when there is none', async () => {
    harnessAbsent()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = input instanceof URL ? input.toString() : typeof input === 'string' ? input : input.url
        if (url.includes('/api/pairing/state')) return new Response(null, { status: 404 })
        return new Response(null, { status: 404 })
      }),
    )
    render(<CommandsPane />)

    await screen.findByText('The harness is not running.')
    expect(
      screen.getByText('Commands are read by the harness, so the list cannot be read until it starts.'),
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: 'New command' }).hasAttribute('disabled')).toBe(true)
  })
})
