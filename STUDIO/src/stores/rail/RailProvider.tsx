import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import type { Artifact } from '@/domain/artifacts/types'
import type { BrowserFrame, BrowserStep } from '@/domain/browser/steps'
import type { ReportFamilyId } from '@/features/chat/transcript/live/reportFamily'

/**
 * The side rail's state.
 *
 * The rail holds artifacts opened out of the transcript so they can be read at
 * a size the message column cannot give them — a long search, a table with
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
 * the list stays navigable at any size — and a cap drops the oldest, because a
 * rail is a workbench, not an archive.
 */

/**
 * What the rail holds.
 *
 * An artifact entry is a thing the model produced out of the transcript. A
 * plan entry is the conversation's standing plan - one per conversation,
 * addressed by the conversation, exempt from the cap (a conversation has one
 * plan, and evicting it to make room for a search result is a bug that only
 * shows up in long sessions). The rail is where both live because both are
 * "too big for the reading column", not because they are the same kind of
 * thing; the union says they are not.
 */
export type RailEntry =
  | {
      readonly kind: 'artifact'
      /** The artifact's own id, which is also what makes opening idempotent. */
      readonly id: string
      readonly artifact: Artifact
      /** Which conversation produced it. The grouping key. */
      readonly conversationId: string
      readonly conversationTitle: string
      readonly openedAt: number
    }
  | {
      /**
       * The conversation's background commands: one entry, not one per job.
       *
       * Like the plan, and for the same reason. Jobs arrive and end on their
       * own schedule, and a tab per job would open and close the rail under
       * somebody who was reading something else in it. One entry that lists
       * them stays put.
       */
      readonly kind: 'jobs'
      /** `jobs:<conversation id>` - one per conversation, keyed by it. */
      readonly id: string
      readonly conversationId: string
      readonly conversationTitle: string
      readonly openedAt: number
    }
  | {
      readonly kind: 'plan'
      /** `plan:<conversation id>` - one per conversation, keyed by it. */
      readonly id: string
      readonly conversationId: string
      readonly conversationTitle: string
      readonly openedAt: number
    }
  | {
      /**
       * The browser, as a report of one.
       *
       * One entry per conversation, like the plan and the jobs, and for the
       * same reason: a conversation drives one browser through many calls, and
       * a tab per call would open and close the rail under somebody who was
       * reading something else in it. The entry is replaced in place as the
       * model works, so the rail always holds the latest frame.
       *
       * It is a preview and not a browser (ADR 0049 §7). There is no address
       * bar and no way to navigate by hand - that needs history, cookies,
       * profiles, a download policy and a clear-data control, which is a
       * second product inside this one, for a person who has a real browser
       * one keystroke away.
       */
      readonly kind: 'browser'
      /**
       * Which capability this is a report of. The computer's report (ADR
       * 0055 §7) is the same entry - a picture and a sequence - under its own
       * family, and its own tab: a conversation may drive both at once.
       */
      readonly family: ReportFamilyId
      /** `browser:<conversation id>` or `computer:<conversation id>` - one per conversation and family. */
      readonly id: string
      readonly conversationId: string
      readonly conversationTitle: string
      readonly openedAt: number
      readonly url: string | null
      readonly title: string | null
      /**
       * The newest picture the browser produced, in whatever spelling the log
       * carries it - an attachment reference most of the time, which the panel
       * resolves through the same seam the transcript uses. Nothing here is a
       * finished `data:` URL: resolving is rendering's job, not storage's.
       */
      readonly frame: BrowserFrame | null
      /** What the model has done in the browser, oldest first. */
      readonly steps: readonly BrowserStep[]
    }

/** The id of a conversation's plan entry. One plan per conversation, so the conversation keys it. */
export function planEntryId(conversationId: string): string {
  return `plan:${conversationId}`
}

/** The id of a conversation's background-commands entry. Keyed the same way. */
export function jobsEntryId(conversationId: string): string {
  return `jobs:${conversationId}`
}

/** The id of a conversation's browser or computer preview. Keyed the same way. */
function reportEntryId(family: ReportFamilyId, conversationId: string): string {
  return `${family}:${conversationId}`
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
 * already speaks — the page is a rounded panel resting on the sidebar, and the
 * rail is another panel beside it.
 */

/** Beyond this the strip stops being scannable, so the oldest entry goes. */
const MAX_ENTRIES = 12

/**
 * The cap, applied to a strip that has just grown by one.
 *
 * Two rules at once, and they are not the same rule. The cap governs the whole
 * strip, because scannability is a property of how many tabs there are, not of
 * what kind they are. But the entry it drops is always the oldest artifact: a
 * conversation has one plan, and evicting it to make room for a search result
 * is the bug that only shows up in long sessions.
 *
 * Shared by both openers rather than living in the artifact one, because the
 * cap has to hold whichever order the strip filled in. Applying it only when
 * an artifact arrives left twelve artifacts plus a plan sitting at thirteen.
 */
function capped(grown: readonly RailEntry[]): readonly RailEntry[] {
  if (grown.length <= MAX_ENTRIES) return grown
  const oldest = grown.find((entry) => entry.kind === 'artifact')
  return oldest === undefined ? grown : grown.filter((entry) => entry !== oldest)
}

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
   * rail cannot both have the window — at any width where both fit, the
   * conversation between them is narrower than either — so opening one folds
   * the other. Folding must be recoverable without the user having to find the
   * artifact in the transcript again, which is why this is a separate flag
   * rather than a call to `closeAll`.
   */
  readonly collapsed: boolean
  readonly entries: readonly RailEntry[]
  readonly activeId: string | null
  readonly width: number

  openArtifact: (artifact: Artifact, conversationId: string, conversationTitle: string) => void
  /** Opens - or focuses - the conversation's plan entry. Idempotent, like openArtifact. */
  openPlan: (conversationId: string, conversationTitle: string) => void
  /** Opens - or focuses - the conversation's background commands. Idempotent too. */
  openJobs: (conversationId: string, conversationTitle: string) => void
  /**
   * Takes the browser's whole derived report and replaces what the entry
   * holds.
   *
   * The caller reads the report off the transcript - every step, the latest
   * place and picture - so what arrives here is the complete truth for the
   * conversation, and nothing merges: merging a derived report with a stored
   * one is how two readings of the same log drift apart. What stays put is
   * the tab itself, so a person reading the preview keeps reading it while
   * the model works rather than watching tabs open behind them.
   *
   * It does NOT focus the rail. A model browsing in the background must not
   * seize the panel somebody is reading - the transcript row is where the
   * work announces itself, and opening the preview is the person's move.
   */
  showBrowser: (
    conversationId: string,
    conversationTitle: string,
    report: {
      readonly family: ReportFamilyId
      readonly url: string | null
      readonly title: string | null
      readonly frame: BrowserFrame | null
      readonly steps: readonly BrowserStep[]
    },
  ) => void
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
        // matters as much as not duplicating — an artifact still streaming
        // will be opened again with more of itself, and the rail should show
        // the newer one without moving it in the strip.
        if (existing) {
          return current.map((entry) =>
            entry.id === artifact.id ? { ...entry, artifact } : entry,
          )
        }

        const next: RailEntry = {
          kind: 'artifact',
          id: artifact.id,
          artifact,
          conversationId,
          conversationTitle,
          openedAt: Date.now(),
        }

        return capped([...current, next])
      })

      setActiveId(artifact.id)
      // Opening something is a request to see it. Arriving into a rail that is
      // folded away would look like the button did nothing.
      setCollapsed(false)
    },
    [],
  )

  const openPlan = useCallback((conversationId: string, conversationTitle: string) => {
    const id = planEntryId(conversationId)
    setEntries((current) => {
      const existing = current.find((entry) => entry.id === id)
      if (existing) {
        // Focused, not duplicated - the same rule as openArtifact, and it
        // falls out of the keying: the conversation is the key, so a second
        // open finds the one entry and re-titles it in place.
        return current.map((entry) =>
          entry.id === id && entry.kind === 'plan' ? { ...entry, conversationTitle } : entry,
        )
      }
      return capped([
        ...current,
        { kind: 'plan', id, conversationId, conversationTitle, openedAt: Date.now() },
      ])
    })

    setActiveId(id)
    setCollapsed(false)
  }, [])

  const openJobs = useCallback((conversationId: string, conversationTitle: string) => {
    const id = jobsEntryId(conversationId)
    setEntries((current) => {
      const existing = current.find((entry) => entry.id === id)
      if (existing) {
        return current.map((entry) =>
          entry.id === id && entry.kind === 'jobs' ? { ...entry, conversationTitle } : entry,
        )
      }
      return capped([
        ...current,
        { kind: 'jobs', id, conversationId, conversationTitle, openedAt: Date.now() },
      ])
    })

    setActiveId(id)
    setCollapsed(false)
  }, [])

  const showBrowser = useCallback<RailValue['showBrowser']>(
    (conversationId, conversationTitle, report) => {
      const id = reportEntryId(report.family, conversationId)
      setEntries((current) => {
        const existing = current.find((entry) => entry.id === id)
        const next: RailEntry = {
          kind: 'browser',
          family: report.family,
          id,
          conversationId,
          conversationTitle,
          openedAt: existing?.openedAt ?? Date.now(),
          url: report.url,
          title: report.title,
          frame: report.frame,
          steps: report.steps,
        }
        // Kept in place, not moved to the end of the strip: the reader who is
        // watching has the tab where they left it, and a model working in the
        // background must not shuffle the furniture.
        if (existing !== undefined) {
          return current.map((entry) => (entry.id === id ? next : entry))
        }
        return capped([...current, next])
      })
    },
    [],
  )

  const close = useCallback((id: string) => {
    setEntries((current) => {
      const index = current.findIndex((entry) => entry.id === id)
      const next = current.filter((entry) => entry.id !== id)

      // Focus the neighbour, preferring the one before — closing a tab should
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
      openPlan,
      openJobs,
      showBrowser,
      focus: setActiveId,
      close,
      closeAll,
      collapse: () => setCollapsed(true),
      expand: () => setCollapsed(false),
      setWidth,
    }),
    [
      entries,
      activeId,
      width,
      collapsed,
      openArtifact,
      openPlan,
      openJobs,
      showBrowser,
      close,
      closeAll,
      setWidth,
    ],
  )

  return <RailContext.Provider value={value}>{children}</RailContext.Provider>
}

export function useRail(): RailValue {
  const value = useContext(RailContext)
  if (!value) throw new Error('useRail must be used inside RailProvider')
  return value
}

export { MIN_WIDTH as RAIL_MIN_WIDTH, MAX_WIDTH as RAIL_MAX_WIDTH }
