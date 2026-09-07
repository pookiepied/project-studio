/**
 * The conversation surface of the harness, one client per conversation.
 *
 * This is the client ADR 0045 exists for. `client.ts` is request and
 * response: ask, wait, parse, done. A conversation is a different shape —
 * a turn is submitted and the answer is a durable run that is READ,
 * possibly from before it started, possibly after an interruption — so it
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
 * ---- Two views, and the order a cold start reads them in ------------------
 *
 * The agent stream answers in two views. `?view=history` returns ONE JSON
 * snapshot of the materialized conversation and refuses `offset` and `live`;
 * `?view=updates` emits the chunk protocol as SSE and requires an offset to
 * resume strictly after. A plain GET defaults to history, which is why the
 * bare path this client once sent — to which Rust appended
 * `offset=...&live=sse` — was refused on every single attach.
 *
 * The protocol is also explicit that an updates connection must not be
 * resumed without the projection state its offset presupposes ("request
 * fresh history when local state is unavailable"). So a cold start here —
 * no retained offset — is always: read history first, hand its snapshot to
 * the consumer, then open updates strictly after the snapshot's offset. A
 * 404 from history is not a failure: the harness creates the stream when the
 * agent instance receives its first prompt, so a conversation nobody has
 * spoken into yet simply does not exist, and that fact is delivered as
 * `absent` rather than dressed up as a broken read.
 *
 * ---- What crosses which seam ----------------------------------------------
 *
 * Submitting and aborting are ordinary requests through `service_fetch`.
 * Reading is `service_stream`: Rust holds the credential, reads the SSE
 * body, and forwards classified events over a Tauri channel. Cancelling a
 * read is `service_stream_cancel`, and the distinction it rests on is ADR
 * 0045 section 5: cancelling a stream stops READING a run; aborting stops
 * the RUN. Closing a pane does the first and must never do the second —
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
  executionModeToWire,
  parseHarnessErrorBody,
  parseWireStreamEvent,
  readChunkFacts,
  readConversationSnapshot,
  type ExecutionModeWire,
  type ChunkFacts,
  type ConversationSnapshotFacts,
  type WireStreamEvent,
} from './contracts'
import type { PermissionMode } from '@/domain/permissions/modes'

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
 * - `rejected`: OUR seam refused the call — a bad path or init is this
 *   file's bug, not something to show a user as a harness problem.
 * - `broken`: the read began and then failed mid-flight. Recoverable by
 *   reattaching at the retained offset — that is its whole design.
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
 * travelled with it — never swallowed.
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

/**
 * The settings a turn is sent with, beside its words.
 *
 * Flue 2.0's submission payload is the delivered-message envelope - `kind`,
 * `body`, and `attachments` - and its own validation strips unknown keys from
 * it, so no setting can cross into the run inside the envelope. These keys
 * therefore ride at the top level BESIDE the envelope, where the harness's
 * turn-settings middleware reads and settles them into the conversation index
 * before the run's render does; the runtime strips them from the payload it
 * stores. `modelId` is the runtime reference in `<provider>/<model>` form, or
 * null for the stable default; the reasoning level is one of the model's
 * levels, or null when the user has not picked one - the harness then rests
 * the turn on medium rather than the window writing a level nobody chose.
 *
 * `permissionMode` is the execution mode the turn is sent under, in the
 * harness's own vocabulary (`manual` / `auto-edit` / `full-auto`). Absent
 * means the conversation's stored mode stands, which is why it is optional
 * here while the send paths above always carry one: what the picker shows is
 * what is sent.
 */
export interface TurnSettingsWire {
  readonly modelId: string | null
  readonly reasoningLevel: string | null
  readonly permissionMode?: ExecutionModeWire
  /**
   * The project a first turn belongs to, when it has one.
   *
   * Carried with the send rather than left to the index write that follows
   * the receipt, because the run reads the row to decide where it stands and
   * the receipt has not arrived yet. Omitted entirely off a project, and
   * never sent as null: the harness only ever sets this, so that a later turn
   * cannot unfile a conversation somebody moved.
   */
  readonly projectId?: string
}

/**
 * The domain's shape for the settings a turn goes out with - what
 * `effectiveTurnSettings` answers and what every send path reads. Named here
 * so the wire builder below and the domain function can be checked against
 * one shape without either importing the other's module for values.
 */
export interface EffectiveTurnSettings {
  readonly modelId: string | null
  readonly reasoningLevel: string | null
  /** The frontend's word for the mode; the wire builder does the translation. */
  readonly permission: PermissionMode
}

/**
 * Builds the settings a submission body carries from the effective settings a
 * surface has settled on. One builder rather than one object literal per send
 * path, because the mode's translation from the picker's vocabulary to the
 * harness's is exactly the kind of thing two copies start disagreeing about.
 */
export function turnSettingsToWire(
  settings: EffectiveTurnSettings,
  projectId?: string | null,
): TurnSettingsWire {
  return {
    modelId: settings.modelId,
    reasoningLevel: settings.reasoningLevel,
    permissionMode: executionModeToWire(settings.permission),
    ...(projectId === undefined || projectId === null ? {} : { projectId }),
  }
}

/**
 * One image a turn carries beside its words, already read and encoded.
 *
 * The item shape is Flue's `DeliveredAttachment`, spelled once here: base64
 * bytes, never a path - the sandbox has no read root that reaches anything
 * the user picked, and the model consumes pixels, not references. The body
 * key is `attachments` (Flue 2.0's own name for the field; 1.0 called it
 * `images`, and a body still using the old name would have the images
 * stripped silently at validation). Bytes travel in the moment of sending;
 * the harness persists them and re-sends them to the model on every later
 * turn of the conversation, which is the only way a stateless provider can
 * see an image twice.
 */
export interface TurnImageWire {
  readonly type: 'image'
  readonly data: string
  readonly mimeType: string
  readonly filename?: string
}

/* -------------------------------------------------------------------------- */
/* Deliveries                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * One delivery on an attached stream, already classified by Rust and parsed
 * where the contract allows it.
 *
 * `snapshot` is the history view's answer at a cold start: the whole
 * materialized conversation, from which content is seeded before the
 * updates connection opens. `chunks` replaces the raw `data` frame when the
 * payload parses as the chunk array the updates view promises; anything else
 * arrives as `frame` untouched, because a frame this layer cannot read is
 * still real bytes somebody may yet want. `keep-alive` is liveness only; it
 * reaches handlers so a UI can show quietness, but must never become
 * content. `replaying` distinguishes history being replayed from history
 * being made; it flips when `up-to-date` arrives and stays flipped.
 * `absent` means the harness answered that no stream exists for this
 * conversation yet — a fresh conversation, not a failure.
 */
export type ConversationDelivery =
  | {
      readonly kind: 'snapshot'
      readonly offset: string
      readonly snapshot: ConversationSnapshotFacts
    }
  | { readonly kind: 'absent'; readonly offset: string }
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
 * nobody was left reading — an explicit cancel, a superseded attach, or a
 * webview that went away mid-read. `absent` is how a cold start ends when
 * the harness has no stream for this conversation at all: there was
 * nothing to read, nothing broke, and submitting the first turn will
 * create what this read could not find.
 */
export type StreamSettlement =
  | { readonly outcome: 'ended' }
  | { readonly outcome: 'absent' }
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
   * Caller-chosen conversation id. ADR 0045: the id is ours — the UI
   * already stores conversation ids because it lists them — so there is
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
   * this webview has read to — ADR 0045: "everything else is re-derivable
   * from the id and that number".
   */
  lastOffset(): string | null
  /** Whether a read is currently attached; at most one ever is. */
  attached(): boolean
  /**
   * Submits one user turn and resolves with where its events begin. The
   * settings travel in the body; a model the harness cannot serve is refused
   * at admission, before anything is created. Images ride beside the words
   * as base64 parts, Flue's own submission shape — omitted entirely when the
   * turn carries none, so a text turn's body is byte-for-byte what it was.
   */
  submitTurn(
    message: string,
    settings?: TurnSettingsWire,
    images?: readonly TurnImageWire[],
  ): Promise<TurnResult<SubmittedTurn>>
  /**
   * Attaches a reader.
   *
   * With a retained offset (or one named explicitly) the read opens the
   * updates view strictly after that offset. Without one — a cold start —
   * the history view is read first and its snapshot delivered, because an
   * updates connection resumed without the projection state behind its
   * offset would render deltas whose messages never began. Attaching while
   * attached supersedes the older read first.
   */
  attach(handlers: AttachHandlers, options?: { readonly from?: string }): AttachHandle
  /**
   * Aborts the RUN: Flue's abort route, and the only thing that means
   * abort. 2.0's scope is the conversation's whole durable work - the
   * in-flight submission AND anything queued behind it - not "the current
   * turn" the way 1.0's was. Resolves with whether there was work to abort;
   * the `aborted` settlement arrives asynchronously on the stream.
   */
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
  const historyPath = (): string => `${agentsPath()}?view=history`
  const updatesPath = (): string => `${agentsPath()}?view=updates`

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
      // Not JSON, or not the shape: the null it was declared with stands.
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

    async submitTurn(message, settings, images) {
      // Never retried, here or above: an identical resend is a SECOND TURN
      // (the harness pins this behaviour in its own test), so a retry loop
      // would be duplication wearing a retry's clothes.
      //
      // The body is Flue 2.0's delivered-message envelope - `kind: "user"`
      // with the words in `body` - which is what the runtime validates before
      // admission; the 1.0 wire's bare `message` string is refused with a 400
      // before anything runs. The settings keys travel at the top level
      // beside the envelope under the harness contract's own spellings
      // (`modelId`, `reasoningLevel`, `permissionMode`): the turn-settings
      // middleware reads them there, and Flue strips them from the stored
      // payload. Null modelId is omitted: absent means the conversation's
      // settled state stands. A null reasoning level rides as null and the
      // harness rests it on medium, which is why the fallback below keeps
      // the choice absent rather than writing a level nobody picked. Images
      // ride under `attachments`, Flue's own payload field (1.0's `images`
      // key is gone and would be stripped) - empty means the key is absent,
      // which is what a text-only turn sends.
      const wire = settings ?? { modelId: null, reasoningLevel: null }
      const carried = images ?? []
      const sent = await request('POST', agentsPath(), JSON.stringify({
        kind: 'user',
        body: message,
        ...(wire.modelId === null ? {} : { modelId: wire.modelId }),
        reasoningLevel: wire.reasoningLevel,
        ...(wire.permissionMode === undefined ? {} : { permissionMode: wire.permissionMode }),
        ...(carried.length === 0 ? {} : { attachments: carried }),
      }))
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
      // ignored, including a resolve with no prior `Ended` — Rust returns
      // `Ok(())` for a reader gone or cancelled too, and with nobody left
      // reading, "cancelled" is the honest word for it.
      let done = false
      // Set by cancel() directly, because a cold start spends time in its
      // history fetch before any registered stream exists for the registry
      // to stop — and a superseded read must deliver nothing once told.
      let stopped = false
      // Whether a stream was ever registered. Cancelling a read that opened
      // one settles through the registry: Rust stops the reader and resolves
      // `service_stream`. A cold start cancelled BEFORE that has no reader to
      // stop, so nothing downstream would ever settle it — see cancel().
      let opened = false
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
            // The try covers the PARSE and nothing else. Reading the data
            // is a judgement about the frame; what the consumer then does
            // with it is not, and folding a consumer's exception into this
            // fallback would deliver the same bytes twice — once as chunks
            // and once as raw — while hiding the real failure.
            let chunks: readonly ChunkFacts[] | null = null
            try {
              const value: unknown = JSON.parse(event.data)
              if (Array.isArray(value)) {
                chunks = value
                  .map(readChunkFacts)
                  .filter((chunk): chunk is ChunkFacts => chunk !== null)
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
              return
            }
            handlers.onEvent({
              kind: 'chunks',
              offset: event.offset,
              replaying: !upToDate,
              chunks,
            })
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

      /**
       * Opens the updates view strictly after `from`. Rust appends the
       * offset and the live mode itself, so the path names only the view.
       */
      const openUpdates = (from: string) => {
        opened = true
        const pending = invoke('service_stream', {
          service: 'harness',
          path: updatesPath(),
          init: {},
          offset: from,
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
      }

      /**
       * The cold-start sequence: history first, then updates from wherever
       * the snapshot ended. A conversation the harness has never heard of
       * has no stream to attach to — that is `absent`, a normal state a
       * first submission leaves, not an error — and everything else that
       * can go wrong lands in the same settlements a broken read uses.
       */
      const openFromHistory = () => {
        void (async () => {
          const answer = await request('GET', historyPath(), undefined)
          if (done || stopped) return
          if ('failure' in answer) {
            resolveSettled(
              answer.failure.kind === 'broken'
                ? { outcome: 'broken', failure: answer.failure }
                : { outcome: 'refused', failure: answer.failure },
            )
            return
          }
          if (answer.status === 404) {
            // Streams are created when their agent instance receives its
            // first prompt. There is nothing to replay and nothing live.
            handlers.onEvent({ kind: 'absent', offset: '-1' })
            resolveSettled({ outcome: 'absent' })
            return
          }
          if (answer.status < 200 || answer.status >= 300) {
            resolveSettled({ outcome: 'refused', failure: refusalOf(answer.status, answer.bodyText) })
            return
          }
          let parsed: unknown
          try {
            parsed = JSON.parse(answer.bodyText)
          } catch {
            resolveSettled({
              outcome: 'broken',
              failure: {
                kind: 'malformed',
                message: 'The harness answered a history read with something that is not JSON.',
              },
            })
            return
          }
          const snapshot = readConversationSnapshot(parsed)
          if (snapshot === null || snapshot.offset === null) {
            resolveSettled({
              outcome: 'broken',
              failure: {
                kind: 'malformed',
                message: 'The history snapshot did not match the contract this client mirrors.',
              },
            })
            return
          }
          trackedOffset = snapshot.offset
          handlers.onEvent({ kind: 'snapshot', offset: snapshot.offset, snapshot })
          openUpdates(snapshot.offset)
        })()
      }

      const registration: AttachHandle = {
        settled,
        cancel() {
          // Prompt stop of THIS READ, by name, through Part 1's registry.
          // It never touches the run: a window going away cancels nothing.
          stopped = true
          // A cold start still inside its history read has no registered
          // stream, so the registry has nothing to stop and nothing else
          // will ever settle this handle. Say so here rather than leaving a
          // promise pending for the lifetime of the page — and leave the
          // opened case to the registry, whose Ok is the honest signal that
          // the reader really has gone.
          if (!opened) resolveSettled({ outcome: 'cancelled' })
          return invoke('service_stream_cancel', { streamId }).then(
            () => undefined,
            () => undefined,
          )
        },
      }

      const from = attachOptions?.from ?? trackedOffset
      // An explicitly named `-1` still goes straight to updates: the server
      // projects a full reset plus every chunk from scratch at that offset,
      // which is exactly what a caller asking for the beginning asked for.
      if (from !== null) openUpdates(from)
      else openFromHistory()

      active = registration
      // Supersede, don't stack: two live readers would deliver everything
      // twice. Fire-and-forget is enough — the old read settles `cancelled`
      // into whoever still awaits it.
      void previous?.cancel()
      return registration
    },

    /**
     * Aborts the RUN: Flue's abort route, and the only thing that means
     * abort. 2.0's scope is the conversation's durable work - the in-flight
     * submission AND anything queued behind it (measured on a live harness:
     * a submission sent while a response was live joins that host response,
     * so in practice one conversation holds at most one running response,
     * but the contract is conversation-wide, not per-submission). The
     * answer says whether there was work to abort; the `aborted` settlement
     * itself arrives asynchronously on the stream, which is why the stop
     * control reads on instead of ending anything.
     */
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
