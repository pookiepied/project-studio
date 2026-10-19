import { describe, expect, it } from 'vitest'
import { parseLiveBrowserState } from './live'

describe('live browser response boundary', () => {
  const state = { running: true, activeTabId: 'tab_1', control: 'agent', busy: false,
    tabs: [{ id: 'tab_1', url: 'about:blank', title: '' }], cursor: null, frame: null }
  it('accepts empty frames and refuses malformed cursor and image data', () => {
    expect(parseLiveBrowserState(state)).toEqual(state)
    expect(parseLiveBrowserState({ ...state, cursor: { x: NaN, y: 0, tabId: 'tab_1' } })).toBeNull()
    expect(parseLiveBrowserState({ ...state, frame: { data: '<svg>', sequence: 1, tabId: 'tab_1', width: 10, height: 10 } })).toBeNull()
    expect(parseLiveBrowserState({ ...state, control: 'unrecognized' })).toBeNull()
  })
  it('preserves cursor shape and press state while refusing coordinates outside the viewport', () => {
    const cursor = { x: 0.5, y: 0.3, tabId: 'tab_1', kind: 'text', pressed: true }
    expect(parseLiveBrowserState({ ...state, cursor })?.cursor).toEqual(cursor)
    expect(parseLiveBrowserState({ ...state, cursor: { ...cursor, x: 2 } })).toBeNull()
    expect(parseLiveBrowserState({ ...state, cursor: { ...cursor, kind: 'arbitrary' } })).toBeNull()
    expect(parseLiveBrowserState({ ...state, cursor: { ...cursor, kind: {} } })).toBeNull()
    expect(parseLiveBrowserState({ ...state, cursor: { ...cursor, pressed: 'yes' } })).toBeNull()
  })
})
