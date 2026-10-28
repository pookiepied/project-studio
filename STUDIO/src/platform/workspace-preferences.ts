import { openStore } from '@/platform/store'

const KEY = 'studio.sideWorkspace.collapsed'
export async function loadWorkspaceCollapsed(): Promise<boolean> {
  const store = await openStore('preferences.json')
  if (store) return (await store.get(KEY).catch(() => false)) === true
  try { return localStorage.getItem(KEY) === 'true' } catch { return false }
}

let pendingWrite: Promise<void> = Promise.resolve()
export function saveWorkspaceCollapsed(collapsed: boolean): Promise<void> {
  pendingWrite = pendingWrite.catch(() => undefined).then(() => writeCollapsed(collapsed))
  return pendingWrite
}

async function writeCollapsed(collapsed: boolean): Promise<void> {
  const store = await openStore('preferences.json')
  if (store) {
    await store.set(KEY, collapsed).catch(() => undefined)
    await store.save().catch(() => undefined)
  } else {
    try { localStorage.setItem(KEY, String(collapsed)) } catch { /* Preferences remain usable in memory. */ }
  }
}
