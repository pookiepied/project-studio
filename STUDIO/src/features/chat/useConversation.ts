import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

import {
  createConversationClient,
  type ChunkFacts,
  type ChunkPosition,
  type ConversationClient,
  type ConversationDelivery,
} from '@/platform/harness'
import { isTauri } from '@/platform/tauri/window'

/**
 * The states a conversation's connection to its run can be in.
 *
 * One tagged union, because each of these renders as a different thing, and
 * the combinations booleans allow -- attaching *and* live, streaming *and*
 * interrupted -- are not states a conversation has.
 *
 * - `no-harness` / `harness-starting`: Task 23's lifecycle events, finally
 *   consumed. `harness-starting` is now a real state, not a placeholder.
 * - `attaching`: a read is in flight and history is being replayed into it.
 * - `live`: the `up-to-date` transition happened -- the replay is over and
 *   what follows is history being made.
 * - `streaming`: a turn is being produced, carrying the submission it
 *   belongs to when one has been seen.
 * - `idle`: the last turn settled completed; connected and quiet.
 * - `interrupted`: the read broke -- transport failure, harness crash,
 *   harness stop. The offset is retained, so this is resumable, not lost.
 * - `run-failed`: a settlement said `failed` or `aborted`. Sticky until the
 *   user acts, because a failure that heals silently was never shown.
 */
export type ConversationPhase =
  | { readonly status: 'no-harness' }
  | { readonly status: 'harness-starting' }
  | { readonly status: 'attaching' }
  | { readonly status: 'live' }
  | { readonly status: 'streaming'; readonly submissionId: string | null }
  | { readonly status: 'idle' }
  | { readonly status: 'interrupted'; readonly reason: string }
  | {
      readonly status: 'run-failed'
      readonly outcome: 'failed' | 'aborted'
      readonly message: string
    }

export interface ConversationView {
  readonly phase: ConversationPhase
  /**
   * The last offset any delivery reported -- everything durably known about
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
 * Whatever comes back must be stable across renders -- it is an effect
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
 * What one batch of chunk facts does to the turn state.
 *
 * Redelivered batches are dropped by position, not by faith: a reconnect
 * after an interruption replays the batch that was in flight, and the
 * projection's own ordering token is what makes that at-least-once delivery
 * safe to apply twice.
 *
 * `message-started` opens a stream and names its submission;
 * `message-delta` proves generation is running even when the start scrolled
 * past the resume point; `submission-settled` closes it. Anything else --
 * appended history, tool traffic, compaction -- moves neither needle yet,
 * because rendering them is Task 25's business.
 */
function reduceChunks(
  chunks: readonly ChunkFacts[],
  applied: ChunkPosition | null,
): {
  applied: ChunkPosition | null
  streaming: string | null
  settled: 'completed' | 'failed' | 'aborted' | null
} {
  let streaming: string | null = null
  let settled: 'completed' | 'failed' | 'aborted' | null = null
  for (const chunk of chunks) {
    if (applied !== null && chunk.position !== null && atOrBefore(chunk.position, applied)) {
      continue
    }
    if (chunk.position !== null) applied = chunk.position
    if (chunk.type === 'message-started') {
      streaming = chunk.submissionId ?? streaming ?? ''
    } else if (chunk.type === 'message-delta' && streaming === null) {
      streaming = ''
    } else if (chunk.type === 'submission-settled' && chunk.outcome !== null) {
      settled = chunk.outcome
    }
  }
  return { applied, streaming, settled }
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
}

export function useConversation(
  conversationId: string,
  options: UseConversationOptions = {},
): ConversationView {
  const subscribe = options.listen ?? defaultListen
  // Memoised so the mount effect does not churn when a parent re-renders.
  const fallbackContact = useMemo(() => defaultContactFor(conversationId), [conversationId])
  const contact = options.contact ?? fallbackContact

  // The opening state is honest about what is happening: this hook is trying
  // to reach a run, and knows nothing else yet.
  const [phase, setPhase] = useState<ConversationPhase>({ status: 'attaching' })
  const [offset, setOffset] = useState<string | null>(null)

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
          case 'up-to-date':
            upToDateRef.current = true
            setPhase((current) =>
              current.status === 'streaming' ? current : { status: 'live' },
            )
            return
          case 'chunks': {
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
                    },
              )
              return
            }
            if (result.streaming !== null) {
              setPhase((current) =>
                current.status === 'streaming'
                  ? {
                      status: 'streaming',
                      submissionId:
                        result.streaming === '' ? current.submissionId : result.streaming,
                    }
                  : {
                      status: 'streaming',
                      submissionId: result.streaming === '' ? null : result.streaming,
                    },
              )
            }
            return
          }
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
      // `ended` already arrived as a delivery; `cancelled` means this read
      // was superseded or the hook went away -- both handled where that
      // happens, not here.
    })
  }, [])

  useEffect(() => {
    liveRef.current = true
    let disposed = false

    // A new conversation is a new client: the id is caller-chosen and the
    // client is one per conversation by construction.
    clientRef.current = createConversationClient({ conversationId })
    setOffset(null)
    setPhase({ status: 'attaching' })

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
      // stops THIS READ immediately. It never touches the run -- a dead
      // window cancels nothing (ADR 0045 section 5).
      void handleRef.current?.cancel()
      handleRef.current = null
      unsubscribe?.()
    }
  }, [conversationId, contact, subscribe, attach])

  const resume = useCallback(() => {
    attach()
  }, [attach])

  return { phase, offset, resume }
}
