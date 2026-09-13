/**
 * How a conversation read reaches the harness, in the two places it can.
 *
 * Reading a run is the one call that cannot be a request and a response. It is
 * a connection held open for as long as the turn lasts, and the two surfaces
 * Studio runs on hold it differently:
 *
 * - **In the desktop window**, Rust reads it. The per-launch bearer lives
 *   there and never comes here (ADR 0044), so the webview names a path and a
 *   `service_stream` command does the rest, delivering classified events over
 *   a Tauri channel.
 * - **In a browser on another device**, there is no Rust in the page. The
 *   request goes out as an ordinary `fetch` to a relative path, and Studio's
 *   own listener — running on the PC, beside the harness — attaches the bearer
 *   on the way to loopback.
 *
 * The comment this file replaces said there would deliberately never be a
 * browser path, because "a second SSE path in the webview would be two
 * credential stories for one process". That reasoning was right and no longer
 * applies: a browser read carries **no credential at all**. There is still
 * exactly one credential story, and it is still that Rust holds the bearer and
 * nothing else ever sees it. What changed is that the Rust doing the holding
 * can be reached over a socket instead of only over an invoke.
 *
 * ---- One shape, so the two cannot drift ------------------------------------
 *
 * Both are [`OpenStream`]: given a path and an offset, deliver
 * [`WireStreamEvent`]s until the read ends, and settle. `conversation.ts` has
 * one control flow over that shape rather than two branches of its own, which
 * is what keeps "what the desktop window saw" and "what the phone saw" the
 * same sentence rather than two readings of one log.
 */

import { Channel, invoke as tauriInvoke } from '@tauri-apps/api/core'

import { parseWireStreamEvent, type WireStreamEvent } from './contracts'
import { SseParser } from './sse'

/**
 * How a command leaves the process. Narrower than `typeof invoke` on purpose:
 * nothing here needs invoke options, and a test satisfies this with a plain
 * async function over a recorded call list.
 */
export type ServiceInvoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>

/** What a stream channel must look like to be handed into an invoke. */
export interface StreamChannel {
  readonly id: number
}

/** Builds the channel a stream's events arrive over; injectable for tests. */
export type ChannelFactory = (onMessage: (message: WireStreamEvent) => void) => StreamChannel

function defaultChannelFactory(
  onMessage: (message: WireStreamEvent) => void,
): StreamChannel {
  return new Channel<WireStreamEvent>(onMessage)
}

/** A read in progress. */
export interface StreamHandle {
  /**
   * Resolves when the read is over for any reason that is not a failure —
   * the run ended, the reader was cancelled, the body finished. Rejects with
   * a `ServiceError`-shaped object, which `seamFailure` classifies.
   */
  readonly settled: Promise<void>
  /** Stops reading. Never stops the run — see ADR 0045 section 5. */
  cancel(): Promise<void>
}

/** What a caller asks for when it wants to read a run. */
interface StreamRequest {
  /** The path, carrying its view and nothing else. */
  readonly path: string
  /** The opaque offset to resume strictly after. */
  readonly offset: string
  /** Delivered as events arrive, already classified. */
  readonly onEvent: (event: WireStreamEvent) => void
  /** Names this read, for the cancellation registry the command seam uses. */
  readonly streamId: string
}

/** The seam itself. */
export type OpenStream = (request: StreamRequest) => StreamHandle

/* -------------------------------------------------------------------------- */
/* The desktop window: Rust reads, and says what it read                       */
/* -------------------------------------------------------------------------- */

function commandStream(invoke: ServiceInvoke, createChannel: ChannelFactory): OpenStream {
  return ({ path, offset, onEvent, streamId }) => {
    const channel = createChannel((raw) => {
      const event = parseWireStreamEvent(raw)
      if (event !== null) onEvent(event)
    })
    const settled = invoke('service_stream', {
      service: 'harness',
      path,
      init: {},
      offset,
      streamId,
      channel,
    }).then(() => undefined)
    return {
      settled,
      cancel: () =>
        invoke('service_stream_cancel', { streamId }).then(
          () => undefined,
          () => undefined,
        ),
    }
  }
}

/* -------------------------------------------------------------------------- */
/* A browser: read the body, and do what Rust does with it                     */
/* -------------------------------------------------------------------------- */

/**
 * How long the read may go without a byte from the server.
 *
 * The same 45 seconds `service_stream` uses, and for the same reason: the
 * harness heartbeats its stream, so silence past three missed heartbeats means
 * dead or frozen rather than quiet. A stream with no bound at all is one that
 * can hang a page forever with no way to tell.
 */
const READ_IDLE_TIMEOUT_MS = 45_000

/**
 * How often the read tells its consumer it is still going.
 *
 * Mirrors Rust's channel heartbeat, so a quiet stream produces the same
 * events on both surfaces and a consumer that watches for them behaves the
 * same in a browser as in the window.
 */
const KEEP_ALIVE_MS = 15_000

/**
 * The value a cancelled read resolves with, raced against the body.
 *
 * A unique object rather than a string or null: the race has to be decidable
 * without asking what the body might have produced, and a sentinel nothing
 * else can construct decides it.
 */
const CANCELLED = Symbol('cancelled')

/** How much of a refusal body is worth carrying into a message. */
const EXCERPT = 500

function excerpt(body: string): string {
  const trimmed = body.trim()
  return trimmed.length <= EXCERPT ? trimmed : `${trimmed.slice(0, EXCERPT)}…`
}

/** A refusal, in the shape `seamFailure` reads. */
function refused(status: number, message: string): unknown {
  return { kind: 'stream-refused', status, message }
}

/** A stream that began and then failed, in the shape `seamFailure` reads. */
function broken(message: string): unknown {
  return { kind: 'stream-broken', message }
}

/**
 * The stream URL: the caller's path, the offset, and the live mode.
 *
 * The same composition `compose_stream_url` performs in Rust, including its
 * two refusals. A path that already carries an offset is this client's bug and
 * is refused here rather than sent, because the harness would reject two
 * offsets and the error would name the wrong layer.
 */
export function composeStreamUrl(path: string, offset: string): string {
  if (path.includes('#')) {
    throw broken('a stream path cannot carry a fragment: the offset would join it, not the query')
  }
  if (offset === '') {
    throw broken('the offset is empty; a stream must say where to resume from (-1 for the beginning)')
  }
  const query = path.includes('?') ? path.slice(path.indexOf('?') + 1) : null
  const names = query === null ? [] : query.split('&').map((parameter) => parameter.split('=')[0])
  if (names.includes('offset')) {
    throw broken(
      'the path already carries an offset; the reader adds its own, and two are not a request the harness accepts',
    )
  }
  const separator = path.includes('?') ? '&' : '?'
  const live = names.includes('live') ? '' : '&live=sse'
  return `${path}${separator}offset=${encodeURIComponent(offset)}${live}`
}

/**
 * Reads one run over HTTP, classifying frames exactly as Rust's `deliver`
 * does.
 *
 * The classification is not a second interpretation of the protocol; it is the
 * same rules transferred. A frame that is not `control` is delivered as it
 * stands, carrying the offset currently in force. A `control` frame is the
 * protocol talking: it must be JSON and it must carry `streamNextOffset`,
 * because without the resume point the contract this whole design rests on is
 * already broken and a quiet guess would be worse than saying so.
 */
export function httpStream(
  // Wrapped rather than passed as `globalThis.fetch` directly: a browser's
  // `fetch` throws "Illegal invocation" when called detached from `window`.
  fetchImpl: typeof fetch = (input, init) => globalThis.fetch(input, init),
): OpenStream {
  return ({ path, offset, onEvent }) => {
    const controller = new AbortController()
    let cancelled = false
    let timedOut = false
    // Resolved by `cancel`, and raced against every read. The sentinel is a
    // value the body can never produce, so winning the race is unambiguous.
    let stop!: () => void
    const stopped = new Promise<typeof CANCELLED>((resolve) => {
      stop = () => resolve(CANCELLED)
    })

    const settled = (async () => {
      const url = composeStreamUrl(path, offset)

      let response: Response
      try {
        response = await fetchImpl(url, {
          method: 'GET',
          headers: { accept: 'text/event-stream' },
          // A conversation stream must never be served from a cache, and a
          // browser will try if the response ever looks cacheable.
          cache: 'no-store',
          signal: controller.signal,
        })
      } catch (error) {
        if (cancelled) return
        throw broken(messageOf(error, 'The read could not reach Studio.'))
      }

      if (!response.ok) {
        const body = await response.text().catch(() => '')
        throw refused(response.status, excerpt(body) || 'The harness refused the read.')
      }
      const contentType = response.headers.get('content-type') ?? ''
      if (!contentType.startsWith('text/event-stream')) {
        throw refused(
          response.status,
          `answered ${response.status} with content-type ${contentType}`,
        )
      }
      if (response.body === null) {
        throw broken('The harness answered a stream with no body to read.')
      }

      // The offset in force. Every event delivered carries it, which is what
      // makes a reattach replay the event an interruption interrupted rather
      // than skip it.
      let current = offset
      let upToDate = false
      let ended = false

      const keepAlive = setInterval(() => {
        onEvent({ kind: 'keep-alive', offset: current })
      }, KEEP_ALIVE_MS)
      let idle = setTimeout(() => {
        timedOut = true
        controller.abort()
      }, READ_IDLE_TIMEOUT_MS)

      const reader = response.body.getReader()
      const parser = new SseParser()
      try {
        for (;;) {
          let chunk: ReadableStreamReadResult<Uint8Array>
          try {
            // Raced against the cancellation rather than relying on the abort
            // signal to tear the body down. Aborting a real `fetch` does error
            // its body, but that is the environment's promise and not this
            // reader's: if it ever does not, an unraced read waits for a chunk
            // that will never come and the page holds the connection forever.
            // Cancelling is a local fact and should behave like one.
            const next: ReadableStreamReadResult<Uint8Array> | typeof CANCELLED =
              await Promise.race([reader.read(), stopped])
            if (next === CANCELLED) return
            chunk = next
          } catch (error) {
            if (cancelled) return
            if (timedOut) {
              throw broken(
                `the harness sent nothing for ${READ_IDLE_TIMEOUT_MS / 1000}s, past its own heartbeat`,
              )
            }
            throw broken(messageOf(error, 'The stream broke mid-flight.'))
          }
          if (chunk.done) break

          clearTimeout(idle)
          idle = setTimeout(() => {
            timedOut = true
            controller.abort()
          }, READ_IDLE_TIMEOUT_MS)

          for (const frame of parser.push(chunk.value)) {
            const outcome = deliver(frame, current, upToDate, onEvent)
            current = outcome.offset
            upToDate = outcome.upToDate
            if (outcome.closed) {
              ended = true
              break
            }
          }
          if (ended) break
        }
        if (!ended) {
          for (const frame of parser.finish()) {
            const outcome = deliver(frame, current, upToDate, onEvent)
            current = outcome.offset
            upToDate = outcome.upToDate
            if (outcome.closed) break
          }
        }
      } finally {
        clearInterval(keepAlive)
        clearTimeout(idle)
        // `reader.cancel` rather than `releaseLock`: it closes the body and
        // releases the lock together, and it is the one that is legal while a
        // read is still pending - which it is whenever this unwinds through
        // the cancellation race. Closing the body is what actually ends the
        // connection to Studio's listener, so a reader that goes away does not
        // leave a stream running behind it. Harmless after a clean end.
        await reader.cancel().catch(() => undefined)
      }
    })()

    return {
      settled,
      cancel: () => {
        cancelled = true
        stop()
        controller.abort()
        // Nothing to await: aborting is local and immediate, and the promise
        // above resolves on its own once the read unwinds.
        return Promise.resolve()
      },
    }
  }
}

/** What one frame means, and what it leaves in force. */
function deliver(
  frame: { readonly event: string | null; readonly data: string },
  offset: string,
  upToDate: boolean,
  onEvent: (event: WireStreamEvent) => void,
): { offset: string; upToDate: boolean; closed: boolean } {
  if (frame.event !== 'control') {
    onEvent({
      kind: 'frame',
      offset,
      ...(frame.event === null ? {} : { event: frame.event }),
      data: frame.data,
    })
    return { offset, upToDate, closed: false }
  }

  let control: unknown
  try {
    control = JSON.parse(frame.data)
  } catch {
    throw broken('a control frame was not valid JSON')
  }
  if (typeof control !== 'object' || control === null) {
    throw broken('a control frame was not valid JSON')
  }
  const record = control as Record<string, unknown>
  const next = record['streamNextOffset']
  if (typeof next !== 'string') {
    throw broken('a control frame carried no streamNextOffset')
  }

  const nowUpToDate = record['upToDate'] === true
  let stillUpToDate = upToDate
  if (nowUpToDate && !upToDate) {
    stillUpToDate = true
    onEvent({ kind: 'up-to-date', offset: next })
  } else if (!nowUpToDate) {
    // Behind the tail again after having been live: new events are being
    // replayed into the stream. No event for this direction — frames arriving
    // says it — but the transition must re-arm so a later catch-up is
    // reported again.
    stillUpToDate = false
  }

  if (record['closed'] === true) {
    onEvent({ kind: 'ended', offset: next })
    return { offset: next, upToDate: stillUpToDate, closed: true }
  }
  return { offset: next, upToDate: stillUpToDate, closed: false }
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message !== '' ? error.message : fallback
}

/**
 * The seam a client should use when it was not told.
 *
 * The rule, stated rather than inferred: a client handed an `invoke` reads
 * through it, because being handed a command transport is a caller saying that
 * commands are how this process reaches the service — which is true of the
 * desktop window and of every test that scripts one. Everything else reads
 * over HTTP, which is what a browser on another device is.
 */
export function defaultStream(
  invoke: ServiceInvoke | undefined,
  createChannel: ChannelFactory | undefined,
  inTauri: boolean,
): OpenStream {
  if (invoke !== undefined || inTauri) {
    return commandStream(invoke ?? tauriInvoke, createChannel ?? defaultChannelFactory)
  }
  return httpStream()
}
