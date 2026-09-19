import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { questionFromRecord, type PermissionQuestion } from '@/domain/permissions/question'
import { useWorkspace } from '@/stores/workspace'
import type { ApprovalAnswer, HarnessFailure, PendingApprovalRecord } from '@/platform/harness'

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
 * How long the "answered elsewhere" sentence stays after the card it explains.
 *
 * The sentence exists for the moment the card vanishes - the second in which
 * a person who was reading it needs to know it did not simply glitch away.
 * After a few seconds the moment has passed and a notice about a question
 * that left the screen long ago is noise, so the sentence clears itself.
 */
const ANSWERED_ELSEWHERE_MS = 6_000

/**
 * The harness's answer to losing the race: the row is gone because someone
 * else's answer got there first. A 404 from the answer route is exactly that
 * fact and nothing else - every other refusal of this route is a 400 - so the
 * status alone discriminates the race from every other failure the POST can
 * meet.
 */
function isAnsweredElsewhere(failure: HarnessFailure): boolean {
  return failure.kind === 'harness-error' && failure.status === 404
}

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
    /** Whether the conversation belongs to a project; decides how the sentence names the workspace. */
    readonly hasProject?: boolean
  } = {},
): {
  /** The conversation's questions, oldest first. Empty means nothing is asked. */
  readonly questions: readonly PermissionQuestion[]
  /** While an answer is in flight; the prompt's controls are disabled. */
  readonly answeringId: string | null
  /**
   * The harness's own sentence for a prompt that was answered from somewhere
   * else while this window was showing it, or null. Carried the way a refusal
   * never is: the sentence explains the vanishing instead of leaving a card
   * that simply never comes back.
   */
  readonly answeredElsewhere: string | null
  answer: (id: string, answer: ApprovalAnswer) => Promise<void>
  /** Withdraws every question this conversation has pending. Safe when empty. */
  cancelAll: () => void
} {
  const { enabled = true, active = false, hasProject = false } = options
  const { approvals } = useWorkspace()

  // The raw rows, unfiltered: the store answers for every conversation. The
  // filter happens at render time, so switching conversations re-filters the
  // same poll without re-reading.
  const [records, setRecords] = useState<readonly PendingApprovalRecord[]>([])
  const [answeringId, setAnsweringId] = useState<string | null>(null)
  const [answeredElsewhere, setAnsweredElsewhere] = useState<string | null>(null)
  const liveRef = useRef(true)
  const elsewhereTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    liveRef.current = true
    return () => {
      liveRef.current = false
      if (elsewhereTimer.current !== null) clearTimeout(elsewhereTimer.current)
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
        if (!liveRef.current) return
        if (result.ok) {
          setRecords((current) => current.filter((record) => record.id !== id))
          return
        }
        // Losing the race is not a failure to ride out until the next poll
        // reconciles it: the harness has said the row is gone because another
        // window's answer got there first, so the row leaves the screen at
        // once and the harness's own sentence says where it went. A prompt
        // that simply vanishes reads as a glitch; the same event with a
        // sentence reads as what it was - someone answered it already.
        if (isAnsweredElsewhere(result.error)) {
          setRecords((current) => current.filter((record) => record.id !== id))
          setAnsweredElsewhere(result.error.message)
          if (elsewhereTimer.current !== null) clearTimeout(elsewhereTimer.current)
          elsewhereTimer.current = setTimeout(() => {
            elsewhereTimer.current = null
            if (liveRef.current) setAnsweredElsewhere(null)
          }, ANSWERED_ELSEWHERE_MS)
          return
        }
        // Any other refusal stays for the next poll to reconcile: the queue
        // is durable state, and "the answer did not land" is not yet the fact
        // "nothing is asked".
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
    return own.map((record) => questionFromRecord(record, { hasProject }))
  }, [records, conversationId, hasProject])

  return { questions, answeringId, answeredElsewhere, answer, cancelAll }
}
