/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppearanceProvider, useAppearance } from './AppearanceProvider'
import { DEFAULT_APPEARANCE } from './appearance'

const store = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), save: vi.fn(), delete: vi.fn(), onKeyChange: vi.fn() }))
const platform = vi.hoisted(() => ({ native: true }))
vi.mock('@tauri-apps/plugin-store', () => ({ load: async () => store }))
// The shared subscription uses the same native handle as persistence.
vi.mock('@/platform/tauri', () => ({ isTauri: () => platform.native }))

function Preference() {
  const { appearance, update, reset } = useAppearance()
  return <><output>{appearance.theme}</output><button onClick={() => update({ theme: 'light' })}>Light</button><button onClick={reset}>Reset</button></>
}

beforeEach(() => {
  platform.native = true
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
})
afterEach(() => { cleanup(); vi.resetAllMocks(); vi.unstubAllGlobals(); localStorage.clear() })

describe('appearance across windows', () => {
  it('adopts other window changes and reset without echoing persistence, then unsubscribes', async () => {
    let receive: ((value: unknown) => void) | undefined
    const off = vi.fn()
    store.get.mockResolvedValue({ ...DEFAULT_APPEARANCE, theme: 'dark' })
    store.onKeyChange.mockImplementation(async (_key, callback: (value: unknown) => void) => { receive = callback; return off })
    const view = render(<AppearanceProvider initial={{ ...DEFAULT_APPEARANCE, theme: 'dark' }}><Preference /></AppearanceProvider>)
    await waitFor(() => expect(store.onKeyChange).toHaveBeenCalled())
    await act(async () => receive?.({ ...DEFAULT_APPEARANCE, theme: 'light' }))
    expect(screen.getByRole('status').textContent).toBe('light')
    expect(document.documentElement.style.colorScheme).toBe('light')
    await act(async () => receive?.(undefined))
    expect(screen.getByRole('status').textContent).toBe('system')
    expect(store.set).not.toHaveBeenCalled()
    expect(store.delete).not.toHaveBeenCalled()
    view.unmount()
    expect(off).toHaveBeenCalledTimes(1)
  })

  it('persists a local choice once and deletes it on reset', async () => {
    store.get.mockResolvedValue(DEFAULT_APPEARANCE)
    store.onKeyChange.mockResolvedValue(vi.fn())
    store.set.mockResolvedValue(undefined)
    store.save.mockResolvedValue(undefined)
    store.delete.mockResolvedValue(undefined)
    render(<AppearanceProvider initial={DEFAULT_APPEARANCE}><Preference /></AppearanceProvider>)
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: 'Light' }))
    await waitFor(() => expect(store.set).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    await waitFor(() => expect(store.delete).toHaveBeenCalledTimes(1))
    expect(store.set).toHaveBeenCalledTimes(1)
  })

  it('does not overwrite a newer store event with the older catch-up snapshot', async () => {
    let receive: ((value: unknown) => void) | undefined
    let finish: ((value: unknown) => void) | undefined
    store.get.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    store.onKeyChange.mockImplementation(async (_key, callback: (value: unknown) => void) => { receive = callback; return vi.fn() })
    render(<AppearanceProvider initial={{ ...DEFAULT_APPEARANCE, theme: 'dark' }}><Preference /></AppearanceProvider>)
    await waitFor(() => expect(store.get).toHaveBeenCalled())
    await act(async () => receive?.({ ...DEFAULT_APPEARANCE, theme: 'light' }))
    await act(async () => finish?.({ ...DEFAULT_APPEARANCE, theme: 'dark' }))
    expect(screen.getByRole('status').textContent).toBe('light')
    expect(store.set).not.toHaveBeenCalled()
  })

  it('updates browser windows through storage events, including clearing preferences', async () => {
    platform.native = false
    localStorage.setItem('studio.appearance', JSON.stringify({ ...DEFAULT_APPEARANCE, theme: 'dark' }))
    render(<AppearanceProvider initial={{ ...DEFAULT_APPEARANCE, theme: 'dark' }}><Preference /></AppearanceProvider>)
    await act(async () => {})
    localStorage.setItem('studio.appearance', JSON.stringify({ ...DEFAULT_APPEARANCE, theme: 'light' }))
    act(() => { window.dispatchEvent(new StorageEvent('storage', { key: 'studio.appearance', storageArea: localStorage })) })
    expect(screen.getByRole('status').textContent).toBe('light')
    localStorage.clear()
    act(() => { window.dispatchEvent(new StorageEvent('storage', { key: null, storageArea: localStorage })) })
    expect(screen.getByRole('status').textContent).toBe('system')
    expect(localStorage.getItem('studio.appearance')).toBeNull()
  })
})
