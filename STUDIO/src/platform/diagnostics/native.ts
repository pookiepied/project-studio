import { invoke } from '@tauri-apps/api/core'
import { isTauri } from '@/platform/tauri'
import { isRecord } from '@/lib/guards'

export async function syncNativeCapture(expectedEnabled: boolean): Promise<boolean> {
  if (!isTauri()) return true
  try {
    const result: unknown = await invoke('diagnostic_capture_sync')
    return isRecord(result) && result.enabled === expectedEnabled
  } catch { return false }
}

/** Host evidence remains available after a harness restart or transport failure. */
export async function readNativeCapture(): Promise<Readonly<Record<string, unknown>> | null> {
  if (!isTauri()) return null
  const result: unknown = await invoke('diagnostic_capture_snapshot')
  if (!isRecord(result) || typeof result.bootId !== 'string' || !Array.isArray(result.events) || result.events.length > 2000) {
    throw new Error('The native diagnostic snapshot could not be read.')
  }
  return result
}

export async function clearNativeCapture(): Promise<void> {
  if (isTauri()) await invoke('diagnostic_capture_clear')
}
