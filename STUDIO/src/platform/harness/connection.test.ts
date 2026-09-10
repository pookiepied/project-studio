import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  harnessFailureReason,
  httpHarnessStatus,
  resolveHarnessAddress,
  startHarness,
} from './connection'

/**
 * The one module that decides where the harness is.
 *
 * The case that matters most is the absent one: with nothing configured the
 * app must run exactly as it does today, with no harness and no requests. A
 * bug here that returned a half-built address would send the whole UI down a
 * network path that cannot succeed.
 */

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('resolveHarnessAddress', () => {
  it('returns null when neither variable is set', async () => {
    vi.stubEnv('VITE_HARNESS_BASE_URL', undefined)
    vi.stubEnv('VITE_HARNESS_TOKEN', undefined)

    await expect(resolveHarnessAddress()).resolves.toBeNull()
  })

  it('returns null when only the address is set', async () => {
    vi.stubEnv('VITE_HARNESS_BASE_URL', 'http://127.0.0.1:4319')
    vi.stubEnv('VITE_HARNESS_TOKEN', undefined)

    await expect(resolveHarnessAddress()).resolves.toBeNull()
  })

  it('returns null when only the credential is set', async () => {
    vi.stubEnv('VITE_HARNESS_BASE_URL', undefined)
    vi.stubEnv('VITE_HARNESS_TOKEN', 'a-credential')

    await expect(resolveHarnessAddress()).resolves.toBeNull()
  })

  it('treats an empty or whitespace value as unset', async () => {
    vi.stubEnv('VITE_HARNESS_BASE_URL', '  ')
    vi.stubEnv('VITE_HARNESS_TOKEN', '')

    await expect(resolveHarnessAddress()).resolves.toBeNull()
  })

  it('returns the address when both are set', async () => {
    vi.stubEnv('VITE_HARNESS_BASE_URL', 'http://127.0.0.1:4319')
    vi.stubEnv('VITE_HARNESS_TOKEN', 'a-credential')

    await expect(resolveHarnessAddress()).resolves.toEqual({
      baseUrl: 'http://127.0.0.1:4319',
      credential: 'a-credential',
    })
  })

  it('trims surrounding whitespace and a trailing slash', async () => {
    vi.stubEnv('VITE_HARNESS_BASE_URL', '  http://127.0.0.1:4319/  ')
    vi.stubEnv('VITE_HARNESS_TOKEN', ' a-credential ')

    await expect(resolveHarnessAddress()).resolves.toEqual({
      baseUrl: 'http://127.0.0.1:4319',
      credential: 'a-credential',
    })
  })

  it('refuses an address that is not an http URL rather than repairing it', async () => {
    // Prepending a scheme would send the credential somewhere nobody named.
    vi.stubEnv('VITE_HARNESS_BASE_URL', '127.0.0.1:4319')
    vi.stubEnv('VITE_HARNESS_TOKEN', 'a-credential')

    await expect(resolveHarnessAddress()).resolves.toBeNull()
  })

  it('refuses a non-http scheme', async () => {
    vi.stubEnv('VITE_HARNESS_BASE_URL', 'file:///etc/passwd')
    vi.stubEnv('VITE_HARNESS_TOKEN', 'a-credential')

    await expect(resolveHarnessAddress()).resolves.toBeNull()
  })
})

/**
 * The listener-served browser (ADR 0050): the page's own origin is the
 * address, and the proof that this page came from Studio at all is the state
 * route answering. Only the listener serves that path, so an answer is
 * identity — but only in its exact shape, and only with a 200.
 */
describe('resolveHarnessAddress, served by the listener', () => {
  it('answers with the page’s own origin when the listener answers, paired or not', async () => {
    for (const paired of [true, false]) {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => aJson({ ok: true, status: 200, json: { paired } })),
      )
      await expect(resolveHarnessAddress()).resolves.toEqual({
        baseUrl: '',
        credential: 'host-attached',
      })
    }
  })

  it('returns null when the route is not served here', async () => {
    // `vite dev` and a static host 404 the path; the app then runs with no
    // harness, exactly as it did before the listener existed.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => aJson({ ok: false, status: 404, json: {} })),
    )
    await expect(resolveHarnessAddress()).resolves.toBeNull()
  })

  it('returns null when nothing answers at all', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('failed to fetch'))))
    await expect(resolveHarnessAddress()).resolves.toBeNull()
  })

  it('returns null when the answer is not the listener’s shape', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => aJson({ ok: true, status: 200, json: { paired: 'yes' } })),
    )
    await expect(resolveHarnessAddress()).resolves.toBeNull()
  })

  it('returns null when the body is not an object', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => aJson({ ok: true, status: 200, json: 42 })),
    )
    await expect(resolveHarnessAddress()).resolves.toBeNull()
  })

  it('never asks when dev configuration already named the harness', async () => {
    vi.stubEnv('VITE_HARNESS_BASE_URL', 'http://127.0.0.1:4319')
    vi.stubEnv('VITE_HARNESS_TOKEN', 'a-credential')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(resolveHarnessAddress()).resolves.toEqual({
      baseUrl: 'http://127.0.0.1:4319',
      credential: 'a-credential',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

function aJson(body: { ok: boolean; status: number; json: unknown }): Response {
  return {
    ok: body.ok,
    status: body.status,
    json: () => Promise.resolve(body.json),
  } as Response
}

/**
 * The supervisor's answers over HTTP (step 6): the status a paired device's
 * page reads, the restart it can ask for. None of it exists on an origin
 * Studio does not serve — a 404 there is the same absence the Tauri command
 * failing is inside the webview.
 */
describe('httpHarnessStatus', () => {
  it('reads the supervisor route the listener answers', async () => {
    const fetchMock = vi.fn(async () =>
      aJson({
        ok: true,
        status: 200,
        json: { state: 'running', endpoint: { url: 'http://127.0.0.1:4319' }, error: null },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(httpHarnessStatus()).resolves.toEqual({
      state: 'running',
      endpoint: { url: 'http://127.0.0.1:4319' },
      error: null,
    })
    expect(fetchMock).toHaveBeenCalledWith('/api/harness/status')
  })

  it('is null when the route is not served here', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => aJson({ ok: false, status: 404, json: {} })))

    await expect(httpHarnessStatus()).resolves.toBeNull()
  })

  it('is null when nothing answers', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('failed to fetch'))))

    await expect(httpHarnessStatus()).resolves.toBeNull()
  })

  it('is null when the answer is not a status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => aJson({ ok: true, status: 200, json: { hello: 1 } })))

    await expect(httpHarnessStatus()).resolves.toBeNull()
  })
})

describe('startHarness, in a browser', () => {
  it('asks the process that served the page, by POST', async () => {
    const fetchMock = vi.fn(async () =>
      aJson({
        ok: true,
        status: 200,
        json: { state: 'running', endpoint: { url: 'http://127.0.0.1:4319' }, error: null },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(startHarness()).resolves.toBe(true)
    expect(fetchMock).toHaveBeenCalledWith('/api/harness/restart', { method: 'POST' })
  })

  it('says no when the supervisor refused the start', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => aJson({ ok: false, status: 500, json: { error: 'no harness to start' } })),
    )

    await expect(startHarness()).resolves.toBe(false)
  })

  it('says no when there is no Studio behind the page', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => aJson({ ok: false, status: 404, json: {} })))

    await expect(startHarness()).resolves.toBe(false)
  })

  it('says no when the network refuses the request outright', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('failed to fetch'))))

    await expect(startHarness()).resolves.toBe(false)
  })
})

describe('harnessFailureReason, in a browser', () => {
  it('carries the supervisor’s own sentence for a failed start', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        aJson({
          ok: true,
          status: 200,
          json: { state: 'failed', endpoint: null, error: 'The harness could not be started.' },
        }),
      ),
    )

    await expect(harnessFailureReason()).resolves.toBe('The harness could not be started.')
  })

  it('is null while the harness is fine', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        aJson({
          ok: true,
          status: 200,
          json: { state: 'running', endpoint: { url: 'http://127.0.0.1:4319' }, error: null },
        }),
      ),
    )

    await expect(harnessFailureReason()).resolves.toBeNull()
  })

  it('is null when nobody answers', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => aJson({ ok: false, status: 404, json: {} })))

    await expect(harnessFailureReason()).resolves.toBeNull()
  })
})
