import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigation } from '@/stores/navigation'
import { useLiveWork, useWorkspace } from '@/stores/workspace'

/** What a conversation is doing, for the rows that list it. Absent means nothing to say. */
export type ConversationStatus = 'running' | 'input' | 'done'

/** While something is under way, a finish or a question should show promptly. */
const BUSY_POLL_MS = 1_500
/** Nothing here is urgent, but a run started elsewhere still has to appear. */
const IDLE_POLL_MS = 5_000

/** What must outlast a reload: a run can end while no window is there to see it. */
const STORAGE_KEY = 'studio.conversation-status'

const NOTHING: ReadonlySet<string> = new Set()
const NO_STATUSES: ReadonlyMap<string, ConversationStatus> = new Map()

const ConversationStatusContext = createContext<ReadonlyMap<string, ConversationStatus>>(NO_STATUSES)

function sameMembers(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size === b.size && [...a].every((id) => b.has(id))
}

function readRemembered(): { readonly active: ReadonlySet<string>; readonly done: ReadonlySet<string> } {
  const ids = (value: unknown) =>
    new Set(Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [])
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as { active?: unknown; done?: unknown }
    return { active: ids(stored.active), done: ids(stored.done) }
  } catch {
    return { active: NOTHING, done: NOTHING }
  }
}

function remember(active: ReadonlySet<string>, done: ReadonlySet<string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ active: [...active], done: [...done] }))
  } catch {
    // A convenience, not a record: without it a reload only forgets the checks.
  }
}

/**
 * Every conversation's status, including the ones that are not open.
 *
 * A page can only report on itself, and it stops reporting when it closes, so the
 * harness is the witness here: it says which conversations have a turn in flight,
 * and which are waiting on a permission or a question. All three lists are
 * harness-wide, so one read covers every conversation.
 *
 * `done` is the one fact the harness does not hold. It means a turn finished while
 * the conversation was not on screen, so it is noticed here as a run ending, and
 * opening the conversation clears it. It says a turn ended, not how: a turn that
 * failed is `done` too. What was running is remembered across a reload, so a run
 * that ends while the window is gone is still noticed when it comes back.
 *
 * A hidden window's timers are slowed by the webview, so its reads can fall far
 * behind. Coming back to the window reads at once rather than waiting them out.
 *
 * A failed read keeps what was last known, as the pending hooks do: "the harness
 * is down" is not the same fact as "nothing is happening". For the same reason
 * nothing is called finished until the harness has been heard from.
 */
export function ConversationStatusProvider({ children }: { children: ReactNode }) {
  const { approvals, questions, runningConversations } = useWorkspace()
  const { running: witnessed, markRunning } = useLiveWork()
  const { route } = useNavigation()
  const openId = route.kind === 'chat' ? route.conversationId : null

  const [reported, setReported] = useState<ReadonlySet<string>>(NOTHING)
  const [waiting, setWaiting] = useState<ReadonlySet<string>>(NOTHING)
  const [remembered] = useState(readRemembered)
  const [done, setDone] = useState<ReadonlySet<string>>(remembered.done)
  const [heard, setHeard] = useState(false)

  // The poll reads these rather than depending on them, so a change of page or a
  // new mark does not restart its timer.
  const latest = useRef({ witnessed, openId, busy: false })
  latest.current = { witnessed, openId, busy: reported.size + waiting.size + witnessed.size > 0 }

  useEffect(() => {
    let live = true
    let timer: ReturnType<typeof setTimeout> | null = null
    let reading = false

    const read = async () => {
      const [runs, permissions, asked] = await Promise.all([
        runningConversations(),
        approvals.list(),
        questions.list(),
      ])
      if (!live) return

      if (runs.ok) {
        const next = new Set(runs.value)
        setHeard(true)
        setReported((current) => (sameMembers(current, next) ? current : next))
        // A page that closed mid-turn left its mark behind with nobody to clear
        // it. The open page still speaks for itself, including before admission.
        for (const id of latest.current.witnessed) {
          if (id !== latest.current.openId && !next.has(id)) markRunning(id, false)
        }
      }
      if (permissions.ok && asked.ok) {
        const next = new Set<string>()
        for (const row of [...permissions.value, ...asked.value]) {
          // A row with no conversation has no row in any list to mark.
          if (row.conversationId !== null) next.add(row.conversationId)
        }
        setWaiting((current) => (sameMembers(current, next) ? current : next))
      }
    }

    const tick = () => {
      if (reading) return
      reading = true
      if (timer !== null) clearTimeout(timer)
      void read().finally(() => {
        reading = false
        if (live) timer = setTimeout(tick, latest.current.busy ? BUSY_POLL_MS : IDLE_POLL_MS)
      })
    }
    tick()

    const onReturn = () => {
      if (document.visibilityState === 'visible') tick()
    }
    document.addEventListener('visibilitychange', onReturn)
    window.addEventListener('focus', onReturn)

    return () => {
      live = false
      if (timer !== null) clearTimeout(timer)
      document.removeEventListener('visibilitychange', onReturn)
      window.removeEventListener('focus', onReturn)
    }
  }, [approvals, questions, runningConversations, markRunning])

  const active = useMemo(() => new Set([...reported, ...witnessed]), [reported, witnessed])

  // Noticed on the way out of `active`, so a conversation that was idle when
  // Studio opened is never called finished.
  const wasActive = useRef<ReadonlySet<string>>(remembered.active)
  useEffect(() => {
    if (!heard) return
    const ended = [...wasActive.current].filter((id) => !active.has(id) && id !== openId)
    wasActive.current = active
    setDone((current) => {
      const next = new Set([...current, ...ended])
      for (const id of active) next.delete(id)
      if (openId !== null) next.delete(openId)
      return sameMembers(current, next) ? current : next
    })
  }, [active, openId, heard])

  useEffect(() => {
    if (heard) remember(active, done)
  }, [active, done, heard])

  const statuses = useMemo(() => {
    const next = new Map<string, ConversationStatus>()
    for (const id of done) next.set(id, 'done')
    for (const id of active) next.set(id, 'running')
    // Last, because a run parked on a question is both, and the question is the
    // part that needs a person.
    for (const id of waiting) next.set(id, 'input')
    return next
  }, [done, active, waiting])

  return <ConversationStatusContext.Provider value={statuses}>{children}</ConversationStatusContext.Provider>
}

/** Empty outside the provider: a detached window lists no other conversations. */
export function useConversationStatuses(): ReadonlyMap<string, ConversationStatus> {
  return useContext(ConversationStatusContext)
}
