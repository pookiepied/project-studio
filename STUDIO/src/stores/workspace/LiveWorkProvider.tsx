import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ContextReport } from '@/domain/turn/context'

/**
 * What is happening right now, kept apart from what exists.
 *
 * The workspace store publishes the index: which conversations and projects
 * there are, and the writes that change them. That changes when a person
 * does something. This store publishes the two facts an open conversation
 * reports while a turn runs - that it is working, and what its context
 * costs - and the second of those changes with nearly every streamed delta,
 * because the pending estimate is a count of characters.
 *
 * Published from the same context, every delta would hand a new value to
 * every reader of the index: the sidebar and each of its rows, the palette,
 * the settings panes, none of which asked about the stream. Published from
 * this one, a delta reaches the top strip's ring and the row that carries
 * the working mark, and nothing else. That is the whole reason this is a
 * second provider rather than four more fields on the first.
 */
interface LiveWorkValue {
  /**
   * Which conversations are working right now.
   *
   * A set rather than a flag: the sidebar answers "is anything happening in
   * the other three" without being one of them.
   */
  readonly running: ReadonlySet<string>
  /**
   * Marks a conversation working, or settled. Kept on the store rather than
   * derived, because the witness is the phase machine of an open
   * conversation, and the sidebar asks about conversations that are not open.
   */
  markRunning: (conversationId: string, active: boolean) => void
  /**
   * What a conversation's context costs, by conversation id: the last turn
   * the provider reported on, and an estimate of everything since.
   *
   * On the store for the same reason `running` is: the witness is the open
   * conversation's own live projection, and the reader is the top strip,
   * which is not that page and cannot see its transcript. Absent means the
   * page has said nothing yet, which is not the same as an empty window.
   */
  readonly contextReports: ReadonlyMap<string, ContextReport>
  /** Reports what the open conversation's transcript currently costs. */
  markContextReport: (conversationId: string, report: ContextReport | null) => void
  /**
   * Conversations being compacted by hand right now. The witness is the
   * control that asked for it, in the top strip; the reader is the page,
   * which shows the state, and the strip itself, which disables the control.
   */
  readonly compacting: ReadonlySet<string>
  markCompacting: (conversationId: string, active: boolean) => void
  /**
   * A counter per conversation that the page's measurement read depends on,
   * bumped when something other than a turn ending has changed the figure -
   * a compaction by hand - so the page reads it again.
   */
  readonly contextRevisions: ReadonlyMap<string, number>
  bumpContext: (conversationId: string) => void
}

const LiveWorkContext = createContext<LiveWorkValue | null>(null)

export function LiveWorkProvider({
  onSettled,
  children,
}: {
  /**
   * A conversation went from working to settled - a turn actually ending,
   * not a page mounting on an idle conversation. The workspace store arms
   * its one title re-read on this.
   */
  readonly onSettled: (conversationId: string) => void
  readonly children: ReactNode
}) {
  const [running, setRunning] = useState<ReadonlySet<string>>(() => new Set())
  // Mirrors `running` so the true-to-false transition is visible outside the
  // state updater, where the settlement callback has to be made.
  const runningWitnessRef = useRef<ReadonlySet<string>>(new Set())

  const markRunning = useCallback(
    (conversationId: string, active: boolean) => {
      const was = runningWitnessRef.current.has(conversationId)
      if (was === active) return
      const next = new Set(runningWitnessRef.current)
      if (active) next.add(conversationId)
      else next.delete(conversationId)
      runningWitnessRef.current = next
      setRunning(next)
      if (!active) onSettled(conversationId)
    },
    [onSettled],
  )

  const [contextReports, setContextReports] = useState<ReadonlyMap<string, ContextReport>>(
    () => new Map<string, ContextReport>(),
  )

  const markContextReport = useCallback(
    (conversationId: string, report: ContextReport | null) => {
      setContextReports((current) => {
        const held = current.get(conversationId)
        if (report === null) {
          if (held === undefined) return current
          const next = new Map(current)
          next.delete(conversationId)
          return next
        }
        // Compared field by field, not by identity: the page rebuilds this
        // object on every delivery, and storing each one would re-render the
        // strip for every streamed delta that changed nothing.
        if (
          held !== undefined &&
          held.pending === report.pending &&
          held.measured?.fresh === report.measured?.fresh &&
          held.measured?.cached === report.measured?.cached &&
          held.measured?.reply === report.measured?.reply &&
          held.measured?.estimated === report.measured?.estimated
        ) {
          return current
        }
        const next = new Map(current)
        next.set(conversationId, report)
        return next
      })
    },
    [],
  )

  const [compacting, setCompacting] = useState<ReadonlySet<string>>(() => new Set())
  const markCompacting = useCallback((conversationId: string, active: boolean) => {
    setCompacting((current) => {
      if (current.has(conversationId) === active) return current
      const next = new Set(current)
      if (active) next.add(conversationId)
      else next.delete(conversationId)
      return next
    })
  }, [])

  const [contextRevisions, setContextRevisions] = useState<ReadonlyMap<string, number>>(
    () => new Map<string, number>(),
  )
  const bumpContext = useCallback((conversationId: string) => {
    setContextRevisions((current) => {
      const next = new Map(current)
      next.set(conversationId, (current.get(conversationId) ?? 0) + 1)
      return next
    })
  }, [])

  const value = useMemo<LiveWorkValue>(
    () => ({
      running,
      markRunning,
      contextReports,
      markContextReport,
      compacting,
      markCompacting,
      contextRevisions,
      bumpContext,
    }),
    [
      running,
      markRunning,
      contextReports,
      markContextReport,
      compacting,
      markCompacting,
      contextRevisions,
      bumpContext,
    ],
  )

  return <LiveWorkContext.Provider value={value}>{children}</LiveWorkContext.Provider>
}

export function useLiveWork(): LiveWorkValue {
  const context = useContext(LiveWorkContext)
  if (!context) throw new Error('useLiveWork must be used within WorkspaceProvider')
  return context
}
