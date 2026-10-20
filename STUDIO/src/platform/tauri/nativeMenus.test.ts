/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest'
const environment = vi.hoisted(() => ({ desktop: false }))
vi.mock('./window', () => ({ isTauri: () => environment.desktop }))
import { suppressWebviewChrome } from './nativeMenus'

let dispose = () => {}
afterEach(() => { dispose(); environment.desktop = false })

describe('desktop context menu suppression', () => {
  it('leaves the browser menu and shortcuts available', () => {
    dispose = suppressWebviewChrome()
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    document.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    for (const key of ['F12', 'r']) {
      const shortcut = new KeyboardEvent('keydown', { key, ctrlKey: true, cancelable: true, bubbles: true })
      document.dispatchEvent(shortcut)
      expect(shortcut.defaultPrevented).toBe(false)
    }
    dispose()
  })
  it('blocks the desktop webview menu and removes the listener on disposal', () => {
    environment.desktop = true
    dispose = suppressWebviewChrome()
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    document.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    dispose()
    const after = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    document.dispatchEvent(after)
    expect(after.defaultPrevented).toBe(false)
  })
})
