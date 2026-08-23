import { describe, expect, it } from 'vitest'

import { createHarnessClient, type HarnessClient, type HarnessResult } from './client'
import type { ProviderConnection } from './contracts'

/**
 * The transport, proved against a stubbed fetch.
 *
 * Nothing here needs a running harness. What is being tested is the part
 * STUDIO owns: that the credential goes out on every call, that a body which
 * does not match the contract is refused instead of returned, that the three
 * failure kinds land on the right cases, and -- the one that matters most --
 * that a key-shaped field in a response cannot survive into a parsed record.
 */

const BASE_URL = 'http://127.0.0.1:4319'
const CREDENTIAL = 'test-credential-value'

/** A well-formed connection exactly as `GET /connections` returns them. */
const CONNECTION = {
  id: 'work-openai',
  displayName: 'Work OpenAI',
  kind: 'language',
  source: 'local',
  baseUrl: 'https://api.openai.com/v1',
  enabled: true,
  catalogProvider: 'openai',
  credential: 'set',
  protocol: 'openai-responses',
} as const

const CAPABILITY = {
  textGeneration: 'supported',
  streaming: 'supported',
  reasoning: 'unknown',
  toolCalling: 'supported',
  vision: 'unsupported',
  embeddings: 'unsupported',
  reranking: 'unsupported',
  imageGeneration: 'unsupported',
  videoGeneration: 'unsupported',
  speechGeneration: 'unsupported',
  transcription: 'unsupported',
  contextWindow: 200000,
  maxOutputTokens: 'unknown',
} as const

const MODEL = {
  connectionId: 'work-openai',
  modelId: 'gpt-5',
  displayName: 'GPT-5',
  capability: CAPABILITY,
  shape: 'stream',
  pricing: { input: 1.25, output: 10, cacheRead: 'unknown', cacheWrite: 'unknown' },
  hidden: false,
  origin: 'catalog',
} as const

const PROBE = { ok: true, reachedAt: 1_700_000_000_000, modelCount: 42, latencyMs: 91 } as const

interface Recorded {
  readonly url: string
  readonly method: string
  readonly authorization: string | null
  readonly body: string | null
}

interface Stub {
  readonly fetch: typeof globalThis.fetch
  readonly calls: readonly Recorded[]
}

/**
 * A fetch that records what it was asked to send and answers with whatever the
 * test supplies. `reply` may throw, which is how a dead port is simulated.
 */
function stubFetch(reply: (url: string) => Response): Stub {
  const calls: Recorded[] = []
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = input instanceof URL ? input.toString() : String(input)
    const headers = new Headers(init?.headers)
    calls.push({
      url,
      method: init?.method ?? 'GET',
      authorization: headers.get('Authorization'),
      body: typeof init?.body === 'string' ? init.body : null,
    })
    return reply(url)
  }
  return { fetch, calls }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function clientWith(fetch: typeof globalThis.fetch): HarnessClient {
  return createHarnessClient({ baseUrl: BASE_URL, credential: CREDENTIAL, fetch })
}

/**
 * Every method, called the same way, so a test can assert something about all
 * six without repeating six call sites. The bodies are minimal but valid.
 */
const METHODS: readonly {
  readonly name: string
  readonly call: (client: HarnessClient) => Promise<HarnessResult<unknown>>
}[] = [
  { name: 'listConnections', call: (client) => client.listConnections() },
  {
    name: 'createConnection',
    call: (client) =>
      client.createConnection({
        id: 'work-openai',
        displayName: 'Work OpenAI',
        kind: 'language',
        source: 'local',
        enabled: true,
        protocol: 'openai-responses',
        apiKey: 'sk-CANARY-DO-NOT-PERSIST',
      }),
  },
  {
    name: 'updateConnection',
    call: (client) => client.updateConnection('work-openai', { enabled: false }),
  },
  { name: 'deleteConnection', call: (client) => client.deleteConnection('work-openai') },
  { name: 'probeConnection', call: (client) => client.probeConnection('work-openai') },
  { name: 'listModels', call: (client) => client.listModels({ kind: 'language' }) },
]

/** Whatever each route legitimately answers with, so success paths succeed. */
function replyForRoute(url: string): Response {
  if (url.endsWith('/probe')) return jsonResponse(PROBE)
  if (url.includes('/models')) return jsonResponse([MODEL])
  if (url.endsWith('/connections')) return jsonResponse([CONNECTION])
  return jsonResponse(CONNECTION)
}

describe('the credential', () => {
  it('is sent as Authorization: Bearer on every method', async () => {
    for (const method of METHODS) {
      const stub = stubFetch(replyForRoute)
      await method.call(clientWith(stub.fetch))

      expect(stub.calls, `${method.name} made exactly one request`).toHaveLength(1)
      expect(stub.calls[0]?.authorization, `${method.name} sent the credential`).toBe(
        `Bearer ${CREDENTIAL}`,
      )
    }
  })

  it('never appears in a URL', async () => {
    for (const method of METHODS) {
      const stub = stubFetch(replyForRoute)
      await method.call(clientWith(stub.fetch))
      expect(stub.calls[0]?.url).not.toContain(CREDENTIAL)
    }
  })
})

describe('routes', () => {
  it('addresses the harness provider surface', async () => {
    const seen: string[] = []
    for (const method of METHODS) {
      const stub = stubFetch(replyForRoute)
      await method.call(clientWith(stub.fetch))
      const call = stub.calls[0]
      if (call !== undefined) seen.push(`${call.method} ${call.url}`)
    }

    expect(seen).toEqual([
      `GET ${BASE_URL}/api/providers/connections`,
      `POST ${BASE_URL}/api/providers/connections`,
      `PATCH ${BASE_URL}/api/providers/connections/work-openai`,
      `DELETE ${BASE_URL}/api/providers/connections/work-openai`,
      `POST ${BASE_URL}/api/providers/connections/work-openai/probe`,
      `GET ${BASE_URL}/api/providers/models?kind=language`,
    ])
  })

  it('tolerates a trailing slash on the base URL', async () => {
    const stub = stubFetch(replyForRoute)
    const client = createHarnessClient({
      baseUrl: `${BASE_URL}/`,
      credential: CREDENTIAL,
      fetch: stub.fetch,
    })
    await client.listConnections()
    expect(stub.calls[0]?.url).toBe(`${BASE_URL}/api/providers/connections`)
  })
})

describe('a body that does not match the contract', () => {
  it('is rejected rather than returned', async () => {
    // `enabled` as a string, which TypeScript would have believed on the way
    // in and the harness would never send.
    const malformed = { ...CONNECTION, enabled: 'yes' }
    const stub = stubFetch(() => jsonResponse([malformed]))

    const result = await clientWith(stub.fetch).listConnections()

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe('malformed-response')
  })

  it('rejects a protocol that belongs to a different kind', async () => {
    // The discriminant is the point of the union: a language connection
    // cannot speak a retrieval protocol.
    const crossed = { ...CONNECTION, protocol: 'brave' }
    const stub = stubFetch(() => jsonResponse([crossed]))

    const result = await clientWith(stub.fetch).listConnections()

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe('malformed-response')
  })

  it('rejects a 200 whose body is not JSON at all', async () => {
    const stub = stubFetch(() => new Response('<html>not json</html>', { status: 200 }))

    const result = await clientWith(stub.fetch).listModels()

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe('malformed-response')
  })
})

describe('failures', () => {
  it('maps 401 to unauthorized and keeps the harness sentence', async () => {
    const stub = stubFetch(() =>
      jsonResponse(
        { error: 'Harness admission is required.', code: 'admission.unauthenticated' },
        401,
      ),
    )

    const result = await clientWith(stub.fetch).listConnections()

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe('unauthorized')
    expect(result.error.message).toBe('Harness admission is required.')
  })

  it('maps 403 to unauthorized as well, because the remedy is the same', async () => {
    const stub = stubFetch(() =>
      jsonResponse(
        {
          error: 'The authenticated client is not authorized for this operation.',
          code: 'admission.scope_required',
        },
        403,
      ),
    )

    const result = await clientWith(stub.fetch).listConnections()

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe('unauthorized')
    if (result.error.kind !== 'unauthorized') return
    expect(result.error.status).toBe(403)
  })

  it('maps a fetch that throws to not-reachable', async () => {
    const fetch: typeof globalThis.fetch = async () => {
      throw new TypeError('fetch failed')
    }

    const result = await clientWith(fetch).listConnections()

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe('not-reachable')
    if (result.error.kind !== 'not-reachable') return
    expect(result.error.timedOut).toBe(false)
    expect(result.error.message).toContain(BASE_URL)
  })

  it('maps a request that outlives the timeout to not-reachable, flagged', async () => {
    // Never resolves on its own; only the client's abort ends it.
    const fetch: typeof globalThis.fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
      })

    const client = createHarnessClient({
      baseUrl: BASE_URL,
      credential: CREDENTIAL,
      fetch,
      timeoutMs: 10,
    })
    const result = await client.probeConnection('work-openai')

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe('not-reachable')
    if (result.error.kind !== 'not-reachable') return
    expect(result.error.timedOut).toBe(true)
  })

  it('carries a harness-authored 400 through with its message and code', async () => {
    const stub = stubFetch(() =>
      jsonResponse(
        {
          error: 'Provider connection does not match the provider contract.',
          code: 'models.configuration',
        },
        400,
      ),
    )

    const result = await clientWith(stub.fetch).updateConnection('work-openai', {
      displayName: 'Renamed',
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe('harness-error')
    if (result.error.kind !== 'harness-error') return
    expect(result.error.status).toBe(400)
    expect(result.error.message).toBe(
      'Provider connection does not match the provider contract.',
    )
    expect(result.error.code).toBe('models.configuration')
  })

  it('still reports a failure when the error body is unreadable', async () => {
    const stub = stubFetch(() => new Response('gateway exploded', { status: 500 }))

    const result = await clientWith(stub.fetch).listConnections()

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe('harness-error')
    if (result.error.kind !== 'harness-error') return
    expect(result.error.status).toBe(500)
    expect(result.error.message).toContain('500')
  })

  it('does not retry', async () => {
    let attempts = 0
    const fetch: typeof globalThis.fetch = async () => {
      attempts += 1
      throw new TypeError('fetch failed')
    }

    await clientWith(fetch).listConnections()

    expect(attempts).toBe(1)
  })
})

describe('successes', () => {
  it('returns the parsed connections', async () => {
    const stub = stubFetch(() => jsonResponse([CONNECTION]))
    const result = await clientWith(stub.fetch).listConnections()

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toHaveLength(1)
    const connection: ProviderConnection | undefined = result.value[0]
    expect(connection?.id).toBe('work-openai')
    expect(connection?.credential).toBe('set')
  })

  it('returns nothing at all for a 204 delete', async () => {
    const stub = stubFetch(() => new Response(null, { status: 204 }))
    const result = await clientWith(stub.fetch).deleteConnection('work-openai')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toBeUndefined()
  })

  it('returns the parsed probe, including an unreachable provider', async () => {
    const stub = stubFetch(() =>
      jsonResponse({ ok: false, reachedAt: 1, failure: 'Connection refused.', status: 0 }),
    )
    const result = await clientWith(stub.fetch).probeConnection('work-openai')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.ok).toBe(false)
    expect(result.value.failure).toBe('Connection refused.')
    expect(result.value.modelCount).toBeUndefined()
  })

  it('sends only the filter keys it was given', async () => {
    const stub = stubFetch(() => jsonResponse([MODEL]))
    await clientWith(stub.fetch).listModels({ connectionId: 'work-openai' })

    expect(stub.calls[0]?.url).toBe(
      `${BASE_URL}/api/providers/models?connectionId=work-openai`,
    )
  })
})

describe('the api key', () => {
  const CANARY = 'sk-CANARY-DO-NOT-PERSIST'

  it('goes out in a create body and comes back in nothing', async () => {
    // A hostile or buggy harness echoing the key back is the case this guards.
    // The contract says a ProviderConnection never carries one; the parser is
    // what makes that true on this side rather than a promise.
    const stub = stubFetch(() =>
      jsonResponse({ ...CONNECTION, apiKey: CANARY, secret: CANARY }, 201),
    )

    const result = await clientWith(stub.fetch).createConnection({
      id: 'work-openai',
      displayName: 'Work OpenAI',
      kind: 'language',
      source: 'local',
      enabled: true,
      protocol: 'openai-responses',
      apiKey: CANARY,
    })

    // It was sent, once, in the request body -- that is the whole point of it.
    expect(stub.calls[0]?.body).toContain(CANARY)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(JSON.stringify(result.value)).not.toContain(CANARY)
    expect(Object.keys(result.value)).not.toContain('apiKey')
    expect(Object.keys(result.value)).not.toContain('secret')
  })

  it('does not survive a list either', async () => {
    const stub = stubFetch(() => jsonResponse([{ ...CONNECTION, apiKey: CANARY }]))

    const result = await clientWith(stub.fetch).listConnections()

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(JSON.stringify(result.value)).not.toContain(CANARY)
  })

  it('does not survive a patch that set it', async () => {
    const stub = stubFetch(() => jsonResponse({ ...CONNECTION, apiKey: CANARY }))

    const result = await clientWith(stub.fetch).updateConnection('work-openai', {
      apiKey: CANARY,
    })

    expect(stub.calls[0]?.body).toContain(CANARY)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(JSON.stringify(result.value)).not.toContain(CANARY)
  })
})
