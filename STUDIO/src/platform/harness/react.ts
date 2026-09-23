import { useCallback, useRef } from 'react'

import { createHarnessClient, type HarnessClient } from './client'
import { resolveHarnessAddress } from './connection'

/**
 * A feature's own connection to the harness, as a hook.
 *
 * Not the conversation-bound client the workspace store binds — the Settings
 * panes, the slash and the library are each reached on their own, and none
 * of them should have to thread a store through for one request. The address
 * is resolved once per mount, the client built once, and both live as long
 * as the component does.
 */
export function useHarnessClient(): () => Promise<HarnessClient | null> {
  const client = useRef<HarnessClient | null>(null)
  return useCallback(async () => {
    if (client.current !== null) return client.current
    const address = await resolveHarnessAddress()
    if (address === null) return null
    client.current = createHarnessClient(address)
    return client.current
  }, [])
}