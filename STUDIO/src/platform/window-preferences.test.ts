import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Both settings reach outside the webview, so both dependencies are stood in
 * for: the store is a plain map, and the autostart plugin is a fake operating
 * system whose registry can be made to refuse a write.
 */
const stored = new Map<string, unknown>()
let saves = 0

vi.mock('@tauri-apps/plugin-store', () => ({
  load: async () => ({
    get: async (key: string) => stored.get(key),
    set: async (key: string, value: unknown) => {
      stored.set(key, value)
    },
    save: async () => {
      saves += 1
    },
  }),
}))

/** What the fake OS believes, and whether it will accept a change. */
const os = { enabled: false, writable: true }

vi.mock('@tauri-apps/plugin-autostart', () => ({
  isEnabled: async () => os.enabled,
  enable: async () => {
    if (!os.writable) throw new Error('registry is managed by policy')
    os.enabled = true
  },
  disable: async () => {
    if (!os.writable) throw new Error('registry is managed by policy')
    os.enabled = false
  },
}))

vi.mock('@/platform/tauri', () => ({ isTauri: () => true }))

async function freshModule() {
  vi.resetModules()
  return import('@/platform/window-preferences')
}

beforeEach(() => {
  stored.clear()
  saves = 0
  os.enabled = false
  os.writable = true
})

describe('window preferences', () => {
  it('keeps the window running when nothing has been chosen', async () => {
    // The default is the ON one: closing a window is almost never a request
    // to end a conversation someone is in the middle of.
    const preferences = await freshModule()
    expect(await preferences.loadWindowPreferences()).toEqual({ closeToTray: true })
  })

  it('gives back the choice that was made', async () => {
    const preferences = await freshModule()
    await preferences.saveWindowPreferences({ closeToTray: false })

    expect(saves).toBe(1)
    expect(await preferences.loadWindowPreferences()).toEqual({ closeToTray: false })
  })

  it('falls back to the default when the stored value is not a boolean', async () => {
    // The file is hand-editable and a non-boolean reaching the control
    // renders a broken toggle.
    for (const junk of ['yes', 1, null, [], { closeToTray: 'true' }]) {
      stored.set('studio.window', junk)
      const preferences = await freshModule()
      expect(await preferences.loadWindowPreferences()).toEqual({ closeToTray: true })
    }
  })

  it('asks the operating system about the login item, not a stored copy', async () => {
    const preferences = await freshModule()
    expect(await preferences.loadLaunchAtStartup()).toBe(false)

    os.enabled = true
    expect(await preferences.loadLaunchAtStartup()).toBe(true)
  })

  it('registers and removes the login item', async () => {
    const preferences = await freshModule()

    expect(await preferences.setLaunchAtStartup(true)).toBe(true)
    expect(os.enabled).toBe(true)

    expect(await preferences.setLaunchAtStartup(false)).toBe(false)
    expect(os.enabled).toBe(false)
  })

  it('reports the refusal when the machine will not accept the change', async () => {
    // A policy-managed machine, or a locked registry hive. A toggle that
    // flips anyway is lying about a change that did not happen, so the answer
    // is what the OS believes afterwards rather than what was asked for.
    const preferences = await freshModule()
    os.writable = false

    expect(await preferences.setLaunchAtStartup(true)).toBe(false)
    expect(os.enabled).toBe(false)
  })
})
