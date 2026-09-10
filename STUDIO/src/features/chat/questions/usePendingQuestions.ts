import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useWorkspace } from '@/stores/workspace'
import type { HarnessFailure, PendingQuestionRecord } from '@/platform/harness'

/**
 * How often the pending list is read while the answer matters this second:
 * a run is live, or a question is already on screen and someone is about to
 * answer it. One SELECT over a table that is empty nearly always - and the
 * same read that notices a question also honours its deadline, since the
 * harness settles expired questions on every list.
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
 * The questions this conversation's runs are asking, and the answers a
 * person can give.
 *
 * The same poll shape the approvals hook runs, and deliberately not the same
 * hook: the two channels answer different questions, take different bodies,
 * and this one carries a stop that ends a whole conversation's questions.
 * Sharing a hook would be the first step toward sharing rows, and the rows
 * must never meet.
 */
export function usePendingQuestions(
  conversationId: string,
  options: {
    /** False on surfaces with no harness conversation behind them (the gallery). */
    readonly enabled?: boolean
    /** Whether a run is under way - the fast cadence's other trigger. */
    readonly active?: boolean
  } = {},
): {
  /** The conversation's pending questions, oldest first. Empty means none. */
  readonly rows: readonly PendingQuestionRecord[]
  /** While an answer is in flight; the card's controls are disabled. */
  readonly answeringId: string | null
  /**
   * The harness's own sentence for a question that was answered from somewhere
   * else while this window was showing it, or null. Carried the way a refusal
   * never is: the sentence explains the vanishing instead of leaving a card
   * that simply never comes back.
   */
  readonly answeredElsewhere: string | null
  answer: (
    id: string,
    answer: { optionIds?: readonly string[]; text?: string; deferred?: boolean },
  ) => Promise<void>
  /** Stops every question this conversation is asking. Safe when empty. */
  stop: () => void
  /** Withdraws every question this conversation has pending. Safe when empty. */
  cancelAll: () => void
} {
  const { enabled = true, active = false } = options
  const { questions } = useWorkspace()

  // The raw rows, unfiltered: the store answers for every conversation. The
  // filter happens at render time, so switching conversations re-filters the
  // same poll without re-reading.
  const [records, setRecords] = useState<readonly PendingQuestionRecord[]>([])
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
    const result = await questions.list()
    // A failed read keeps what was last known: the queue is durable state,
    // and "the harness is down" is not the same fact as "nothing is asked".
    if (!result.ok || !liveRef.current) return
    setRecords(result.value)
  }, [questions])

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
    async (
      id: string,
      answer: { optionIds?: readonly string[]; text?: string; deferred?: boolean },
    ) => {
      setAnsweringId(id)
      try {
        const result = await questions.answer(id, answer)
        if (!liveRef.current) return
        if (result.ok) {
          setRecords((current) => current.filter((record) => record.id !== id))
          return
        }
        // Losing the race is not a failure to ride out until the next poll
        // reconciles it: the harness has said the row is gone because another
        // window's answer got there first, so the row leaves the screen at
        // once and the harness's own sentence says where it went. A card that
        // simply vanishes reads as a glitch; the same event with a sentence
        // reads as what it was - someone answered it already.
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
    [questions],
  )

  const stop = useCallback(() => {
    void questions.stop(conversationId).then(() => {
      if (!liveRef.current) return
      // Stopped rows are settled, not deleted, so the next read leaves the
      // queue empty; clearing now keeps the card from lingering one poll.
      setRecords((current) => current.filter((record) => record.conversationId !== conversationId))
    })
  }, [questions, conversationId])

  const cancelAll = useCallback(() => {
    for (const record of records) {
      if (record.conversationId === conversationId) {
        void questions.cancel(record.id)
      }
    }
  }, [questions, conversationId, records])

  const rows = useMemo(() => {
    // Compared bare, exactly as the approvals hook compares its id: the
    // scope's conversation id lost its `conversation:` prefix in the Flue 2.0
    // migration, and a filter written against the old shape has no error in
    // it - the poll succeeds, the list is simply empty, the card never
    // renders, and the run parks forever with nothing on screen.
    const own = records.filter((record) => record.conversationId === conversationId)
    // Oldest first, the order the harness raised them in: one call's
    // questions are asked one at a time, in order.
    own.sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1))
    return own
  }, [records, conversationId])

  return { rows, answeringId, answeredElsewhere, answer, stop, cancelAll }
}
