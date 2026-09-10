import { invoke } from '@tauri-apps/api/core'
import { isTauri } from '@/platform/tauri'
import { openPreferencesStore } from '@/platform/window-preferences'

/**
 * The desktop's side of "open on other devices" (ADR 0050), as the settings
 * screen sees it.
 *
 * Every function here is a Tauri command, and every one is a no-op or an
 * absence in a browser: the listener lives in the desktop process, and a
 * browser tab — even a paired one — is a device the listener serves, not
 * the machine that holds the switch. The screen reads that absence and says
 * where the switch is instead.
 *
 * Nothing here caches. The screen reads the status, the addresses, the code
 * and the devices when it opens and again on a slow poll, so a phone that
 * paired a moment ago appears without anyone pressing anything.
 */

/** One paired device, as the desktop lists it. */
export interface PairedDevice {
  readonly id: string
  readonly name: string
  readonly pairedAtMs: number
  readonly lastSeenMs: number
}

/** The Tailscale side of the address reading. */
export interface AwayAddress {
  readonly address: string
  /** The MagicDNS name, when Tailscale's tool would say it. */
  readonly name: string | null
}

/**
 * The addresses a device can type or scan, told honestly: the home ones the
 * name is published for, the name only while it is published, and the
 * Tailscale one only when the machine has it. See `remote/addresses.rs`.
 */
export interface RemoteAddresses {
  readonly port: number
  /**
   * The port the name answers on: 80 when the desktop could take it, so the
   * name is printed bare, otherwise the same as `port`.
   */
  readonly namePort: number
  readonly home: readonly string[]
  readonly homeName: string | null
  readonly away: AwayAddress | null
}

/** Starts the listener; the address it serves, or the sentence saying why not. */
export async function startRemoteAccess(): Promise<string> {
  if (!isTauri()) throw new Error('Other devices are opened from Studio on the PC.')
  return invoke<string>('remote_access_start')
}

export async function stopRemoteAccess(): Promise<void> {
  if (!isTauri()) return
  await invoke('remote_access_stop')
}

/** The address being served, or `null` while the listener is off. */
export async function readRemoteAccessStatus(): Promise<string | null> {
  if (!isTauri()) return null
  return invoke<string | null>('remote_access_status').catch(() => null)
}

export async function readRemoteAddresses(): Promise<RemoteAddresses | null> {
  if (!isTauri()) return null
  return invoke<RemoteAddresses | null>('remote_addresses').catch(() => null)
}

/**
 * The pairing code to show. Asking replaces a code that was never used and
 * mints one when none is active, so what is shown is always one that works.
 */
export async function readPairingCode(): Promise<string | null> {
  if (!isTauri()) return null
  return invoke<string>('remote_pairing_code').catch(() => null)
}

export async function listPairedDevices(): Promise<readonly PairedDevice[]> {
  if (!isTauri()) return []
  const devices = await invoke<RawDevice[]>('remote_devices').catch(() => [])
  return devices.map((device) => ({
    id: device.id,
    name: device.name,
    pairedAtMs: device.paired_at_ms,
    lastSeenMs: device.last_seen_ms,
  }))
}

/** The shape the command writes; the field names are Rust's, not ours. */
interface RawDevice {
  readonly id: string
  readonly name: string
  readonly paired_at_ms: number
  readonly last_seen_ms: number
}

export async function renamePairedDevice(id: string, name: string): Promise<void> {
  if (!isTauri()) return
  await invoke('remote_device_rename', { id, name })
}

/** Removes one device. Its next request is refused, and its open streams end now. */
export async function revokePairedDevice(id: string): Promise<void> {
  if (!isTauri()) return
  await invoke('remote_device_revoke', { id })
}

export async function revokeAllPairedDevices(): Promise<void> {
  if (!isTauri()) return
  await invoke('remote_device_revoke_all')
}

/**
 * The remembered switch.
 *
 * Kept in the same preferences file as the window settings, under its own
 * key, because native code reads that file at launch and reopens the
 * listener when this says so (ADR 0050 §6: the setting survives a restart,
 * and the tray line is what keeps that honest). **`STORAGE_KEY` must stay in
 * step with `REMOTE_PREFERENCES_KEY` in `src-tauri/src/lib.rs`**, which is
 * the copy that reads it.
 *
 * The preference is what was asked for; the status is what is true. The
 * screen shows the status, and writes the preference only when the switch
 * actually took — a port that would not bind leaves the preference off,
 * so a restart does not retry an address that was never served.
 */
const STORAGE_KEY = 'studio.remote'

export async function loadRemoteAccessPreference(): Promise<boolean> {
  const store = await openPreferencesStore()
  if (!store) return false
  const stored = await store.get(STORAGE_KEY).catch(() => undefined)
  if (typeof stored !== 'object' || stored === null) return false
  const enabled: unknown = (stored as { enabled?: unknown }).enabled
  return enabled === true
}

export async function saveRemoteAccessPreference(enabled: boolean): Promise<void> {
  const store = await openPreferencesStore()
  if (!store) return
  await store.set(STORAGE_KEY, { enabled }).catch(() => undefined)
  await store.save().catch(() => undefined)
}
