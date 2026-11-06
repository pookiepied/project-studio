import { DEFAULT_PERMISSION_MODE, type PermissionMode } from '@/domain/permissions/modes'
import { openPreferencesStore } from '@/platform/window-preferences'
import { isTauri } from '@/platform/tauri'

const KEY = 'studio.default-execution-mode'

export async function loadDefaultPermission(): Promise<PermissionMode> {
  try {
    const stored: unknown = isTauri()
      ? await (await openPreferencesStore())?.get(KEY)
      : localStorage.getItem(KEY)
    return stored === 'ask' || stored === 'auto' ? stored : DEFAULT_PERMISSION_MODE
  } catch {
    return DEFAULT_PERMISSION_MODE
  }
}

let pendingSave = Promise.resolve(true)

export function saveDefaultPermission(mode: PermissionMode): Promise<boolean> {
  const result = pendingSave.then(() => writeDefaultPermission(mode))
  pendingSave = result
  return result
}

async function writeDefaultPermission(mode: PermissionMode): Promise<boolean> {
  try {
    if (!isTauri()) {
      localStorage.setItem(KEY, mode)
      return true
    }

    const store = await openPreferencesStore()
    if (!store) return false
    const previous = await store.get(KEY)
    await store.set(KEY, mode)
    try {
      await store.save()
      return true
    } catch {
      // A failed disk write leaves the plugin's in-memory store changed.
      if (previous === undefined) await store.delete(KEY)
      else await store.set(KEY, previous)
      return false
    }
  } catch {
    return false
  }
}
