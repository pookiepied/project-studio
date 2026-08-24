/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * The half of `resolveHarnessAddress` that runs inside Tauri.
 *
 * The other half — the browser-branch env reads — is covered by
 * `connection.test.ts`, which runs outside Tauri. These tests need a `window`
 * to enter Tauri with and a mocked invoke, because the real command answers
 * with a supervisor this environment does not have.
 *
 * The case that matters most is still the credential: inside Tauri the result
 * must carry the host-attached marker, never a bearer, because the bearer is
 * Rust's to attach and nothing here should ever be able to learn it.
 */

const invoke = vi.fn(async (_command: string, _args?: unknown): Promise<unknown> => undefined)

vi.mock('@tauri-apps/api/core', () => ({ invoke }))

const { resolveHarnessAddress } = await import('./connection')

function enterTauri() {
  Object.defineProperty(window, '__TAURI_INTERNALS__', {
    value: {},
    configurable: true,
    writable: true,
  })
}

/** The shape `get_harness_status` answers with when the supervisor is up. */
function runningStatus(url: string) {
  return {
    state: 'running',
    endpoint: {
      host: '127.0.0.1',
      port: 4319,
      pid: 1234,
      url,
      clientId: 'studio-host',
      sessionId: 'sess',
    },
    error: null,
  }
}

afterEach(() => {
  Reflect.deleteProperty(window, '__TAURI_INTERNALS__')
  vi.unstubAllEnvs()
  invoke.mockReset()
})

describe('resolveHarnessAddress inside Tauri', () => {
  it('resolves the address from the supervisor status, with the host-attached marker in place of a credential', async () => {
    enterTauri()
    invoke.mockResolvedValueOnce(runningStatus('http://127.0.0.1:4319'))

    await expect(resolveHarnessAddress()).resolves.toEqual({
      baseUrl: 'http://127.0.0.1:4319',
      credential: 'host-attached',
    })
    expect(invoke).toHaveBeenCalledWith('get_harness_status')
  })

  it('returns null unless the supervisor reports running', async () => {
    enterTauri()
    for (const state of ['stopped', 'failed']) {
      invoke.mockResolvedValueOnce({
        state,
        endpoint: null,
        error: state === 'failed' ? 'the harness did not start' : null,
      })

      await expect(resolveHarnessAddress()).resolves.toBeNull()
    }
  })

  it('treats a status that cannot be answered as no harness, not an error', async () => {
    // The hook that calls this has no error state for a thrown command to
    // become; wedging its pane on "loading" forever would be the alternative.
    enterTauri()
    invoke.mockRejectedValueOnce(new Error('the command exploded'))

    await expect(resolveHarnessAddress()).resolves.toBeNull()
  })

  it('ignores the env vars the browser branch would have read', async () => {
    enterTauri()
    vi.stubEnv('VITE_HARNESS_BASE_URL', 'http://127.0.0.1:9999')
    vi.stubEnv('VITE_HARNESS_TOKEN', 'a-credential')
    invoke.mockResolvedValueOnce(runningStatus('http://127.0.0.1:4319'))

    const address = await resolveHarnessAddress()

    expect(address).not.toBeNull()
    expect(address?.baseUrl).toBe('http://127.0.0.1:4319')
    expect(address?.credential).toBe('host-attached')
  })

  it('refuses a status URL that is not http rather than repairing it', async () => {
    enterTauri()
    invoke.mockResolvedValueOnce(runningStatus('file:///etc/passwd'))

    await expect(resolveHarnessAddress()).resolves.toBeNull()
  })
})
