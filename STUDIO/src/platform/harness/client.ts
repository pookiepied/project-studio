/**
 * The one module in STUDIO that speaks HTTP.
 *
 * It talks to the STUDIO HARNESS, a separate local process listening on
 * 127.0.0.1 whose address and bearer credential arrive from `connection.ts`.
 * Routes are mounted at `/api/providers` by
 * `STUDIO HARNESS/src/transport/http/create-app.ts:42`, and every one of them
 * sits behind the admission middleware plus a PROVIDER_MANAGEMENT scope check.
 *
 * Three deliberate shapes:
 *
 * 1. Failures are values, not exceptions. Every method returns a
 *    `HarnessResult`, so a settings pane can render "harness not running"
 *    without an error boundary and without a try block.
 * 2. Nothing is trusted because TypeScript described it. Every response body
 *    goes through a parser from `contracts.ts`, and a body that does not match
 *    is a `malformed-response` failure rather than a value.
 * 3. No retries. A local process that does not answer is a fact to show the
 *    user, not a thing to hammer -- a retry loop against a dead loopback port
 *    only delays the truth.
 *
 * The credential is held in this object and sent as a header. It is never
 * logged, never put in a URL, and never stored. Nothing here writes to
 * localStorage or the Tauri store.
 */

import {
  parseHarnessErrorBody,
  parseProbeResult,
  parseProviderConnection,
  parseProviderConnections,
  parseProviderModels,
  type CapabilitySlot,
  type ProbeResult,
  type ProviderConnection,
  type ProviderConnectionDraft,
  type ProviderConnectionPatch,
  type ProviderKind,
  type ProviderModel,
} from './contracts'

/**
 * Long enough that the slowest honest answer still arrives.
 *
 * `POST /connections/:id/probe` calls out to the provider's own endpoint with
 * an 8 second budget of its own (`PROBE_TIMEOUT_MS` in
 * `STUDIO HARNESS/src/providers/connection-probe.ts:19`), and only then reads
 * the OS credential store and serializes a reply. A client timeout at or below
 * 8s would abort exactly the probes that are about to report a useful
 * timeout failure, turning a precise "the provider did not answer in 8s" into
 * a useless "the harness did not answer". 12s leaves four seconds of headroom
 * over the slowest path and is still short enough that a wedged harness is
 * visible rather than a hang.
 */
export const DEFAULT_TIMEOUT_MS = 12_000

/** Where the harness is and what proves we may talk to it. */
export interface HarnessAddress {
  /** Origin, optionally with a path prefix. A trailing slash is tolerated. */
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

/**
 * The failures a Connections page has to tell apart.
 *
 * `not-reachable` is nothing at the other end: the harness is not running, the
 * port moved, or it did not answer inside the timeout. The remedy is to start
 * it. `unauthorized` is a live harness refusing this credential -- 401 when it
 * does not recognise it, 403 when it does but the session lacks
 * PROVIDER_MANAGEMENT. Both are the same remedy, a fresh launch, so they are
 * one case with different words. `harness-error` is the harness working
 * correctly and saying no, and it carries the sentence the harness wrote
 * because that sentence is better than anything this layer could invent.
 * `malformed-response` is a 2xx whose body did not match the contract, which
 * means this file's mirror of the contract has drifted from the harness's.
 */
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

/** Filter accepted by `GET /api/providers/models`. */
export interface ModelFilter {
  readonly connectionId?: string
  readonly kind?: ProviderKind
  readonly capability?: CapabilitySlot
}

export interface HarnessClient {
  listConnections(): Promise<HarnessResult<readonly ProviderConnection[]>>
  createConnection(draft: ProviderConnectionDraft): Promise<HarnessResult<ProviderConnection>>
  updateConnection(
    id: string,
    patch: ProviderConnectionPatch,
  ): Promise<HarnessResult<ProviderConnection>>
  deleteConnection(id: string): Promise<HarnessResult<void>>
  probeConnection(id: string): Promise<HarnessResult<ProbeResult>>
  listModels(filter?: ModelFilter): Promise<HarnessResult<readonly ProviderModel[]>>
}

const PROVIDERS_PATH = '/api/providers'

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

/** Only the params that were actually supplied; an empty filter adds no query. */
function query(filter: ModelFilter): string {
  const params = new URLSearchParams()
  if (filter.connectionId !== undefined) params.set('connectionId', filter.connectionId)
  if (filter.kind !== undefined) params.set('kind', filter.kind)
  if (filter.capability !== undefined) params.set('capability', filter.capability)
  const search = params.toString()
  return search === '' ? '' : `?${search}`
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

export function createHarnessClient(options: HarnessClientOptions): HarnessClient {
  const { baseUrl, credential } = options
  const send = options.fetch ?? globalThis.fetch.bind(globalThis)
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
  ): Promise<HarnessResult<Response>> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
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
          ? `The harness did not answer within ${Math.round(timeoutMs / 1000)} seconds.`
          : `The harness could not be reached at ${baseUrl}. ${describe(error)}`,
      })
    } finally {
      clearTimeout(timer)
    }
  }

  /** A request whose success carries a parsed body. */
  async function json<T>(
    method: string,
    path: string,
    body: unknown,
    parse: (value: unknown) => T | null,
  ): Promise<HarnessResult<T>> {
    const sent = await call(method, path, body)
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
          'The harness answered with a body that does not match the provider contract. The wire types in platform/harness/contracts.ts may have drifted from the harness.',
      })
    }
    return { ok: true, value: parsed }
  }

  /** A request whose success carries nothing: the harness replies 204. */
  async function empty(method: string, path: string): Promise<HarnessResult<void>> {
    const sent = await call(method, path, undefined)
    if (!sent.ok) return sent
    const response = sent.value
    return response.ok ? { ok: true, value: undefined } : failed(await failureFor(response))
  }

  function connectionPath(id: string, suffix = ''): string {
    return `${PROVIDERS_PATH}/connections/${encodeURIComponent(id)}${suffix}`
  }

  return {
    listConnections() {
      return json('GET', `${PROVIDERS_PATH}/connections`, undefined, parseProviderConnections)
    },

    createConnection(draft) {
      // The draft may carry `apiKey`. It goes out in this body and is gone the
      // moment the request is serialized -- the 201 that comes back is a
      // ProviderConnection, which by contract has no key on it.
      return json(
        'POST',
        `${PROVIDERS_PATH}/connections`,
        draft,
        parseProviderConnection,
      )
    },

    updateConnection(id, patch) {
      return json('PATCH', connectionPath(id), patch, parseProviderConnection)
    },

    deleteConnection(id) {
      return empty('DELETE', connectionPath(id))
    },

    probeConnection(id) {
      // A refused key or a dead endpoint is a 200 with `ok: false` -- the probe
      // succeeded as a probe. Only a missing connection is a 404 here.
      return json('POST', connectionPath(id, '/probe'), undefined, parseProbeResult)
    },

    listModels(filter = {}) {
      return json(
        'GET',
        `${PROVIDERS_PATH}/models${query(filter)}`,
        undefined,
        parseProviderModels,
      )
    },
  }
}
