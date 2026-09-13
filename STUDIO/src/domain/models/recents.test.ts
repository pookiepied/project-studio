/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadRecentModelIds, rememberRecentModel } from './recents'

/**
 * The recents list, on its own terms rather than through a picker: what a
 * pick does to the order, where the cap bites, and what corrupt or absent
 * storage yields - an empty list, never an error.
 */

const KEY = 'studio.recent-models'

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('the recent-models list', () => {
  it('is empty when nothing has been picked', () => {
    expect(loadRecentModelIds()).toEqual([])
  })

  it('puts the newest pick first and keeps a pick only once', () => {
    rememberRecentModel('a/one')
    rememberRecentModel('b/two')
    rememberRecentModel('a/one')
    expect(loadRecentModelIds()).toEqual(['a/one', 'b/two'])
  })

  it('holds three, dropping the oldest', () => {
    rememberRecentModel('a/one')
    rememberRecentModel('b/two')
    rememberRecentModel('c/three')
    rememberRecentModel('d/four')
    expect(loadRecentModelIds()).toEqual(['d/four', 'c/three', 'b/two'])
  })

  it('reads nothing from garbage, and writes over it', () => {
    localStorage.setItem(KEY, '{not json at all')
    expect(loadRecentModelIds()).toEqual([])
    rememberRecentModel('a/one')
    expect(loadRecentModelIds()).toEqual(['a/one'])
  })

  it('ignores stored entries that are not names', () => {
    localStorage.setItem(KEY, JSON.stringify([42, null, 'a/one', '']))
    expect(loadRecentModelIds()).toEqual(['a/one'])
  })

  it('answers empty when storage itself is unavailable', () => {
    // The module reaches `localStorage` directly; a privacy mode that refuses
    // on access throws the moment the global is touched, which the module
    // catches and answers empty to.
    const original = globalThis.localStorage
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get: () => {
        throw new Error('storage refused')
      },
    })
    try {
      expect(loadRecentModelIds()).toEqual([])
    } finally {
      Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: original,
      })
    }
  })
})
