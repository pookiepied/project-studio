/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LiveBrowserState } from '@/domain/browser/live'
import { BrowserWindow } from './BrowserWindow'

const send = vi.fn()
const reconnect = vi.fn()
const start = vi.fn()
const initialState: LiveBrowserState = { running: true, activeTabId: 'tab_1', control: 'agent', busy: false,
  tabs: [{ id: 'tab_1', title: 'Example', url: 'https://example.com/' }], frame: null, cursor: null }
let state = initialState
let error: string | null = null
vi.mock('./useLiveBrowser', () => ({ useLiveBrowser: () => ({ state, error, start, send, reconnect }) }))
vi.mock('@/platform/tauri', async (original) => ({ ...await original<object>(), isTauri: () => false, startWindowDrag: vi.fn() }))

afterEach(() => { cleanup(); send.mockClear(); reconnect.mockClear(); start.mockClear(); state = initialState; error = null })

describe('detached browser window', () => {
  it('explains an idle workspace without offering unusable browser controls', () => {
    state = { ...state, running: false, activeTabId: null, tabs: [] }
    render(<BrowserWindow conversationId="cnv_1" embedded />)
    expect(screen.getByText('No browser session')).toBeTruthy()
    expect(start).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Start browser' }))
    expect(start).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button', { name: 'Take control' })).toBeNull()
    expect(screen.queryByRole('textbox', { name: 'Address' })).toBeNull()
  })

  it('shows the harness failure and lets the viewer reconnect', () => {
    state = { ...state, running: false, activeTabId: null, tabs: [] }
    error = 'Studio could not load the live browser.'
    render(<BrowserWindow conversationId="cnv_1" embedded />)
    expect(screen.getByRole('alert').textContent).toBe(error)
    expect(screen.queryByText('No browser session')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }))
    expect(reconnect).toHaveBeenCalledOnce()
  })

  it('embeds the working browser without a second window heading', () => {
    state = { ...state, control: 'human' }
    render(<BrowserWindow conversationId="cnv_1" embedded />)
    expect(screen.queryByText('Studio Browser')).toBeNull()
    expect(screen.getByRole('textbox', { name: 'Address' }).getAttribute('readonly')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Browser tabs' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'New tab' }))
    expect(send).toHaveBeenCalledWith({ action: 'new' })
  })
  it('emphasizes the hostname at rest and keeps the entire address in the field', () => {
    state = { ...state, tabs: [{ id: 'tab_1', title: 'Article', url: 'https://example.com/articles?q=studio' }] }
    render(<BrowserWindow conversationId="cnv_1" embedded />)
    const address = screen.getByRole<HTMLInputElement>('textbox', { name: 'Address' })
    expect(address.value).toBe('https://example.com/articles?q=studio')
    expect(screen.getByText('example.com', { selector: 'strong' })).toBeTruthy()
    fireEvent.focus(address)
    expect(screen.queryByText('example.com', { selector: 'strong' })).toBeNull()
    expect(address.value).toBe('https://example.com/articles?q=studio')
  })
  it('hides Studio input feedback for another human controller or an ended session', () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
    state = { ...state, control: 'other', cursor: { x: 0.5, y: 0.5, tabId: 'tab_1', pressed: true },
      frame: { data: '/9j/', tabId: 'tab_1', sequence: 1, width: 640, height: 400 } }
    const view = render(<BrowserWindow conversationId="cnv_1" />)
    expect(screen.queryByLabelText('Studio cursor')).toBeNull()
    state = { ...state, control: 'agent' }
    view.rerender(<BrowserWindow conversationId="cnv_1" />)
    expect(screen.getByLabelText('Studio cursor')).toBeTruthy()
    state = { ...state, running: false }
    view.rerender(<BrowserWindow conversationId="cnv_1" />)
    expect(screen.queryByLabelText('Studio cursor')).toBeNull()
    vi.unstubAllGlobals()
  })
  it('fits a small viewport without magnifying its page', () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
    state = { ...state, frame: { data: '/9j/', tabId: 'tab_1', sequence: 1, width: 640, height: 400 } }
    render(<BrowserWindow conversationId="cnv_1" />)
    const surface = screen.getByRole('application', { name: 'Live browser page' })
    expect(surface.style.width).toBe('640px')
    expect(surface.style.height).toBe('400px')
    vi.unstubAllGlobals()
  })
  it('zooms the viewer and keeps the page size through both control handoffs', () => {
    vi.useFakeTimers()
    vi.stubGlobal('ResizeObserver', class {
      private readonly notify: (entries: { contentRect: { width: number; height: number } }[]) => void
      constructor(notify: (entries: { contentRect: { width: number; height: number } }[]) => void) {
        this.notify = notify
      }
      observe() { this.notify([{ contentRect: { width: 640, height: 360 } }]) }
      disconnect() {}
    })
    try {
      state = { ...state, frame: { data: '/9j/', tabId: 'tab_1', sequence: 1, width: 1280, height: 720 } }
      const view = render(<BrowserWindow conversationId="cnv_1" embedded />)
      const surface = screen.getByRole('application', { name: 'Live browser page' })
      expect(surface.style.width).toBe('640px')
      fireEvent.click(screen.getByRole('button', { name: 'Browser view zoom: Fit' }))
      fireEvent.click(screen.getByRole('menuitemradio', { name: '75%' }))
      expect(surface.style.width).toBe('960px')
      expect(surface.style.height).toBe('540px')
      state = { ...state, control: 'human' }
      view.rerender(<BrowserWindow conversationId="cnv_1" embedded />)
      act(() => { vi.advanceTimersByTime(250) })
      expect(surface.style.width).toBe('960px')
      expect(send).not.toHaveBeenCalled()
      const wheel = new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true })
      fireEvent(surface, wheel)
      expect(wheel.defaultPrevented).toBe(true)
      expect(send).toHaveBeenCalledWith({ action: 'wheel', tabId: 'tab_1', x: 0, y: 100 })
      send.mockClear()
      state = { ...state, control: 'agent' }
      view.rerender(<BrowserWindow conversationId="cnv_1" embedded />)
      expect(surface.style.width).toBe('960px')
      fireEvent.click(screen.getByRole('button', { name: 'Browser view zoom: 75%' }))
      fireEvent.click(screen.getByRole('menuitemradio', { name: '100%' }))
      expect(surface.style.width).toBe('1280px')
      expect(send).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
      vi.unstubAllGlobals()
    }
  })
  it('updates the live image and active page title while Studio controls the browser', () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
    const onPageTitle = vi.fn()
    const frame = { data: 'YXNk', tabId: 'tab_1', sequence: 1, width: 640, height: 400 }
    state = { ...state, frame }
    const view = render(<BrowserWindow conversationId="cnv_1" embedded onPageTitle={onPageTitle} />)
    expect(screen.getByRole('img', { name: 'Live browser page' }).getAttribute('src')).toContain(frame.data)
    state = { ...state, activeTabId: 'tab_2', tabs: [{ id: 'tab_2', title: 'New article', url: 'https://example.org' }],
      frame: { ...frame, tabId: 'tab_2', sequence: 2, data: 'Zmdo' } }
    view.rerender(<BrowserWindow conversationId="cnv_1" embedded onPageTitle={onPageTitle} />)
    expect(screen.getByRole('img', { name: 'Live browser page' }).getAttribute('src')).toContain('Zmdo')
    expect(onPageTitle).toHaveBeenLastCalledWith({ conversationId: 'cnv_1', title: 'New article', url: 'https://example.org' })
    expect(send).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
  it('requires human control before navigation and tab changes', () => {
    const view = render(<BrowserWindow conversationId="cnv_1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Browser tabs' }))
    expect(screen.getByRole('menuitem', { name: 'New tab' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('menuitem', { name: 'Close Example' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Take control' }))
    expect(send).toHaveBeenCalledWith({ action: 'claim' })
    state = { ...state, control: 'human' }
    view.rerender(<BrowserWindow conversationId="cnv_1" />)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Close Example' }))
    expect(send).toHaveBeenCalledWith({ action: 'close', tabId: 'tab_1' })
    fireEvent.click(screen.getByRole('menuitem', { name: 'New tab' }))
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
  it('reports viewer activity without claiming control or forwarding key contents to the page', () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
    state = { ...state, cursor: { tabId: 'tab_1', x: 0.4, y: 0.2, kind: 'text', pressed: true },
      frame: { data: '/9j/', tabId: 'tab_1', sequence: 1, width: 1280, height: 800 } }
    render(<BrowserWindow conversationId="cnv_1" />)
    const surface = screen.getByRole('application', { name: 'Live browser page' })
    fireEvent.pointerMove(surface, { clientX: 10, clientY: 20 })
    fireEvent.keyDown(surface, { key: 'private-key' })
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ action: 'activity', kind: 'move' }))
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ action: 'activity', kind: 'keyboard' }))
    expect(JSON.stringify(send.mock.calls)).not.toContain('private-key')
    expect(send.mock.calls.every(([command]) => command.action === 'activity')).toBe(true)
    expect(screen.getByLabelText('Studio cursor').getAttribute('data-cursor-kind')).toBe('text')
    expect(screen.getByLabelText('Studio cursor').getAttribute('data-pressed')).toBe('true')
    vi.unstubAllGlobals()
  })
})
