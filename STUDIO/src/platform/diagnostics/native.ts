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

export interface InspectorSharing {
  readonly enabled: boolean
  readonly path: string | null
  readonly status: string
}

export async function inspectorSharing(enabled?: boolean): Promise<InspectorSharing> {
  if (!isTauri()) return { enabled: false, path: null, status: 'off' }
  const result: unknown = enabled === undefined ? await invoke('diagnostic_inspector_status')
    : await invoke('diagnostic_inspector_configure', { enabled })
  if (!isRecord(result) || typeof result.enabled !== 'boolean' || typeof result.status !== 'string' ||
    (result.path !== null && typeof result.path !== 'string')) throw new Error('The local Inspector sharing status is unavailable.')
  return { enabled: result.enabled, path: result.path, status: result.status }
}
