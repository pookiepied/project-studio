/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LiveBrowserState } from '@/domain/browser/live'
import { BrowserWindow } from './BrowserWindow'

const send = vi.fn()
const reconnect = vi.fn()
let state: LiveBrowserState = { running: true, activeTabId: 'tab_1', control: 'agent', busy: false,
  tabs: [{ id: 'tab_1', title: 'Example', url: 'https://example.com/' }], frame: null, cursor: null }
vi.mock('./useLiveBrowser', () => ({ useLiveBrowser: () => ({ state, error: null, send, reconnect }) }))
vi.mock('@/platform/tauri', async (original) => ({ ...await original<object>(), isTauri: () => false, startWindowDrag: vi.fn() }))

afterEach(() => { cleanup(); send.mockClear(); state = { ...state, control: 'agent', frame: null, cursor: null } })

describe('detached browser window', () => {
  it('fits a small viewport without magnifying its page', () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
    state = { ...state, frame: { data: '/9j/', tabId: 'tab_1', sequence: 1, width: 640, height: 400 } }
    render(<BrowserWindow conversationId="cnv_1" />)
    const surface = screen.getByRole('application', { name: 'Live browser page' })
    expect(surface.style.width).toBe('640px')
    expect(surface.style.height).toBe('400px')
    vi.unstubAllGlobals()
  })
  it('requires human control before navigation and tab changes', () => {
    const view = render(<BrowserWindow conversationId="cnv_1" />)
    expect(screen.getByRole('button', { name: 'New tab' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Take control' }))
    expect(send).toHaveBeenCalledWith({ action: 'claim' })
    state = { ...state, control: 'human' }
    view.rerender(<BrowserWindow conversationId="cnv_1" />)
    fireEvent.click(screen.getByRole('button', { name: 'New tab' }))
    expect(send).toHaveBeenCalledWith({ action: 'new' })
    fireEvent.change(screen.getByRole('textbox', { name: 'Address' }), { target: { value: 'example.org' } })
    fireEvent.submit(screen.getByRole('textbox', { name: 'Address' }).closest('form') as HTMLFormElement)
    expect(send).toHaveBeenCalledWith({ action: 'navigate', tabId: 'tab_1', url: 'https://example.org' })
    fireEvent.click(screen.getByRole('button', { name: 'Resume Studio' }))
    expect(send).toHaveBeenCalledWith({ action: 'release' })
  })

  it('forwards pasted text and composition to the same tab and shows the agent cursor only during automation', async () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
    state = { ...state, control: 'human', cursor: { tabId: 'tab_1', x: 0.5, y: 0.5 },
      frame: { data: '/9j/', tabId: 'tab_1', sequence: 1, width: 1280, height: 800 } }
    const view = render(<BrowserWindow conversationId="cnv_1" />)
    const input = screen.getByRole('textbox', { name: 'Browser keyboard input' })
    fireEvent.paste(input, { clipboardData: { getData: () => 'pasted text' } })
    expect(send).toHaveBeenCalledWith({ action: 'text', tabId: 'tab_1', text: 'pasted text' })
    fireEvent.compositionEnd(input, { data: 'composed text' })
    expect(send).toHaveBeenCalledWith({ action: 'text', tabId: 'tab_1', text: 'composed text' })
    expect(screen.queryByLabelText('Studio cursor')).toBeNull()
    state = { ...state, control: 'agent' }
    await act(async () => view.rerender(<BrowserWindow conversationId="cnv_1" />))
    expect(screen.getByLabelText('Studio cursor')).toBeTruthy()
    vi.unstubAllGlobals()
  })
})
