/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * Which way a harness request goes out, and when that is decided.
 *
 * The command itself is not under test — it is ours but it lives in Rust,
 * with its own tests there (`src-tauri/src/services.rs`). The invoke is
 * replaced with a spy so the only thing these assertions can be about is the
 * dispatch: did we pick the right destination, did we send it a path and a
 * service id rather than a URL, and did we pick late enough.
 *
 * "Late enough" is the point of the per-call tests. A module-scope
 * `const transport = isTauri() ? a : b` would evaluate once, at import, and
 * `window.__TAURI_INTERNALS__` is injected by the webview on its own schedule
 * — so the wrong answer would be cached forever. The harness shipped this
 * exact bug in `net/own-ports.ts`; the fix there and here is to read on every
 * call. These tests are what stop it coming back.
 */

/** The payload shape the command receives, so the spy's assertions are typed. */
interface ServiceFetchArgs {
  service: string
  path: string
  init: {
    method?: string
    headers: ReadonlyArray<readonly [string, string]>
    body?: string
  }
}

const invoke = vi.fn(async (_command: string, _args: ServiceFetchArgs): Promise<unknown> => undefined)

vi.mock('@tauri-apps/api/core', () => ({ invoke }))

const { harnessTransport } = await import('./transport')

/** Makes `isTauri()` answer true, the way the webview does at runtime. */
function enterTauri() {
  Object.defineProperty(window, '__TAURI_INTERNALS__', {
    value: {},
    configurable: true,
    writable: true,
  })
}

function leaveTauri() {
  Reflect.deleteProperty(window, '__TAURI_INTERNALS__')
}

afterEach(() => {
  leaveTauri()
  vi.unstubAllGlobals()
  invoke.mockReset()
})

describe('outside Tauri', () => {
  it('goes through the global fetch', async () => {
    const global = vi.fn(async () => new Response('from the global'))
    vi.stubGlobal('fetch', global)

    const response = await harnessTransport('http://127.0.0.1:4319/api/providers/connections')

    expect(await response.text()).toBe('from the global')
    expect(global).toHaveBeenCalledTimes(1)
    expect(invoke).not.toHaveBeenCalled()
  })

  it('passes the request and its init through untouched', async () => {
    const global = vi.fn(async () => new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', global)

    const signal = new AbortController().signal
    await harnessTransport('http://127.0.0.1:4319/api/providers/connections', {
      method: 'POST',
      headers: { Authorization: 'Bearer a-credential' },
      body: '{}',
      signal,
    })

    expect(global).toHaveBeenCalledWith('http://127.0.0.1:4319/api/providers/connections', {
      method: 'POST',
      headers: { Authorization: 'Bearer a-credential' },
      body: '{}',
      signal,
    })
  })
})

describe('inside Tauri', () => {
  it('goes through the service seam instead, sending a path and a service id', async () => {
    const global = vi.fn(async () => new Response('from the global'))
    vi.stubGlobal('fetch', global)
    enterTauri()
    invoke.mockResolvedValueOnce({
      status: 200,
      headers: [['content-type', 'application/json']],
      body: '[]',
    })

    const response = await harnessTransport(
      'http://127.0.0.1:4319/api/providers/models?kind=anthropic',
      { method: 'GET', headers: { Authorization: 'Bearer host-attached' } },
    )

    expect(await response.text()).toBe('[]')
    expect(response.status).toBe(200)
    expect(global).not.toHaveBeenCalled()
    expect(invoke).toHaveBeenCalledTimes(1)

    const [command, payload] = invoke.mock.calls[0]
    expect(command).toBe('service_fetch')
    expect(payload.service).toBe('harness')
    // A path, query included — not the URL. Rust re-addresses it.
    expect(payload.path).toBe('/api/providers/models?kind=anthropic')
    expect(payload.init.method).toBe('GET')
    // Lowercased by the Headers normalisation; replaced by Rust before it
    // reaches the harness either way.
    expect(payload.init.headers).toEqual([['authorization', 'Bearer host-attached']])
    expect(payload.init.body).toBeUndefined()
  })

  it('rebuilds a 204 without a body, which the Response constructor refuses to take', async () => {
    enterTauri()
    invoke.mockResolvedValueOnce({ status: 204, headers: [], body: '' })

    const response = await harnessTransport(
      'http://127.0.0.1:4319/api/providers/connections/abc',
      { method: 'DELETE' },
    )

    expect(response.status).toBe(204)
    expect(await response.text()).toBe('')
  })

  it('surfaces a not-running service as a distinguishable error', async () => {
    enterTauri()
    invoke.mockRejectedValueOnce({ kind: 'not-running' })

    const request = harnessTransport('http://127.0.0.1:4319/api/providers/connections')

    await expect(request).rejects.toMatchObject({
      name: 'ServiceFetchError',
      kind: 'not-running',
      message: 'The harness is not running.',
    })
  })

  it('refuses without dispatching when the signal is already aborted', async () => {
    enterTauri()
    const controller = new AbortController()
    controller.abort()

    await expect(
      harnessTransport('http://127.0.0.1:4319/api/providers/connections', {
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(invoke).not.toHaveBeenCalled()
  })

  it('stops waiting when the caller aborts mid-flight, the way fetch does', async () => {
    enterTauri()
    invoke.mockImplementationOnce(() => new Promise(() => {}))
    const controller = new AbortController()

    const request = harnessTransport('http://127.0.0.1:4319/api/providers/connections', {
      signal: controller.signal,
    })
    controller.abort()

    await expect(request).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('the choice is made per call', () => {
  it('follows the environment when it changes after import', async () => {
    // The same module instance, asked twice, answering differently. If the
    // branch were evaluated at import this could not happen: the first answer
    // would be the only answer for the life of the process.
    const global = vi.fn(async () => new Response('from the global'))
    vi.stubGlobal('fetch', global)

    await harnessTransport('http://127.0.0.1:4319/first')
    expect(global).toHaveBeenCalledTimes(1)
    expect(invoke).not.toHaveBeenCalled()

    enterTauri()
    invoke.mockResolvedValueOnce({ status: 200, headers: [], body: 'ok' })
    await harnessTransport('http://127.0.0.1:4319/second')

    expect(invoke).toHaveBeenCalledTimes(1)
    expect(global).toHaveBeenCalledTimes(1)
  })

  it('reads globalThis.fetch fresh every time rather than binding it once', async () => {
    // A client can outlive a stub swap. `globalThis.fetch.bind(globalThis)`
    // captured at construction would keep calling the first one.
    const first = vi.fn(async () => new Response('first'))
    vi.stubGlobal('fetch', first)
    await harnessTransport('http://127.0.0.1:4319/one')

    const second = vi.fn(async () => new Response('second'))
    vi.stubGlobal('fetch', second)
    const response = await harnessTransport('http://127.0.0.1:4319/two')

    expect(await response.text()).toBe('second')
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
  })
})
