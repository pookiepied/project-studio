/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ProvidersPane } from './ProvidersPane'
import { KNOWN_VENDOR, UNKNOWN_VENDOR, modelFor } from './harness.fixtures'

/**
 * The pane, from the env vars down to the request body.
 *
 * Nothing in this file mocks a module of ours. The harness address comes from
 * the same two Vite env vars `connection.ts` reads in production, and the only
 * substitution is `fetch` - so a passing test here exercises the real
 * resolver, the real client, and the real parsers, and a change that breaks any
 * of them fails here rather than in front of a user.
 *
 * What is asserted is behaviour, not pixels: which requests went out, what a
 * refused create does to a dialog, whether a delete asks first, and - new with
 * the library and the slots - that the add flow probes what it created and the
 * defaults section writes through the contract's own door.
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
  if (url.includes('/library')) return jsonResponse([])
  if (url.includes('/defaults')) return jsonResponse({})
  if (url.includes('/models')) return jsonResponse([modelFor(KNOWN_VENDOR.id, 'claude-opus-5')])
  if (method === 'POST' && url.endsWith('/connections')) return jsonResponse(KNOWN_VENDOR, 201)
  if (method === 'POST' && url.endsWith('/probe')) {
    return jsonResponse({ ok: true, reachedAt: 1, modelCount: 271 })
  }
  if (method === 'DELETE') return new Response(null, { status: 204 })
  if (method === 'PATCH') return jsonResponse({ ...KNOWN_VENDOR, enabled: false })
  return jsonResponse([KNOWN_VENDOR, UNKNOWN_VENDOR])
}

function stubFetch(route: Route = defaultRoute): Call[] {
  const calls: Call[] = []
  const fetch: typeof globalThis.fetch = async (input, init) => {
    // A `Request` stringifies to "[object Request]"; its url is what these
    // assertions are about.
    const url =
      input instanceof URL ? input.toString() : typeof input === 'string' ? input : input.url
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
 * title - "Add connection" opens it and its close button reads "Close" - which
 * is right on screen and ambiguous to a query.
 */
function dialog(name: string): HTMLElement {
  return screen.getByRole('dialog', { name })
}

/**
 * Opens the add dialog and walks to the custom endpoint form: the picker is
 * the front door now, and a private endpoint is one click behind it. The
 * dialog takes its accessible name from its title, which becomes
 * "Custom endpoint" on that click.
 */
function openCustomForm() {
  fireEvent.click(screen.getByText('Add connection'))
  fireEvent.click(within(dialog('Add connection')).getByText('Custom endpoint'))
}

/** The custom form's dialog, named by the title the form shows. */
function customDialog(): HTMLElement {
  return dialog('Custom endpoint')
}

/** Fills the custom form. The key is optional so the no-key path is testable. */
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
    expect(screen.queryByText(/Could not read providers/)).toBeNull()
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

    await screen.findByText('Could not read providers.')
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
  it('renders each connection with its offer and credential status', async () => {
    harnessConfigured()
    stubFetch()
    render(<ProvidersPane />)

    await screen.findByText('Work Anthropic')
    expect(screen.getByText('The box next door')).toBeTruthy()

    // One model came back, offered; the second connection has none.
    expect(screen.getByText('1 of 1 models offered')).toBeTruthy()
    expect(screen.getByText('0 of 0 models offered')).toBeTruthy()

    expect(screen.getByText('Key stored')).toBeTruthy()
    expect(screen.getByText('No key')).toBeTruthy()
    expect(screen.getByText('Disabled')).toBeTruthy()
  })

  it('marks each row with the vendor it actually names', async () => {
    harnessConfigured()
    const { container } = render(<ProvidersPane />)
    stubFetch()

    await screen.findByText('The box next door')

    // Both rows report their own `catalogProvider`. `together-ai` used to be
    // bucketed into `custom` here, which meant a row could not say which
    // vendor it was for once the vendor was outside a seven-name union -- and
    // the vendors outside it are most of them.
    expect(container.querySelector('[data-provider="anthropic"]')).not.toBeNull()
    expect(container.querySelector('[data-provider="together-ai"]')).not.toBeNull()
    expect(container.querySelector('[data-provider="custom"]')).toBeNull()
  })

  it('probes on demand and reports latency', async () => {
    harnessConfigured()
    const calls = stubFetch((url, method) => {
      if (url.endsWith('/probe') && !url.endsWith('/connections')) {
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
  it('sends the key in the request body, probes, and keeps the key nowhere', async () => {
    harnessConfigured()
    const calls = stubFetch()
    render(<ProvidersPane />)
    await screen.findByText('Work Anthropic')

    openCustomForm()
    fillDialog({ name: 'My Gateway', url: 'https://api.example.com/v1', key: CANARY })

    // The id is derived and shown, because it is what a duplicate error names.
    expect(screen.getByText('Filed as my-gateway')).toBeTruthy()

    fireEvent.click(within(customDialog()).getByRole('button', { name: 'Add and check' }))

    await waitFor(() => {
      expect(calls.some((call) => call.method === 'POST' && call.url.endsWith('/connections'))).toBe(true)
    })

    const post = calls.find((call) => call.method === 'POST' && call.url.endsWith('/connections'))
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

    // The probe ran, inside the same dialog, and reported what it learned.
    await waitFor(() => {
      expect(calls.some((call) => call.url.endsWith('/my-gateway/probe'))).toBe(true)
    })
    await screen.findByText('271 models listed by the provider.')

    // The key field is already empty - cleared on success, not on close.
    const key = screen.getByLabelText('API key')
    expect(key instanceof HTMLInputElement ? key.value : null).toBe('')

    fireEvent.click(within(customDialog()).getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    // And now the canary is nowhere that outlives it.
    expect(document.body.innerHTML).not.toContain(CANARY)
    expect(JSON.stringify(localStorage)).not.toContain(CANARY)
    expect(JSON.stringify(sessionStorage)).not.toContain(CANARY)
  })

  it('masks the key and does not offer to remember it', async () => {
    harnessConfigured()
    stubFetch()
    render(<ProvidersPane />)
    await screen.findByText('Work Anthropic')

    openCustomForm()
    const field = screen.getByLabelText('API key')

    expect(field.getAttribute('type')).toBe('password')
    expect(field.getAttribute('autocomplete')).toBe('off')
  })

  it('omits the key entirely when none was typed', async () => {
    harnessConfigured()
    const calls = stubFetch()
    render(<ProvidersPane />)
    await screen.findByText('Work Anthropic')

    openCustomForm()
    fillDialog({ name: 'Keyless', url: 'http://localhost:11434/v1' })
    fireEvent.click(within(customDialog()).getByRole('button', { name: 'Add and check' }))

    await waitFor(() => expect(calls.some((call) => call.method === 'POST')).toBe(true))
    const sent: unknown = JSON.parse(calls.find((call) => call.method === 'POST')?.body ?? '{}')
    // An empty string is a key the harness would try to store. Absent is not.
    expect(Object.keys(sent ?? {})).not.toContain('apiKey')
  })

  it('reports what the provider said when the probe is refused', async () => {
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

    openCustomForm()
    fillDialog({ name: 'Refusing', url: 'https://api.example.com/v1', key: CANARY })
    fireEvent.click(within(customDialog()).getByRole('button', { name: 'Add and check' }))

    // The provider's own sentence, in the dialog, where the user just typed.
    await screen.findByText('The endpoint rejected the credential.')
  })

  it('leaves the form open with the fields intact when the harness refuses', async () => {
    harnessConfigured()
    stubFetch((url, method) => {
      if (method === 'POST' && url.endsWith('/connections')) {
        return jsonResponse(
          { error: 'Provider connection "my-gateway" already exists.', code: 'models.configuration' },
          400,
        )
      }
      return defaultRoute(url, method)
    })
    render(<ProvidersPane />)
    await screen.findByText('Work Anthropic')

    openCustomForm()
    fillDialog({ name: 'My Gateway', url: 'https://api.example.com/v1', key: CANARY })
    fireEvent.click(within(customDialog()).getByRole('button', { name: 'Add and check' }))

    await screen.findByText('Provider connection "my-gateway" already exists.')

    // Still open, and nobody has to retype a URL because the id clashed.
    const name = screen.getByPlaceholderText('My gateway')
    const url = screen.getByPlaceholderText('https://api.example.com/v1')
    const key = screen.getByLabelText('API key')
    expect(name instanceof HTMLInputElement ? name.value : null).toBe('My Gateway')
    expect(url instanceof HTMLInputElement ? url.value : null).toBe('https://api.example.com/v1')
    expect(key instanceof HTMLInputElement ? key.value : null).toBe(CANARY)
  })

  it('offers the provider library with what each entry serves', async () => {
    harnessConfigured()
    const calls = stubFetch((url, method) => {
      if (url.includes('/library')) {
        return jsonResponse([
          {
            id: 'openai',
            displayName: 'OpenAI',
            kind: 'language',
            protocol: 'openai-completions',
            capabilities: ['textGeneration', 'imageGeneration'],
            modelCount: 28,
          },
          {
            id: 'tavily',
            displayName: 'Tavily',
            kind: 'retrieval',
            protocol: 'tavily',
            capabilities: ['webSearch'],
            modelCount: 2,
          },
        ])
      }
      return defaultRoute(url, method)
    })
    render(<ProvidersPane />)
    await screen.findByText('Work Anthropic')

    fireEvent.click(screen.getByText('Add connection'))
    const picker = dialog('Add connection')
    await within(picker).findByText('OpenAI')
    within(picker).getByText('Chat - Images')
    await within(picker).findByText('Tavily')
    within(picker).getByText('Web search')

    // Choosing a library entry pre-fills the form from the harness's own
    // answer: the display name defaults to the vendor, and no base URL is
    // demanded because the library carries the vendor's own.
    fireEvent.click(within(picker).getByText('Tavily'))
    fireEvent.change(within(picker).getByLabelText('API key'), { target: { value: CANARY } })
    fireEvent.click(within(picker).getByRole('button', { name: 'Add and check' }))

    await waitFor(() => {
      expect(calls.some((call) => call.method === 'POST' && call.url.endsWith('/connections'))).toBe(true)
    })
    const sent: unknown = JSON.parse(
      calls.find((call) => call.method === 'POST' && call.url.endsWith('/connections'))?.body ?? '{}',
    )
    expect(sent).toMatchObject({
      id: 'tavily',
      displayName: 'Tavily',
      kind: 'retrieval',
      catalogProvider: 'tavily',
      protocol: 'tavily',
      apiKey: CANARY,
    })
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
  it('asks first, names the connection, and says what happens to the key', async () => {
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

describe('the capability defaults', () => {
  it('renders every slot and refuses to offer a picker nothing can fill', async () => {
    harnessConfigured()
    stubFetch()
    render(<ProvidersPane />)
    await screen.findByText('Work Anthropic')

    // Nine slots, in the contract's order, from the one derived list.
    for (const label of [
      'Chat',
      'Images',
      'Image editing',
      'Video',
      'Speech',
      'Transcription',
      'Embeddings',
      'Web search',
      'Web fetch',
    ]) {
      expect(screen.getByText(label)).toBeTruthy()
    }

    // The only model on screen has textGeneration supported; the image slots
    // have nothing fillable and say so with the one honest sentence about
    // what would invoke them, rather than rendering a dead picker.
    expect(screen.getAllByText(/No model with images is connected/)).toHaveLength(1)
    expect(screen.getAllByText(/studio-image tool arrives in a later update/)).toHaveLength(2)
    expect(screen.getByText(/No model with image editing is connected/)).toBeTruthy()
  })

  it('shows the one honest sentence where the invocation would be', async () => {
    harnessConfigured()
    stubFetch()
    render(<ProvidersPane />)
    await screen.findByText('Work Anthropic')

    // Both image slots name the same future server, so the sentence appears
    // twice; the video slot names its own, and web search - which is invoked
    // today - gets no invocation sentence at all.
    expect(screen.getAllByText(/studio-image tool arrives in a later update/)).toHaveLength(2)
    expect(screen.getByText(/studio-video tool arrives in a later update/)).toBeTruthy()
    expect(screen.getByText(/Connect a provider serving web search/)).toBeTruthy()
  })

  it('writes a default through PUT with the contract reference', async () => {
    harnessConfigured()
    const calls = stubFetch()
    render(<ProvidersPane />)
    await screen.findByText('Work Anthropic')

    fireEvent.click(screen.getAllByText('Choose')[0])
    fireEvent.click(screen.getByText('claude-opus-5'))

    await waitFor(() => {
      expect(calls.some((call) => call.method === 'PUT' && call.url.includes('/defaults/'))).toBe(true)
    })
    const put = calls.find((call) => call.method === 'PUT')
    expect(put?.url).toBe(`${BASE_URL}/api/providers/defaults/textGeneration`)
    expect(put?.body).toBe(
      JSON.stringify({ connectionId: KNOWN_VENDOR.id, modelId: 'claude-opus-5' }),
    )
  })
})
