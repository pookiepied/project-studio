import { useCallback, useEffect, useRef, useState } from 'react'

import {
  listPairedDevices,
  readPairingCode,
  readRemoteAccessStatus,
  readRemoteAddresses,
  renamePairedDevice,
  revokeAllPairedDevices,
  revokePairedDevice,
  saveRemoteAccessPreference,
  startRemoteAccess,
  stopRemoteAccess,
  type PairedDevice,
  type RemoteAddresses,
} from '@/platform/remote-access'

/**
 * Everything the Other devices pane shows, read from the desktop process.
 *
 * ---- Status, not preference --------------------------------------------
 *
 * The switch shows whether the listener *is* on, not whether it was asked
 * to be. The two differ exactly when it matters: the port was taken, the
 * credential store was unreachable, the app was relaunched and the listener
 * did not come back. A switch that showed the preference would say "on" over
 * a machine nobody can reach. So the status is read from the process, and
 * the preference is written only after a start that took, so a restart never
 * retries an address that was never served.
 *
 * ---- The poll ----------------------------------------------------------
 *
 * A phone that pairs does so through the listener, and the desktop window is
 * not told. The pane therefore re-reads the status and the device list every
 * few seconds while it is open — cheap, in-process calls — so the new device
 * appears in the list on its own. The addresses are re-read far less often:
 * that reading asks the `tailscale` tool a question, and a network change is
 * a once-a-day event, not a once-a-second one.
 */

/** How often the status and the devices are re-read while the pane is open. */
const STATE_POLL_MS = 4_000
/** How often the addresses are re-read. */
const ADDRESS_POLL_MS = 30_000

type Reach = 'unknown' | 'off' | 'on'

export interface RemoteAccessView {
  readonly reach: Reach
  readonly addresses: RemoteAddresses | null
  readonly code: string | null
  readonly devices: readonly PairedDevice[]
  /** The desktop's own sentence when an operation fails, until the next attempt. */
  readonly failure: string | null
  /** A start or stop is in flight. */
  readonly switching: boolean
  readonly codeLoading: boolean
}

export interface RemoteAccessActions {
  readonly turnOn: () => Promise<void>
  readonly turnOff: () => Promise<void>
  readonly newCode: () => Promise<void>
  readonly rename: (id: string, name: string) => Promise<void>
  readonly remove: (id: string) => Promise<void>
  readonly removeAll: () => Promise<void>
}

export function useRemoteAccess(): RemoteAccessView & RemoteAccessActions {
  const [reach, setReach] = useState<Reach>('unknown')
  const [addresses, setAddresses] = useState<RemoteAddresses | null>(null)
  const [code, setCode] = useState<string | null>(null)
  const [devices, setDevices] = useState<readonly PairedDevice[]>([])
  const [failure, setFailure] = useState<string | null>(null)
  const [switching, setSwitching] = useState(false)
  const [codeLoading, setCodeLoading] = useState(false)
  const live = useRef(true)
  const codeVersion = useRef(0)
  const codeBusy = useRef(false)

  const readCode = useCallback(async (renew = false) => {
    if (codeBusy.current) return
    codeBusy.current = true
    if (live.current) setCodeLoading(true)
    if (renew && live.current) setFailure(null)
    const version = ++codeVersion.current
    try {
      const minted = await readPairingCode(renew)
      if (live.current && version === codeVersion.current) setCode(minted)
    } catch (error) {
      if (live.current && version === codeVersion.current) {
        setCode(null)
        setFailure(error instanceof Error ? error.message : String(error))
      }
    } finally {
      codeBusy.current = false
      if (live.current) setCodeLoading(false)
    }
  }, [])

  const readState = useCallback(async () => {
    const [address, list] = await Promise.all([readRemoteAccessStatus(), listPairedDevices()])
    if (!live.current) return
    setReach(address === null ? 'off' : 'on')
    setDevices(list)
    if (address === null) {
      ++codeVersion.current
      setCode(null)
    } else {
      await readCode()
    }
  }, [readCode])

  const readAddresses = useCallback(async () => {
    const reading = await readRemoteAddresses()
    if (live.current) setAddresses(reading)
  }, [])

  /** Everything, after a switch: the state, the addresses and the code. */
  const readAll = useCallback(async () => {
    await readState()
    await readAddresses()
  }, [readAddresses, readState])

  useEffect(() => {
    live.current = true
    void readAll()
    const state = window.setInterval(() => void readState(), STATE_POLL_MS)
    const address = window.setInterval(() => void readAddresses(), ADDRESS_POLL_MS)
    return () => {
      live.current = false
      window.clearInterval(state)
      window.clearInterval(address)
    }
  }, [readAddresses, readAll, readState])

  const turnOn = useCallback(async () => {
    setSwitching(true)
    setFailure(null)
    try {
      await startRemoteAccess()
      await saveRemoteAccessPreference(true)
    } catch (error) {
      // The desktop writes its refusals as sentences; one is shown as it is.
      if (live.current) setFailure(error instanceof Error ? error.message : String(error))
      await saveRemoteAccessPreference(false)
    } finally {
      if (live.current) setSwitching(false)
    }
    await readAll()
  }, [readAll])

  const turnOff = useCallback(async () => {
    setSwitching(true)
    setFailure(null)
    try {
      await stopRemoteAccess()
      await saveRemoteAccessPreference(false)
    } catch (error) {
      if (live.current) setFailure(error instanceof Error ? error.message : String(error))
    } finally {
      if (live.current) {
        setSwitching(false)
        setAddresses(null)
        setCode(null)
      }
    }
    await readState()
  }, [readState])

  const rename = useCallback(
    async (id: string, name: string) => {
      setFailure(null)
      await renamePairedDevice(id, name).catch((error: unknown) => {
        if (live.current) setFailure(error instanceof Error ? error.message : String(error))
      })
      await readState()
    },
    [readState],
  )

  const remove = useCallback(
    async (id: string) => {
      setFailure(null)
      await revokePairedDevice(id).catch((error: unknown) => {
        if (live.current) setFailure(error instanceof Error ? error.message : String(error))
      })
      await readState()
    },
    [readState],
  )

  const removeAll = useCallback(async () => {
    setFailure(null)
    await revokeAllPairedDevices().catch((error: unknown) => {
      if (live.current) setFailure(error instanceof Error ? error.message : String(error))
    })
    await readState()
  }, [readState])

  return {
    reach,
    addresses,
    code,
    devices,
    failure,
    switching,
    codeLoading,
    turnOn,
    turnOff,
    newCode: () => readCode(true),
    rename,
    remove,
    removeAll,
  }
}
