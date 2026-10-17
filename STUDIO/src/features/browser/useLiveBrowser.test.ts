/** @vitest-environment jsdom */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LiveBrowserState } from '@/domain/browser/live'
import type { HarnessResult } from '@/platform/harness'
import { useLiveBrowser } from './useLiveBrowser'

const browser = { view: vi.fn<() => Promise<HarnessResult<LiveBrowserState>>>(),
  interact: vi.fn<() => Promise<HarnessResult<void>>>() }
let phase: 'loading' | 'ready' = 'ready'
vi.mock('@/stores/workspace', () => ({ useWorkspace: () => ({ browser, storePhase: { status: phase }, ensureStore: vi.fn() }) }))
const state: LiveBrowserState = { running: true, activeTabId: 'tab_1', control: 'human', busy: false,
  tabs: [{ id: 'tab_1', url: 'https://example.com', title: 'Current' }], cursor: null, frame: null }
const success = { ok: true, value: state } as const

afterEach(() => { cleanup(); vi.resetAllMocks(); phase = 'ready' })

describe('live browser delivery lifecycle', () => {
  it('waits for the detached window client to initialize before requesting frames', async () => {
    phase = 'loading'
    browser.view.mockResolvedValue(success)
    browser.interact.mockResolvedValue({ ok: true, value: undefined })
    const hook = renderHook(() => useLiveBrowser('cnv_1'))
    expect(browser.view).not.toHaveBeenCalled()
    expect(hook.result.current.error).toBeNull()
    phase = 'ready'
    hook.rerender()
    await waitFor(() => expect(hook.result.current.state?.running).toBe(true))
    expect(browser.view).toHaveBeenCalledTimes(1)
  })
  it('does not resend failed input when reconnecting and releases the old viewer', async () => {
    browser.view.mockResolvedValue(success)
    browser.interact.mockResolvedValue({ ok: true, value: undefined })
    const hook = renderHook(() => useLiveBrowser('cnv_1'))
    await waitFor(() => expect(hook.result.current.state?.control).toBe('human'))
    browser.interact.mockResolvedValueOnce({ ok: false, error: { kind: 'not-reachable', message: 'Connection lost', timedOut: true } })
    act(() => hook.result.current.send({ action: 'text', tabId: 'tab_1', text: 'submit once' }))
    await waitFor(() => expect(hook.result.current.error).toBe('Connection lost'))
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
    hook.rerender({ id: 'cnv_new' })
    await waitFor(() => expect(hook.result.current.state?.tabs[0]?.title).toBe('Current'))
    await act(async () => resolveOld?.({ ok: true, value: { ...state, tabs: [{ id: 'old', url: 'https://old.example', title: 'Old private page' }] } }))
    expect(hook.result.current.state?.tabs[0]?.title).toBe('Current')
  })
})
