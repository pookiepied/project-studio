import { invoke } from '@tauri-apps/api/core'
import { isTauri } from '@/platform/tauri'

/**
 * How a harness request actually leaves the process.
 *
 * ---- Why this is not just `fetch` ------------------------------------------
 *
 * The harness serves no CORS headers. That is deliberate on its side and
 * should stay that way: it is a loopback service holding provider credentials,
 * and a service like that has no business being reachable by any origin a
 * browser is willing to preflight. An allow-list would not fix it either —
 * an allow-list is a config value, and config values get widened to `*` during
 * one debugging session and never narrowed again.
 *
 * But the packaged webview's origin is `http://tauri.localhost`, which is
 * cross-origin to a port on 127.0.0.1, so every browser `fetch` from the app
 * died at the preflight with "No 'Access-Control-Allow-Origin' header is
 * present". Task 16 confirmed this against a live harness and had to stand up
 * a same-origin proxy to get past it.
 *
 * Inside Tauri the request therefore leaves through the service seam: the
 * `service_fetch` command in `src-tauri/src/services.rs`. The webview sends a
 * service id and a path — never a URL it chose, never a credential it holds
 * — and Rust resolves the address from the supervisor, attaches the bearer
 * the supervisor minted, and refuses any path that could steer the request
 * off the harness's origin. This is also why the client's `Authorization`
 * header is inert here: Rust replaces it, so the placeholder the connection
 * layer puts there (`connection.ts`) never reaches the wire. It replaced the
 * HTTP plugin, which marshalled a full URL across and needed a capability
 * grant to do it; a command of our own needs none.
 *
 * ---- Why the choice is made per request ------------------------------------
 *
 * Not at import time, and not once when a client is constructed. Two reasons.
 *
 * `isTauri()` reads `window.__TAURI_INTERNALS__`, which is injected by the
 * webview and is not guaranteed to be there the instant a module is evaluated.
 * A module-scope `const transport = isTauri() ? ... : ...` would bake in
 * whatever was true at import and be wrong forever after. The harness had this
 * exact bug in `net/own-ports.ts` and the fix was the same one: read on every
 * call.
 *
 * And `globalThis.fetch` is looked up per call rather than bound once, so a
 * test that replaces the global after a client exists still gets its stub.
 * Binding at construction would silently ignore it.
 *
 * The cost is two property reads per request, against a request that is about
 * to cross a process boundary.
 */

/** What `service_fetch` sends back: a response flattened for the invoke. */
interface SerializedServiceResponse {
  readonly status: number
  readonly headers: ReadonlyArray<readonly [string, string]>
  readonly body: string
}

/**
 * The shape `service_fetch` rejects with, tagged by kind. `not-running` is
 * the one worth distinguishing: it means "the harness is not started", not
 * "the request failed".
 */
interface SerializedServiceError {
  readonly kind: string
  readonly message?: string
}

/**
 * Thrown where `fetch` would simply reject, keeping the command's `kind`
 * distinguishable at the throw site.
 */
class ServiceFetchError extends Error {
  readonly kind: string
  constructor(kind: string, message: string) {
    super(message)
    this.name = 'ServiceFetchError'
    this.kind = kind
  }
}

function isSerializedServiceError(value: unknown): value is SerializedServiceError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    typeof value.kind === 'string'
  )
}

function describeServiceError(error: SerializedServiceError): string {
  if (error.kind === 'not-running') return 'The harness is not running.'
  return error.message ?? 'The request through the service seam failed.'
}

function toError(value: unknown): Error {
  if (isSerializedServiceError(value)) {
    return new ServiceFetchError(value.kind, describeServiceError(value))
  }
  return value instanceof Error
    ? value
    : new Error('service_fetch rejected without an explanation.')
}

/**
 * Strips the origin the client added, leaving the path Rust re-addresses.
 *
 * The workspace client builds `baseUrl + path` because its seam is `fetch`,
 * which takes a URL; this takes the path back out because the other side of
 * the seam refuses URLs on purpose. The conversation client sends the path
 * alone, and that is passed through as it is. The origin here is advisory only — if the harness
 * restarted since the address was resolved, Rust sends this path to the new
 * endpoint with the new credential, which is the correct request.
 *
 * A `Request` object is refused rather than half-handled: its init (method,
 * headers, body) lives on the object, not beside it, and silently dropping
 * whatever was there would be worse than saying no. Nothing in this app
 * sends one.
 */
function servicePath(input: RequestInfo | URL): string {
  if (typeof input === 'string') {
    // A bare path is already what Rust wants. The conversation client sends
    // exactly these - `/agents/studio/<id>` with no origin, because it has
    // no origin to add - and `new URL` on one throws `Invalid URL`, which
    // read at the composer as "the harness stopped answering while the
    // message was being sent" for a harness that was never asked.
    if (input.startsWith('/')) return input
    const url = new URL(input)
    return `${url.pathname}${url.search}`
  }
  if (input instanceof URL) return `${input.pathname}${input.search}`
  throw new TypeError('The service seam takes a URL or a URL string, not a Request object.')
}

/**
 * The rejection `fetch` produces for an aborted exchange.
 *
 * An `Error` with the `AbortError` name rather than a `DOMException`, because
 * consumers branch on `name` and on `instanceof Error` (as `toError` below
 * does), and the two disagree in some environments — jsdom's DOMException,
 * for one, is not an `Error` instance. Nothing anywhere checks for
 * `instanceof DOMException`.
 */
function abortError(): Error {
  const error = new Error('The request was aborted.')
  error.name = 'AbortError'
  return error
}

/**
 * Stops waiting when the signal fires, exactly as `fetch` does.
 *
 * The invoke underneath cannot be cancelled from JS — the command runs to
 * completion in Rust, bounded by its own timeout — but the client's timeout
 * only works if this side stops waiting, and an `AbortError` is how `fetch`
 * says "the caller gave up" rather than "the other end is gone". `client/request.ts`
 * reads the difference (`timedOut`).
 */
function raceAbort<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError())
    signal.addEventListener('abort', onAbort, { once: true })
    pending.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error: Error) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}

async function throughServiceSeam(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  // Before anything else, per fetch semantics: an already-aborted signal
  // rejects without dispatching.
  if (init?.signal?.aborted) throw abortError()

  const path = servicePath(input)
  const headers: Array<[string, string]> = []
  if (init?.headers !== undefined) {
    // Normalised through `Headers`, so every shape fetch accepts (record,
    // Headers, pairs) becomes the one shape the command accepts. Names come
    // out lowercase; the Rust side compares case-insensitively when it
    // replaces Authorization, so the placeholder never escapes either way.
    new Headers(init.headers).forEach((value, name) => {
      headers.push([name, value])
    })
  }
  if (init?.body !== undefined && typeof init.body !== 'string') {
    throw new TypeError('The service seam carries string bodies; serialize before sending.')
  }

  const pending = invoke<SerializedServiceResponse>('service_fetch', {
    service: 'harness',
    path,
    init: {
      method: init?.method,
      headers,
      body: typeof init?.body === 'string' ? init.body : undefined,
    },
  })

  const signal = init?.signal ?? undefined
  let serialized: SerializedServiceResponse
  try {
    serialized = signal ? await raceAbort(pending, signal) : await pending
  } catch (error) {
    // Whether the command failed or the caller aborted: one place where the
    // rejection becomes an `Error` a caller can read.
    throw toError(error)
  }

  const responseHeaders = new Headers()
  for (const [name, value] of serialized.headers) responseHeaders.append(name, value)

  // A null-body status cannot be given even an empty string — the `Response`
  // constructor throws — and a 204 (the DELETE reply) is routine here.
  const body = serialized.body === '' ? null : serialized.body
  return new Response(body, {
    status: serialized.status,
    headers: responseHeaders,
  })
}

/**
 * Signature-compatible with `typeof globalThis.fetch` on purpose: the client's
 * injection seam is a `fetch`, and staying one is what lets every existing
 * test that supplies its own transport keep working unmodified.
 */
export const harnessTransport: typeof globalThis.fetch = (input, init) =>
  isTauri() ? throughServiceSeam(input, init) : globalThis.fetch(input, init)
