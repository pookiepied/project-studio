/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ProvidersPane } from './ProvidersPane'
import { CAPABILITY, KNOWN_VENDOR, UNKNOWN_VENDOR, modelFor } from './harness.fixtures'
import type { ModelCapability, ProviderModel } from '@/platform/harness'

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
  // The pairing state route is not a harness route: with no harness configured
  // the resolver still asks whether this page was served by Studio's listener,
  // and this stub is not the listener. 404 is what a host that is not Studio
  // answers, and it keeps the resolver on the no-harness path.
  if (url.includes('/api/pairing/state')) return new Response(null, { status: 404 })
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
    render(<ProvidersPane kind="language" />)

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
    render(<ProvidersPane kind="language" />)

    await screen.findByText(/No harness is connected/)

    // The pairing state route is the one exception, and it is identity, not a
    // harness call: the resolver asks whether this page was served by Studio's
    // listener before it concludes there is no harness. Everything a harness
    // would have been asked must still be absent.
    const harness = calls.filter((call) => call.url !== '/api/pairing/state')
    expect(harness).toHaveLength(0)
  })
})

describe('when the load fails', () => {
  it('renders the failure rather than an empty list', async () => {
    harnessConfigured()
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('fetch failed')
    })
    render(<ProvidersPane kind="language" />)

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
    render(<ProvidersPane kind="language" />)

    await screen.findByText('Harness admission is required.')
  })
})

describe('the list', () => {
  it('renders each connection with its offer and credential status', async () => {
    harnessConfigured()
    stubFetch()
    render(<ProvidersPane kind="language" />)

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
    const { container } = render(<ProvidersPane kind="language" />)
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
    render(<ProvidersPane kind="language" />)
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
    render(<ProvidersPane kind="language" />)
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
    render(<ProvidersPane kind="language" />)
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
      serves: { language: 'openai-completions' },
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
    render(<ProvidersPane kind="language" />)
    await screen.findByText('Work Anthropic')

    openCustomForm()
    const field = screen.getByLabelText('API key')

    expect(field.getAttribute('type')).toBe('password')
    expect(field.getAttribute('autocomplete')).toBe('off')
  })

  it('omits the key entirely when none was typed', async () => {
    harnessConfigured()
    const calls = stubFetch()
    render(<ProvidersPane kind="language" />)
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
    render(<ProvidersPane kind="language" />)
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
    render(<ProvidersPane kind="language" />)
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
            serves: { language: 'openai-completions' },
            capabilities: ['textGeneration', 'imageGeneration'],
            modelCount: 28,
          },
          {
            id: 'tavily',
            displayName: 'Tavily',
            serves: { retrieval: 'tavily' },
            capabilities: ['webSearch'],
            modelCount: 2,
          },
        ])
      }
      return defaultRoute(url, method)
    })
    // The Models page offers the vendors that serve language and no other:
    // Tavily serves only retrieval, and belongs to the Tools page.
    const models = render(<ProvidersPane kind="language" />)
    await screen.findByText('Work Anthropic')
    fireEvent.click(screen.getByText('Add connection'))
    const languagePicker = dialog('Add connection')
    await within(languagePicker).findByText('OpenAI')
    within(languagePicker).getByText('Chat - Images')
    expect(within(languagePicker).queryByText('Tavily')).toBeNull()
    models.unmount()

    render(<ProvidersPane kind="retrieval" />)
    await screen.findByText('Add connection')
    fireEvent.click(screen.getByText('Add connection'))
    const picker = dialog('Add connection')
    await within(picker).findByText('Tavily')
    within(picker).getByText('Web search')
    expect(within(picker).queryByText('OpenAI')).toBeNull()
    // No custom endpoint here: a self-hosted endpoint speaks a language wire.
    expect(within(picker).queryByText('Custom endpoint')).toBeNull()

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
      serves: { retrieval: 'tavily' },
      catalogProvider: 'tavily',
      apiKey: CANARY,
    })
  })
})

/**
 * The harness's answer for an OpenRouter connection, shaped like the real one:
 * 121 models the vendor lists as media (54 image, 29 video, 18 speech, 20
 * transcription - the plan's own count), 12 it lists as language, and one -
 * `google/gemini-3-pro-image`, joined by the catalog - that both chats and
 * paints. The Media page has to offer all 122 and offer each once; a filter
 * that lets the twelve through, drops the joined one, or duplicates it, is the
 * leak this pins.
 */
const OPENROUTER_CONNECTION = {
  id: 'openrouter',
  displayName: 'OpenRouter',
  serves: { language: 'openai-completions', media: 'openrouter' },
  source: 'local' as const,
  enabled: true,
  catalogProvider: 'openrouter',
  credential: 'set' as const,
}

function mediaCapable(id: string, capability: Partial<ModelCapability>): ProviderModel {
  return {
    ...modelFor(OPENROUTER_CONNECTION.id, id),
    capability: { ...CAPABILITY, textGeneration: 'unsupported', ...capability },
  }
}

function theHarnessAnswer(): ProviderModel[] {
  const counted = (kind: string, count: number, capability: Partial<ModelCapability>): ProviderModel[] =>
    Array.from({ length: count }, (_, at) => mediaCapable(`stand-in/${kind}-${at}`, capability))
  return [
    ...counted('image', 54, { imageGeneration: 'supported' }),
    ...counted('video', 29, { videoGeneration: 'supported' }),
    ...counted('speech', 18, { speechGeneration: 'supported' }),
    ...counted('transcription', 20, { transcription: 'supported' }),
    ...Array.from({ length: 12 }, (_, at) => modelFor(OPENROUTER_CONNECTION.id, `stand-in/chat-${at}`)),
    // The joined model: one id, both truths. It keeps its textGeneration,
    // which is what the join preserves, and gains the image half.
    {
      ...modelFor(OPENROUTER_CONNECTION.id, 'google/gemini-3-pro-image'),
      capability: {
        ...CAPABILITY,
        imageGeneration: 'supported',
        imageEditing: 'supported',
        vision: 'supported',
      },
    },
  ]
}

describe('the Media page against a 121-model answer', () => {
  it('offers all 122, each once, and keeps a two-way model on both of its pages', async () => {
    harnessConfigured()
    stubFetch((url, method) => {
      if (method === 'GET' && url.endsWith('/connections')) return jsonResponse([OPENROUTER_CONNECTION])
      if (url.includes('/models')) return jsonResponse(theHarnessAnswer())
      return defaultRoute(url, method)
    })

    const media = render(<ProvidersPane kind="media" />)
    await screen.findByText('OpenRouter')
    expect(screen.getByText('122 of 122 models offered')).toBeTruthy()

    fireEvent.click(screen.getByLabelText('OpenRouter options'))
    fireEvent.click(screen.getByText('Show models'))
    expect(screen.getAllByRole('checkbox')).toHaveLength(122)
    expect(screen.getByLabelText('Offer google/gemini-3-pro-image')).toBeTruthy()
    media.unmount()

    // The same id answers the Models page too, where it chats: 12 language
    // models plus the one it shares with the media half.
    render(<ProvidersPane kind="language" />)
    await screen.findByText('OpenRouter')
    expect(screen.getByText('13 of 13 models offered')).toBeTruthy()
  })
})

describe('the Tools page', () => {  it('calls what a connection offers a service, not a model', async () => {
    harnessConfigured()
    const brave = {
      ...KNOWN_VENDOR,
      id: 'brave',
      displayName: 'Brave Search',
      catalogProvider: 'brave',
      serves: { retrieval: 'brave' },
    }
    stubFetch((url, method) => {
      if (url.includes('/models')) {
        return jsonResponse([
          {
            ...modelFor('brave', 'brave-search'),
            capability: { ...CAPABILITY, textGeneration: 'unsupported', webSearch: 'supported' },
          },
        ])
      }
      if (method === 'GET' && url.endsWith('/connections')) return jsonResponse([brave])
      return defaultRoute(url, method)
    })
    render(<ProvidersPane kind="retrieval" />)
    await screen.findByText('Brave Search')
    expect(screen.getByText('1 of 1 services offered')).toBeTruthy()
    expect(screen.queryByText(/models offered/)).toBeNull()
  })
})

describe('enable and disable', () => {
  it('patches only the enabled flag', async () => {
    harnessConfigured()
    const calls = stubFetch()
    render(<ProvidersPane kind="language" />)
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
    render(<ProvidersPane kind="language" />)
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
    render(<ProvidersPane kind="language" />)
    await screen.findByText('Work Anthropic')

    fireEvent.click(screen.getByLabelText('Work Anthropic options'))
    fireEvent.click(screen.getByText('Remove'))
    fireEvent.click(within(dialog('Remove connection')).getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(screen.queryByText('Remove Work Anthropic?')).toBeNull())
    expect(calls.some((call) => call.method === 'DELETE')).toBe(false)
  })
})

describe('the capability defaults', () => {
  it("renders each page's slots, and refuses to offer a picker nothing can fill", async () => {
    harnessConfigured()
    stubFetch()
    // The Models page has the one language slot and none of the others.
    const models = render(<ProvidersPane kind="language" />)
    await screen.findByText('Work Anthropic')
    expect(screen.getByText('Chat')).toBeTruthy()
    for (const label of ['Images', 'Video', 'Speech', 'Web search']) {
      expect(screen.queryByText(label)).toBeNull()
    }
    models.unmount()

    // The Media page has the six media slots, in the contract's order. The
    // only model the harness knows has textGeneration supported, so nothing
    // fills an image slot and the row says so rather than rendering a dead
    // picker.
    render(<ProvidersPane kind="media" />)
    await screen.findByText('Images')
    for (const label of ['Images', 'Image editing', 'Video', 'Speech', 'Transcription', 'Embeddings']) {
      expect(screen.getByText(label)).toBeTruthy()
    }
    expect(screen.queryByText('Chat')).toBeNull()
    expect(screen.getByText(/Connect a provider serving images to fill this slot/)).toBeTruthy()
    expect(screen.getByText(/Connect a provider serving image editing to fill this slot/)).toBeTruthy()
  })

  it('shows the one honest sentence only where nothing invokes the slot yet', async () => {
    harnessConfigured()
    stubFetch()
    render(<ProvidersPane kind="media" />)
    await screen.findByText('Images')

    // The image, video and voice slots are invoked now - the studio tools
    // and the read-aloud and dictation features - so they carry no such
    // sentence; embeddings still has no consumer, and says so once.
    expect(screen.getAllByText(/in a later update/)).toHaveLength(1)
    expect(screen.getByText(/No model with embeddings is connected.*embed through it/)).toBeTruthy()
  })

  it('writes a default through PUT with the contract reference', async () => {
    harnessConfigured()
    const calls = stubFetch()
    render(<ProvidersPane kind="language" />)
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
