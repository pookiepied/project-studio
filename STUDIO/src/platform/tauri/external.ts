import { invoke } from '@tauri-apps/api/core'
import { isTauri } from './window'

export function webUrl(value: string): string | null {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
  } catch { return null }
}

/** The OS default browser on desktop; a separate tab for the web client. */
export async function openExternalUrl(value: string): Promise<void> {
  const url = webUrl(value)
  if (url === null) throw new Error('Only web addresses can be opened.')
  if (isTauri()) await invoke('open_external_url', { url })
  else window.open(url, '_blank', 'noopener,noreferrer')
}
