/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ desktop: false, invoke: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }))
vi.mock('./window', () => ({ isTauri: () => mocks.desktop }))
import { openExternalUrl, webUrl } from './external'
afterEach(() => { mocks.desktop = false; mocks.invoke.mockReset(); vi.restoreAllMocks() })
describe('opening browser results', () => {
  it('allows web results and rejects executable or local-file schemes', async () => {
    expect(webUrl('http://localhost:3000')).toBe('http://localhost:3000/')
    expect(webUrl('https://example.com')).toBe('https://example.com/')
    for (const url of ['javascript:alert(1)', 'file:///C:/secret', 'data:text/html,test', 'invalid']) {
      expect(webUrl(url)).toBeNull()
      await expect(openExternalUrl(url)).rejects.toThrow()
    }
    expect(mocks.invoke).not.toHaveBeenCalled()
  })
  it('uses the native default-browser command only in the desktop app', async () => {
    mocks.desktop = true
    mocks.invoke.mockResolvedValue(undefined)
    await openExternalUrl('http://localhost:3000')
    expect(mocks.invoke).toHaveBeenCalledWith('open_external_url', { url: 'http://localhost:3000/' })
  })
  it('opens a separate tab in the web client', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    await openExternalUrl('https://example.com')
    expect(open).toHaveBeenCalledWith('https://example.com/', '_blank', 'noopener,noreferrer')
  })
})
