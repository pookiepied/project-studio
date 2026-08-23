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
 * There is one placement, and this note is why there is not two.
 *
 * It shipped with a toggle between a floating inset panel and a flush
 * full-height one. Both looked fine and that was the problem: it was a control
 * that changed a great deal, was needed by nobody in particular, and asked the
 * reader to hold an opinion about window furniture in the middle of a
 * conversation. A setting whose right answer is "either" is a setting that
 * should not exist.
 *
 * The rail floats, inset, because that is the language the rest of the window
 * already speaks -- the page is a rounded panel resting on the sidebar, and the
 * rail is another panel beside it.
 */

/** Beyond this the strip stops being scannable, so the oldest entry goes. */
const MAX_ENTRIES = 12

const MIN_WIDTH = 320
const MAX_WIDTH = 760

interface RailValue {
  /** Showing: it holds something *and* has not been folded away. */
  readonly open: boolean
  /**
   * Holding something that is not currently on screen.
   *
   * The distinction between this and `open` is the whole point. Closing the
   * rail throws its contents away; collapsing it does not. The sidebar and the
   * rail cannot both have the window -- at any width where both fit, the
   * conversation between them is narrower than either -- so opening one folds
   * the other. Folding must be recoverable without the user having to find the
   * artifact in the transcript again, which is why this is a separate flag
   * rather than a call to `closeAll`.
   */
  readonly collapsed: boolean
  readonly entries: readonly RailEntry[]
  readonly activeId: string | null
  readonly width: number

  openArtifact: (artifact: Artifact, conversationId: string, conversationTitle: string) => void
  focus: (id: string) => void
  close: (id: string) => void
  closeAll: () => void
  /** Fold away, keeping every entry. */
  collapse: () => void
  /** Bring it back, exactly as it was. */
  expand: () => void
  setWidth: (width: number) => void
}

const RailContext = createContext<RailValue | null>(null)

export function RailProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<readonly RailEntry[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [width, setRawWidth] = useState(420)
  const [collapsed, setCollapsed] = useState(false)

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
      // Opening something is a request to see it. Arriving into a rail that is
      // folded away would look like the button did nothing.
      setCollapsed(false)
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
      open: entries.length > 0 && !collapsed,
      collapsed: entries.length > 0 && collapsed,
      entries,
      activeId,
      width,
      openArtifact,
      focus: setActiveId,
      close,
      closeAll,
      collapse: () => setCollapsed(true),
      expand: () => setCollapsed(false),
      setWidth,
    }),
    [entries, activeId, width, collapsed, openArtifact, close, closeAll, setWidth],
  )

  return <RailContext.Provider value={value}>{children}</RailContext.Provider>
}

export function useRail(): RailValue {
  const value = useContext(RailContext)
  if (!value) throw new Error('useRail must be used inside RailProvider')
  return value
}

export { MIN_WIDTH as RAIL_MIN_WIDTH, MAX_WIDTH as RAIL_MAX_WIDTH }
