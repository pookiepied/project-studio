import { useCallback, useEffect, useRef, useState } from 'react'
import {
  useHarnessClient,
  type HarnessFailure,
  type LibraryKind,
  type LibraryListing,
} from '@/platform/harness'
import { NO_HARNESS } from '@/features/library/client'

/**
 * The Library pane's data: the listing under the current filter, and the
 * removal. Adding and editing go through the Keep dialog, which talks to
 * the harness itself and hands back the item; the pane then re-reads.
 */

export interface LibraryFilter {
  readonly query: string
  readonly kind: LibraryKind | null
  readonly subject: string | null
}

export type LibraryView =
  | { readonly status: 'no-harness' }
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly listing: LibraryListing }
  | { readonly status: 'failed'; readonly error: HarnessFailure }

export interface Library {
  readonly view: LibraryView
  readonly refreshing: boolean
  readonly filter: LibraryFilter
  setFilter: (filter: LibraryFilter) => void
  refresh: () => Promise<void>
  remove: (id: string) => Promise<HarnessFailure | null>
}

const EMPTY_FILTER: LibraryFilter = { query: '', kind: null, subject: null }

export function useLibrary(): Library {
  const connect = useHarnessClient()
  const [view, setView] = useState<LibraryView>({ status: 'loading' })
  const [refreshing, setRefreshing] = useState(false)
  const [filter, setFilter] = useState<LibraryFilter>(EMPTY_FILTER)
  const live = useRef(true)

  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
    }
  }, [])

  const read = useCallback(
    async (quiet: boolean) => {
      const harness = await connect()
      if (!live.current) return
      if (harness === null) {
        setView({ status: 'no-harness' })
        return
      }
      if (quiet) setRefreshing(true)
      const result = await harness.listLibraryItems({
        ...(filter.query.trim() === '' ? {} : { query: filter.query.trim() }),
        ...(filter.kind === null ? {} : { kind: filter.kind }),
        ...(filter.subject === null ? {} : { subject: filter.subject }),
        limit: 200,
      })
      if (!live.current) return
      setRefreshing(false)
      if (!result.ok) {
        if (!quiet) setView({ status: 'failed', error: result.error })
        return
      }
      setView({ status: 'ready', listing: result.value })
    },
    [connect, filter],
  )

  // A typed word waits a moment before it is asked; a filter click asks now.
  useEffect(() => {
    const timer = setTimeout(() => void read(view.status === 'ready'), filter.query === '' ? 0 : 200)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-read on filter change only.
  }, [read])

  return {
    view,
    refreshing,
    filter,
    setFilter,
    refresh: useCallback(() => read(true), [read]),
    remove: useCallback(
      async (id: string) => {
        const harness = await connect()
        if (harness === null) return NO_HARNESS
        const result = await harness.removeLibraryItem(id)
        if (!result.ok) return result.error
        await read(true)
        return null
      },
      [connect, read],
    ),
  }
}
