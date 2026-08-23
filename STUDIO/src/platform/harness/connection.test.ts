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
