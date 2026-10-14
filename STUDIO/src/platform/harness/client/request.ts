import { parseHarnessErrorBody } from '../contracts'
import { harnessTransport } from '../transport'

/**
 * One request to the harness, and what comes back.
 *
 * Every method of the client is a call to `json` or `empty` from here. The
 * credential is held in the closure and sent as a header. It is never
 * logged, never put in a URL, and never stored. Nothing here writes to
 * localStorage or the Tauri store.
 */

/**
 * Long enough that the slowest honest answer still arrives.
 *
 * `POST /connections/:id/probe` calls out to the provider's own endpoint with
 * an 8 second budget of its own (`PROBE_TIMEOUT_MS` in
 * `STUDIO HARNESS/src/gateway/connections/connection-probe.ts:19`), and only then reads
 * the OS credential store and serializes a reply. A client timeout at or below
 * 8s would abort exactly the probes that are about to report a useful
 * timeout failure, turning a precise "the provider did not answer in 8s" into
 * a useless "the harness did not answer". 12s leaves four seconds of headroom
 * over the slowest path and is still short enough that a wedged harness is
 * visible rather than a hang.
 */
const DEFAULT_TIMEOUT_MS = 12_000

export interface HarnessAddress {
  /**
   * Origin, optionally with a path prefix. A trailing slash is tolerated. The
   * empty string means this page's own origin — the listener-served browser
   * (ADR 0050), whose every request is relative and gated by its device
   * cookie before it is forwarded.
   */
  readonly baseUrl: string
  /**
   * The bearer credential minted by whoever launched the harness. Held for
   * the life of the client and sent as a header; never persisted, never
   * logged, never a query parameter.
   */
  readonly credential: string
}

export interface HarnessClientOptions extends HarnessAddress {
  /**
   * The fetch implementation. Injected so tests can stub the transport
   * without a running harness and without patching a global.
   */
  readonly fetch?: typeof globalThis.fetch
  readonly timeoutMs?: number
}

export type HarnessFailure =
  | { readonly kind: 'not-reachable'; readonly message: string; readonly timedOut: boolean }
  | { readonly kind: 'unauthorized'; readonly message: string; readonly status: number }
  | {
      readonly kind: 'harness-error'
      readonly message: string
      readonly status: number
      readonly code?: string
    }
  | { readonly kind: 'malformed-response'; readonly message: string }

export type HarnessResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: HarnessFailure }

/** The two shapes of request every method is made of. */
export interface Requester {
  /** A request whose success carries a parsed body. */
  readonly json: <T>(
    method: string,
    path: string,
    body: unknown,
    parse: (value: unknown) => T | null,
    budgetMs?: number,
  ) => Promise<HarnessResult<T>>
  /** A request whose success carries nothing: the harness replies 204. */
  readonly empty: (method: string, path: string, body?: unknown, budgetMs?: number) => Promise<HarnessResult<void>>
}

export function createRequester(options: HarnessClientOptions): Requester {
  const { baseUrl, credential } = options
  // The default goes through Rust, not the webview. The harness serves no CORS
  // headers and the webview's origin is cross-origin to a loopback port, so a
  // browser fetch never gets past the preflight; a request issued from Rust has
  // no origin to preflight. `transport.ts` says why at length, and the
  // capability — not this module — is what limits where it may go.
  //
  // Still just a `typeof globalThis.fetch`, so the injection seam above is
  // unchanged and every test that supplies its own transport is unaffected.
  const send = options.fetch ?? harnessTransport
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

  /**
   * The scheme is `Authorization: Bearer <credential>`, taken from the
   * harness's own verifier: `presentedCredential` in
   * `STUDIO HARNESS/src/admission/verifier.ts` matches `/^Bearer ([^\s]+)$/i`
   * against the `Authorization` header, and the middleware reads exactly that
   * header (`transport/http/middleware/admission.ts`), answering 401 with
   * `WWW-Authenticate: Bearer` when it is missing or malformed.
   */
  function headers(hasBody: boolean): Record<string, string> {
    return {
      Authorization: `Bearer ${credential}`,
      Accept: 'application/json',
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
    }
  }

  async function call(
    method: string,
    path: string,
    body: unknown,
    budgetMs = timeoutMs,
  ): Promise<HarnessResult<Response>> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), budgetMs)
    try {
      const response = await send(join(baseUrl, path), {
        method,
        headers: headers(body !== undefined),
        cache: 'no-store',
        signal: controller.signal,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
      return { ok: true, value: response }
    } catch (error) {
      // fetch rejects for exactly one class of reason: the exchange never
      // completed. A refused connection, a DNS failure and our own abort all
      // arrive here, and all three mean the same thing to the user.
      const timedOut = controller.signal.aborted
      return failed({
        kind: 'not-reachable',
        timedOut,
        message: timedOut
          ? `The harness did not answer within ${Math.round(budgetMs / 1000)} seconds.`
          : `The harness could not be reached at ${baseUrl}. ${describe(error)}`,
      })
    } finally {
      clearTimeout(timer)
    }
  }

  async function json<T>(
    method: string,
    path: string,
    body: unknown,
    parse: (value: unknown) => T | null,
    budgetMs?: number,
  ): Promise<HarnessResult<T>> {
    const sent = await call(method, path, body, budgetMs)
    if (!sent.ok) return sent

    const response = sent.value
    if (!response.ok) return failed(await failureFor(response))

    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      return failed({
        kind: 'malformed-response',
        message: 'The harness answered with something that is not JSON.',
      })
    }

    const parsed = parse(payload)
    if (parsed === null) {
      return failed({
        kind: 'malformed-response',
        message:
          'The harness answered with a body that does not match the provider contract. The wire types in platform/harness/contracts/ may have drifted from the harness.',
      })
    }
    return { ok: true, value: parsed }
  }

  async function empty(method: string, path: string, body?: unknown, budgetMs?: number): Promise<HarnessResult<void>> {
    const sent = await call(method, path, body, budgetMs)
    if (!sent.ok) return sent
    const response = sent.value
    return response.ok ? { ok: true, value: undefined } : failed(await failureFor(response))
  }

  return { json, empty }
}

function failed(error: HarnessFailure): { ok: false; error: HarnessFailure } {
  return { ok: false, error }
}

/**
 * Joins the configured base onto a route path.
 *
 * Not `new URL(path, baseUrl)`: that resolves an absolute path against the
 * origin alone and would silently discard a base URL carrying a prefix, which
 * is exactly the configuration someone puts the harness behind when they run
 * it under a local reverse proxy.
 */
function join(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${path}`
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : 'The request could not be sent.'
}

/**
 * Turns a non-2xx response into the failure the UI branches on.
 *
 * The body is read before the status is judged, because the harness puts its
 * own sentence there for every failure it authors, and that sentence is what
 * the user should see.
 */
async function failureFor(response: Response): Promise<HarnessFailure> {
  let body: unknown
  try {
    body = await response.json()
  } catch {
    body = undefined
  }
  const parsed = parseHarnessErrorBody(body)

  if (response.status === 401 || response.status === 403) {
    return {
      kind: 'unauthorized',
      status: response.status,
      message:
        parsed?.error ??
        'The harness refused this credential. It was minted by whoever launched the harness and is only valid for that launch.',
    }
  }

  return {
    kind: 'harness-error',
    status: response.status,
    message: parsed?.error ?? `The harness answered ${response.status} with no explanation.`,
    ...(parsed?.code === undefined ? {} : { code: parsed.code }),
  }
}
