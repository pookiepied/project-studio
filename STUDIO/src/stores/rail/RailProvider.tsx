import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import type { Artifact } from '@/domain/artifacts/types'

/**
 * The side rail's state.
 *
 * The rail holds artifacts opened out of the transcript so they can be read at
 * a size the message column cannot give them -- a long search, a table with
 * fifteen columns, a generated image you want to look at properly.
 *
 * ---- Two things done differently from the version this follows -----------
 *
 * That one appended a tab per call, so opening the same artifact twice put two
 * identical tabs side by side and the strip filled with duplicates of whatever
 * you had clicked most. Entries are keyed by the artifact's own id here:
 * opening something already open focuses it instead.
 *
 * And tabs accumulated without limit. A conversation that produces fifteen
 * artifacts gave fifteen tabs, at which point the strip is scrolling
 * horizontally and finding anything means reading tiny labels one at a time.
 * Entries carry the conversation they came from and the rail groups by it, so
 * the list stays navigable at any size -- and a cap drops the oldest, because a
 * rail is a workbench, not an archive.
 */

export interface RailEntry {
  /** The artifact's own id, which is also what makes opening idempotent. */
  readonly id: string
  readonly artifact: Artifact
  /** Which conversation produced it. The grouping key. */
  readonly conversationId: string
  readonly conversationTitle: string
  readonly openedAt: number
}

/**
 * How the rail sits in the window.
 *
 * `inset` floats it as a panel with the window's ground visible around it,
 * matching the way the page itself is a rounded panel resting on the sidebar.
 * `full` runs it flush from top to bottom, which gives back the vertical
 * margins and is what you want when the thing being read is long.
 */
export type RailPlacement = 'inset' | 'full'

/** Beyond this the strip stops being scannable, so the oldest entry goes. */
const MAX_ENTRIES = 12

const MIN_WIDTH = 320
const MAX_WIDTH = 760

interface RailValue {
  readonly open: boolean
  readonly entries: readonly RailEntry[]
  readonly activeId: string | null
  readonly width: number
  readonly placement: RailPlacement

  openArtifact: (artifact: Artifact, conversationId: string, conversationTitle: string) => void
  focus: (id: string) => void
  close: (id: string) => void
  closeAll: () => void
  setWidth: (width: number) => void
  setPlacement: (placement: RailPlacement) => void
}

const RailContext = createContext<RailValue | null>(null)

export function RailProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<readonly RailEntry[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [width, setRawWidth] = useState(420)
  const [placement, setPlacement] = useState<RailPlacement>('inset')

  const openArtifact = useCallback(
    (artifact: Artifact, conversationId: string, conversationTitle: string) => {
      setEntries((current) => {
        const existing = current.find((entry) => entry.id === artifact.id)

        // Already here: replace it in place rather than appending. Replacing
        // matters as much as not duplicating -- an artifact still streaming
        // will be opened again with more of itself, and the rail should show
        // the newer one without moving it in the strip.
        if (existing) {
          return current.map((entry) =>
            entry.id === artifact.id ? { ...entry, artifact } : entry,
          )
        }

        const next: RailEntry = {
          id: artifact.id,
          artifact,
          conversationId,
          conversationTitle,
          openedAt: Date.now(),
        }

        const grown = [...current, next]
        return grown.length > MAX_ENTRIES ? grown.slice(grown.length - MAX_ENTRIES) : grown
      })

      setActiveId(artifact.id)
    },
    [],
  )

  const close = useCallback((id: string) => {
    setEntries((current) => {
      const index = current.findIndex((entry) => entry.id === id)
      const next = current.filter((entry) => entry.id !== id)

      // Focus the neighbour, preferring the one before -- closing a tab should
      // leave you where you were in the list, not jump you to the end of it.
      setActiveId((active) => {
        if (active !== id) return active
        if (next.length === 0) return null
        return next[Math.max(0, index - 1)]?.id ?? next[0].id
      })

      return next
    })
  }, [])

  const closeAll = useCallback(() => {
    setEntries([])
    setActiveId(null)
  }, [])

  // Clamped here rather than at the drag handle, so every caller gets the same
  // bounds and a stray value cannot leave the rail unusably narrow.
  const setWidth = useCallback((value: number) => {
    setRawWidth(Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(value))))
  }, [])

  const value = useMemo<RailValue>(
    () => ({
      open: entries.length > 0,
      entries,
      activeId,
      width,
      placement,
      openArtifact,
      focus: setActiveId,
      close,
      closeAll,
      setWidth,
      setPlacement,
    }),
    [entries, activeId, width, placement, openArtifact, close, closeAll, setWidth],
  )

  return <RailContext.Provider value={value}>{children}</RailContext.Provider>
}

export function useRail(): RailValue {
  const value = useContext(RailContext)
  if (!value) throw new Error('useRail must be used inside RailProvider')
  return value
}

export { MIN_WIDTH as RAIL_MIN_WIDTH, MAX_WIDTH as RAIL_MAX_WIDTH }
