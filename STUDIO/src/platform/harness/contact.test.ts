import { afterEach, describe, expect, it, vi } from 'vitest'

import { defaultContactFor } from './contact'
import { defaultListen } from './lifecycle'

/**
 * The two defaults, met in a browser (step 6): contact goes to the listener
 * that served the page, and a page with no event bus still gets a working
 * subscription shape. Inside Tauri these paths are the supervisor command and
 * the event bus, tested where the surfaces that consume them are tested; a
 * browser cannot be detected inside those tests, so its branches are stated
 * here, where `isTauri()` is false for real.
 */

afterEach(() => {
  vi.unstubAllGlobals()
})

function aJson(status: number, json: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(json),
  } as Response
}

describe('defaultContactFor, in a browser', () => {
  it('attaches when the listener answers that the harness is running', async () => {
    const fetchMock = vi.fn(async () =>
      aJson(200, { state: 'running', endpoint: { url: 'http://127.0.0.1:4319' }, error: null }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const contact = await defaultContactFor('cnv_a')()
    expect(contact.kind).toBe('ready')
    expect(fetchMock).toHaveBeenCalledWith('/api/harness/status')
  })

  it('reports starting while the harness is coming up', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => aJson(200, { state: 'starting', endpoint: null, error: null })),
    )

    const contact = await defaultContactFor('cnv_a')()
    expect(contact.kind).toBe('starting')
  })

  it('is absent when the harness is stopped', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => aJson(200, { state: 'stopped', endpoint: null, error: null })),
    )

    const contact = await defaultContactFor('cnv_a')()
    expect(contact.kind).toBe('absent')
  })

  it('is absent when no listener serves the page', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => aJson(404, {})))

    const contact = await defaultContactFor('cnv_a')()
    expect(contact.kind).toBe('absent')
  })
})

describe('defaultListen, in a browser', () => {
  it('resolves with a no-op unsubscriber rather than rejecting', async () => {
    const unlisten = await defaultListen(() => undefined)
    expect(typeof unlisten).toBe('function')
    expect(() => unlisten()).not.toThrow()
  })
})
