/** @vitest-environment jsdom */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LiveBrowserState } from '@/domain/browser/live'
import type { HarnessResult } from '@/platform/harness'
import { useLiveBrowser } from './useLiveBrowser'

const browser = { view: vi.fn<() => Promise<HarnessResult<LiveBrowserState>>>(),
  interact: vi.fn<() => Promise<HarnessResult<void>>>() }
const client = { viewConversationBrowser: browser.view, interactConversationBrowser: browser.interact }
const getClient = vi.fn<() => Promise<typeof client | null>>(async () => client)
vi.mock('@/platform/harness/react', () => ({ useHarnessClient: () => getClient }))
const state: LiveBrowserState = { running: true, activeTabId: 'tab_1', control: 'human', busy: false,
  tabs: [{ id: 'tab_1', url: 'https://example.com', title: 'Current' }], cursor: null, frame: null }
const success = { ok: true, value: state } as const

beforeEach(() => { browser.interact.mockResolvedValue({ ok: true, value: undefined }) })
afterEach(() => { cleanup(); vi.useRealTimers(); vi.resetAllMocks(); getClient.mockResolvedValue(client) })

describe('live browser delivery lifecycle', () => {
  it('waits for the detached window client to initialize before requesting frames', async () => {
    let resolveClient: ((value: typeof client) => void) | undefined
    getClient.mockImplementationOnce(() => new Promise((resolve) => { resolveClient = resolve }))
    browser.view.mockResolvedValue(success)
    browser.interact.mockResolvedValue({ ok: true, value: undefined })
    const hook = renderHook(() => useLiveBrowser('cnv_1'))
    expect(browser.view).not.toHaveBeenCalled()
    expect(hook.result.current.error).toBeNull()
    await act(async () => resolveClient?.(client))
    await waitFor(() => expect(hook.result.current.state?.running).toBe(true))
    expect(browser.view).toHaveBeenCalledTimes(1)
  })
  it('recovers an initially unavailable harness without refreshing the window', async () => {
    vi.useFakeTimers()
    getClient.mockResolvedValueOnce(null).mockResolvedValue(client)
    browser.view.mockResolvedValue(success)
    const hook = renderHook(() => useLiveBrowser('cnv_1'))
    await act(async () => {})
    expect(hook.result.current.reconnecting).toBe(true)
    expect(browser.view).not.toHaveBeenCalled()
    await act(async () => vi.advanceTimersByTimeAsync(500))
    expect(hook.result.current.state?.running).toBe(true)
    expect(hook.result.current.reconnecting).toBe(false)
    expect(hook.result.current.error).toBeNull()
  })

  it('keeps the live connection after a navigation is refused, without resending it', async () => {
    browser.view.mockResolvedValue(success)
    browser.interact.mockResolvedValue({ ok: false, error: { kind: 'harness-error', status: 400, message: 'Navigation failed' } })
    const hook = renderHook(() => useLiveBrowser('cnv_1'))
    await waitFor(() => expect(hook.result.current.state?.running).toBe(true))
    act(() => hook.result.current.send({ action: 'back', tabId: 'tab_1' }))
    await waitFor(() => expect(hook.result.current.inputError).toBe('Navigation failed'))
    expect(hook.result.current.error).toBeNull()
    await waitFor(() => expect(browser.view.mock.calls.length).toBeGreaterThan(1))
    expect(browser.interact).toHaveBeenCalledTimes(1)
  })

  it('ends startup recovery after five retries instead of hiding a stopped harness', async () => {
    vi.useFakeTimers()
    getClient.mockResolvedValue(null)
    const hook = renderHook(() => useLiveBrowser('cnv_1'))
    await act(async () => vi.advanceTimersByTimeAsync(8000))
    expect(getClient).toHaveBeenCalledTimes(6)
    expect(hook.result.current.reconnecting).toBe(false)
    expect(hook.result.current.error).toBe('The harness is not running.')
    await act(async () => vi.advanceTimersByTimeAsync(8000))
    expect(getClient).toHaveBeenCalledTimes(6)
  })

  it('coalesces scrolling behind a pending input while preserving the following click', async () => {
    browser.view.mockResolvedValue(success)
    let finish: ((value: HarnessResult<void>) => void) | undefined
    browser.interact.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
      .mockResolvedValue({ ok: true, value: undefined })
    const hook = renderHook(() => useLiveBrowser('cnv_1'))
    await waitFor(() => expect(hook.result.current.state?.running).toBe(true))
    act(() => {
      hook.result.current.send({ action: 'claim' })
      for (let index = 0; index < 100; index++) hook.result.current.send({ action: 'wheel', tabId: 'tab_1', x: 0, y: 10 })
      hook.result.current.send({ action: 'pointer', tabId: 'tab_1', kind: 'down', x: 0.5, y: 0.5, button: 'left', clicks: 1 })
    })
    await act(async () => finish?.({ ok: true, value: undefined }))
    expect(browser.interact).toHaveBeenCalledTimes(3)
    expect(browser.interact.mock.calls[1]).toContainEqual({ action: 'wheel', tabId: 'tab_1', x: 0, y: 1000 })
    expect(browser.interact.mock.calls[2]).toContainEqual(expect.objectContaining({ action: 'pointer', kind: 'down' }))
  })
  it('does not resend failed input when reconnecting and releases the old viewer', async () => {
    browser.view.mockResolvedValue(success)
    browser.interact.mockResolvedValue({ ok: true, value: undefined })
    const hook = renderHook(() => useLiveBrowser('cnv_1'))
    await waitFor(() => expect(hook.result.current.state?.control).toBe('human'))
    browser.interact.mockResolvedValueOnce({ ok: false, error: { kind: 'not-reachable', message: 'Connection lost', timedOut: true } })
    act(() => hook.result.current.send({ action: 'text', tabId: 'tab_1', text: 'submit once' }))
    await waitFor(() => expect(hook.result.current.inputError).toBe('Connection lost'))
    act(() => hook.result.current.reconnect())
    await waitFor(() => expect(hook.result.current.error).toBeNull())
    expect(browser.interact.mock.calls.filter((call) => JSON.stringify(call).includes('submit once'))).toHaveLength(1)
    expect(browser.interact.mock.calls.some((call) => JSON.stringify(call).includes('detach'))).toBe(true)
  })

  it('ignores a late frame from a replaced conversation', async () => {
    let resolveOld: ((result: HarnessResult<LiveBrowserState>) => void) | undefined
    browser.view.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve }))
      .mockResolvedValue(success)
    browser.interact.mockResolvedValue({ ok: true, value: undefined })
    const hook = renderHook(({ id }) => useLiveBrowser(id), { initialProps: { id: 'cnv_old' } })
    await waitFor(() => expect(browser.view).toHaveBeenCalledTimes(1))
    hook.rerender({ id: 'cnv_new' })
    await waitFor(() => expect(hook.result.current.state?.tabs[0]?.title).toBe('Current'))
    await act(async () => resolveOld?.({ ok: true, value: { ...state, tabs: [{ id: 'old', url: 'https://old.example', title: 'Old private page' }] } }))
    expect(hook.result.current.state?.tabs[0]?.title).toBe('Current')
  })

  it('recovers frame delivery after uncertain input without replaying it and releases held keys', async () => {
    vi.useFakeTimers()
    browser.view.mockResolvedValue(success)
    const hook = renderHook(() => useLiveBrowser('cnv_1'))
    await act(async () => {})
    browser.interact.mockResolvedValueOnce({ ok: false, error: { kind: 'not-reachable', message: 'Delivery unknown', timedOut: true } })
    act(() => hook.result.current.send({ action: 'text', tabId: 'tab_1', text: 'once' }))
    await act(async () => {})
    expect(hook.result.current.reconnecting).toBe(true)
    await act(async () => vi.advanceTimersByTimeAsync(40))
    expect(hook.result.current.reconnecting).toBe(false)
    expect(hook.result.current.inputError).toBe('Delivery unknown')
    expect(browser.interact.mock.calls.filter((call) => JSON.stringify(call).includes('once'))).toHaveLength(1)
    expect(browser.interact.mock.calls).toContainEqual(['cnv_1', expect.any(String), { action: 'reset' }])
  })

  it('does not let an old pending sender strand input for a replacement conversation', async () => {
    browser.view.mockResolvedValue(success)
    let finish: ((value: HarnessResult<void>) => void) | undefined
    const hook = renderHook(({ id }) => useLiveBrowser(id), { initialProps: { id: 'cnv_old' } })
    await waitFor(() => expect(hook.result.current.state?.running).toBe(true))
    browser.interact.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    act(() => hook.result.current.send({ action: 'text', tabId: 'tab_1', text: 'old' }))
    hook.rerender({ id: 'cnv_new' })
    await waitFor(() => expect(browser.view.mock.calls.some((call) => JSON.stringify(call).includes('cnv_new'))).toBe(true))
    act(() => hook.result.current.send({ action: 'text', tabId: 'tab_1', text: 'new' }))
    await waitFor(() => expect(browser.interact.mock.calls).toContainEqual(['cnv_new', expect.any(String), { action: 'text', tabId: 'tab_1', text: 'new' }]))
    await act(async () => finish?.({ ok: true, value: undefined }))
    expect(browser.interact.mock.calls.filter((call) => JSON.stringify(call).includes('"old"'))).toHaveLength(1)
  })
})
