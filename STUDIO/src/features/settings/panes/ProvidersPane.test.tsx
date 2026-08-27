/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ProvidersPane } from './ProvidersPane'
import { KNOWN_VENDOR, UNKNOWN_VENDOR, modelFor } from '@/features/settings/connections/harness.fixtures'

/**
 * The pane, from the env vars down to the request body.
 *
 * Nothing in this file mocks a module of ours. The harness address comes from
 * the same two Vite env vars `connection.ts` reads in production, and the only
 * substitution is `fetch` — so a passing test here exercises the real
 * resolver, the real client, and the real parsers, and a change that breaks any
 * of them fails here rather than in front of a user.
 *
 * What is asserted is behaviour, not pixels: which requests went out, what a
 * refused create does to a dialog, whether a delete asks first.
 */

const CANARY = 'sk-CANARY-DO-NOT-PERSIST'
const BASE_URL = 'http://127.0.0.1:4319'

interface Call {
  readonly url: string
  readonly method: string
  readonly body: string | null
}

type Route = (url: string, method: string) => Response

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** The harness answering the way its route module says it does. */
function defaultRoute(url: string, method: string): Response {
  if (url.includes('/models')) return jsonResponse([modelFor(KNOWN_VENDOR.id, 'claude-opus-5')])
  if (method === 'POST' && url.endsWith('/connections')) return jsonResponse(KNOWN_VENDOR, 201)
  if (method === 'DELETE') return new Response(null, { status: 204 })
  if (method === 'PATCH') return jsonResponse({ ...KNOWN_VENDOR, enabled: false })
  return jsonResponse([KNOWN_VENDOR, UNKNOWN_VENDOR])
}

function stubFetch(route: Route = defaultRoute): Call[] {
  const calls: Call[] = []
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = input instanceof URL ? input.toString() : String(input)
    const method = init?.method ?? 'GET'
    calls.push({ url, method, body: typeof init?.body === 'string' ? init.body : null })
    return route(url, method)
  }
  vi.stubGlobal('fetch', fetch)
  return calls
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

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

/**
 * The open dialog by name.
 *
 * Scoped rather than global because the footer button repeats the dialog's own
 * title — "Add connection" opens it and "Add connection" submits it — which
 * is right on screen and ambiguous to a query.
 */
function dialog(name: string): HTMLElement {
  return screen.getByRole('dialog', { name })
}

/** Fills the add dialog. The key is optional so the no-key path is testable. */
function fillDialog({ name, url, key }: { name: string; url: string; key?: string }) {
  fireEvent.change(screen.getByPlaceholderText('My gateway'), { target: { value: name } })
  fireEvent.change(screen.getByPlaceholderText('https://api.example.com/v1'), {
    target: { value: url },
  })
  if (key !== undefined) {
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: key } })
  }
}

describe('with no harness', () => {
  it('says so plainly instead of showing a fixture catalog', async () => {
    harnessAbsent()
    stubFetch()
    render(<ProvidersPane />)

    await screen.findByText(/No harness is connected/)
    expect(screen.getByText(/Start Studio's harness/)).toBeTruthy()

    // Quiet, and phrased as a fact rather than a problem. No fixture rows
    // that look like connections but hold no key and answer no probe.
    expect(screen.queryByText('Anthropic')).toBeNull()
    expect(screen.queryByText('Mistral')).toBeNull()

    // Nothing that reads as a failure, and nothing that offers a mutation
    // there is no harness to accept.
    expect(screen.queryByText(/Could not read connections/)).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByText('Add connection')).toBeNull()
  })

  it('sends no request at all', async () => {
    harnessAbsent()
    const calls = stubFetch()
    render(<ProvidersPane />)

    await screen.findByText(/No harness is connected/)
    expect(calls).toHaveLength(0)
  })
})

describe('when the load fails', () => {
  it('renders the failure rather than an empty list', async () => {
    harnessConfigured()
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('fetch failed')
    })
    render(<ProvidersPane />)

    await screen.findByText('Could not read connections.')
    expect(screen.getByText(new RegExp(BASE_URL.replace(/[.]/g, '\\.')))).toBeTruthy()

    // Critically, it does not silently fall through to a fixture list:
    // that would present fixture rows as though they were the user's own.
    expect(screen.queryByText('The box next door')).toBeNull()
    expect(screen.getByText('Try again')).toBeTruthy()
  })

  it('says a 401 is a credential problem', async () => {
    harnessConfigured()
    stubFetch(() =>
      jsonResponse({ error: 'Harness admission is required.', code: 'admission.unauthenticated' }, 401),
    )
    render(<ProvidersPane />)

    await screen.findByText('Harness admission is required.')
  })
})

describe('the list', () => {
  it('renders each connection with its models and credential status', async () => {
    harnessConfigured()
    stubFetch()
    render(<ProvidersPane />)

    await screen.findByText('Work Anthropic')
    expect(screen.getByText('The box next door')).toBeTruthy()

    // One model came back, and it belongs to the first connection only.
    expect(screen.getByText('1 model')).toBeTruthy()
    expect(screen.getByText('0 models')).toBeTruthy()

    expect(screen.getByText('Key stored')).toBeTruthy()
    expect(screen.getByText('No key')).toBeTruthy()
    expect(screen.getByText('Disabled')).toBeTruthy()
  })

  it('falls back to the custom mark for a vendor it has no drawing for', async () => {
    harnessConfigured()
    const { container } = render(<ProvidersPane />)
    stubFetch()

    await screen.findByText('The box next door')

    // `catalogProvider: 'anthropic'` is known; 'together-ai' is not, and the
    // closed union this used to be typed as could not have expressed it.
    expect(container.querySelector('[data-provider="anthropic"]')).not.toBeNull()
    expect(container.querySelector('[data-provider="together-ai"]')).toBeNull()
    expect(container.querySelector('[data-provider="custom"]')).not.toBeNull()
  })

  it('probes on demand and reports latency', async () => {
    harnessConfigured()
    const calls = stubFetch((url, method) => {
      if (url.endsWith('/probe')) {
        return jsonResponse({ ok: true, reachedAt: 1, modelCount: 12, latencyMs: 94 })
      }
      return defaultRoute(url, method)
    })
    render(<ProvidersPane />)
    await screen.findByText('Work Anthropic')

    fireEvent.click(screen.getAllByText('Check')[0] ?? document.createElement('button'))

    await screen.findByText('Reachable in 94 ms - 12 models listed')
    expect(
      calls.some(
        (call) =>
          call.method === 'POST' &&
          call.url === `${BASE_URL}/api/providers/connections/${KNOWN_VENDOR.id}/probe`,
      ),
    ).toBe(true)
  })

  it('shows a failed probe as the provider refusing, not as a broken page', async () => {
    harnessConfigured()
    stubFetch((url, method) => {
      if (url.endsWith('/probe')) {
        return jsonResponse({
          ok: false,
          reachedAt: 1,
          failure: 'The endpoint rejected the credential.',
          status: 401,
        })
      }
      return defaultRoute(url, method)
    })
    render(<ProvidersPane />)
    await screen.findByText('Work Anthropic')

    fireEvent.click(screen.getAllByText('Check')[0] ?? document.createElement('button'))

    await screen.findByText(/The endpoint rejected the credential\./)
    expect(screen.getByText(/HTTP 401/)).toBeTruthy()
    // The row is still there and the page never entered its failed state.
    expect(screen.getByText('The box next door')).toBeTruthy()
  })
})

describe('creating a connection', () => {
  it('sends the key in the request body and keeps it nowhere afterwards', async () => {
    harnessConfigured()
    const calls = stubFetch()
    render(<ProvidersPane />)
    await screen.findByText('Work Anthropic')

    fireEvent.click(screen.getByText('Add connection'))
    fillDialog({ name: 'My Gateway', url: 'https://api.example.com/v1', key: CANARY })

    // The id is derived and shown, because it is what a duplicate error names.
    expect(screen.getByText('Filed as my-gateway')).toBeTruthy()

    fireEvent.click(within(dialog('Add connection')).getByRole('button', { name: 'Add connection' }))

    await waitFor(() => {
      expect(calls.some((call) => call.method === 'POST')).toBe(true)
    })

    const post = calls.find((call) => call.method === 'POST')
    expect(post?.body).toContain(CANARY)
    const sent: unknown = JSON.parse(post?.body ?? '{}')
    expect(sent).toMatchObject({
      id: 'my-gateway',
      displayName: 'My Gateway',
      kind: 'language',
      source: 'local',
      enabled: true,
      baseUrl: 'https://api.example.com/v1',
      apiKey: CANARY,
    })

    // The dialog closed on success, which is what clears the field.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    // And now the canary is nowhere that outlives it.
    expect(document.body.innerHTML).not.toContain(CANARY)
    expect(JSON.stringify(localStorage)).not.toContain(CANARY)
    expect(JSON.stringify(sessionStorage)).not.toContain(CANARY)

    // Reopening gives an empty field rather than a remembered one.
    fireEvent.click(screen.getByText('Add connection'))
    const reopened = screen.getByLabelText('API key')
    expect(reopened instanceof HTMLInputElement ? reopened.value : 'not an input').toBe('')
  })

  it('masks the key and does not offer to remember it', async () => {
    harnessConfigured()
    stubFetch()
    render(<ProvidersPane />)
    await screen.findByText('Work Anthropic')

    fireEvent.click(screen.getByText('Add connection'))
    const field = screen.getByLabelText('API key')

    expect(field.getAttribute('type')).toBe('password')
    expect(field.getAttribute('autocomplete')).toBe('off')
  })

  it('omits the key entirely when none was typed', async () => {
    harnessConfigured()
    const calls = stubFetch()
    render(<ProvidersPane />)
    await screen.findByText('Work Anthropic')

    fireEvent.click(screen.getByText('Add connection'))
    fillDialog({ name: 'Keyless', url: 'http://localhost:11434/v1' })
    fireEvent.click(within(dialog('Add connection')).getByRole('button', { name: 'Add connection' }))

    await waitFor(() => expect(calls.some((call) => call.method === 'POST')).toBe(true))
    const sent: unknown = JSON.parse(calls.find((call) => call.method === 'POST')?.body ?? '{}')
    // An empty string is a key the harness would try to store. Absent is not.
    expect(Object.keys(sent ?? {})).not.toContain('apiKey')
  })

  it('leaves the dialog open with the fields intact when the harness refuses', async () => {
    harnessConfigured()
    stubFetch((url, method) => {
      if (method === 'POST') {
        return jsonResponse(
          { error: 'Provider connection "my-gateway" already exists.', code: 'models.configuration' },
          400,
        )
      }
      return defaultRoute(url, method)
    })
    render(<ProvidersPane />)
    await screen.findByText('Work Anthropic')

    fireEvent.click(screen.getByText('Add connection'))
    fillDialog({ name: 'My Gateway', url: 'https://api.example.com/v1', key: CANARY })
    fireEvent.click(within(dialog('Add connection')).getByRole('button', { name: 'Add connection' }))

    await screen.findByText('Provider connection "my-gateway" already exists.')

    // Still open, and nobody has to retype a URL because the id clashed.
    const name = screen.getByPlaceholderText('My gateway')
    const url = screen.getByPlaceholderText('https://api.example.com/v1')
    const key = screen.getByLabelText('API key')
    expect(name instanceof HTMLInputElement ? name.value : null).toBe('My Gateway')
    expect(url instanceof HTMLInputElement ? url.value : null).toBe('https://api.example.com/v1')
    expect(key instanceof HTMLInputElement ? key.value : null).toBe(CANARY)
  })
})

describe('enable and disable', () => {
  it('patches only the enabled flag', async () => {
    harnessConfigured()
    const calls = stubFetch()
    render(<ProvidersPane />)
    await screen.findByText('Work Anthropic')

    fireEvent.click(screen.getByLabelText('Work Anthropic options'))
    fireEvent.click(screen.getByText('Disable'))

    await waitFor(() => expect(calls.some((call) => call.method === 'PATCH')).toBe(true))
    const patch = calls.find((call) => call.method === 'PATCH')
    expect(patch?.url).toBe(`${BASE_URL}/api/providers/connections/${KNOWN_VENDOR.id}`)
    expect(patch?.body).toBe(JSON.stringify({ enabled: false }))
  })
})

describe('removing a connection', () => {
  it('asks first, names the connection, and says the key goes too', async () => {
    harnessConfigured()
    const calls = stubFetch()
    render(<ProvidersPane />)
    await screen.findByText('Work Anthropic')

    fireEvent.click(screen.getByLabelText('Work Anthropic options'))
    fireEvent.click(screen.getByText('Remove'))

    // Asked, not done.
    expect(screen.getByText('Remove Work Anthropic?')).toBeTruthy()
    expect(screen.getByText(/deleted from this machine's credential store/)).toBeTruthy()
    expect(calls.some((call) => call.method === 'DELETE')).toBe(false)

    fireEvent.click(within(dialog('Remove connection')).getByRole('button', { name: 'Remove' }))

    await waitFor(() => expect(calls.some((call) => call.method === 'DELETE')).toBe(true))
    expect(calls.find((call) => call.method === 'DELETE')?.url).toBe(
      `${BASE_URL}/api/providers/connections/${KNOWN_VENDOR.id}`,
    )
  })

  it('deletes nothing when the question is declined', async () => {
    harnessConfigured()
    const calls = stubFetch()
    render(<ProvidersPane />)
    await screen.findByText('Work Anthropic')

    fireEvent.click(screen.getByLabelText('Work Anthropic options'))
    fireEvent.click(screen.getByText('Remove'))
    fireEvent.click(within(dialog('Remove connection')).getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(screen.queryByText('Remove Work Anthropic?')).toBeNull())
    expect(calls.some((call) => call.method === 'DELETE')).toBe(false)
  })
})

describe('creating the very first connection', () => {
  it('closes the dialog even when the list was empty before', async () => {
    // The live app hit this and the jsdom suite did not: every other create
    // test starts with rows already on screen, so the empty-state branch of
    // the list was never the thing being replaced when the refresh landed.
    harnessConfigured()
    let created = false
    stubFetch((url, method) => {
      if (url.includes('/models')) return jsonResponse([])
      if (method === 'POST') {
        created = true
        return jsonResponse(KNOWN_VENDOR, 201)
      }
      return jsonResponse(created ? [KNOWN_VENDOR] : [])
    })
    render(<ProvidersPane />)
    await screen.findByText(/No connections yet/)

    fireEvent.click(screen.getByText('Add connection'))
    fillDialog({ name: 'First', url: 'http://127.0.0.1:9999/v1', key: CANARY })
    fireEvent.click(within(dialog('Add connection')).getByRole('button', { name: 'Add connection' }))

    await screen.findByText('Work Anthropic')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(document.body.innerHTML).not.toContain(CANARY)
  })
})
