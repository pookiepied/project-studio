/**
 * The conversation surface of the harness, one client per conversation.
 *
 * This is the client ADR 0045 exists for. `client.ts` is request and
 * response: ask, wait, parse, done. A conversation is a different shape --
 * a turn is submitted and the answer is a durable run that is READ,
 * possibly from before it started, possibly after an interruption -- so it
 * belongs beside the administration client rather than inside it.
 *
 * ---- The offset is the whole point ----------------------------------------
 *
 * Flue stores every conversation event durably and addresses them with
 * opaque offsets. The webview's only durable fact about a run is the last
 * offset it was reported, and Rust guarantees every event carries exactly
 * that: the value to resume FROM, so a reattach replays the event an
 * interruption interrupted rather than skipping it. This client tracks that
 * offset as deliveries arrive and resumes from it on any later attach.
 * Offsets are never parsed, compared or incremented here either.
 *
 * ---- What crosses which seam ----------------------------------------------
 *
 * Submitting and aborting are ordinary requests through `service_fetch`.
 * Reading is `service_stream`: Rust holds the credential, reads the SSE
 * body, and forwards classified events over a Tauri channel. Cancelling a
 * read is `service_stream_cancel`, and the distinction it rests on is ADR
 * 0045 section 5: cancelling a stream stops READING a run; aborting stops
 * the RUN. Closing a pane does the first and must never do the second --
 * which is why `attach()`'s handle exposes cancel and nothing else touches
 * the abort route except an explicit caller decision.
 *
 * ---- Injectable seams ------------------------------------------------------
 *
 * The pattern of `client.ts`'s injected fetch: the invoke and the channel
 * constructor are options, so tests script whole conversations with no
 * Tauri runtime, no harness, and no module patching.
 *
 * There is deliberately no browser fallback for reading: outside Tauri there
 * is no seam, no supervisor and no channel, and a second SSE path in the
 * webview would be two credential stories for one process. The factory still
 * constructs outside Tauri; its reads simply fail through the same result
 * shapes instead of pretending.
 */

import { Channel, invoke as tauriInvoke } from '@tauri-apps/api/core'

import { newId } from '@/lib/id'
import {
  parseHarnessErrorBody,
  parseWireStreamEvent,
  readChunkFacts,
  type ChunkFacts,
  type WireStreamEvent,
} from './contracts'

/**
 * How a command leaves the process. Narrower than `typeof invoke` on
 * purpose: nothing here needs invoke options, and a test satisfies this
 * with a plain async function over a recorded call list.
 */
export type ServiceInvoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>

/** What a stream channel must look like to be handed into an invoke. */
export interface StreamChannel {
  readonly id: number
}

/** Builds the channel a stream's events arrive over; injectable for tests. */
export type ChannelFactory = (onMessage: (message: WireStreamEvent) => void) => StreamChannel

function defaultChannelFactory(onMessage: (message: WireStreamEvent) => void): StreamChannel {
  return new Channel<WireStreamEvent>(onMessage)
}

/* -------------------------------------------------------------------------- */
/* Failures and results                                                        */
/* -------------------------------------------------------------------------- */

/**
 * How a conversation call failed, mapped from Rust's `ServiceError` kinds
 * plus what Rust cannot classify. One vocabulary for both commands:
 *
 * - `no-harness`: the supervisor has no endpoint. Remedy: start it.
 * - `refused`: the harness answered, with a refusal; status travels with
 *   its own sentence.
 * - `rejected`: OUR seam refused the call -- a bad path or init is this
 *   file's bug, not something to show a user as a harness problem.
 * - `broken`: the read began and then failed mid-flight. Recoverable by
 *   reattaching at the retained offset -- that is its whole design.
 * - `unreachable`: the exchange never completed; a lost submission
 *   acknowledgement lands here and stays unknown, never retried (Flue
 *   deduplicates nothing).
 * - `malformed`: a success whose body broke the parser, meaning this
 *   mirror has drifted from the harness.
 */
export type SeamFailure =
  | { readonly kind: 'no-harness'; readonly message: string }
  | { readonly kind: 'refused'; readonly status: number; readonly message: string }
  | { readonly kind: 'rejected'; readonly message: string }
  | { readonly kind: 'broken'; readonly message: string }
  | { readonly kind: 'unreachable'; readonly message: string }
  | { readonly kind: 'malformed'; readonly message: string }

const NO_HARNESS: SeamFailure = {
  kind: 'no-harness',
  message: 'The harness is not running, so the conversation cannot be reached.',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonEmpty(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/**
 * Reads a rejection from any service-seam command into the failure union.
 * An unclassifiable rejection stays `unreachable` with whatever sentence
 * travelled with it -- never swallowed.
 */
export function seamFailure(value: unknown): SeamFailure {
  if (!isRecord(value) || typeof value['kind'] !== 'string') {
    return {
      kind: 'unreachable',
      message:
        value instanceof Error && value.message !== ''
          ? value.message
          : 'The call through the service seam did not complete.',
    }
  }
  const detail = nonEmpty(value['message'])
  switch (value['kind']) {
    case 'not-running':
      return NO_HARNESS
    case 'stream-refused': {
      const status = typeof value['status'] === 'number' ? value['status'] : 0
      return {
        kind: 'refused',
        status,
        message: detail ?? 'The harness refused the request.',
      }
    }
    case 'stream-broken':
      return { kind: 'broken', message: detail ?? 'The stream broke mid-flight.' }
    case 'invalid-path':
    case 'invalid-request':
      return { kind: 'rejected', message: detail ?? 'The seam rejected the call.' }
    default:
      return {
        kind: 'unreachable',
        message: detail ?? 'The call through the service seam did not complete.',
      }
  }
}

export type TurnResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: SeamFailure }

/** The receipt for one submitted turn: where its events begin. */
export interface SubmittedTurn {
  /** Server-assigned; correlates the turn's messages and its settlement. */
  readonly submissionId: string
  /** Opaque stream offset captured at admission. Reading from here yields this turn. */
  readonly offset: string
}

/* -------------------------------------------------------------------------- */
/* Deliveries                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * One delivery on an attached stream, already classified by Rust and parsed
 * where the contract allows it. `chunks` replaces the raw `data` frame when
 * the payload parses as the chunk array the updates view promises; anything
 * else arrives as `frame` untouched, because a frame this layer cannot read
 * is still real bytes somebody may yet want. `keep-alive` is liveness only;
 * it reaches handlers so a UI can show quietness, but must never become
 * content. `replaying` distinguishes history being replayed from history
 * being made; it flips when `up-to-date` arrives and stays flipped.
 */
export type ConversationDelivery =
  | {
      readonly kind: 'chunks'
      readonly offset: string
      readonly replaying: boolean
      readonly chunks: readonly ChunkFacts[]
    }
  | {
      readonly kind: 'frame'
      readonly offset: string
      readonly event: string | null
      readonly data: string
    }
  | { readonly kind: 'up-to-date'; readonly offset: string }
  | { readonly kind: 'keep-alive'; readonly offset: string }
  | { readonly kind: 'ended'; readonly offset: string }

export interface AttachHandlers {
  onEvent: (delivery: ConversationDelivery) => void
}

/**
 * How an attached read finished. `ended` is the harness saying the stream
 * closed behind an `Ended` delivery; `cancelled` covers everything where
 * nobody was left reading -- an explicit cancel, a superseded attach, or a
 * webview that went away mid-read.
 */
export type StreamSettlement =
  | { readonly outcome: 'ended' }
  | { readonly outcome: 'cancelled' }
  | { readonly outcome: 'broken'; readonly failure: SeamFailure }
  | { readonly outcome: 'refused'; readonly failure: SeamFailure }

export interface AttachHandle {
  /** Settles once, when the underlying read finishes for any reason. */
  readonly settled: Promise<StreamSettlement>
  /** Stops THIS READ promptly through the cancellation registry. Idempotent. */
  cancel(): Promise<void>
}

/* -------------------------------------------------------------------------- */
/* The client                                                                  */
/* -------------------------------------------------------------------------- */

export interface ConversationClientOptions {
  /**
   * Caller-chosen conversation id. ADR 0045: the id is ours -- the UI
   * already stores conversation ids because it lists them -- so there is
   * nothing to discover and nothing here asks the harness what is in flight.
   */
  readonly conversationId: string
  /** The Flue agent instance name. Production runs exactly one, `studio`. */
  readonly agentName?: string
  readonly invoke?: ServiceInvoke
  readonly createChannel?: ChannelFactory
}

export interface ConversationClient {
  readonly conversationId: string
  /**
   * The last offset any delivered event reported across attachments; null
   * until a first delivery. This is everything durably known about where
   * this webview has read to -- ADR 0045: "everything else is re-derivable
   * from the id and that number".
   */
  lastOffset(): string | null
  /** Whether a read is currently attached; at most one ever is. */
  attached(): boolean
  /** Submits one user turn and resolves with where its events begin. */
  submitTurn(message: string): Promise<TurnResult<SubmittedTurn>>
  /**
   * Attaches a reader, resuming from the tracked offset unless the caller
   * names one explicitly (`-1` reads the whole durable history). Attaching
   * while attached supersedes the older read first.
   */
  attach(handlers: AttachHandlers, options?: { readonly from?: string }): AttachHandle
  /** Aborts the RUN: Flue's abort route, and the only thing that means abort. */
  abortRun(): Promise<TurnResult<boolean>>
}

export function createConversationClient(options: ConversationClientOptions): ConversationClient {
  const conversationId = options.conversationId
  const agentName = options.agentName ?? 'studio'
  const invoke: ServiceInvoke = options.invoke ?? ((command, args) => tauriInvoke(command, args))
  const createChannel: ChannelFactory = options.createChannel ?? defaultChannelFactory

  let trackedOffset: string | null = null
  let active: AttachHandle | null = null

  const agentsPath = (): string =>
    `/agents/${encodeURIComponent(agentName)}/${encodeURIComponent(conversationId)}`

  /**
   * One round trip through `service_fetch`, judged the way `client.ts`
   * judges one: non-2xx takes the harness's own sentence out of the body,
   * and the response shape the command actually returns is checked before
   * use because TypeScript describing it proves nothing.
   */
  async function request(
    method: string,
    path: string,
    body: string | undefined,
  ): Promise<{ status: number; bodyText: string } | { failure: SeamFailure }> {
    try {
      const raw: unknown = await invoke('service_fetch', {
        service: 'harness',
        path,
        init: {
          method,
          headers: [
            ['accept', 'application/json'],
            ...(body === undefined ? [] : [['content-type', 'application/json']]),
          ],
          ...(body === undefined ? {} : { body }),
        },
      })
      if (!isRecord(raw) || typeof raw['status'] !== 'number' || typeof raw['body'] !== 'string') {
        return {
          failure: {
            kind: 'malformed',
            message: 'The service seam answered in a shape no response could be read from.',
          },
        }
      }
      return { status: raw['status'], bodyText: raw['body'] }
    } catch (error) {
      return { failure: seamFailure(error) }
    }
  }

  function refusalOf(status: number, bodyText: string): SeamFailure {
    let parsed: ReturnType<typeof parseHarnessErrorBody> = null
    try {
      parsed = parseHarnessErrorBody(JSON.parse(bodyText))
    } catch {
      parsed = null
    }
    return {
      kind: 'refused',
      status,
      message: parsed?.error ?? `The harness answered ${status} with no explanation.`,
    }
  }

  return {
    conversationId,

    lastOffset() {
      return trackedOffset
    },

    attached() {
      return active !== null
    },

    async submitTurn(message) {
      // Never retried, here or above: an identical resend is a SECOND TURN
      // (the harness pins this behaviour in its own test), so a retry loop
      // would be duplication wearing a retry's clothes.
      const sent = await request('POST', agentsPath(), JSON.stringify({ message }))
      if ('failure' in sent) return { ok: false, error: sent.failure }

      if (sent.status < 200 || sent.status >= 300) {
        return { ok: false, error: refusalOf(sent.status, sent.bodyText) }
      }

      let admission: unknown
      try {
        admission = JSON.parse(sent.bodyText)
      } catch {
        return {
          ok: false,
          error: {
            kind: 'malformed',
            message: 'The harness answered a submission with something that is not JSON.',
          },
        }
      }
      const submissionId = isRecord(admission) ? nonEmpty(admission['submissionId']) : null
      const offset = isRecord(admission) ? nonEmpty(admission['offset']) : null
      if (submissionId === null || offset === null) {
        return {
          ok: false,
          error: {
            kind: 'malformed',
            message:
              'The harness admitted the turn but its receipt carried no submission id or offset.',
          },
        }
      }
      return { ok: true, value: { submissionId, offset } }
    },

    attach(handlers, attachOptions) {
      const streamId = newId('stream')
      const previous = active

      // One settle, whichever fact arrives first: the `Ended` delivery, the
      // command resolving, or the command rejecting. Everything later is
      // ignored, including a resolve with no prior `Ended` -- Rust returns
      // `Ok(())` for a reader gone or cancelled too, and with nobody left
      // reading, "cancelled" is the honest word for it.
      let done = false
      let upToDate = false
      let resolveSettled!: (settlement: StreamSettlement) => void
      const settled = new Promise<StreamSettlement>((resolve) => {
        resolveSettled = (settlement) => {
          if (!done) {
            done = true
            if (active === registration) active = null
            resolve(settlement)
          }
        }
      })

      const channel = createChannel((raw) => {
        const event = parseWireStreamEvent(raw)
        if (event === null || done) return
        // Every variant carries the resume point; none is exempt.
        trackedOffset = event.offset
        switch (event.kind) {
          case 'frame': {
            if (event.event !== undefined && event.event !== 'data') {
              handlers.onEvent({
                kind: 'frame',
                offset: event.offset,
                event: event.event,
                data: event.data,
              })
              return
            }
            let chunks: readonly ChunkFacts[] | null = null
            try {
              const value: unknown = JSON.parse(event.data)
              if (Array.isArray(value)) {
                chunks = value
                  .map(readChunkFacts)
                  .filter((chunk): chunk is ChunkFacts => chunk !== null)
                handlers.onEvent({
                  kind: 'chunks',
                  offset: event.offset,
                  replaying: !upToDate,
                  chunks,
                })
              }
            } catch {
              chunks = null
            }
            if (chunks === null) {
              handlers.onEvent({
                kind: 'frame',
                offset: event.offset,
                event: event.event ?? null,
                data: event.data,
              })
            }
            return
          }
          case 'up-to-date':
            upToDate = true
            handlers.onEvent(event)
            return
          case 'keep-alive':
          case 'ended':
            if (event.kind === 'ended') resolveSettled({ outcome: 'ended' })
            handlers.onEvent(event)
            return
        }
      })

      const registration: AttachHandle = {
        settled,
        cancel() {
          // Prompt stop of THIS READ, by name, through Part 1's registry.
          // It never touches the run: a window going away cancels nothing.
          return invoke('service_stream_cancel', { streamId }).then(
            () => undefined,
            () => undefined,
          )
        },
      }

      const pending = invoke('service_stream', {
        service: 'harness',
        path: agentsPath(),
        init: {},
        // Resume from wherever this conversation got to; `-1` only when
        // nothing has been seen, which replays the durable history.
        offset: attachOptions?.from ?? trackedOffset ?? '-1',
        streamId,
        channel,
      })
      pending.then(
        () => resolveSettled({ outcome: 'cancelled' }),
        (error: unknown) => {
          const failure = seamFailure(error)
          resolveSettled(
            failure.kind === 'broken'
              ? { outcome: 'broken', failure }
              : { outcome: 'refused', failure },
          )
        },
      )

      active = registration
      // Supersede, don't stack: two live readers would deliver everything
      // twice. Fire-and-forget is enough -- the old read settles `cancelled`
      // into whoever still awaits it.
      void previous?.cancel()
      return registration
    },

    async abortRun() {
      const sent = await request('POST', `${agentsPath()}/abort`, undefined)
      if ('failure' in sent) return { ok: false, error: sent.failure }
      if (sent.status < 200 || sent.status >= 300) {
        return { ok: false, error: refusalOf(sent.status, sent.bodyText) }
      }
      let verdict: unknown
      try {
        verdict = JSON.parse(sent.bodyText)
      } catch {
        return {
          ok: false,
          error: {
            kind: 'malformed',
            message: 'The harness answered an abort with something that is not JSON.',
          },
        }
      }
      if (!isRecord(verdict) || typeof verdict['aborted'] !== 'boolean') {
        return {
          ok: false,
          error: {
            kind: 'malformed',
            message: 'The abort answer did not say whether work was aborted.',
          },
        }
      }
      return { ok: true, value: verdict['aborted'] }
    },
  }
}
