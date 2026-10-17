import { describe, expect, it, vi } from 'vitest'
import { newId, newUuid } from './id'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('Studio-created identities', () => {
  it('uses cryptographic UUIDv4 without changing prefixes or parsing old IDs', () => {
    expect(newUuid()).toMatch(UUID)
    expect(newId('cnv').slice(4)).toMatch(UUID)
    expect(newId('cnv')).not.toBe(newId('cnv'))
  })

  it('works when randomUUID is unavailable on a remote HTTP origin', () => {
    const fill = vi.fn((bytes: Uint8Array) => { bytes.fill(255); return bytes })
    vi.stubGlobal('crypto', { getRandomValues: fill })
    try {
      expect(newUuid()).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff')
      expect(fill).toHaveBeenCalledOnce()
    } finally { vi.unstubAllGlobals() }
  })
})
