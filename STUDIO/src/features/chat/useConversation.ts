import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

import {
  createConversationClient,
  type ChunkFacts,
  type ChunkPosition,
  type ConversationClient,
  type ConversationDelivery,
  type ConversationSnapshotFacts,
  type SeamFailure,
  type TurnResult,
} from '@/platform/harness'
import { isTauri } from '@/platform/tauri/window'

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
   * Submits one user turn through the harness. Never retried here: an
   * identical resend would be a SECOND turn, so a failed submission is
   * surfaced, not repeated. On success, makes sure a read is attached —
   * a conversation's very first turn creates the stream this page has
   * been unable to find since it mounts.
   */
  submit: (message: string) => Promise<TurnResult<{ readonly submissionId: string }>>
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

/** What one contact attempt found. `starting` is a fact, not an absence. */
export type HarnessContact =
  | { readonly kind: 'ready'; readonly client: ConversationClient }
  | { readonly kind: 'starting' }
  | { readonly kind: 'absent' }

export type ContactHarness = () => Promise<HarnessContact>

/** The lifecycle events Task 23 emits, normalised to a name plus raw payload. */
export interface LifecycleSignal {
  readonly name:
    | 'harness-starting'
    | 'harness-started'
    | 'harness-stopped'
    | 'harness-failed'
    | 'harness-restarting'
  readonly payload?: unknown
}

/** Subscribes to lifecycle events; resolves with the unsubscriber. */
export type LifecycleListen = (
  handler: (signal: LifecycleSignal) => void,
) => Promise<() => void>

const LIFECYCLE_EVENTS = [
  'harness-starting',
  'harness-started',
  'harness-stopped',
  'harness-failed',
  'harness-restarting',
] as const

const defaultListen: LifecycleListen = (handler) => {
  const subscriptions = LIFECYCLE_EVENTS.map((name) =>
    listen<unknown>(name, (event) => handler({ name, payload: event.payload })),
  )
  return Promise.all(subscriptions).then((unlisten) => () =>
    unlisten.forEach((off) => off()),
  )
}

/**
 * Narrows a command's answer before anything reads a field off it.
 *
 * `invoke` is typed by its caller, not by the command, so a type argument
 * here would be an assertion wearing a signature. The platform contracts
 * parse rather than assert for exactly this reason; a status read is no
 * different for being small.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Asks the supervisor whether there is anything to attach to.
 *
 * A per-conversation factory rather than a shared function because the id is
 * a property of the call: ids are caller-chosen (ADR 0045), and the client
 * built here is one per conversation by construction. Outside Tauri there is
 * no supervisor to ask, and the shipped no-harness behaviour applies.
 *
 * Whatever comes back must be stable across renders — it is an effect
 * dependency, like the settings pane's connect seam.
 */
function defaultContactFor(conversationId: string): ContactHarness {
  return async () => {
    if (!isTauri()) return { kind: 'absent' }
    let state: unknown
    try {
      const report: unknown = await invoke('get_harness_status')
      state = isRecord(report) ? report['state'] : null
    } catch {
      // A status that cannot be answered is not a harness either.
      return { kind: 'absent' }
    }
    if (state === 'starting') return { kind: 'starting' }
    if (state !== 'running') return { kind: 'absent' }
    return { kind: 'ready', client: createConversationClient({ conversationId }) }
  }
}

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
 * `submission-settled` closes the stream. Anything else moves neither needle.
 */
function reduceChunks(
  chunks: readonly ChunkFacts[],
  applied: ChunkPosition | null,
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

  const attach = useCallback(() => {
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
    setPhase({ status: 'attaching' })

    const handle = client.attach({
      onEvent: (delivery: ConversationDelivery) => {
        if (generationRef.current !== generation) return
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
            return
          case 'up-to-date':
            upToDateRef.current = true
            setPhase((current) =>
              current.status === 'streaming' ? current : { status: 'live' },
            )
            return
          case 'chunks': {
            onContent?.({
              kind: 'chunks',
              replaying: delivery.replaying,
              chunks: delivery.chunks,
            })
            const result = reduceChunks(delivery.chunks, appliedRef.current)
            appliedRef.current = result.applied
            if (result.settled !== null) {
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
                // whatever association the stream already carried.
                const previous = current.status === 'streaming' ? current.submissionId : null
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
    })
    handleRef.current = handle

    void handle.settled.then((settlement) => {
      if (!liveRef.current || generationRef.current !== generation) return
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
  }, [onContent])

  useEffect(() => {
    liveRef.current = true
    let disposed = false

    // A new conversation is a new client: the id is caller-chosen and the
    // client is one per conversation by construction.
    clientRef.current = createConversationClient({ conversationId })
    setOffset(null)
    setPhase({ status: 'attaching' })
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
      attach()
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
      void handleRef.current?.cancel()
      handleRef.current = null
      unsubscribe?.()
    }
  }, [conversationId, contact, subscribe, attach])

  const resume = useCallback(() => {
    attach()
  }, [attach])

  const submit = useCallback(
    async (message: string) => {
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
      const sent = await client.submitTurn(message)
      if (!sent.ok) {
        // The no-harness diagnosis belongs to the phase machine, which says
        // it permanently; stacking the same sentence in a second notice
        // teaches people to stop reading them. Every other refusal lands.
        if (liveRef.current && phaseRef.current.status !== 'no-harness') {
          setRefused(sent.error)
        }
        return sent
      }
      // A send that got through retires whatever the last refusal said.
      if (liveRef.current) setRefused(null)
      // A fresh conversation had no stream to attach to at mount; its first
      // admitted turn creates one, and this is where the read begins.
      if (!client.attached()) attach()
      return { ok: true as const, value: { submissionId: sent.value.submissionId } }
    },
    [attach],
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
