/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * Which way a harness request goes out, and when that is decided.
 *
 * The plugin itself is not under test -- it is not ours, and it cannot run
 * outside a webview anyway. It is replaced with a spy so the only thing these
 * assertions can be about is the dispatch: did we pick the right destination,
 * and did we pick it late enough.
 *
 * "Late enough" is the point of the file. A module-scope
 * `const transport = isTauri() ? a : b` would evaluate once, at import, and
 * `window.__TAURI_INTERNALS__` is injected by the webview on its own schedule
 * -- so the wrong answer would be cached forever. The harness shipped this
 * exact bug in `net/own-ports.ts`; the fix there and here is to read on every
 * call. These tests are what stop it coming back.
 */

// Typed with the parameters it actually receives, so the spy's assertions are
// about the same call shape the real plugin would see.
const pluginFetch = vi.fn(
  async (_input: URL | Request | string, _init?: RequestInit) =>
    new Response('from the plugin'),
)

vi.mock('@tauri-apps/plugin-http', () => ({ fetch: pluginFetch }))

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
  pluginFetch.mockClear()
})

describe('outside Tauri', () => {
  it('goes through the global fetch', async () => {
    const global = vi.fn(async () => new Response('from the global'))
    vi.stubGlobal('fetch', global)

    const response = await harnessTransport('http://127.0.0.1:4319/api/providers/connections')

    expect(await response.text()).toBe('from the global')
    expect(global).toHaveBeenCalledTimes(1)
    expect(pluginFetch).not.toHaveBeenCalled()
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
  it('goes through the plugin instead', async () => {
    const global = vi.fn(async () => new Response('from the global'))
    vi.stubGlobal('fetch', global)
    enterTauri()

    const response = await harnessTransport('http://127.0.0.1:4319/api/providers/models')

    expect(await response.text()).toBe('from the plugin')
    expect(pluginFetch).toHaveBeenCalledTimes(1)
    expect(global).not.toHaveBeenCalled()
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
    expect(pluginFetch).not.toHaveBeenCalled()

    enterTauri()
    await harnessTransport('http://127.0.0.1:4319/second')

    expect(pluginFetch).toHaveBeenCalledTimes(1)
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
