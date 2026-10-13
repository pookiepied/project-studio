import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { queuedMessages, rememberQueued, forgetQueued } from './queued-messages'
import {
  createConversationClient,
  type ChunkFacts,
  type ChunkPosition,
  type ConversationClient,
  type ConversationDelivery,
  type ConversationSnapshotFacts,
  type SeamFailure,
  type TurnImageWire,
  type TurnResult,
  type TurnSettingsWire,
} from '@/platform/harness'
import { defaultContactFor, type ContactHarness } from '@/platform/harness/contact'
import {
  defaultListen,
  type LifecycleListen,
  type LifecycleSignal,
} from '@/platform/harness/lifecycle'
import { firstAdmission, forgetFirstAdmission } from '@/features/chat/connection/first-attach'

/**
 * The facts a retry signal carries, verbatim from the wire. Which attempt
 * failed, out of what budget, how long the next wait is, and what the
 * provider said about the attempt that failed — nothing derived here, and
 * nothing fed back into requests.
 */
export interface RetryWaitFacts {
  readonly attempt: number
  readonly maxRetries: number
  readonly delayMs: number
  /** The provider's sentence for the failed attempt; null when none came. */
  readonly detail: string | null
}

/**
 * The states a conversation's connection to its run can be in.
 *
 * One tagged union, because each of these renders as a different thing, and
 * the combinations booleans allow — attaching *and* live, streaming *and*
 * interrupted — are not states a conversation has.
 *
 * - `no-harness` / `harness-starting`: Task 23's lifecycle events, finally
 *   consumed. `harness-starting` is now a real state, not a placeholder.
 * - `attaching`: a read is in flight and history is being replayed into it.
 * - `live`: the `up-to-date` transition happened — the replay is over and
 *   what follows is history being made.
 * - `submitted`: the harness admitted a turn and has produced nothing for it
 *   yet. This is a REPORT, not a guess: the admission receipt named the
 *   submission and the offset its events begin at, so saying "a turn is
 *   running" here repeats what the harness said rather than what a clock
 *   suspects. It is its own state rather than a `streaming` carrying nothing
 *   because "a turn exists" and "a turn is producing" are different facts
 *   that render differently — the working mark and the stop control belong
 *   to the first, the caret and the paced reveal only to the second — and
 *   folding them together would leave every consumer re-deriving the
 *   difference from a boolean, which is the shape the top of this comment
 *   refuses. Only the harness ends it: a start or a delta moves it on to
 *   `streaming`, a settlement to `idle` or `run-failed`, and a read that
 *   broke or went silent to `interrupted`. No timer here may end it, because
 *   a busy composer that unsticks itself on a clock is the silent stop
 *   wearing a spinner.
 * - `streaming`: a turn is being produced, carrying the submission it
 *   belongs to when one has been seen. `retrying` carries the harness's own
 *   announcement that a transient model failure is being retried inside that
 *   turn — a fact the wire did not have before Task 29, so a waiting retry
 *   is no longer indistinguishable from a stall. It clears the moment
 *   generation resumes or the turn settles, never by timing out locally.
 * - `idle`: the last turn settled completed — or the harness has no stream
 *   for this conversation yet, which is how every fresh conversation starts.
 * - `interrupted`: the read broke — transport failure, harness crash,
 *   harness stop. The offset is retained, so this is resumable, not lost.
 * - `run-failed`: a settlement said `failed` or `aborted`. Sticky until the
 *   user acts, because a failure that heals silently was never shown.
 */
export type ConversationPhase =
  | { readonly status: 'no-harness' }
  | { readonly status: 'harness-starting' }
  | { readonly status: 'attaching' }
  | { readonly status: 'live' }
  | { readonly status: 'submitted'; readonly submissionId: string }
  | {
      readonly status: 'streaming'
      readonly submissionId: string | null
      /** The scheduled retry being waited on, when the harness said so. */
      readonly retrying: RetryWaitFacts | null
    }
  | { readonly status: 'idle' }
  | { readonly status: 'interrupted'; readonly reason: string }
  | {
      readonly status: 'run-failed'
      readonly outcome: 'failed' | 'aborted'
      /** What the settlement means, in this file's own words. */
      readonly message: string
      /**
       * The provider's own sentence for the failure, when the wire carried
       * one — the part that names the cause. Null when it did not; nothing
       * invents a reason the harness never gave.
       */
      readonly detail: string | null
    }

/**
 * Whether a turn is under way at all, admitted or producing.
 *
 * The one question the composer and the working mark ask, in one place rather
 * than in each of them: a person watching the window cannot tell admission
 * from generation and should not have to, because what they need — their
 * words are gone, something is happening, here is how to stop it — is true
 * across both. Everything that distinguishes the two, the caret and the paced
 * reveal, reads `streaming` directly and must keep doing so.
 */
export function isTurnRunning(phase: ConversationPhase): boolean {
  return phase.status === 'submitted' || phase.status === 'streaming'
}

/**
 * The content half of a delivery: everything rendering reduces into the
 * transcript. Connection-only deliveries (liveness, foreign frames) stop at
 * this hook and never reach the projection — heartbeats are not content,
 * and the boundary between the two lives here rather than in every consumer.
 */
export type ConversationContent =
  | { readonly kind: 'snapshot'; readonly snapshot: ConversationSnapshotFacts }
  | { readonly kind: 'chunks'; readonly replaying: boolean; readonly chunks: readonly ChunkFacts[] }

export interface ConversationView {
  readonly phase: ConversationPhase
  /**
   * The last offset any delivery reported — everything durably known about
   * where this webview has read to (ADR 0045), and what the next attach
   * resumes from.
   */
  readonly offset: string | null
  /**
   * Reattaches from the retained offset. How `interrupted` and `run-failed`
   * clear; also safe any time, because attaching supersedes whatever read
   * is live rather than stacking on it.
   */
  resume: () => void
  /**
   * Submits one user turn through the harness, carrying the turn's settings.
   * Never retried here: an identical resend would be a SECOND turn, so a
   * failed submission is surfaced, not repeated. On success, makes sure a read
   * is attached - a conversation's very first turn creates the stream this
   * page has been unable to find since it mounts. The settings travel in the
   * submission body; the harness settles them into the index before the run
   * starts, and refuses a model nothing serves before creating anything.
   */
  submit: (
    message: string,
    settings: TurnSettingsWire,
    images?: readonly TurnImageWire[],
  ) => Promise<TurnResult<{ readonly submissionId: string }>>
  /** Aborts the RUN, and says so; reading on is how the UI learns the outcome. */
  abort: () => Promise<TurnResult<boolean>>
  /**
   * The last submission this connection refused to carry, held where the
   * other connection states render until the person dismisses it or the
   * next send succeeds. A refused POST used to change nothing at all —
   * the person typed, pressed send, and watched the app do exactly
   * nothing, which reads as a broken key rather than a broken connection.
   * The one exception is `no-harness`: while the phase machine is already
   * saying that permanently, a second notice would say it twice.
   */
  readonly refused: SeamFailure | null
  /** Puts the refusal away without sending anything. */
  dismissRefusal: () => void
}

/* -------------------------------------------------------------------------- */
/* Injectable seams                                                            */
/* -------------------------------------------------------------------------- */

export type { ContactHarness, LifecycleListen, LifecycleSignal }

/* -------------------------------------------------------------------------- */
/* Chunk reduction                                                             */
/* -------------------------------------------------------------------------- */

/** Lexicographic chunk order: by batch, then index. */
function atOrBefore(a: ChunkPosition, b: ChunkPosition): boolean {
  return a.batch < b.batch || (a.batch === b.batch && a.index <= b.index)
}

/**
 * What one batch of chunk facts does to the TURN state.
 *
 * Redelivered batches are dropped by position, not by faith: a reconnect
 * after an interruption replays the batch that was in flight, and the
 * projection's own ordering token is what makes that at-least-once delivery
 * safe to apply twice. Content goes through the transcript projection, which
 * keeps the same discipline over the same positions — this function reads
 * only what connection phases need, so the two concerns stay out of each
 * other's way.
 *
 * `message-started` opens a stream and names its submission;
 * `message-delta` proves generation is running even when the start scrolled
 * past the resume point; `submission-retrying` says the turn is paused on a
 * scheduled retry — it can only be believed while no later chunk shows
 * generation resumed, so any start, delta, or settlement after it clears it;
 * `submission-settled` ends that submission; the conversation remains busy
 * until all admitted inputs have settled.
 */
function reduceChunks(
  chunks: readonly ChunkFacts[],
  applied: ChunkPosition | null,
  outstanding: Set<string>,
  settledIds: Set<string>,
): {
  applied: ChunkPosition | null
  streaming: string | null
  retrying: RetryWaitFacts | null
  settled: 'completed' | 'failed' | 'aborted' | null
  settledReason: string | null
} {
  let streaming: string | null = null
  let retrying: RetryWaitFacts | null = null
  let settled: 'completed' | 'failed' | 'aborted' | null = null
  let settledReason: string | null = null
  for (const chunk of chunks) {
    if (applied !== null && chunk.position !== null && atOrBefore(chunk.position, applied)) {
      continue
    }
    if (chunk.position !== null) applied = chunk.position
    if (chunk.type === 'message-started' && chunk.submissionId !== null) {
      outstanding.add(chunk.submissionId)
    }
    if (chunk.type === 'submission-retrying') {
      // A half-read signal is not a state: all three numbers must have come
      // off the wire before anything waits on them.
      if (chunk.attempt === null || chunk.maxRetries === null || chunk.delayMs === null) continue
      retrying = {
        attempt: chunk.attempt,
        maxRetries: chunk.maxRetries,
        delayMs: chunk.delayMs,
        detail: chunk.errorMessage,
      }
    } else if (chunk.type === 'message-started') {
      streaming = chunk.submissionId ?? streaming ?? ''
      retrying = null
    } else if (chunk.type === 'message-delta') {
      if (streaming === null) streaming = ''
      retrying = null
    } else if (chunk.type === 'submission-settled' && chunk.outcome !== null) {
      if (chunk.submissionId !== null) {
        outstanding.delete(chunk.submissionId)
        settledIds.add(chunk.submissionId)
      }
      else if (outstanding.size <= 1) outstanding.clear()
      settled = chunk.outcome
      retrying = null
      // The provider's sentence, parsed since Task 26 put it on the facts.
      // A later settlement in the same batch replaces an earlier one; a
      // settlement without a sentence leaves the reason null.
      settledReason = chunk.errorMessage
    }
  }
  return { applied, streaming, retrying, settled, settledReason }
}

const SETTLEMENT_MESSAGES: Record<'failed' | 'aborted', string> = {
  failed: 'The turn failed while it was running.',
  aborted: 'The turn was aborted before it finished.',
}

/**
 * How long an attached read may deliver nothing at all - no chunk, no
 * keep-alive, nothing - before this hook stops trusting it.
 *
 * Rust forwards a KeepAlive every 15s while a read is healthy, so a live
 * read is heard from at least twice inside this budget; the budget is
 * Rust's own READ_IDLE_TIMEOUT, one layer up. What it closes is the failure
 * Rust cannot see: a channel whose webview side went away keeps accepting
 * sends successfully forever, so the run streams into a void while the UI
 * sits attached and deaf - and a turn submitted into that state runs
 * entirely unwitnessed, which is the silent stop wearing a connection's
 * clothes. On expiry the read is cancelled and the phase says interrupted:
 * visible, holding its retained offset, never silently reattached.
 */
const READ_LIVENESS_BUDGET_MS = 45_000

/* -------------------------------------------------------------------------- */
/* The hook                                                                    */
/* -------------------------------------------------------------------------- */

export interface UseConversationOptions {
  /** Defaults to asking the supervisor; see `defaultContactFor`. */
  readonly contact?: ContactHarness
  /** Defaults to the real lifecycle events; must be stable across renders. */
  readonly listen?: LifecycleListen
  /**
   * Receives everything rendering is allowed to see: snapshots and chunk
   * batches, in arrival order, from the current read only. Must be stable
   * across renders — it rides beside `contact` as an effect dependency.
   */
  readonly onContent?: (content: ConversationContent) => void
  /**
   * How long an attached read may deliver nothing at all before this hook
   * stops trusting it. Tests shorten it; production never names it.
   */
  readonly livenessBudgetMs?: number
}

export function useConversation(
  conversationId: string,
  options: UseConversationOptions = {},
): ConversationView {
  const subscribe = options.listen ?? defaultListen
  const onContent = options.onContent
  // Memoised so the mount effect does not churn when a parent re-renders.
  const fallbackContact = useMemo(() => defaultContactFor(conversationId), [conversationId])
  const contact = options.contact ?? fallbackContact

  // The opening state is honest about what is happening: this hook is trying
  // to reach a run, and knows nothing else yet.
  const [phase, setPhase] = useState<ConversationPhase>({ status: 'attaching' })
  const [offset, setOffset] = useState<string | null>(null)
  // A refused submission. Deliberately NOT a phase: a send can be refused
  // while an earlier turn is still streaming, and the state machine has no
  // status that means "streaming AND refused" — booleans are how the
  // combinations start lying (see ConversationPhase above). The refusal
  // renders beside whatever phase is real.
  const [refused, setRefused] = useState<SeamFailure | null>(null)
  // Mirror for callbacks that must judge the CURRENT phase — a closure over
  // `phase` would see the render the callback was created in.
  const phaseRef = useRef(phase)
  phaseRef.current = phase

  // Client and live handle are not render state: nothing displays them and
  // changing them must not paint.
  const clientRef = useRef<ConversationClient | null>(null)
  const handleRef = useRef<{ cancel(): Promise<void> } | null>(null)
  // Guards every write below: some of these promises outlive the hook, and
  // a setState after unmount hides real warnings behind a console noise.
  const liveRef = useRef(true)
  // Deliveries from a superseded read are ignored wholesale.
  const generationRef = useRef(0)
  const upToDateRef = useRef(false)
  const appliedRef = useRef<ChunkPosition | null>(null)
  const outstandingRef = useRef(new Set<string>())
  const settledIdsRef = useRef(new Set<string>())

  // Liveness of the current read: one timer, re-armed by every attach and
  // every delivery. A firing timer is the whole test - no delivery of any
  // kind arrived for a whole budget - so no clock comparison is kept.
  const livenessBudgetRef = useRef(options.livenessBudgetMs ?? READ_LIVENESS_BUDGET_MS)
  livenessBudgetRef.current = options.livenessBudgetMs ?? READ_LIVENESS_BUDGET_MS
  const livenessTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const disarmLiveness = useCallback(() => {
    if (livenessTimerRef.current !== null) {
      clearTimeout(livenessTimerRef.current)
      livenessTimerRef.current = null
    }
  }, [])

  const refreshLiveness = useCallback(() => {
    disarmLiveness()
    livenessTimerRef.current = setTimeout(() => {
      livenessTimerRef.current = null
      const handle = handleRef.current
      if (handle === null || !liveRef.current) return
      handleRef.current = null
      void handle.cancel()
      setPhase({
        status: 'interrupted',
        reason:
          'The connection to this run went quiet, so Studio stopped reading it. Reattach to continue from where it stopped.',
      })
    }, livenessBudgetRef.current)
  }, [disarmLiveness])

  const attach = useCallback(
    (reattach?: { readonly from?: string; readonly announce?: boolean }) => {
      const client = clientRef.current
      if (client === null || !liveRef.current) return
      // Never two live readers: the client supersedes its own previous attach,
      // and this covers the rarer case where the client itself was replaced
      // along the way (a contact resolving after an earlier attach).
      void handleRef.current?.cancel()
      generationRef.current += 1
      const generation = generationRef.current
      upToDateRef.current = false
      appliedRef.current = null
      // A submission-driven attach names its own starting offset (the
      // admission receipt's) and stays quiet: the turn's own replay arrives
      // within milliseconds and drives the phase from there, so the
      // reaching-the-conversation sentence would only flash over it. The
      // stale notice a reattach replaces - interrupted, run-failed - is
      // cleared by the same replay the moment it lands.
      if (reattach?.announce !== false) setPhase({ status: 'attaching' })

      const handle = client.attach(
        {
          onEvent: (delivery: ConversationDelivery) => {
            if (generationRef.current !== generation) return
            // A delivery of any kind - chunk, frame, keep-alive - is this
            // read proving it is still being heard.
            refreshLiveness()
            // Every variant carries the resume point; none is exempt.
            setOffset(delivery.offset)
            switch (delivery.kind) {
              case 'keep-alive':
              case 'frame':
                // Liveness and unread bytes: neither is content, and neither
                // moves this state machine. This is what keeps heartbeats out
                // of the transcript's way forever.
                return
              case 'snapshot':
                // History's whole answer: content to seed the projection with.
                // The phase stays `attaching` — the updates connection that
                // follows still has to catch up before anything is live.
                onContent?.({ kind: 'snapshot', snapshot: delivery.snapshot })
                {
                  const settled = new Set(delivery.snapshot.settlements.map((item) => item.submissionId))
                  settledIdsRef.current = settled
                  for (const id of outstandingRef.current) {
                    if (settled.has(id)) outstandingRef.current.delete(id)
                  }
                  for (const message of delivery.snapshot.messages) {
                    if (message.submissionId !== null && !settled.has(message.submissionId)) {
                      outstandingRef.current.add(message.submissionId)
                    }
                  }
                }
                return
              case 'up-to-date':
                upToDateRef.current = true
                // A reader that has caught up no longer needs the receipt a
                // first turn was started with; every later attach on this
                // conversation is an ordinary cold start.
                forgetFirstAdmission(conversationId)
                // Catching up says where the read is, not what the run is
                // doing. A turn already known to be under way — admitted, or
                // producing — outranks it: this delivery arrives on the very
                // read a submission just opened, and demoting `submitted` to
                // `live` here is exactly how the stop control would blink
                // out a frame after it appeared.
                setPhase((current) => {
                  if (isTurnRunning(current)) return current
                  const next = outstandingRef.current.values().next().value
                  return next === undefined ? { status: 'live' } : { status: 'submitted', submissionId: next }
                })
                return
              case 'chunks': {
                onContent?.({
                  kind: 'chunks',
                  replaying: delivery.replaying,
                  chunks: delivery.chunks,
                })
                const result = reduceChunks(delivery.chunks, appliedRef.current, outstandingRef.current, settledIdsRef.current)
                for (const chunk of delivery.chunks) {
                  if (chunk.type === 'conversation-reset' && chunk.snapshot !== null) {
                    const settled = new Set(chunk.snapshot.settlements.map((item) => item.submissionId))
                    for (const id of settled) outstandingRef.current.delete(id)
                  }
                }
                appliedRef.current = result.applied
                if (result.settled !== null && outstandingRef.current.size === 0) {
                  setPhase(
                    result.settled === 'completed'
                      ? { status: 'idle' }
                      : {
                          status: 'run-failed',
                          outcome: result.settled,
                          message: SETTLEMENT_MESSAGES[result.settled],
                          detail: result.settledReason,
                        },
                  )
                  return
                }
                if (result.streaming !== null || result.retrying !== null) {
                  setPhase((current) => {
                    // A start names the submission outright; an empty name (a
                    // delta with no seen start) and a bare retry both keep
                    // whatever association the stream already carried — which
                    // now includes the receipt's own, since a submission is
                    // named from the moment it was admitted.
                    const previous =
                      current.status === 'streaming' || current.status === 'submitted'
                        ? current.submissionId
                        : null
                    const submissionId =
                      result.streaming === null || result.streaming === ''
                        ? previous
                        : result.streaming
                    return { status: 'streaming', submissionId, retrying: result.retrying }
                  })
                }
                return
              }
              case 'absent':
                // The harness creates the stream at a conversation's first
                // prompt. Until then there is nothing to replay and nothing to
                // watch: connected, quiet, ready for the composer.
                setPhase({ status: 'idle' })
                return
              case 'ended':
                setPhase({ status: 'idle' })
                return
            }
          },
        },
        reattach?.from === undefined ? undefined : { from: reattach.from },
      )
      handleRef.current = handle
      // The read has its whole budget from now to prove it is alive; the
      // first delivery re-arms this.
      refreshLiveness()

      void handle.settled.then((settlement) => {
        if (!liveRef.current || generationRef.current !== generation) return
        // The read is over, whatever the outcome: liveness is moot until a
        // next attach arms it again.
        disarmLiveness()
        if (settlement.outcome === 'broken' || settlement.outcome === 'refused') {
          const failure = settlement.failure
          const reason =
            failure.kind === 'refused'
              ? `The harness refused the read (${failure.status}).`
              : failure.message
          setPhase({ status: 'interrupted', reason })
        }
        // `ended` and `absent` already arrived as deliveries; `cancelled`
        // means this read was superseded or the hook went away — both
        // handled where that happens, not here.
      })
    },
    [conversationId, onContent, refreshLiveness, disarmLiveness],
  )

  useEffect(() => {
    liveRef.current = true
    let disposed = false

    // A new conversation is a new client: the id is caller-chosen and the
    // client is one per conversation by construction.
    clientRef.current = createConversationClient({ conversationId })
    setOffset(null)
    // A conversation opened for a turn that was admitted elsewhere says so
    // from its first render, not from whenever the supervisor answers. The
    // receipt is in hand before this view exists, so waiting on `contact()`
    // to repeat it would leave the composer idle for the length of one
    // status invoke — measured at ~280ms on the desktop, which is a stop
    // control blinking out of the home page and back into this one.
    const opening = firstAdmission(conversationId)
    settledIdsRef.current = new Set()
    outstandingRef.current = new Set([
      ...queuedMessages(conversationId).map((item) => item.submissionId),
      ...(opening === null ? [] : [opening.submissionId]),
    ])
    setPhase(
      opening === null
        ? { status: 'attaching' }
        : { status: 'submitted', submissionId: opening.submissionId },
    )
    // A refusal belongs to the conversation it happened in.
    setRefused(null)

    void contact().then((found) => {
      if (disposed || !liveRef.current) return
      if (found.kind === 'absent') {
        setPhase({ status: 'no-harness' })
        return
      }
      if (found.kind === 'starting') {
        setPhase({ status: 'harness-starting' })
        return
      }
      clientRef.current = found.client
      // A conversation whose first turn was submitted from another page
      // reads from that turn's own offset rather than asking history about a
      // stream that is milliseconds old — the 404 race Task 32 removed from
      // `submit()`, which a first turn would otherwise walk straight back
      // into. Quiet, because the phase this view opened in is already the
      // right one and the turn's replay is a few milliseconds behind.
      const first = firstAdmission(conversationId)
      attach(first === null ? undefined : { from: first.offset, announce: false })
    })

    let unsubscribe: (() => void) | null = null
    void subscribe((signal) => {
      if (disposed || !liveRef.current) return
      switch (signal.name) {
        case 'harness-starting':
        case 'harness-restarting':
          setPhase({ status: 'harness-starting' })
          return
        case 'harness-started':
          // ADR 0045 section 4: the restart was visible (this state machine
          // showed it), and now the client simply re-reads from its offset.
          attach()
          return
        case 'harness-stopped':
          setPhase({ status: 'interrupted', reason: 'The harness stopped.' })
          return
        case 'harness-failed':
          setPhase({
            status: 'interrupted',
            reason:
              typeof signal.payload === 'string' && signal.payload !== ''
                ? signal.payload
                : 'The harness failed.',
          })
          return
      }
    }).then((off) => {
      if (disposed) off()
      else unsubscribe = off
    })

    return () => {
      disposed = true
      liveRef.current = false
      // The prompt half of cancellation: switching conversations or leaving
      // stops THIS READ immediately. It never touches the run — a dead
      // window cancels nothing (ADR 0045 section 5).
      disarmLiveness()
      void handleRef.current?.cancel()
      handleRef.current = null
      unsubscribe?.()
    }
  }, [conversationId, contact, subscribe, attach, disarmLiveness])

  const resume = useCallback(() => {
    attach()
  }, [attach])

  const submit = useCallback(
    async (message: string, settings: TurnSettingsWire, images?: readonly TurnImageWire[]) => {
      const client = clientRef.current
      if (client === null) {
        return {
          ok: false as const,
          error: {
            kind: 'no-harness' as const,
            message: 'There is no harness to send this to yet.',
          },
        }
      }
      const continueReading = isTurnRunning(phaseRef.current)
      const sent = await client.submitTurn(message, settings, images)
      if (!sent.ok) {
        // The no-harness diagnosis belongs to the phase machine, which says
        // it permanently; stacking the same sentence in a second notice
        // teaches people to stop reading them. Every other refusal lands.
        if (liveRef.current && phaseRef.current.status !== 'no-harness') {
          setRefused(sent.error)
        }
        return sent
      }
      if (settings.deliveryMode === 'queue') {
        rememberQueued(conversationId, { submissionId: sent.value.submissionId, text: message })
      }
      if (clientRef.current !== client || !liveRef.current) {
        return { ok: true as const, value: { submissionId: sent.value.submissionId } }
      }
      setRefused(null)
      const continuing = isTurnRunning(phaseRef.current)
      const alreadySettled = settledIdsRef.current.has(sent.value.submissionId)
      if (alreadySettled) forgetQueued(conversationId, new Set([sent.value.submissionId]))
      if (!alreadySettled) outstandingRef.current.add(sent.value.submissionId)
      // Every receipt refreshes the reader. An idle conversation starts from
      // admission; a busy one resumes its last read position, because the new
      // receipt's offset could skip results produced during the POST.
      attach(continueReading ? { announce: false } : { from: sent.value.offset, announce: false })
      // Said before this call answers, so the page is never between two
      // truths: the composer drops its own in-flight lock the moment the
      // receipt reaches it, and if nothing had taken the lock over by then
      // the stop control would blink out and back when the first token
      // finally arrived. Setting it here means the phase is already
      // `submitted` in the render the composer's own release lands in.
      if (!continuing && !alreadySettled) {
        setPhase({ status: 'submitted', submissionId: sent.value.submissionId })
      }
      return { ok: true as const, value: { submissionId: sent.value.submissionId } }
    },
    [attach, conversationId],
  )

  const dismissRefusal = useCallback(() => {
    if (liveRef.current) setRefused(null)
  }, [])

  const abort = useCallback(async () => {
    const client = clientRef.current
    if (client === null) {
      return {
        ok: false as const,
        error: {
          kind: 'no-harness' as const,
          message: 'There is no harness to abort work in.',
        },
      }
    }
    return client.abortRun()
  }, [])

  return { phase, offset, resume, submit, abort, refused, dismissRefusal }
}
