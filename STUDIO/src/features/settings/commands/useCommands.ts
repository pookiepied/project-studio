import { useCallback, useEffect, useRef, useState } from 'react'
import {
  createHarnessClient,
  resolveHarnessAddress,
  type CommandDetail,
  type CommandListing,
  type HarnessClient,
  type HarnessFailure,
} from '@/platform/harness'

/**
 * The Commands pane's data: the listing, and the writes for the person's
 * own commands. `useSkills` with a writer added, because a command is one
 * small text file and the pane edits it in place.
 */

export type CommandsView =
  | { readonly status: 'no-harness' }
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly listing: CommandListing }
  | { readonly status: 'failed'; readonly error: HarnessFailure }

export interface CommandSourceInput {
  readonly description: string
  readonly argumentHint: string
  readonly body: string
}

export interface Commands {
  readonly view: CommandsView
  readonly refreshing: boolean
  refresh: () => Promise<void>
  /** One command with its file, for the editor. */
  read: (id: string) => Promise<CommandDetail | HarnessFailure>
  /** Resolves to the failure to show, or null when it was saved. */
  save: (id: string, source: CommandSourceInput) => Promise<HarnessFailure | null>
  remove: (id: string) => Promise<HarnessFailure | null>
}

const NO_HARNESS: HarnessFailure = {
  kind: 'not-reachable',
  message: 'The harness is not running.',
  timedOut: false,
}

export function useCommands(): Commands {
  const [view, setView] = useState<CommandsView>({ status: 'loading' })
  const [refreshing, setRefreshing] = useState(false)
  const client = useRef<HarnessClient | null>(null)
  const live = useRef(true)

  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
    }
  }, [])

  const connect = useCallback(async (): Promise<HarnessClient | null> => {
    if (client.current) return client.current
    const address = await resolveHarnessAddress()
    if (address === null) return null
    client.current = createHarnessClient(address)
    return client.current
  }, [])

  const readAll = useCallback(
    async (quiet: boolean) => {
      const harness = await connect()
      if (!live.current) return
      if (harness === null) {
        setView({ status: 'no-harness' })
        return
      }
      if (quiet) setRefreshing(true)
      const result = await harness.listCommands()
      if (!live.current) return
      setRefreshing(false)
      if (!result.ok) {
        if (!quiet) setView({ status: 'failed', error: result.error })
        return
      }
      setView({ status: 'ready', listing: result.value })
    },
    [connect],
  )

  useEffect(() => {
    void readAll(false)
  }, [readAll])

  const write = useCallback(
    async (
      run: (harness: HarnessClient) => Promise<{ ok: true } | { ok: false; error: HarnessFailure }>,
    ): Promise<HarnessFailure | null> => {
      const harness = await connect()
      if (harness === null) return NO_HARNESS
      const result = await run(harness)
      if (!result.ok) return result.error
      await readAll(true)
      return null
    },
    [connect, readAll],
  )

  return {
    view,
    refreshing,
    refresh: useCallback(() => readAll(true), [readAll]),
    read: useCallback(
      async (id: string) => {
        const harness = await connect()
        if (harness === null) return NO_HARNESS
        const result = await harness.readCommand(id)
        return result.ok ? result.value : result.error
      },
      [connect],
    ),
    save: useCallback(
      (id, source) => write((harness) => harness.saveCommand(id, source)),
      [write],
    ),
    remove: useCallback((id) => write((harness) => harness.removeCommand(id)), [write]),
  }
}
