import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The remembered switch, against a store that is a plain map. The commands
 * are not tested here: each is one `invoke` with no logic of its own, and
 * what they answer is pinned in Rust.
 */
const stored = new Map<string, unknown>()

vi.mock('@tauri-apps/plugin-store', () => ({
  load: async () => ({
    get: async (key: string) => stored.get(key),
    set: async (key: string, value: unknown) => {
      stored.set(key, value)
    },
    save: async () => undefined,
  }),
}))

vi.mock('@tauri-apps/plugin-autostart', () => ({
  isEnabled: async () => false,
  enable: async () => undefined,
  disable: async () => undefined,
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: async () => null }))

vi.mock('@/platform/tauri', () => ({ isTauri: () => true }))

async function freshModule() {
  vi.resetModules()
  return import('@/platform/remote-access')
}

beforeEach(() => {
  stored.clear()
})

describe('the remembered switch', () => {
  it('is off until something was stored', async () => {
    const remote = await freshModule()
    expect(await remote.loadRemoteAccessPreference()).toBe(false)
  })

  it('round-trips under the key native code reads at launch', async () => {
    const remote = await freshModule()
    await remote.saveRemoteAccessPreference(true)

    // `studio.remote` is `REMOTE_PREFERENCES_KEY` in `src-tauri/src/lib.rs`,
    // and `enabled` is the field it reads; both are pinned here so a rename
    // on one side fails a test rather than silently leaving the listener
    // closed at the next launch.
    expect(stored.get('studio.remote')).toEqual({ enabled: true })
    expect(await remote.loadRemoteAccessPreference()).toBe(true)

    await remote.saveRemoteAccessPreference(false)
    expect(await remote.loadRemoteAccessPreference()).toBe(false)
  })

  it('treats a hand-edited value that is not a boolean as off', async () => {
    stored.set('studio.remote', { enabled: 'yes' })
    const remote = await freshModule()
    expect(await remote.loadRemoteAccessPreference()).toBe(false)
  })
})
