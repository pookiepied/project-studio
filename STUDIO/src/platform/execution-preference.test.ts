/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadDefaultPermission, saveDefaultPermission } from './execution-preference'

const native = vi.hoisted(() => ({
  isTauri: vi.fn(() => false),
  openStore: vi.fn(),
}))

vi.mock('@/platform/tauri', () => ({ isTauri: native.isTauri }))
vi.mock('@/platform/window-preferences', () => ({ openPreferencesStore: native.openStore }))

afterEach(() => {
  localStorage.clear()
  vi.resetAllMocks()
})

describe('the default execution mode preference', () => {
  it('restores Auto from browser storage and falls back to Ask for invalid values', async () => {
    expect(await loadDefaultPermission()).toBe('ask')
    expect(await saveDefaultPermission('auto')).toBe(true)
    expect(await loadDefaultPermission()).toBe('auto')
    localStorage.setItem('studio.default-execution-mode', 'unrecognized')
    expect(await loadDefaultPermission()).toBe('ask')
  })

  it('restores the previous desktop preference when the save fails', async () => {
    let stored: unknown = 'ask'
    native.isTauri.mockReturnValue(true)
    const save = vi.fn().mockRejectedValueOnce(new Error('disk write failed')).mockResolvedValue(undefined)
    native.openStore.mockResolvedValue({
      get: async () => stored,
      set: async (_key: string, value: unknown) => { stored = value },
      save,
    })
    expect(await saveDefaultPermission('auto')).toBe(false)
    expect(await loadDefaultPermission()).toBe('ask')
    expect(await saveDefaultPermission('auto')).toBe(true)
    expect(await loadDefaultPermission()).toBe('auto')
  })
})
