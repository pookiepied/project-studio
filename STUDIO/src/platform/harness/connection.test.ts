import { afterEach, describe, expect, it, vi } from 'vitest'

import { resolveHarnessAddress } from './connection'

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
