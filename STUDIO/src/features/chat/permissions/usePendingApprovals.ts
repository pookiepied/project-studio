import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { questionFromRecord, type PermissionQuestion } from '@/domain/permissions/question'
import { useWorkspace } from '@/stores/workspace'
import type { ApprovalAnswer, PendingApprovalRecord } from '@/platform/harness'

/**
 * How often the pending list is read while the answer matters this second:
 * a run is live, or a question is already on screen and someone is about to
 * answer it. One SELECT over a table that is empty nearly always.
 */
const ACTIVE_POLL_MS = 1_000

/**
 * How often the list is read while the conversation merely sits open. Slow,
 * because nothing here is urgent - but not zero, because a question can
 * outlive the harness process that raised it, and a queue the webview only
 * reads while a run is live would never show an inherited question at all.
 */
const IDLE_POLL_MS = 10_000

/**
 * The permission questions that belong to one conversation, and the answers
 * a person can give.
 *
 * ---- Why a poll ------------------------------------------------------------
 *
 * Task 47 settled the channel: the conversation stream cannot carry the
 * question (Flue's chunk union is closed and the application has no way to
 * append to it), and `GET /api/permissions/pending` reads the durable store -
 * which is exactly the state that survives a restart. So the poll answer and
 * the crash-recovery answer are the same answer from the same source, and
 * there is no second representation to reconcile.
 *
 * ---- What the poll covers --------------------------------------------------
 *
 * Three situations, deliberately on one cadence:
 *
 * - A live run raises a question: the fast cadence catches it within a
 *   second of the run parking.
 * - The run that raised a question is gone (the harness restarted under it):
 *   the row is still in the durable store, the slow cadence still reads it,
 *   and answering it clears the queue without pretending the run resumed -
 *   the phase machine here is never touched by an answer.
 * - No harness: a read that fails says nothing about the queue. The last
 *   known rows stay on screen, because an unanswered question does not stop
 *   existing because the process holding it went down.
 */
export function usePendingApprovals(
  conversationId: string,
  options: {
    /** False on surfaces with no harness conversation behind them (the gallery). */
    readonly enabled?: boolean
    /** Whether a run is under way - the fast cadence's other trigger. */
    readonly active?: boolean
  } = {},
): {
  /** The conversation's questions, oldest first. Empty means nothing is asked. */
  readonly questions: readonly PermissionQuestion[]
  /** While an answer is in flight; the prompt's controls are disabled. */
  readonly answeringId: string | null
  answer: (id: string, answer: ApprovalAnswer) => Promise<void>
  /** Withdraws every question this conversation has pending. Safe when empty. */
  cancelAll: () => void
} {
  const { enabled = true, active = false } = options
  const { approvals } = useWorkspace()

  // The raw rows, unfiltered: the store answers for every conversation. The
  // filter happens at render time, so switching conversations re-filters the
  // same poll without re-reading.
  const [records, setRecords] = useState<readonly PendingApprovalRecord[]>([])
  const [answeringId, setAnsweringId] = useState<string | null>(null)
  const liveRef = useRef(true)
  useEffect(() => {
    liveRef.current = true
    return () => {
      liveRef.current = false
    }
  }, [])

  // Counted questions, not a boolean: while a run is parked the queue is
  // usually non-empty, but the two are different facts - the queue can hold
  // an inherited question with no run anywhere, and that is exactly when the
  // poll must keep going.
  const questionCount = records.filter(
    (record) => record.conversationId === conversationId,
  ).length
  const busy = active || questionCount > 0

  const read = useCallback(async () => {
    const result = await approvals.list()
    // A failed read keeps what was last known: the queue is durable state,
    // and "the harness is down" is not the same fact as "nothing is asked".
    if (!result.ok || !liveRef.current) return
    setRecords(result.value)
  }, [approvals])

  useEffect(() => {
    if (!enabled) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const tick = () => {
      void read().then(() => {
        if (liveRef.current) timer = setTimeout(tick, busy ? ACTIVE_POLL_MS : IDLE_POLL_MS)
      })
    }
    tick()
    return () => {
      if (timer !== null) clearTimeout(timer)
    }
  }, [enabled, busy, read])

  const answer = useCallback(
    async (id: string, answer: ApprovalAnswer) => {
      setAnsweringId(id)
      try {
        const result = await approvals.answer(id, answer)
        // Only an accepted answer removes the row locally; a refusal stays
        // for the next poll to reconcile, which is also what catches the
        // race where another window answered first.
        if (result.ok && liveRef.current) {
          setRecords((current) => current.filter((record) => record.id !== id))
        }
      } finally {
        if (liveRef.current) setAnsweringId(null)
      }
    },
    [approvals],
  )

  const cancelAll = useCallback(() => {
    for (const record of records) {
      if (record.conversationId === conversationId) {
        void approvals.cancel(record.id)
      }
    }
  }, [approvals, conversationId, records])

  const questions = useMemo(() => {
    // Compared bare. The scope's conversation id was `conversation:<id>` under
    // Flue 1.0 and this filter was written against that; 2.0 made the agent
    // instance id the conversation id and dropped the prefix, and because the
    // mismatch has no error in it - the poll succeeds, the list is simply
    // empty - the prompt stopped rendering and every run needing an approval
    // parked forever with nothing on screen. Anything that changes the shape
    // of this id has to change it here too.
    const own = records.filter(
      (record) => record.conversationId === conversationId,
    )
    // Oldest first, the order the harness raised them in: the gate parks per
    // resource in the order the call names them, so the queue's order is the
    // command line's order.
    own.sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1))
    return own.map(questionFromRecord)
  }, [records, conversationId])

  return { questions, answeringId, answer, cancelAll }
}
